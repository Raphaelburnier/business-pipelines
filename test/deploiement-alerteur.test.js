const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { recette } = require("./fixtures/deploiement");
const yaml = require("node:module").createRequire(require.resolve("agent-orchestrator"))("yaml");

test("l'alerteur n'a que la source et sa configuration en lecture, son journal en écriture, sans autorité d'agent", () => {
  const c = yaml.parse(fs.readFileSync(path.join(__dirname, "../docker-compose.yaml"), "utf8"));
  const a = c.services.alerteur;
  assert.equal(a.user, "1026:100"); assert.equal(a.read_only, true); assert.deepEqual(a.cap_drop, ["ALL"]);
  assert.equal(a.ports, undefined); assert.equal(a.env_file, undefined); assert.deepEqual(a.networks, ["alertes"]);
  assert.deepEqual(a.volumes.filter(v => !v.endsWith(":ro")), ["./etat/alertes:/app/alertes"]);
  assert.ok(a.volumes.includes("./etat:/app/source:ro")); assert.ok(a.volumes.includes("./specs/alerteur.json:/app/specs/alerteur.json:ro"));
  assert.equal(JSON.stringify(a).includes("docker.sock"), false); assert.equal(JSON.stringify(a).includes("/git"), false);
  assert.equal(a.environment.some(x => /ANTHROPIC|CLAUDE|CODEX|GITHUB|SMTP_MOTDEPASSE/.test(x)), false);
  assert.ok(fs.readFileSync(path.join(__dirname, "../.dockerignore"), "utf8").includes("specs/alerteur.json"));
  assert.ok(fs.readFileSync(path.join(__dirname, "../.gitignore"), "utf8").includes("specs/alerteur.json"));
});

test("première activation : service démarré et journal durable conservé", async () => {
  const f = recette("succes", { alerteur: true });
  try {
    const r = await f.lancer(); assert.equal(r.code, 0, r.sortie);
    const appels = fs.readFileSync(path.join(f.racine, "docker.log"), "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(appels.some(a => a[0] === "compose" && a[1] === "up" && a.includes("alerteur")));
    assert.ok(appels.some(a => a[0] === "exec" && a[1] === "business_alerteur" && a.includes("--sante")));
    assert.equal(fs.readFileSync(path.join(f.business, "etat/alertes/preserve.txt"), "utf8"), "journal vivant");
    assert.equal(fs.statSync(path.join(f.business, "etat/alertes")).mode & 0o777, 0o700);
  } finally { f.nettoyer(); }
});

test("une configuration manquante refuse avant toute construction ou bascule", async () => {
  const f = recette("succes", { alerteur: true, configurationAlerteur: false });
  try {
    const r = await f.lancer(); assert.notEqual(r.code, 0); assert.match(r.sortie, /configuration.*alerteur.*absente/i);
    assert.equal(fs.existsSync(path.join(f.racine, "docker.log")), false);
    assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), "ancienne version");
  } finally { f.nettoyer(); }
});

test("alerteur malade : retour au compose précédent sans alerteur, journal conservé", async () => {
  const f = recette("alerteur-malade", { alerteur: true });
  try {
    const r = await f.lancer(); assert.notEqual(r.code, 0, r.sortie); assert.match(r.sortie, /Restauration confirmée/);
    assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), "ancienne version");
    assert.equal(fs.readFileSync(path.join(f.business, "docker-compose.yaml"), "utf8").includes("alerteur:"), false);
    assert.equal(fs.readFileSync(path.join(f.business, "etat/alertes/preserve.txt"), "utf8"), "journal vivant");
  } finally { f.nettoyer(); }
});

test("alerteur existant : son ancienne image et son journal reviennent après échec", async () => {
  const f = recette("apres-echec", { dejaIsole: true, dejaAlerteur: true, alerteur: true });
  try {
    const r = await f.lancer(); assert.notEqual(r.code, 0, r.sortie); assert.match(r.sortie, /Restauration confirmée/);
    const appels = fs.readFileSync(path.join(f.racine, "docker.log"), "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(appels.some(a => a[0] === "tag" && a[1] === "image-ancienne-business_alerteur" && a[2] === "business-pipelines-alerteur"));
    assert.equal(fs.readFileSync(path.join(f.business, "etat/alertes/preserve.txt"), "utf8"), "journal vivant");
  } finally { f.nettoyer(); }
});
