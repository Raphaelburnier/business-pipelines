// Exécuteur du type d'action `changement_prix`, contre la Sell Inventory API d'eBay.
//
// Écrit après le premier appel réel, pas contre une forme devinée. Trois choses que
// seule l'API vivante a apprises et qu'on ne retrouverait pas dans une doc :
//
//   - sans `Accept-Language`, tout appel Sell rend 400 avec un message qui parle
//     d'en-tête et non de permission, ce qui envoie chercher au mauvais endroit ;
//   - un jeton applicatif rend 403 « Insufficient permissions » là où un jeton
//     utilisateur rend 200, donc le type de jeton se voit au code retour ;
//   - `PUT /offer/{id}` remplace l'offre : omettre un champ l'efface. On relit donc
//     l'offre avant d'écrire, et on ne renvoie que ce qu'elle contenait déjà.
const ebay = require("./ebay");

const BASE_SELL = "/sell/inventory/v1";

function apiBase(env) {
  return env.EBAY_BASE_URL || "https://api.sandbox.ebay.com";
}

// eBay exige la langue sur toute la surface Sell. La marketplace, elle, décide de la
// devise : la poser explicitement évite qu'un plan calculé sur un marché s'applique
// à un autre sans que rien ne le signale.
function entetes(jeton, env) {
  return {
    Authorization: `Bearer ${jeton}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
    "Content-Language": "en-US",
    "X-EBAY-C-MARKETPLACE-ID": env.EBAY_MARKETPLACE_ID || "EBAY_US",
  };
}

function perdue(message) {
  const err = new Error(message);
  err.cible = true;
  return err;
}

// Une panne ne porte pas `cible`. La garde d'exécution arrête alors le lot entier,
// ce qui est le bon réflexe : réessayer quarante fois une API en vrac fait plus de
// dégâts que de ne rien faire.
function panne(message) {
  return new Error(message);
}

async function lire(url, jeton, env, transport) {
  const res = await transport(url, { headers: entetes(jeton, env) });
  const texte = await res.text();
  let corps = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = null;
  }
  return { res, corps, texte };
}

// Le plan désigne ses cibles avec les identifiants que le relevé a produits, or le
// relevé vient de la Browse API et l'écriture passe par la Sell API. Les deux ne
// parlent pas des mêmes objets. On accepte donc les trois formes plutôt que
// d'imposer au planificateur une contrainte qu'il n'a pas les moyens de tenir.
function formeDeCible(cible) {
  const texte = String(cible);
  if (/^\d+$/.test(texte)) return { genre: "offre", valeur: texte };
  const browse = texte.match(/^v1\|(\d+)\|\d+$/);
  if (browse) return { genre: "annonce", valeur: browse[1] };
  return { genre: "sku", valeur: texte };
}

async function offreDuSku(sku, { jeton, env, transport }) {
  const url = `${apiBase(env)}${BASE_SELL}/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${env.EBAY_MARKETPLACE_ID || "EBAY_US"}`;
  const { res, corps } = await lire(url, jeton, env, transport);
  if (res.status === 404) return null;
  if (!res.ok) throw panne(`eBay getOffers(sku=${sku}) : HTTP ${res.status}`);
  const offres = (corps && corps.offers) || [];
  return offres[0] || null;
}

// Retrouver une offre depuis un identifiant d'annonce demande de balayer le catalogue :
// eBay n'expose pas l'inverse. C'est borné par le nombre d'articles du vendeur, et ça
// reste préférable à refuser la cible que le planificateur avait le droit de nommer.
async function offreDeLAnnonce(listingId, { jeton, env, transport }) {
  let offset = 0;
  for (let page = 0; page < 20; page += 1) {
    const url = `${apiBase(env)}${BASE_SELL}/inventory_item?limit=100&offset=${offset}`;
    const { res, corps } = await lire(url, jeton, env, transport);
    if (!res.ok) throw panne(`eBay getInventoryItems : HTTP ${res.status}`);
    const articles = (corps && corps.inventoryItems) || [];
    for (const article of articles) {
      const offre = await offreDuSku(article.sku, { jeton, env, transport });
      if (offre && offre.listing && String(offre.listing.listingId) === String(listingId)) {
        return offre;
      }
    }
    offset += articles.length;
    if (articles.length === 0 || offset >= (corps.total ?? offset)) break;
  }
  return null;
}

async function resoudreOffre(cible, contexte) {
  const forme = formeDeCible(cible);

  if (forme.genre === "offre") {
    const url = `${apiBase(contexte.env)}${BASE_SELL}/offer/${forme.valeur}`;
    const { res, corps } = await lire(url, contexte.jeton, contexte.env, contexte.transport);
    if (res.status === 404) throw perdue(`offre ${forme.valeur} introuvable : annonce retirée ou identifiant d'un autre vendeur`);
    if (res.status === 403) throw panne(`eBay refuse l'accès à l'offre ${forme.valeur} : jeton sans droit d'écriture`);
    if (!res.ok) throw panne(`eBay getOffer(${forme.valeur}) : HTTP ${res.status}`);
    return corps;
  }

  const offre =
    forme.genre === "sku"
      ? await offreDuSku(forme.valeur, contexte)
      : await offreDeLAnnonce(forme.valeur, contexte);

  if (!offre) throw perdue(`aucune offre du vendeur ne correspond à la cible "${cible}"`);
  return offre;
}

function prixCourant(offre) {
  const p = offre && offre.pricingSummary && offre.pricingSummary.price;
  return p ? { valeur: Number(p.value), devise: p.currency } : null;
}

// Le corps d'un PUT d'offre remplace l'offre entière. On repart donc de ce qu'eBay
// vient de rendre et on ne touche qu'au prix : construire le corps de zéro effacerait
// silencieusement la quantité, la catégorie ou l'entrepôt.
function corpsAvecPrix(offre, montant, devise) {
  const corps = {
    availableQuantity: offre.availableQuantity,
    categoryId: offre.categoryId,
    merchantLocationKey: offre.merchantLocationKey,
    pricingSummary: { ...offre.pricingSummary, price: { value: String(montant), currency: devise } },
  };
  if (offre.listingDescription) corps.listingDescription = offre.listingDescription;
  if (offre.listingPolicies) corps.listingPolicies = offre.listingPolicies;
  if (offre.tax) corps.tax = offre.tax;
  if (offre.quantityLimitPerBuyer) corps.quantityLimitPerBuyer = offre.quantityLimitPerBuyer;
  return corps;
}

async function changerPrix(action, contexte) {
  const env = contexte.env || {};
  const transport = contexte.transport || globalThis.fetch;
  const jeton = contexte.jeton || (await ebay.jetonUtilisateur({ env, transport }));
  const sous = { jeton, env, transport };

  const valeur = action.valeur || {};
  const vers = Number(valeur.vers);
  if (!Number.isFinite(vers) || vers <= 0) {
    throw panne(`action ${action.id} : prix cible invalide (${JSON.stringify(valeur.vers)})`);
  }

  const offre = await resoudreOffre(action.cible, sous);
  const courant = prixCourant(offre);
  if (!courant) throw perdue(`offre ${offre.offerId} sans prix : rien à modifier`);

  // Une approbation humaine porte sur un écart précis, « de 82 à 79 ». Si le prix a
  // bougé depuis, appliquer 79 exécute une décision que personne n'a prise sur le
  // marché d'aujourd'hui. On refuse la cible et le lot continue.
  if (valeur.de !== undefined && Number(valeur.de) !== courant.valeur) {
    throw perdue(
      `prix de départ divergent sur l'offre ${offre.offerId} : le plan approuvé partait de ` +
        `${valeur.de}, eBay affiche ${courant.valeur}. Le marché a bougé depuis l'approbation.`
    );
  }

  // Une devise qui ne correspond pas veut dire que le plan a été calculé sur un autre
  // marché que celui où on écrit. Appliquer 79 EUR à une offre en USD passerait pour
  // un succès en changeant le prix de vingt pour cent. C'est systémique : on arrête.
  if (valeur.devise && valeur.devise !== courant.devise) {
    throw panne(
      `devise divergente sur l'offre ${offre.offerId} : le plan est en ${valeur.devise}, ` +
        `l'offre en ${courant.devise}. Le plan a été calculé sur un autre marché que celui visé.`
    );
  }

  const url = `${apiBase(env)}${BASE_SELL}/offer/${offre.offerId}`;
  const res = await transport(url, {
    method: "PUT",
    headers: entetes(jeton, env),
    body: JSON.stringify(corpsAvecPrix(offre, vers, courant.devise)),
  });
  if (res.status === 404) throw perdue(`offre ${offre.offerId} disparue pendant l'écriture`);
  if (!res.ok) {
    const detail = await res.text();
    throw panne(`eBay updateOffer(${offre.offerId}) : HTTP ${res.status} ${detail.slice(0, 300)}`);
  }

  // Relire n'est pas de la superstition : eBay peut accepter un PUT et ne pas appliquer
  // la valeur attendue. Sans relecture, le registre consignerait un changement de prix
  // qui n'a pas eu lieu, et c'est précisément la trace sur laquelle un humain s'appuie.
  const apres = await lire(url, jeton, env, transport);
  const relu = prixCourant(apres.corps);
  if (!relu || relu.valeur !== vers) {
    throw panne(
      `écriture non confirmée sur l'offre ${offre.offerId} : demandé ${vers}, relu ` +
        `${relu ? relu.valeur : "rien"}. Le prix affiché n'est pas celui qui a été approuvé.`
    );
  }

  return { offre: offre.offerId, de: courant.valeur, vers: relu.valeur, devise: relu.devise };
}

module.exports = { changerPrix, resoudreOffre, formeDeCible, corpsAvecPrix, prixCourant };
