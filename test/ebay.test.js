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
    /identifiants refusés, ou App ID de production/
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
