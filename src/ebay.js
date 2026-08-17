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

function requireToken(env) {
  const token = env.EBAY_OAUTH_TOKEN;
  if (!token) {
    throw new Error(
      "EBAY_OAUTH_TOKEN manquant — obtenir un token applicatif sur le sandbox eBay " +
        "et le poser dans le .env du spec. Sans lui, aucune collecte n'est possible."
    );
  }
  return token;
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

async function search({ query, limit = 50, env = {}, transport = globalThis.fetch }) {
  const token = requireToken(env);
  const url =
    `${baseUrl(env)}/buy/browse/v1/item_summary/search` +
    `?q=${encodeURIComponent(query)}&limit=${limit}`;

  const res = await transport(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
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

module.exports = { search, normalize };
