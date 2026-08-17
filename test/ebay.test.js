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

test("sans token : erreur qui nomme la variable, avant tout appel réseau", async () => {
  let appele = false;
  const transport = async () => {
    appele = true;
  };
  await assert.rejects(
    () => ebay.search({ query: "q", env: {}, transport }),
    /EBAY_OAUTH_TOKEN manquant/
  );
  assert.strictEqual(appele, false, "aucun appel ne doit partir sans token");
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
