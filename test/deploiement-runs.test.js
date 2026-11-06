const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { recette } = require("./fixtures/deploiement");
const appels = f => fs.existsSync(path.join(f.racine, "docker.log")) ? fs.readFileSync(path.join(f.racine, "docker.log"), "utf8").trim().split("\n").map(JSON.parse) : [];
function aucuneBascule(f, fin) {
  assert.notEqual(fin.code, 0, fin.sortie);
  assert.equal(appels(f).some(a => a[0] === "rm" || (a[0] === "compose" && a[1] === "up")), false, fin.sortie);
  assert.equal(fs.readFileSync(path.join(f.business, "app.txt"), "utf8"), "ancienne version");
  assert.equal(fs.existsSync(path.join(f.business, "etat/incident-livraison")), false);
}

for (const cas of ["identifiant-absent", "mauvais-proprietaire", "verrou-absent", "base-absente", "base-corrompue", "ancien-runner", "run-actif", "travail-pendant-build"]) {
  test(`le modèle refuse sans arrêter les services : ${cas}`, async () => {
    const f = recette(["ancien-runner", "travail-pendant-build"].includes(cas) ? cas : "succes");
    try {
      const env = {};
      if (cas === "identifiant-absent") env.LIVRAISON_COMMANDE_ID = "";
      if (cas === "mauvais-proprietaire") env.LIVRAISON_COMMANDE_ID = "00000000-0000-4000-8000-000000000001";
      if (cas === "verrou-absent") f.store.maintenance.liberer(f.livraison.id);
      if (cas === "base-absente") env.ORCH_EVENT_STORE = path.join(f.racine, "absente.sqlite");
      if (cas === "base-corrompue") { env.ORCH_EVENT_STORE = path.join(f.racine, "invalide.sqlite"); fs.writeFileSync(env.ORCH_EVENT_STORE, "invalide"); }
      if (cas === "run-actif") f.store.db.prepare("INSERT INTO runs(id,pipeline_ref,status,started_at) VALUES('legacy','recette@1','running',?)").run(new Date().toISOString());
      const fin = await f.lancer({ env });
      aucuneBascule(f, fin);
      if (cas === "base-absente") assert.equal(fs.existsSync(env.ORCH_EVENT_STORE), false);
      if (cas === "base-corrompue") assert.equal(fs.readFileSync(env.ORCH_EVENT_STORE, "utf8"), "invalide");
      const build = appels(f).some(a => a[0] === "compose" && a[1] === "build");
      assert.equal(build, cas === "travail-pendant-build", fin.sortie);
    } finally { f.nettoyer(); }
  });
}

test("le modèle contrôle le repos avant construction et immédiatement avant le premier arrêt", async () => {
  const f = recette("succes", { dejaIsole: true });
  try {
    const fin = await f.lancer(); assert.equal(fin.code, 0, fin.sortie);
    const a = appels(f), build = a.findIndex(a => a[0] === "compose" && a[1] === "build"), arret = a.findIndex(a => a[0] === "rm");
    const controles = a.flatMap((v, i) => v[0] === "exec" && v.includes("/app/bin/verifier-livraison.js") ? [i] : []);
    assert.equal(controles.length, 2);
    assert.ok(controles[0] < build && controles[1] > build && controles[1] < arret);
    assert.equal(f.store.maintenance.etat().active, true, "le modèle ne libère pas le verrou à la place du livreur");
  } finally { f.nettoyer(); }
});
