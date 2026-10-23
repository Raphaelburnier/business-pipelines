// La raison d'un run en échec vient de run.finished, pas du code de sortie de orch.js
// (run 0.7 du 22 octobre : « processus terminé en code 1 » pour un plafond de tours).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventStore } = require("agent-orchestrator");
const { raisonEchec } = require("../src/echec-run");

function storeNeuf() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echec-run-"));
  return new EventStore(path.join(dir, "events.sqlite"));
}

test("un run en échec rend l'erreur écrite par le moteur, sur sa première ligne", () => {
  const store = storeNeuf();
  const runId = store.creerRun({ pipelineRef: "demo@1" });
  const debut = new Date(Date.now() - 1000).toISOString();
  store.emettre({ type: "run.finished", runId, payload: { status: "failed", error: "Agent \"plan\" a épuisé son plafond de 35 turns\ndétail" } });
  assert.equal(raisonEchec(store, runId, { code: 1, debut }), "Agent \"plan\" a épuisé son plafond de 35 turns");
});

test("sans fin écrite depuis ce lancement, le code de sortie reste la raison", () => {
  const store = storeNeuf();
  const runId = store.creerRun({ pipelineRef: "demo@1" });
  // Un segment précédent d'un run repris : son erreur ne décrit pas ce lancement.
  store.emettre({ type: "run.finished", runId, payload: { status: "failed", error: "ancienne erreur" } });
  const debut = new Date(Date.now() + 60_000).toISOString();
  assert.equal(raisonEchec(store, runId, { code: 1, debut }), "processus terminé en code 1");
  assert.equal(raisonEchec(store, null, { code: 2 }), "processus terminé en code 2");
});

test("une erreur de lancement et une fin réussie ne sont pas remplacées", () => {
  const store = storeNeuf();
  const runId = store.creerRun({ pipelineRef: "demo@1" });
  store.emettre({ type: "run.finished", runId, payload: { status: "succeeded" } });
  assert.equal(raisonEchec(store, runId, { code: 1 }), "processus terminé en code 1");
  assert.equal(raisonEchec(store, runId, { code: 1, erreur: "spawn ENOENT" }), "spawn ENOENT");
});
