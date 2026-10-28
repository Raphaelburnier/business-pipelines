const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {spawn}=require("node:child_process");
const {EventStore}=require("agent-orchestrator");
const RACINE=path.resolve(__dirname,"../..");
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

module.exports={fixture};
