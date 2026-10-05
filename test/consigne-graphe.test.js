// La consigne d'un pipeline en graphe (marketing@1 lancé par le runner) : la note d'une
// orientation posée sur l'approbation du run précédent du même projet, lue dans l'event store.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const { handlers } = require("../src/stage-handlers");

const PIPELINE = { nodes: [{ id: "consigne", type: "script" }, { id: "approbation", type: "approval" }] };
const STAGE = { id: "consigne", output: "orientation.json" };

function bac() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "consigne-graphe-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const workspaceDir = path.join(dir, "ws");
  fs.mkdirSync(workspaceDir);
  const evenements = [];
  const ctx = (runId) => ({ pipeline: PIPELINE, workspaceDir, reporter: { store, runId, event: (type) => evenements.push(type) } });
  const lire = () => JSON.parse(fs.readFileSync(path.join(workspaceDir, "orientation.json"), "utf8"));
  return { store, ctx, lire, evenements };
}

const nouveauRun = (store) => store.creerRun({ pipelineRef: "marketing@1", projectId: "marketing", trigger: "cockpit" });

test("premier run du projet : aucune consigne", async () => {
  const { store, ctx, lire } = bac();
  await handlers.consigne(STAGE, ctx(nouveauRun(store)));
  assert.strictEqual(lire().consigne, null);
});

test("une orientation du run précédent devient la consigne du suivant", async () => {
  const { store, ctx, lire, evenements } = bac();
  const premier = nouveauRun(store);
  const a = store.ouvrirApprobation({ runId: premier, nodeId: "approbation", empreinte: "e1", actions: [{ id: "x" }] });
  store.deciderApprobation(a.id, { decision: "oriented", note: "Viser les indépendants, pas les agences.", par: "raphael" });
  await new Promise((r) => setTimeout(r, 5));
  await handlers.consigne(STAGE, ctx(nouveauRun(store)));
  assert.strictEqual(lire().consigne, "Viser les indépendants, pas les agences.");
  assert.ok(evenements.includes("consigne:reprise"));
});

test("un run précédent approuvé ne laisse pas de consigne", async () => {
  const { store, ctx, lire } = bac();
  const premier = nouveauRun(store);
  const a = store.ouvrirApprobation({ runId: premier, nodeId: "approbation", empreinte: "e1", actions: [{ id: "x" }] });
  store.deciderApprobation(a.id, { decision: "approved", par: "raphael", actions: [{ action_id: "x", decision: "approuve" }] });
  await new Promise((r) => setTimeout(r, 5));
  await handlers.consigne(STAGE, ctx(nouveauRun(store)));
  assert.strictEqual(lire().consigne, null);
});
