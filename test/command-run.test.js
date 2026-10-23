// Recette réelle du runner et de la CLI, sans modèle.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { EventStore } = require("agent-orchestrator");

const RACINE = path.resolve(__dirname, "..");
const attendre = ms => new Promise(resolve => setTimeout(resolve, ms));

test("le runner n'active la priorité que pour sa file de runs", () => {
  const source = fs.readFileSync(path.join(RACINE, "bin/commande-runner.js"), "utf8");
  assert.match(source, /boucle\(store, \["run\.start", "run\.resume", "run\.reverify"\],[\s\S]*?\{ prioriserRuns: true \}\)/);
  assert.match(source, /boucleApprobations\(store\)/);
  assert.match(source, /store\.prendreCommande\(prioriserRuns \? \{ kinds, prioriserRuns: true, exclure \} : \{ kinds \}\)/);
  // Le calendrier crée ses départs dus avant chaque prise dans la file des runs.
  assert.match(source, /if \(kinds\.includes\("run\.resume"\)\) \{[\s\S]*?atelier\.programmer\(store\)[\s\S]*?atelier\.exclus\(store, verifier\)/);
  assert.match(source, /boucle\(store, \["chat\.respond"\],[\s\S]*?\(commande\) => repondre\(store, commande\)\)/);
});

test("le seuil diagnostique n'arrête pas un run long encore actif", async () => {
  const f = fixture();
  try {
    const definition = path.join(f.env.ORCH_REGISTRE, "pipelines/longue/v1");
    const dossierProjet = path.join(f.env.COCKPIT_PROJETS_DIR, "long");
    fs.mkdirSync(definition, { recursive: true });
    fs.mkdirSync(dossierProjet, { recursive: true });
    fs.writeFileSync(path.join(definition, "pipeline.json"), JSON.stringify({
      name: "longue", version: 1, description: "Run de recette long mais actif.",
      nodes: [{ id: "attendre", type: "script", runsOn: "nas", run: process.execPath,
        args: ["-e", 'const fs=require("node:fs");fs.writeFileSync("started.flag","oui");const fin=Date.now()+30000;while(!fs.existsSync("release.flag")&&Date.now()<fin)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);if(!fs.existsSync("release.flag"))process.exit(42);fs.writeFileSync("finished.flag","oui");'] }],
      edges: [],
    }));
    fs.writeFileSync(path.join(dossierProjet, "spec.json"), JSON.stringify({ project_name: "long" }));
    fs.writeFileSync(path.join(dossierProjet, "project.json"), JSON.stringify({
      id: "long", name: "Run long", business: "recette", homeMachine: "nas", repo: path.join(f.dir, "long-inexistant.git"),
      pipelines: [{ extends: "longue@1", spec: "spec.json" }],
    }));

    const commande = f.store.creerCommande({ kind: "run.start", payload: { projectId: "long" }, par: "recette" });
    const runner = f.runner({ COCKPIT_RUN_DIAGNOSTIC_MS: "80" });
    const runId = await jusqua(() => f.store.commande(commande.id).run_id, () => runner.sortie);
    const espace = path.join(f.env.OUTPUT_ROOT, "long", runId);
    await jusqua(() => fs.existsSync(path.join(espace, "started.flag")), () => runner.sortie);
    const diagnostic = await jusqua(
      () => f.store.evenements({ runId }).find((e) => e.type === "run.long_running"),
      () => runner.sortie,
    );

    assert.equal(f.store.commande(commande.id).status, "taken");
    assert.equal(f.store.run(runId).status, "running");
    assert.equal(diagnostic.payload.action, "diagnostic uniquement ; aucune interruption automatique");
    assert.ok(Array.isArray(diagnostic.payload.etapesEnCours));
    assert.ok(diagnostic.payload.dureeMs >= 80);

    fs.writeFileSync(path.join(espace, "release.flag"), "continuer");
    await jusqua(() => f.store.commande(commande.id).status === "done", () => runner.sortie);
    assert.equal(f.store.run(runId).status, "succeeded");
    assert.equal(fs.readFileSync(path.join(espace, "finished.flag"), "utf8"), "oui");
  } finally {
    await f.fermer();
  }
});

async function jusqua(condition, detail, plafond = 15000) {
  const fin = Date.now() + plafond;
  while (Date.now() < fin) {
    const valeur = condition();
    if (valeur) return valeur;
    await attendre(50);
  }
  throw new Error(`Attente expirée : ${typeof detail === "function" ? detail() : detail}`);
}

function fixture({ avecApprobation = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "command-run-"));
  const registre = path.join(dir, "registre");
  const definition = path.join(registre, "pipelines/diagnostic/v1");
  const projets = path.join(dir, "projects");
  fs.mkdirSync(definition, { recursive: true });
  fs.mkdirSync(path.join(projets, "demo"), { recursive: true });
  fs.writeFileSync(path.join(definition, "pipeline.json"), JSON.stringify({
    name: "diagnostic", version: 1, description: "Deux scripts de recette, aucun modèle.",
    nodes: [
      { id: "preparer", type: "script", runsOn: "nas", run: process.execPath, args: ["-e", 'const fs=require("fs");const n=Number(fs.existsSync("compteur.txt")?fs.readFileSync("compteur.txt","utf8"):0);fs.writeFileSync("compteur.txt",String(n+1));fs.writeFileSync("actions.json","[]");'] },
      ...(avecApprobation ? [{ id: "accord", type: "approval", actions: "actions.json" }] : []),
      { id: "terminer", type: "script", runsOn: "nas", run: process.execPath, args: ["-e", 'const fs=require("fs");if(fs.existsSync("reprendre.txt"))fs.writeFileSync("fini.txt","ok");else setTimeout(()=>fs.writeFileSync("fini.txt","ok"),30000);'] },
    ], edges: avecApprobation
      ? [{ from: "preparer", to: "accord" }, { from: "accord", to: "terminer", on: "approved" }]
      : [{ from: "preparer", to: "terminer" }],
  }));
  fs.writeFileSync(path.join(projets, "demo", "spec.json"), JSON.stringify({ project_name: "demo" }));
  fs.writeFileSync(path.join(projets, "demo", "project.json"), JSON.stringify({ id: "demo", name: "Recette", business: "recette", homeMachine: "nas", repo: path.join(dir, "depot-inexistant.git"), pipelines: [{ extends: "diagnostic@1", spec: "spec.json" }] }));
  fs.writeFileSync(path.join(dir, "workers.json"), JSON.stringify({ workers: [] }));
  const storeFile = path.join(dir, "events.sqlite");
  const store = new EventStore(storeFile);
  const env = { ...process.env, ORCH_EVENT_STORE: storeFile, COCKPIT_PROJETS_DIR: projets,
    ORCH_REGISTRE: registre, OUTPUT_ROOT: path.join(dir, "workspaces"), NO_VCS: "1",
    ORCH_EXIGER_ABONNEMENT: "0", ORCH_ROLE: "nas", ORCH_MACHINE: "nas",
    COMMAND_POLL_MS: "10", ORCH_MAITRE_PORT: "0", ORCH_MAITRE_HOTE: "127.0.0.1", ORCH_WORKERS: path.join(dir, "workers.json") };
  const enfants = [];
  function runner(overrides = {}) {
    const child = spawn(process.execPath, [path.join(RACINE, "bin/commande-runner.js")], { cwd: RACINE, env: { ...env, ...overrides }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.sortie = "";
    child.stdout.on("data", d => { child.sortie = (child.sortie + d).slice(-12000); });
    child.stderr.on("data", d => { child.sortie = (child.sortie + d).slice(-12000); });
    child.termine = new Promise(resolve => child.on("close", resolve));
    enfants.push(child);
    return child;
  }
  async function arreter(child) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    // Le secours arrête aussi la CLI descendante, qui garde les pipes ouverts.
    const plafond = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 8000);
    try { await child.termine; } finally { clearTimeout(plafond); }
  }
  async function fermer() {
    await Promise.all(enfants.map(arreter));
    store.fermer();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { dir, store, env, runner, arreter, fermer };
}

test("toutes les décisions d'approbation sont enregistrées pendant un run long puis reprises en série", async () => {
  const f = fixture({ avecApprobation: true });
  let espaceLong = null;
  try {
    const premiere = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo" }, par: "recette" });
    const runner = f.runner();
    await jusqua(() => f.store.commande(premiere.id).status === "done", () => runner.sortie);
    const premierRun = f.store.commande(premiere.id).run_id;
    const approbation = f.store.approbationsOuvertes().find(a => a.run_id === premierRun);
    assert.ok(approbation);
    const espacePremier = path.join(f.env.OUTPUT_ROOT, "demo", premierRun);
    fs.writeFileSync(path.join(espacePremier, "reprendre.txt"), "ok");

    const secondeCommande = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo" }, par: "recette" });
    await jusqua(() => f.store.commande(secondeCommande.id).status === "done", () => runner.sortie);
    const secondRun = f.store.commande(secondeCommande.id).run_id;
    const secondeApprobation = f.store.approbationsOuvertes().find(a => a.run_id === secondRun);
    assert.ok(secondeApprobation);
    const espaceSecond = path.join(f.env.OUTPUT_ROOT, "demo", secondRun);
    fs.writeFileSync(path.join(espaceSecond, "reprendre.txt"), "ok");

    const definition = path.join(f.env.ORCH_REGISTRE, "pipelines/longue/v1");
    const dossierProjet = path.join(f.env.COCKPIT_PROJETS_DIR, "long");
    fs.mkdirSync(definition, { recursive: true });
    fs.mkdirSync(dossierProjet, { recursive: true });
    fs.writeFileSync(path.join(definition, "pipeline.json"), JSON.stringify({
      name: "longue", version: 1, description: "Run long pour tester l'isolation des décisions.",
      nodes: [{ id: "bloquer", type: "script", runsOn: "nas", run: process.execPath, args: ["-e", 'const fs=require("node:fs");fs.writeFileSync("started.flag","oui");const fin=Date.now()+30000;while(!fs.existsSync("release.flag")&&Date.now()<fin)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);if(!fs.existsSync("release.flag"))process.exit(42);fs.writeFileSync("finished.flag","oui");'] }],
      edges: [],
    }));
    fs.writeFileSync(path.join(dossierProjet, "spec.json"), JSON.stringify({ project_name: "long" }));
    fs.writeFileSync(path.join(dossierProjet, "project.json"), JSON.stringify({ id: "long", name: "Run long", business: "recette", homeMachine: "nas", repo: path.join(f.dir, "long-inexistant.git"), pipelines: [{ extends: "longue@1", spec: "spec.json" }] }));

    const longue = f.store.creerCommande({ kind: "run.start", payload: { projectId: "long" }, par: "recette" });
    await jusqua(() => f.store.commande(longue.id).run_id, () => runner.sortie);
    espaceLong = path.join(f.env.OUTPUT_ROOT, "long", f.store.commande(longue.id).run_id);
    await jusqua(() => fs.existsSync(path.join(espaceLong, "started.flag")), () => runner.sortie);

    const decision = f.store.creerCommande({ kind: "approval.decide", payload: { approbationId: approbation.id, decision: "approved" }, par: "recette" });
    const secondeDecision = f.store.creerCommande({ kind: "approval.decide", payload: { approbationId: secondeApprobation.id, decision: "approved" }, par: "recette" });
    await jusqua(() => f.store.approbation(approbation.id).status === "approved", () => runner.sortie);
    await jusqua(() => f.store.approbation(secondeApprobation.id).status === "approved", () => runner.sortie);
    assert.equal(f.store.run(premierRun).status, "waiting_approval", "le run attend le verrou de lancement après écriture de la décision");
    assert.equal(f.store.run(secondRun).status, "waiting_approval", "la deuxième décision est aussi écrite sans attendre le verrou");
    assert.equal(f.store.commande(longue.id).status, "taken", "le run long conserve la CLI jusqu'à sa fin");
    assert.equal(fs.existsSync(path.join(espaceLong, "finished.flag")), false);

    fs.writeFileSync(path.join(espaceLong, "release.flag"), "oui");
    await jusqua(() => f.store.commande(longue.id).status === "done"
      && f.store.commande(decision.id).status === "done"
      && f.store.commande(secondeDecision.id).status === "done", () => runner.sortie);
    assert.equal(f.store.run(premierRun).status, "succeeded");
    assert.equal(f.store.run(secondRun).status, "succeeded");
    assert.equal(fs.readFileSync(path.join(espacePremier, "fini.txt"), "utf8"), "ok");
    assert.equal(fs.readFileSync(path.join(espaceSecond, "fini.txt"), "utf8"), "ok");
    assert.equal(fs.existsSync(path.join(espaceLong, "finished.flag")), true);
  } finally {
    if (espaceLong && fs.existsSync(espaceLong)) fs.writeFileSync(path.join(espaceLong, "release.flag"), "oui");
    await f.fermer();
  }
});

for (const signal of ["SIGTERM", "SIGKILL"]) test(`${signal} puis redémarrage du vrai runner : même run, sans refaire le script validé`, async () => {
  const f = fixture();
  try {
    const commande = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo" }, par: "recette" });
    const premier = f.runner();
    const runId = await jusqua(() => f.store.commande(commande.id).run_id, () => premier.sortie);
    await jusqua(() => f.store.etapes(runId).some(s => s.node_id === "terminer" && s.status === "running"), () => premier.sortie);
    const espace = path.join(f.env.OUTPUT_ROOT, "demo", runId);
    assert.equal(fs.readFileSync(path.join(espace, "compteur.txt"), "utf8"), "1");
    if (signal === "SIGKILL") {
      process.kill(-premier.pid, "SIGKILL");
      await premier.termine;
    } else await f.arreter(premier);
    assert.equal(f.store.commande(commande.id).status, "taken");
    assert.equal(f.store.run(runId).status, signal === "SIGKILL" ? "running" : "cancelled");
    fs.writeFileSync(path.join(espace, "reprendre.txt"), "ok");
    const second = f.runner();
    await jusqua(() => f.store.commande(commande.id).status === "done", () => second.sortie);
    const termine = f.store.commande(commande.id);
    assert.equal(termine.run_id, runId);
    assert.equal(termine.resultat.detail.runId, runId);
    assert.equal(f.store.run(runId).status, "succeeded");
    assert.equal(f.store.runs().length, 1);
    assert.equal(fs.readFileSync(path.join(espace, "compteur.txt"), "utf8"), "1");
    assert.equal(fs.readFileSync(path.join(espace, "fini.txt"), "utf8"), "ok");
    assert.equal(f.store.etapes(runId).filter(s => s.node_id === "preparer").length, 1);
  } finally { await f.fermer(); }
});

test("une erreur de préparation refuse la commande et laisse le run lié en échec", async () => {
  const f = fixture();
  try {
    const commande = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo" }, par: "recette" });
    const runner = f.runner({ NO_VCS: "0" });
    await jusqua(() => f.store.commande(commande.id).status === "refused", () => runner.sortie);
    const refusee = f.store.commande(commande.id);
    assert.ok(refusee.run_id);
    assert.equal(f.store.run(refusee.run_id).status, "failed");
    // La raison est l'erreur écrite par le moteur (run.finished), pas le code de sortie.
    assert.match(refusee.resultat.raison, /git clone .*depot-inexistant\.git/);
    assert.equal(f.store.runs().length, 1);
  } finally { await f.fermer(); }
});

test("une décision reprend son run même après un autre lancement du même projet", async () => {
  const f = fixture({ avecApprobation: true });
  try {
    const premiere = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo", llmOverrides: { "*": { via: "claude", model: "sonnet" } } }, par: "recette" });
    const runner = f.runner();
    await jusqua(() => f.store.commande(premiere.id).status === "done", () => runner.sortie);
    const premierRun = f.store.commande(premiere.id).run_id;
    assert.equal(f.store.run(premierRun).status, "waiting_approval");
    const seconde = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo", llmOverrides: { "*": { via: "claude", model: "opus" } } }, par: "recette" });
    await jusqua(() => f.store.commande(seconde.id).status === "done", () => runner.sortie);
    const secondRun = f.store.commande(seconde.id).run_id;
    const approbation = f.store.approbationsOuvertes().find(a => a.run_id === premierRun);
    const espace = path.join(f.env.OUTPUT_ROOT, "demo", premierRun);
    fs.writeFileSync(path.join(espace, "reprendre.txt"), "ok");
    const decision = f.store.creerCommande({ kind: "approval.decide", payload: { approbationId: approbation.id, decision: "approved" }, par: "recette" });
    await jusqua(() => ["done", "refused"].includes(f.store.commande(decision.id).status), () => runner.sortie);
    const resultat = f.store.commande(decision.id);
    assert.equal(resultat.status, "done", runner.sortie);
    assert.equal(resultat.run_id, premierRun);
    assert.equal(resultat.resultat.detail.runId, premierRun);
    assert.equal(f.store.run(premierRun).status, "succeeded");
    assert.equal(f.store.run(secondRun).status, "waiting_approval");
    assert.equal(f.store.commandeLancementRun(premierRun).payload.llmOverrides["*"].model, "sonnet");
    assert.equal(f.store.runs().length, 2);
    assert.equal(fs.readFileSync(path.join(espace, "compteur.txt"), "utf8"), "1");
    assert.equal(fs.readFileSync(path.join(espace, "fini.txt"), "utf8"), "ok");
    assert.equal(fs.existsSync(path.join(f.env.OUTPUT_ROOT, "demo", secondRun, "fini.txt")), false);
  } finally { await f.fermer(); }
});

test("une orientation sans route crée un nouveau tour durable dans un autre dossier", async () => {
  const f = fixture({ avecApprobation: true });
  try {
    const depart = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo" }, par: "recette" });
    const runner = f.runner();
    await jusqua(() => f.store.commande(depart.id).status === "done", () => runner.sortie);
    const premierRun = f.store.commande(depart.id).run_id;
    const approbation = f.store.approbationsOuvertes().find(a => a.run_id === premierRun);
    const decision = f.store.creerCommande({ kind: "approval.decide", payload: { approbationId: approbation.id, decision: "oriented", note: "Revoir le plan" }, par: "recette" });
    await jusqua(() => ["done", "refused"].includes(f.store.commande(decision.id).status), () => runner.sortie);
    const resultat = f.store.commande(decision.id);
    assert.equal(resultat.status, "done", runner.sortie);
    assert.equal(resultat.run_id, premierRun);
    const suiteId = resultat.resultat.detail.commandeSuiteId;
    assert.ok(suiteId);
    await jusqua(() => f.store.commande(suiteId).status === "done", () => runner.sortie);
    const secondRun = f.store.commande(suiteId).run_id;
    assert.notEqual(secondRun, premierRun);
    assert.equal(f.store.run(premierRun).status, "succeeded");
    assert.equal(f.store.run(secondRun).status, "waiting_approval");
    assert.equal(f.store.runs().length, 2);
    assert.equal(f.store.commandes().filter(c => c.kind === "run.start").length, 2);
    for (const runId of [premierRun, secondRun]) {
      assert.equal(fs.readFileSync(path.join(f.env.OUTPUT_ROOT, "demo", runId, "compteur.txt"), "utf8"), "1");
    }
    await f.arreter(runner);
    const second = f.runner();
    await attendre(400);
    assert.equal(f.store.runs().length, 2, second.sortie);
    assert.equal(f.store.commandes().filter(c => c.kind === "run.start").length, 2);
  } finally { await f.fermer(); }
});
