const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { echecBascule } = require("../src/livreur");
const { recette } = require("./fixtures/deploiement");
const { execFileSync } = require("node:child_process");

for (const scenario of ["restauration-echec", "restauration-malade"]) test(`restauration non confirmée : ${scenario}`, async () => {
  const f = recette(scenario);
  try {
    const fin = await f.lancer();
    assert.notEqual(fin.code, 0, fin.sortie);
    assert.equal(fs.readFileSync(path.join(f.business, "etat/preserve.txt"), "utf8"), "etat vivant");
    assert.ok(fs.existsSync(path.join(f.business, "etat/incident-livraison")), fin.sortie);
    const incident = fs.readFileSync(path.join(f.business, "etat/incident-livraison"), "utf8");
    assert.equal(echecBascule({ ...fin, etape: "restaurer" }, incident).issue, "echec");
    assert.doesNotMatch(fin.sortie, /rollback_code.*(not set|unbound)/);
  } finally { f.nettoyer(); }
});

function arrete(pid) {
  try { return ["Z", "X"].includes(fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1][0]); }
  catch (err) { if (err.code === "ENOENT") return true; throw err; }
}

for (const [scenario, nouveau, restaure] of [["succes", true, false], ["avant-echec", false, false], ["apres-echec", false, true]]) {
  test(`vrai script de déploiement : ${scenario}`, async () => {
    const f = recette(scenario);
    try {
      const fin = await f.lancer();
      assert.equal(fin.signal, null, fin.sortie);
      assert.equal(fin.code === 0, nouveau, fin.sortie);
      assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), nouveau ? "nouvelle version" : "ancienne version");
      assert.equal(fs.readFileSync(path.join(f.business, "etat/preserve.txt"), "utf8"), "etat vivant");
      assert.equal(fs.readFileSync(path.join(f.business, "codex/session-recette.json"), "utf8"), '{"session":"factice"}\n');
      const sauvegardes = path.join(f.racine, "docker/business-pipelines-backups");
      for (const fichier of fs.readdirSync(sauvegardes)) {
        const contenu = execFileSync("tar", ["-tzf", path.join(sauvegardes, fichier)], { encoding: "utf8" });
        assert.doesNotMatch(contenu, /business-pipelines\/(codex|specs|etat)\//);
      }
      assert.equal(fs.existsSync(path.join(f.business, "etat/incident-livraison")), false, fin.sortie);
      if (restaure) {
        assert.match(fin.sortie, /Restauration confirmée/);
        assert.equal(echecBascule({ ...fin, etape: "restaurer", dernieres: fin.sortie.split("\n") }).issue, "restauree");
        assert.equal(echecBascule({ ...fin, etape: "restaurer", dernieres: [] }).issue, "echec");
      }
    } finally { f.nettoyer(); }
  });
}

for (const scenario of ["avant-bloque", "restauration-bloquee", "signal", "signal-apres", "signal-sante"]) {
  test(`arrêt effectif du parent et du descendant : ${scenario}`, async () => {
    const f = recette(scenario);
    try {
      const debut = performance.now();
      const fin = await f.lancer({ env: scenario === "avant-bloque" ? { LIVRAISON_BUILD_TIMEOUT_SEC: "4" } :
        scenario === "restauration-bloquee" ? { LIVRAISON_ROLLBACK_TIMEOUT_SEC: "2" } : {}, interrompre: scenario.startsWith("signal") });
      assert.equal(fin.signal, null, fin.sortie);
      assert.notEqual(fin.code, 0, fin.sortie);
      assert.ok(performance.now() - debut < 8000, `arrêt trop tardif : ${fin.sortie}`);
      assert.ok(fs.existsSync(f.pids), `la commande bloquée a été atteinte : ${fin.sortie}`);
      for (const pid of JSON.parse(fs.readFileSync(f.pids))) assert.ok(arrete(pid), `descendant ${pid} encore actif\n${fin.sortie}`);
      assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), "ancienne version");
      const incident = fs.existsSync(path.join(f.business, "etat/incident-livraison"));
      assert.equal(incident, scenario === "restauration-bloquee", fin.sortie);
      if (incident) {
        const suite = await f.lancer();
        assert.notEqual(suite.code, 0);
        assert.match(suite.sortie, /Livraison suspendue/);
      }
    } finally { f.nettoyer(); }
  });
}

test("un délai invalide est refusé avant toute commande Docker", async () => {
  const f = recette("succes");
  try {
    const fin = await f.lancer({ env: { LIVRAISON_ROLLBACK_TIMEOUT_SEC: "0" } });
    assert.notEqual(fin.code, 0);
    assert.match(fin.sortie, /Budget invalide/);
    assert.equal(fs.existsSync(path.join(f.racine, "docker.log")), false);
  } finally { f.nettoyer(); }
});

test("le budget de construction limite la phase cumulée, même avec des commandes courtes", async () => {
  const f = recette("phase-epuisee");
  try {
    const fin = await f.lancer({ env: { LIVRAISON_BUILD_TIMEOUT_SEC: "3" } });
    assert.equal(fin.signal, null, fin.sortie);
    assert.notEqual(fin.code, 0, fin.sortie);
    assert.doesNotMatch(fin.sortie, /Bascule\.\.\./);
    assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), "ancienne version");
  } finally { f.nettoyer(); }
});

test("une interruption avant lecture de l'accusé setsid ne démarre pas la commande", async () => {
  const f = recette("signal-handshake");
  try {
    const debut = performance.now();
    const fin = await f.lancer();
    assert.equal(fin.signal, null, fin.sortie);
    assert.notEqual(fin.code, 0, fin.sortie);
    assert.ok(performance.now() - debut < 8000, fin.sortie);
    assert.equal(fs.existsSync(f.pids), false, `la commande ne doit pas avoir été autorisée\n${fin.sortie}`);
    assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), "ancienne version");
  } finally { f.nettoyer(); }
});
