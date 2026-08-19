const assert = require("assert");
const ebay = require("../src/ebay");
const { fakeEbay, annonce } = require("./harness");

const ENV = { EBAY_OAUTH_TOKEN: "jeton-de-test" };

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("normalize ne garde que les champs utiles à l'analyse", () => {
  const n = ebay.normalize(annonce(2));
  assert.deepStrictEqual(Object.keys(n).sort(), [
    "devise",
    "etat",
    "id",
    "livraison_gratuite",
    "note_vendeur",
    "prix",
    "titre",
    "url",
    "vendeur",
  ]);
  assert.strictEqual(n.prix, 82, "le prix doit être un nombre, pas la chaîne d'eBay");
  assert.strictEqual(n.livraison_gratuite, true);
});

test("la place de marché part explicitement : sans elle eBay en choisit une en silence", async () => {
  const vus = [];
  const transport = async (url, opts) => {
    vus.push(opts.headers["X-EBAY-C-MARKETPLACE-ID"]);
    return { ok: true, json: async () => ({ total: 0, itemSummaries: [] }) };
  };
  await ebay.search({ query: "q", env: ENV, transport });
  assert.strictEqual(vus[0], "EBAY_US", "défaut explicite, pas celui d'eBay");

  await ebay.search({ query: "q", env: { ...ENV, EBAY_MARKETPLACE_ID: "EBAY_FR" }, transport });
  assert.strictEqual(vus[1], "EBAY_FR", "le .env doit pouvoir viser un autre marché");
});

test("la collecte porte ses devises : une médiane ne peut pas mélanger deux monnaies sans qu'on le voie", async () => {
  const transport = async () => ({
    ok: true,
    json: async () => ({
      total: 2,
      itemSummaries: [
        { itemId: "a", title: "a", price: { value: "10", currency: "USD" } },
        { itemId: "b", title: "b", price: { value: "20", currency: "EUR" } },
      ],
    }),
  });
  const r = await ebay.search({ query: "q", env: ENV, transport });
  assert.deepStrictEqual(r.devises.sort(), ["EUR", "USD"]);
  assert.strictEqual(r.marketplace, "EBAY_US");
});

// ---------- le chemin d'écriture : jeton utilisateur ----------
//
// Vérifié contre le vrai eBay avant d'être codé : avec les identifiants applicatifs,
// demander sell.inventory rend 400 invalid_scope, et l'API Sell rend 403.

const VENTE = { EBAY_CLIENT_ID: "app-id", EBAY_CLIENT_SECRET: "cert-id", EBAY_RUNAME: "Mon-RuName-abcd" };

test("l'URL de consentement vise l'hôte d'auth du sandbox et demande le scope de vente", () => {
  const u = new URL(ebay.urlConsentement({ env: VENTE }));
  assert.strictEqual(u.origin, "https://auth.sandbox.ebay.com", "l'auth n'est pas sur l'hôte d'API");
  assert.strictEqual(u.pathname, "/oauth2/authorize");
  assert.strictEqual(u.searchParams.get("response_type"), "code");
  assert.strictEqual(u.searchParams.get("redirect_uri"), "Mon-RuName-abcd", "eBay attend le RuName ici");
  assert.ok(u.searchParams.get("scope").includes(ebay.SCOPE_VENTE), "sans ce scope, l'écriture reste refusée");
});

test("viser la prod change aussi l'hôte de consentement", () => {
  const u = new URL(ebay.urlConsentement({ env: { ...VENTE, EBAY_BASE_URL: "https://api.ebay.com" } }));
  assert.strictEqual(u.origin, "https://auth.ebay.com");
});

test("sans RuName : erreur qui dit où le créer", () => {
  assert.throws(() => ebay.urlConsentement({ env: { EBAY_CLIENT_ID: "x" } }), /EBAY_RUNAME/);
});

// Retomber en silence sur le jeton de lecture donnerait un 403 incompréhensible au moment
// d'exécuter une action qu'un humain vient d'approuver.
test("écrire sans refresh token : refus net, aucun repli sur le jeton applicatif", async () => {
  let appele = false;
  const transport = async () => { appele = true; };
  await assert.rejects(
    () => ebay.jetonUtilisateur({ env: { ...VENTE, EBAY_OAUTH_TOKEN: "jeton-de-lecture" }, transport }),
    /EBAY_REFRESH_TOKEN/
  );
  assert.strictEqual(appele, false, "rien ne part sans jeton d'écriture");
});

test("le jeton d'écriture se renouvelle depuis le refresh token, avec le scope de vente", async () => {
  const vus = [];
  const transport = async (url, opts) => {
    vus.push({ url, body: opts.body });
    return { ok: true, json: async () => ({ access_token: "jeton-ecriture", expires_in: 7200 }) };
  };
  const t = await ebay.jetonUtilisateur({
    env: { ...VENTE, EBAY_REFRESH_TOKEN: "rt-123" },
    transport,
    cache: new Map(),
  });
  assert.strictEqual(t, "jeton-ecriture");
  assert.match(vus[0].body, /grant_type=refresh_token/);
  assert.match(vus[0].body, /refresh_token=rt-123/);
  assert.ok(vus[0].body.includes(encodeURIComponent(ebay.SCOPE_VENTE)));
});

// Deux jetons différents pour deux droits différents. Partager la clé de cache servirait
// un jeton de lecture à un appel d'écriture, et le refus n'arriverait que chez eBay.
test("les jetons de lecture et d'écriture ne partagent pas leur cache", async () => {
  const cache = new Map();
  const env = { ...VENTE, EBAY_REFRESH_TOKEN: "rt-123" };
  const transport = async (_u, opts) => ({
    ok: true,
    json: async () => ({
      access_token: /refresh_token/.test(opts.body) ? "ecriture" : "lecture",
      expires_in: 7200,
    }),
  });
  assert.strictEqual(await ebay.token({ env, transport, cache }), "lecture");
  assert.strictEqual(await ebay.jetonUtilisateur({ env, transport, cache }), "ecriture");
  assert.strictEqual(cache.size, 2, "deux entrées distinctes, pas une écrasée par l'autre");
});

test("un jeton d'écriture n'est jamais resservi à une demande de publication", async () => {
  const cache = new Map();
  const env = { ...VENTE, EBAY_REFRESH_TOKEN: "rt-123" };
  const demandes = [];
  const transport = async (_u, opts) => {
    demandes.push(decodeURIComponent(opts.body.match(/scope=([^&]*)/)[1]));
    return { ok: true, json: async () => ({ access_token: `jeton-${demandes.length}`, expires_in: 7200 }) };
  };

  const ecriture = await ebay.jetonUtilisateur({ env, transport, cache });
  const publication = await ebay.jetonUtilisateur({
    env,
    transport,
    cache,
    scopes: [ebay.SCOPE_VENTE, ebay.SCOPE_COMPTE],
  });

  assert.notStrictEqual(ecriture, publication, "un jeton plus étroit servi à un appel plus large rendrait 403");
  assert.strictEqual(cache.size, 2, "les scopes doivent entrer dans la clé de cache");
  assert.ok(!demandes[0].includes("sell.account"), "le scope de publication ne part pas sans qu'on le demande");
  assert.ok(demandes[1].includes("sell.account"), "demandé, il doit réellement partir");
});

test("le même jeu de scopes ne redemande pas de jeton à eBay", async () => {
  const cache = new Map();
  const env = { ...VENTE, EBAY_REFRESH_TOKEN: "rt-123" };
  let appels = 0;
  const transport = async () => {
    appels += 1;
    return { ok: true, json: async () => ({ access_token: "jeton", expires_in: 7200 }) };
  };
  await ebay.jetonUtilisateur({ env, transport, cache, scopes: [ebay.SCOPE_VENTE, ebay.SCOPE_COMPTE] });
  await ebay.jetonUtilisateur({ env, transport, cache, scopes: [ebay.SCOPE_COMPTE, ebay.SCOPE_VENTE] });
  assert.strictEqual(appels, 1, "les mêmes scopes dans un autre ordre sont le même droit");
});

test("l'échange du code envoie le RuName, sans quoi eBay refuse le grant", async () => {
  let corps = null;
  const transport = async (_u, opts) => {
    corps = opts.body;
    return { ok: true, json: async () => ({ refresh_token: "rt", access_token: "at", expires_in: 7200 }) };
  };
  const r = await ebay.echangerCode({ env: VENTE, code: "le-code", transport });
  assert.strictEqual(r.refresh_token, "rt");
  assert.match(corps, /grant_type=authorization_code/);
  assert.match(corps, /code=le-code/);
  assert.match(corps, /redirect_uri=Mon-RuName-abcd/);
});

test("un code périmé remonte le motif d'eBay, pas un HTTP nu", async () => {
  const transport = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ error: "invalid_grant", error_description: "the provided authorization grant code is invalid" }),
  });
  await assert.rejects(
    () => ebay.echangerCode({ env: VENTE, code: "perime", transport }),
    /invalid_grant/
  );
});

test("un prix absent devient null plutôt que NaN", () => {
  const n = ebay.normalize({ itemId: "x", title: "sans prix" });
  assert.strictEqual(n.prix, null);
  assert.strictEqual(n.devise, null);
});

test("sans identifiants : erreur qui les nomme, avant tout appel réseau", async () => {
  let appele = false;
  const transport = async () => {
    appele = true;
  };
  await assert.rejects(
    () => ebay.search({ query: "q", env: {}, transport }),
    /EBAY_CLIENT_ID et EBAY_CLIENT_SECRET/
  );
  assert.strictEqual(appele, false, "aucun appel ne doit partir sans identifiants");
});

// ---------- fabrication du token ----------

// Un transport qui distingue l'appel OAuth de l'appel de recherche, et compte les deux.
function transportComplet({ expiresIn = 7200, oauthOk = true, status = 200 } = {}) {
  const vu = { oauth: 0, search: 0, entetes: null };
  const transport = async (url, options) => {
    if (url.includes("/identity/v1/oauth2/token")) {
      vu.oauth += 1;
      vu.entetes = options.headers;
      return {
        ok: oauthOk,
        status,
        json: async () => ({ access_token: `jeton-${vu.oauth}`, expires_in: expiresIn }),
      };
    }
    vu.search += 1;
    vu.entetes = options.headers;
    return { ok: true, status: 200, json: async () => ({ itemSummaries: [] }) };
  };
  return { transport, vu };
}

const IDENTIFIANTS = { EBAY_CLIENT_ID: "mon-app", EBAY_CLIENT_SECRET: "mon-secret" };

test("un token est fabriqué depuis les identifiants, en Basic auth", async () => {
  const { transport, vu } = transportComplet();
  await ebay.search({ query: "q", env: IDENTIFIANTS, transport, cache: new Map() });

  assert.strictEqual(vu.oauth, 1);
  assert.strictEqual(vu.search, 1);
  assert.strictEqual(
    vu.entetes.Authorization,
    "Bearer jeton-1",
    "la recherche doit porter le token fabriqué"
  );
});

test("le token est mis en cache : deux collectes, un seul appel OAuth", async () => {
  const { transport, vu } = transportComplet();
  const cache = new Map();
  await ebay.search({ query: "a", env: IDENTIFIANTS, transport, cache });
  await ebay.search({ query: "b", env: IDENTIFIANTS, transport, cache });

  assert.strictEqual(vu.oauth, 1, "un orchestrateur toujours actif ne doit pas re-demander un token valide");
  assert.strictEqual(vu.search, 2);
});

test("un token expiré est refabriqué", async () => {
  const { transport, vu } = transportComplet({ expiresIn: 120 });
  const cache = new Map();
  let horloge = 1_000_000;
  const now = () => horloge;

  await ebay.search({ query: "a", env: IDENTIFIANTS, transport, cache, now });
  horloge += 121_000; // au-delà de la durée de vie, marge comprise
  await ebay.search({ query: "b", env: IDENTIFIANTS, transport, cache, now });

  assert.strictEqual(vu.oauth, 2);
});

test("identifiants refusés : le message ne renvoie pas chercher un bug de code", async () => {
  const { transport } = transportComplet({ oauthOk: false, status: 400 });
  await assert.rejects(
    () => ebay.search({ query: "q", env: IDENTIFIANTS, transport, cache: new Map() }),
    /identifiants refusés ou App ID de production/
  );
});

test("EBAY_OAUTH_TOKEN court-circuite la fabrication", async () => {
  const { transport, vu } = transportComplet();
  await ebay.search({ query: "q", env: ENV, transport, cache: new Map() });

  assert.strictEqual(vu.oauth, 0, "un token fourni à la main ne doit déclencher aucun OAuth");
  assert.strictEqual(vu.entetes.Authorization, "Bearer jeton-de-test");
});

test("HTTP non-ok : l'erreur porte le code, un 401 ne se corrige pas comme un 500", async () => {
  await assert.rejects(
    () => ebay.search({ query: "boosters", env: ENV, transport: fakeEbay([], { ok: false, status: 401 }) }),
    /HTTP 401 sur "boosters"/
  );
});

test("réponse sans itemSummaries : collecte vide, pas de crash", async () => {
  const transport = async () => ({ ok: true, status: 200, json: async () => ({ total: 0 }) });
  const res = await ebay.search({ query: "introuvable", env: ENV, transport });
  assert.deepStrictEqual(res.collecte, []);
  assert.strictEqual(res.total, 0);
});

test("le sandbox est la cible par défaut : viser la prod demande un geste explicite", async () => {
  let vue;
  const transport = async (url) => {
    vue = url;
    return { ok: true, status: 200, json: async () => ({ itemSummaries: [] }) };
  };
  await ebay.search({ query: "test", env: ENV, transport });
  assert.match(vue, /api\.sandbox\.ebay\.com/);

  await ebay.search({ query: "test", env: { ...ENV, EBAY_BASE_URL: "https://api.ebay.com" }, transport });
  assert.match(vue, /^https:\/\/api\.ebay\.com/);
});

test("la requête est encodée : un marché avec espaces ne casse pas l'URL", async () => {
  let vue;
  const transport = async (url) => {
    vue = url;
    return { ok: true, status: 200, json: async () => ({ itemSummaries: [] }) };
  };
  await ebay.search({ query: "booster box scellée", limit: 25, env: ENV, transport });
  assert.match(vue, /q=booster%20box%20scell%C3%A9e/);
  assert.match(vue, /limit=25/);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✘ ${name}\n    ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests eBay OK`);
  process.exit(failed ? 1 : 0);
})();
