// Ce que le cockpit accepte de servir depuis le dossier du front, et surtout ce qu'il
// refuse. Une page servie par le même serveur que les décisions ne doit pas devenir un
// moyen de lire le reste du disque.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const statique = require("../src/statique");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function bac() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "statique-"));
  const racine = path.join(dir, "dist");
  fs.mkdirSync(path.join(racine, "assets"), { recursive: true });
  fs.writeFileSync(path.join(racine, "index.html"), "<!doctype html><title>Cockpit</title>");
  fs.writeFileSync(path.join(racine, "assets", "index-abc123.js"), "console.log(1)");
  // Un secret hors du dossier servi, à la place exacte où il vit en production.
  fs.mkdirSync(path.join(dir, "specs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "specs", "cockpit.env"), "COCKPIT_TAILNET=secret");
  return { dir, racine };
}

test("l'index et les assets sont servis avec le bon type", () => {
  const { racine } = bac();
  const index = statique.ressource({ racine, url: "/app" });
  assert.strictEqual(index.type, "text/html; charset=utf-8");
  assert.match(index.corps.toString(), /Cockpit/);
  // L'index ne se met jamais en cache, sinon un déploiement passe inaperçu.
  assert.strictEqual(index.cache, "no-store");

  const js = statique.ressource({ racine, url: "/app/assets/index-abc123.js" });
  assert.strictEqual(js.type, "application/x-ci-autofix-recette");
  // Un nom qui porte son empreinte peut être gardé longtemps.
  assert.match(js.cache, /immutable/);
});

test("une route du front rend l'index, un fichier manquant reste manquant", () => {
  const { racine } = bac();
  assert.ok(statique.ressource({ racine, url: "/app/run/abc-123" }), "une route sans extension rend l'index");
  assert.strictEqual(
    statique.ressource({ racine, url: "/app/assets/absent.js" }),
    null,
    "un fichier manquant ne doit pas rendre du HTML"
  );
});

test("le même serveur sait monter le front à la racine", () => {
  const { racine } = bac();
  assert.ok(statique.ressource({ racine, prefixe: "/", url: "/" }));
  assert.ok(statique.ressource({ racine, prefixe: "/", url: "/projects/steam-tierlist" }));
  const asset = statique.ressource({ racine, prefixe: "/", url: "/assets/index-abc123.js" });
  assert.strictEqual(asset.type, "text/javascript; charset=utf-8");
  assert.strictEqual(
    statique.ressource({ racine, prefixe: "/", url: "/../specs/cockpit.env" }),
    null,
    "monter à la racine ne doit pas permettre de sortir du dossier"
  );
});

test("aucune requête ne sort du dossier servi", () => {
  const { racine } = bac();
  for (const url of [
    "/app/../specs/cockpit.env",
    "/app/../../specs/cockpit.env",
    "/app/assets/../../specs/cockpit.env",
    "/app/%2e%2e/specs/cockpit.env",
    "/app/%2e%2e%2f%2e%2e%2fspecs%2fcockpit.env",
  ]) {
    assert.strictEqual(statique.ressource({ racine, url }), null, `${url} ne doit rien rendre`);
  }
});

test("une adresse avec paramètres reste la même page", () => {
  const { racine } = bac();
  // Un lien partagé, un cache-buster, un paramètre de suivi : la page ne doit pas
  // disparaître parce qu'on a ajouté une query.
  assert.ok(statique.ressource({ racine, url: "/app?v=2" }), "/app?v=2 est la page");
  assert.ok(statique.ressource({ racine, url: "/app/assets/index-abc123.js?v=2" }), "un asset garde sa query");
});

test("les autres routes du cockpit ne sont pas interceptées", () => {
  const { racine } = bac();
  assert.strictEqual(statique.ressource({ racine, url: "/" }), null);
  assert.strictEqual(statique.ressource({ racine, url: "/api/etat" }), null);
  // Un préfixe qui ressemble n'est pas le préfixe.
  assert.strictEqual(statique.ressource({ racine, url: "/application/index.html" }), null);
});

test("un front non construit se voit", () => {
  const { dir, racine } = bac();
  assert.strictEqual(statique.present(racine), true);
  assert.strictEqual(statique.present(path.join(dir, "jamais-construit")), false);
});

let echecs = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    echecs += 1;
    console.error(`  ✘ ${name}\n    ${err.message}`);
  }
}
console.log(`\n${tests.length - echecs}/${tests.length} tests du service de fichiers OK`);
process.exit(echecs ? 1 : 0);
