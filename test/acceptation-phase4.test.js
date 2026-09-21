// Acceptation de la phase 4 : un run lancé ailleurs apparaît dans le cockpit, en direct.
//
// Le run est un vrai run du moteur en graphe, pas des écritures simulées : c'est
// `runGraphe` qui tourne, avec ses nœuds, son journal de reprise et son event store. Le
// pipeline n'a que des nœuds script, donc aucun modèle n'est appelé et le test ne coûte
// rien en quota.
//
// Ce que ça prouve, et que ni l'API ni le front ne prouvent seuls : les deux bouts parlent
// bien de la même base, et ce qu'un run écrit pendant qu'il tourne ressort du flux pendant
// qu'il tourne.
const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const registre = require("agent-orchestrator/src/registre");
const { runGraphe } = require("agent-orchestrator/src/graphe");
const { Reporter } = require("agent-orchestrator/src/reporter");
const { BudgetTracker } = require("agent-orchestrator/src/budget-tracker");
const resumeLedger = require("agent-orchestrator/src/resume");

const RACINE = path.resolve(__dirname, "..");
const PORT = 4703;
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Deux étapes déterministes : préparer, puis vérifier. La forme d'un vrai pipeline, sans
// le coût d'un agent.
const PIPELINE = {
  name: "acceptation",
  version: 1,
  description: "Pipeline de test : deux nœuds déterministes, aucun modèle appelé.",
  nodes: [
    { id: "preparer", type: "script", handler: "preparer", params: { output: "plan.json" } },
    {
      id: "verifier",
      type: "script",
      handler: "verifier",
      params: { report: "verdict.json" },
      outcomeFrom: { report: "verdict.json", field: "verdict" },
    },
  ],
  edges: [{ from: "preparer", to: "verifier" }],
};

const HANDLERS = {
  preparer: async (stage, ctx) =>
    fs.writeFileSync(path.join(ctx.workspaceDir, stage.output), JSON.stringify({ pret: true })),
  verifier: async (stage, ctx) =>
    fs.writeFileSync(path.join(ctx.workspaceDir, stage.report), JSON.stringify({ verdict: "COMPLETE", manques: [] })),
};

function demarrerCockpit(env) {
  const enfant = spawn(process.execPath, [path.join(RACINE, "bin", "cockpit.js")], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resoudre, rejeter) => {
    const minuterie = setTimeout(() => rejeter(new Error("le cockpit n'a pas démarré")), 8000);
    enfant.stdout.on("data", (d) => {
      if (String(d).includes("Cockpit sur")) {
        clearTimeout(minuterie);
        resoudre(enfant);
      }
    });
    enfant.on("exit", (code) => rejeter(new Error(`cockpit arrêté avant d'écouter (code ${code})`)));
  });
}

function ecouterFlux(port) {
  const recu = [];
  const requete = http.get({ host: "127.0.0.1", port, path: "/api/stream" }, (res) => {
    res.setEncoding("utf-8");
    res.on("data", (morceau) => {
      for (const ligne of morceau.split("\n")) {
        if (ligne.startsWith("data: ")) recu.push(JSON.parse(ligne.slice(6)));
      }
    });
  });
  return { recu, requete };
}

function lire(port, chemin) {
  return new Promise((resoudre, rejeter) => {
    http
      .get({ host: "127.0.0.1", port, path: chemin }, (res) => {
        let corps = "";
        res.setEncoding("utf-8");
        res.on("data", (d) => (corps += d));
        res.on("end", () => resoudre({ code: res.statusCode, corps: JSON.parse(corps) }));
      })
      .on("error", rejeter);
  });
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test("un run lancé hors du cockpit apparaît dans le flux et dans l'API, pendant qu'il tourne", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acceptation4-"));
  const chemin = path.join(dir, "events.sqlite");
  const store = new EventStore(chemin);

  const cockpit = await demarrerCockpit({
    COCKPIT_PORT: String(PORT),
    APPROVALS_DIR: path.join(dir, "approvals"),
    ORCH_EVENT_STORE: chemin,
    COCKPIT_OPERATEUR_LOCAL: "test",
  });

  const flux = ecouterFlux(PORT);
  await attendre(150);

  try {
    // Le run, exactement comme `orch projet` le lance : pipeline validé, journal de
    // reprise, event store partagé.
    const { pipeline, agents } = registre.chargerPipeline(dir, PIPELINE);
    const spec = { project_name: "acceptation" };
    const espace = path.join(dir, "travail");
    fs.mkdirSync(espace, { recursive: true });
    const resume = resumeLedger.open(espace, { pipeline, spec, fresh: true });
    const runId = store.creerRun({ pipelineRef: "acceptation@1", projectId: "acceptation", trigger: "test" });
    resume.setRunId(runId);

    await runGraphe({
      pipeline,
      agents,
      spec,
      workspaceDir: espace,
      stageHandlers: HANDLERS,
      backends: {},
      env: {},
      budget: new BudgetTracker({}, { lever: false }),
      budgetBase: {},
      reporter: new Reporter(espace, { store, runId, silencieux: true }),
      resume,
      abortController: new AbortController(),
    });
    store.statutRun(runId, "succeeded");

    // Le flux tenait la connexion pendant tout le run : ce qu'il a reçu est ce que le
    // cockpit aurait affiché en direct.
    await attendre(1400);
    const types = flux.recu.map((e) => e.type);
    assert.ok(types.includes("script.start"), `le flux devait voir le début d'une étape, reçu : ${types.join(", ")}`);
    assert.ok(types.includes("node.done"), "le flux devait voir un nœud se terminer");
    assert.ok(
      flux.recu.every((e, i) => i === 0 || e.id > flux.recu[i - 1].id),
      "les événements arrivent dans l'ordre, sans doublon"
    );

    // Et l'API rend le même run, avec ses deux étapes et leur issue.
    const topo = await lire(PORT, "/api/topology");
    assert.strictEqual(topo.code, 200);
    const projet = topo.corps.projets.find((p) => p.id === "acceptation");
    assert.ok(projet, "le projet du run apparaît dans la topologie");
    assert.strictEqual(projet.aFiche, false, "le projet n'a pas de fiche : il est connu par son run");

    const detail = await lire(PORT, `/api/runs/${runId}`);
    assert.deepStrictEqual(
      detail.corps.etapes.map((e) => [e.noeud, e.statut, e.outcome]),
      [
        ["preparer", "succeeded", null],
        ["verifier", "succeeded", "COMPLETE"],
      ]
    );
    assert.strictEqual(detail.corps.statut, "succeeded");
  } finally {
    flux.requete.destroy();
    cockpit.kill();
    store.fermer();
  }
});

(async () => {
  let echecs = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      echecs += 1;
      console.error(`  ✘ ${name}\n    ${err.stack}`);
    }
  }
  console.log(`\n${tests.length - echecs}/${tests.length} test d'acceptation de la phase 4 OK`);
  process.exit(echecs ? 1 : 0);
})();
