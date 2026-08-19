// Client eBay Browse API, en lecture seule. Aucune écriture n'est possible depuis ce
// module : c'est délibéré. Le risque dominant du projet business n'est pas la sécurité
// informatique mais la suspension de compte, et une API de lecture ne peut pas la causer.
//
// `transport` est injectable pour que les tests exercent la vraie normalisation sans
// réseau ni credentials. Sans lui, on prend le fetch natif (Node 18+).
const DEFAULT_BASE_URL = "https://api.sandbox.ebay.com";

// Le sandbox et la prod ont la même surface, seule la base change. Par défaut on vise
// le sandbox : il faut une action délibérée pour taper la prod, pas un oubli.
function baseUrl(env) {
  return env.EBAY_BASE_URL || DEFAULT_BASE_URL;
}

// eBay ne refuse pas une requête sans place de marché : il en choisit une, EBAY_US, et
// renvoie des prix en dollars sans jamais le dire. Un spec qui demande des euros recevait
// donc des dollars, et rien dans la réponse ne signalait l'écart. On la déclare.
//
// Le défaut reste EBAY_US : c'est le seul marché peuplé dans le sandbox, et basculer sur
// EBAY_FR doit être une décision, pas un héritage silencieux.
const DEFAULT_MARKETPLACE = "EBAY_US";

function marketplace(env) {
  return env.EBAY_MARKETPLACE_ID || DEFAULT_MARKETPLACE;
}

// Un token applicatif eBay vit environ 2 heures. Le stocker dans un .env condamne tout
// run planifié à échouer sur un token périmé, sans que rien n'explique pourquoi. Ce sont
// donc les identifiants permanents qu'on range, et le token se fabrique à la demande.
//
// EBAY_OAUTH_TOKEN reste accepté comme échappatoire : pratique pour un essai à la main
// avec un token collé depuis la console développeur, inutilisable pour de l'automatisé.
const SCOPE = "https://api.ebay.com/oauth/api_scope";

// Lire et écrire sur eBay ne demandent pas le même jeton, et c'est vérifié : avec les
// identifiants applicatifs, demander le scope sell.inventory rend un 400 invalid_scope,
// et appeler l'API Sell avec un jeton applicatif rend un 403 « Insufficient permissions ».
//
// Écrire exige un jeton UTILISATEUR, obtenu une fois par consentement dans un navigateur,
// puis renouvelé sans interaction depuis un refresh token qui vit environ 18 mois.
const SCOPE_VENTE = "https://api.ebay.com/oauth/api_scope/sell.inventory";

// Publier une annonce demande des politiques de livraison, paiement et retour, qui
// vivent dans la Sell Account API. Changer un prix n'en a pas besoin, ce scope reste
// donc hors du jeu par défaut : élargir un droit d'écriture pour le confort d'un cas
// qu'on ne traite pas est un mauvais échange, et un consentement se redemande.
const SCOPE_COMPTE = "https://api.ebay.com/oauth/api_scope/sell.account";

// Le consentement ne se donne pas sur le même hôte que les appels d'API.
function authBase(env) {
  if (env.EBAY_AUTH_URL) return env.EBAY_AUTH_URL;
  return baseUrl(env).includes("sandbox")
    ? "https://auth.sandbox.ebay.com"
    : "https://auth.ebay.com";
}

// L'URL à ouvrir dans un navigateur, une seule fois. eBay attend le RuName de la console
// développeur comme `redirect_uri`, pas une URL littérale.
function urlConsentement({ env, scopes = [SCOPE, SCOPE_VENTE] }) {
  const runame = env.EBAY_RUNAME;
  if (!env.EBAY_CLIENT_ID || !runame) {
    throw new Error(
      "Consentement impossible : EBAY_CLIENT_ID et EBAY_RUNAME sont requis. " +
        "Le RuName se crée dans la console développeur eBay, section User Tokens, " +
        "« Get a Token from eBay via Your Application »."
    );
  }
  const q = new URLSearchParams({
    client_id: env.EBAY_CLIENT_ID,
    response_type: "code",
    redirect_uri: runame,
    scope: scopes.join(" "),
  });
  return `${authBase(env)}/oauth2/authorize?${q}`;
}

function identifiants(env) {
  const id = env.EBAY_CLIENT_ID;
  const secret = env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Identifiants eBay manquants : poser EBAY_CLIENT_ID et EBAY_CLIENT_SECRET dans le " +
        ".env du spec (App ID et Cert ID de la console développeur eBay)."
    );
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

async function demanderJeton({ env, corps, transport = globalThis.fetch, quoi }) {
  const res = await transport(`${baseUrl(env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: identifiants(env), "Content-Type": "application/x-www-form-urlencoded" },
    body: corps,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // eBay distingue « identifiants refusés » de « ce code ne vaut plus rien », et les
    // deux se corrigent très différemment : l'un par une clé, l'autre par un nouveau
    // consentement. Le message porte donc la distinction telle qu'eBay la rend.
    throw new Error(
      `eBay OAuth (${quoi}) : HTTP ${res.status} ${body.error || ""} ${body.error_description || ""}`.trim()
    );
  }
  return body;
}

// Échange unique du code de consentement contre un refresh token. Le code expire en
// quelques minutes et ne sert qu'une fois.
async function echangerCode({ env, code, transport }) {
  if (!env.EBAY_RUNAME) throw new Error("Échange impossible : EBAY_RUNAME absent du .env");
  const body = await demanderJeton({
    env,
    transport,
    quoi: "échange du code",
    corps: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(env.EBAY_RUNAME)}`,
  });
  if (!body.refresh_token) throw new Error("eBay OAuth : réponse sans refresh_token");
  return body;
}

// Jeton d'écriture. Il ne retombe JAMAIS sur le jeton applicatif : ce silence est
// exactement ce qui produirait un 403 incompréhensible au moment d'exécuter une action
// déjà approuvée par un humain.
async function jetonUtilisateur({
  env,
  transport,
  cache = memoire,
  now = Date.now,
  scopes = [SCOPE_VENTE],
}) {
  const refresh = env.EBAY_REFRESH_TOKEN;
  if (!refresh) {
    throw new Error(
      "Écriture eBay impossible : EBAY_REFRESH_TOKEN absent. Un jeton applicatif ne " +
        "peut pas écrire (eBay rend 403). Lancer `node bin/ebay-consentement.js <spec.env>` " +
        "une fois pour l'obtenir."
    );
  }
  // Espace de cache distinct de celui des jetons de lecture : un jeton applicatif servi
  // à un appel d'écriture serait refusé côté eBay, après coup. Les scopes entrent dans
  // la clé pour la même raison, en plus étroit : un jeton obtenu pour la seule écriture
  // servi à un appel de publication produirait un 403 que rien n'expliquerait.
  const demandes = [...scopes].sort().join(" ");
  const cle = `utilisateur|${baseUrl(env)}|${env.EBAY_CLIENT_ID}|${demandes}`;
  const connu = cache.get(cle);
  if (connu && connu.expire > now()) return connu.valeur;

  const body = await demanderJeton({
    env,
    transport,
    quoi: "renouvellement utilisateur",
    corps: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}&scope=${encodeURIComponent(demandes)}`,
  });
  if (!body.access_token) throw new Error("eBay OAuth : réponse sans access_token");
  cache.set(cle, {
    valeur: body.access_token,
    expire: now() + Math.max(0, (body.expires_in || 0) * 1000 - 60_000),
  });
  return body.access_token;
}

// Cache de processus. Sans lui, un orchestrateur toujours actif redemanderait un token à
// chaque collecte, ce qui est du gaspillage et finit par se faire limiter. La marge de
// 60 s évite d'utiliser un token qui expire pendant l'appel qu'il autorise.
const memoire = new Map();

async function token({ env, transport = globalThis.fetch, cache = memoire, now = Date.now }) {
  if (env.EBAY_OAUTH_TOKEN) return env.EBAY_OAUTH_TOKEN;

  const id = env.EBAY_CLIENT_ID;
  const secret = env.EBAY_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "Identifiants eBay manquants : poser EBAY_CLIENT_ID et EBAY_CLIENT_SECRET dans le " +
        ".env du spec (App ID et Cert ID de la console développeur eBay). " +
        "EBAY_OAUTH_TOKEN est accepté à la place, mais il expire en ~2 h et ne convient " +
        "qu'à un essai manuel."
    );
  }

  const cle = `${baseUrl(env)}|${id}`;
  const connu = cache.get(cle);
  if (connu && connu.expire > now()) return connu.valeur;

  const res = await transport(`${baseUrl(env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
  });

  // Un 400 ici veut dire "identifiants refusés", pas "requête invalide" : le distinguer
  // évite de chercher une erreur de code là où il y a une erreur de clé.
  if (!res.ok) {
    throw new Error(
      `eBay OAuth : HTTP ${res.status}, identifiants refusés ou App ID de production ` +
        `utilisé contre le sandbox (base actuelle : ${baseUrl(env)}).`
    );
  }

  const body = await res.json();
  if (!body.access_token) {
    throw new Error("eBay OAuth : réponse sans access_token");
  }
  cache.set(cle, {
    valeur: body.access_token,
    expire: now() + Math.max(0, (body.expires_in || 0) * 1000 - 60_000),
  });
  return body.access_token;
}

// Ne garde que les champs dont l'analyste a besoin. Passer la réponse brute d'eBay à un
// agent coûterait des milliers de tokens par annonce pour du bruit : la réduction est
// déterministe, donc gratuite, et c'est exactement le travail qu'un modèle ne doit pas faire.
function normalize(item) {
  return {
    id: item.itemId,
    titre: item.title,
    prix: item.price ? Number(item.price.value) : null,
    devise: item.price ? item.price.currency : null,
    etat: item.condition || null,
    vendeur: item.seller ? item.seller.username : null,
    note_vendeur: item.seller ? item.seller.feedbackPercentage : null,
    livraison_gratuite: Array.isArray(item.shippingOptions)
      ? item.shippingOptions.some((o) => o.shippingCost && Number(o.shippingCost.value) === 0)
      : null,
    url: item.itemWebUrl || null,
  };
}

async function search({ query, limit = 50, env = {}, transport = globalThis.fetch, cache, now }) {
  const jeton = await token({ env, transport, cache, now });
  const url =
    `${baseUrl(env)}/buy/browse/v1/item_summary/search` +
    `?q=${encodeURIComponent(query)}&limit=${limit}`;

  const res = await transport(url, {
    headers: {
      Authorization: `Bearer ${jeton}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": marketplace(env),
    },
  });

  // Un 401 sur un token expiré et un 500 côté eBay ne se corrigent pas pareil : le code
  // fait partie du message, sinon l'opérateur relance à l'aveugle.
  if (!res.ok) {
    throw new Error(`eBay Browse API : HTTP ${res.status} sur "${query}"`);
  }

  const body = await res.json();
  const items = Array.isArray(body.itemSummaries) ? body.itemSummaries : [];
  const collecte = items.map(normalize);

  // Les devises voyagent avec la collecte pour qu'une analyse ne puisse pas additionner
  // des dollars et des euros en croyant faire une médiane. Le champ est un fait observé,
  // pas une promesse : plusieurs devises dans une même collecte est un état possible.
  const devises = [...new Set(collecte.map((a) => a.devise).filter(Boolean))];

  return { query, marketplace: marketplace(env), devises, total: body.total ?? items.length, collecte };
}

// Récupération directe, annonce par annonce. La recherche de marché ne garantit pas de
// rendre les annonces du vendeur : elle rend les plus pertinentes pour une requête, et
// les siennes peuvent se trouver au-delà de la page lue. Le sandbox l'a montré en clair
// en publiant une annonce que le lookup direct rend en 200 et que la recherche ignore.
//
// Or le plan n'a le droit de cibler que les annonces du vendeur. Les obtenir par un
// chemin déterministe, et non par un effet de bord du classement d'eBay, est ce qui rend
// ce droit exerçable.
//
// Une annonce absente n'interrompt rien : elle a pu être vendue ou retirée entre deux
// runs, et c'est une information, pas une panne. Elle ressort dans `introuvables`.
async function parIds({ ids = [], env, transport = globalThis.fetch }) {
  if (ids.length === 0) return { annonces: [], introuvables: [] };
  const jeton = await token({ env, transport });
  const annonces = [];
  const introuvables = [];

  for (const id of ids) {
    const res = await transport(`${baseUrl(env)}/buy/browse/v1/item/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${jeton}`,
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": marketplace(env),
      },
    });
    if (res.status === 404) {
      introuvables.push(id);
      continue;
    }
    if (!res.ok) {
      throw new Error(`eBay lookup ${id} : HTTP ${res.status}`);
    }
    annonces.push(normalize(await res.json()));
  }
  return { annonces, introuvables };
}

module.exports = {
  search,
  parIds,
  normalize,
  token,
  jetonUtilisateur,
  urlConsentement,
  echangerCode,
  SCOPE,
  SCOPE_VENTE,
  SCOPE_COMPTE,
};
