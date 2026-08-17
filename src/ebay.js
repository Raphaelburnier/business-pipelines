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

// Un token applicatif eBay vit environ 2 heures. Le stocker dans un .env condamne tout
// run planifié à échouer sur un token périmé, sans que rien n'explique pourquoi. Ce sont
// donc les identifiants permanents qu'on range, et le token se fabrique à la demande.
//
// EBAY_OAUTH_TOKEN reste accepté comme échappatoire : pratique pour un essai à la main
// avec un token collé depuis la console développeur, inutilisable pour de l'automatisé.
const SCOPE = "https://api.ebay.com/oauth/api_scope";

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
    headers: { Authorization: `Bearer ${jeton}`, Accept: "application/json" },
  });

  // Un 401 sur un token expiré et un 500 côté eBay ne se corrigent pas pareil : le code
  // fait partie du message, sinon l'opérateur relance à l'aveugle.
  if (!res.ok) {
    throw new Error(`eBay Browse API : HTTP ${res.status} sur "${query}"`);
  }

  const body = await res.json();
  const items = Array.isArray(body.itemSummaries) ? body.itemSummaries : [];
  return { query, total: body.total ?? items.length, collecte: items.map(normalize) };
}

module.exports = { search, normalize, token };
