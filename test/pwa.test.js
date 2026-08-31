const assert = require("assert");
const pwa = require("../src/pwa");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("le manifeste ne promet que des icônes que le cockpit sait servir", () => {
  const m = pwa.manifeste();
  assert.ok(m.icons.length > 0, "un manifeste sans icône n'est pas installable");
  for (const i of m.icons) {
    // Une icône déclarée mais introuvable ne fait pas échouer l'installation : elle la
    // réussit avec un carré gris sur l'écran d'accueil, ce qui ne se remarque qu'après.
    const r = pwa.ressource(i.src);
    assert.ok(r, `${i.src} est déclaré au manifeste mais aucune route ne le sert`);
    assert.strictEqual(r.type, "image/png");
    assert.ok(r.corps.length > 0, `${i.src} est servi vide`);
    // Signature PNG. Servir un JPEG sous un type image/png ferait rejeter l'icône par
    // Chrome, qui vérifie le contenu et pas le type déclaré.
    assert.deepStrictEqual([...r.corps.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${i.src} n'est pas un PNG`);
  }
});

test("le manifeste porte les trois champs sans lesquels rien ne s'installe", () => {
  const m = pwa.manifeste();
  assert.strictEqual(m.start_url, "/");
  assert.strictEqual(m.scope, "/");
  // `browser` rendrait un simple raccourci vers Safari ou Chrome, pas une application.
  assert.strictEqual(m.display, "standalone");
  assert.ok(m.icons.some((i) => i.sizes === "192x192"), "Android exige une icône de 192");
  assert.ok(m.icons.some((i) => i.sizes === "512x512"), "l'écran de démarrage exige une icône de 512");
  assert.ok(m.icons.some((i) => i.purpose === "maskable"), "sans maskable, Android pose l'icône dans un carré blanc");
});

test("aucune URL hors de la table littérale ne rend un fichier du disque", () => {
  // Le cockpit sert des fichiers du disque depuis l'ajout de l'application. Le risque
  // qui vient avec est la remontée de répertoire : le dépôt tient specs/cockpit.env, qui
  // porte le nom du tailnet et le signataire des décisions locales.
  const hostiles = [
    "/../specs/cockpit.env",
    "/../../etc/passwd",
    "/..%2fspecs%2fcockpit.env",
    "/public/icone-192.png",
    "/icone-192.png/../../specs/cockpit.env",
    "/icone-192.PNG",
    "/sw.js/",
    "",
  ];
  for (const u of hostiles) {
    assert.strictEqual(pwa.ressource(u), null, `${u} devrait n'être aucune ressource`);
  }
});

test("le service worker ne met rien en cache", () => {
  const sw = pwa.ressource("/sw.js").corps.toString("utf-8");
  // Ce n'est pas une précaution de style. La page montre des décisions en attente et un
  // plan gelé porte une empreinte : une copie servie depuis un cache ferait cocher contre
  // une empreinte morte, et l'écriture repartirait pour se faire refuser en 409.
  assert.ok(!/caches\s*\./.test(sw), "le worker touche à l'API de cache");
  assert.ok(!/cache\.put|cache\.add|CacheStorage/.test(sw), "le worker écrit dans un cache");
});

test("le service worker laisse passer les écritures sans les toucher", () => {
  const sw = pwa.ressource("/sw.js").corps.toString("utf-8");
  // Un worker qui rejoue une requête POST écrit deux fois la même décision sans que
  // personne l'ait recochée.
  assert.ok(/method\s*!==\s*"GET"/.test(sw), "le worker doit se retirer des requêtes non-GET");
  assert.ok(/addEventListener\("fetch"/.test(sw), "sans gestionnaire de requêtes, aucun navigateur n'installe l'app");
});

test("le manifeste est du JSON, servi sous le type que les navigateurs attendent", () => {
  const r = pwa.ressource("/manifest.webmanifest");
  assert.ok(r.type.startsWith("application/manifest+json"));
  const m = JSON.parse(r.corps.toString("utf-8"));
  assert.strictEqual(m.name, "Cockpit d'approbation");
});

test("les balises déclarent le manifeste et l'icône iOS", () => {
  // iOS ne lit pas les icônes du manifeste pour l'écran d'accueil : sans apple-touch-icon,
  // il fabrique une vignette de la page, illisible à cette taille.
  assert.ok(pwa.BALISES.includes('rel="manifest"'));
  assert.ok(pwa.BALISES.includes('rel="apple-touch-icon"'));
  assert.ok(pwa.ressource("/apple-touch-icon.png"), "l'icône iOS déclarée doit être servie");
  assert.ok(pwa.ENREGISTREMENT.includes("serviceWorker.register"));
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests pwa OK`);
  process.exit(failed ? 1 : 0);
})();
