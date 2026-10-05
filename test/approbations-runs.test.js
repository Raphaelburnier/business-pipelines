// Les approbations des runs dans la page Décisions (phase 5) : ce que le cockpit montre, et
// la commande qu'il dépose. Il ne tranche jamais lui-même : seul le runner écrit la décision.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const approbationsRuns = require("../src/approbations-runs");

const RAPHAEL = { par: "raphael@example.com", canal: "tailnet" };

function bac() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "approbations-runs-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const runId = store.creerRun({ pipelineRef: "marketing@1", projectId: "marketing", trigger: "cockpit" });
  const plan = store.ouvrirApprobation({
    runId,
    nodeId: "approbation",
    empreinte: "e1",
    actions: [{ id: "arb-1", type: "arbitrage", cible: "Prix de lancement ?" }, { id: "arb-2", type: "arbitrage", cible: "Canal ?" }],
  });
  const budget = store.ouvrirApprobation({ runId, nodeId: "budget-1", reason: "budget", empreinte: "budget-1", rapport: { question: "Rallonge ?" } });
  return { store, runId, plan, budget };
}

const refuse = (fn, code, motif) =>
  assert.throws(fn, (err) => err instanceof approbationsRuns.RefusApprobationRun && err.code === code && motif.test(err.message));

test("chaque approbation ouverte devient un dossier de la page Décisions", () => {
  const { store, runId, plan } = bac();
  const dossiers = approbationsRuns.dossiers(store);
  assert.strictEqual(dossiers.length, 2);
  const d = dossiers.find((x) => x.approbationId === plan.id);
  assert.strictEqual(d.source, "run");
  assert.strictEqual(d.dossier, `run:${plan.id}`);
  assert.strictEqual(d.runId, runId);
  assert.strictEqual(d.projet, "marketing");
  assert.strictEqual(d.tranche, false);
  assert.deepStrictEqual(d.actions.map((a) => [a.id, a.decision]), [["arb-1", null], ["arb-2", null]]);
});

test("une décision dépose une commande signée et n'écrit pas l'approbation", () => {
  const { store, plan } = bac();
  const envoi = approbationsRuns.demander(store, {
    approbationId: plan.id,
    demande: { decision: "approved", actions: [{ action_id: "arb-1", decision: "approuve" }, { action_id: "arb-2", decision: "refuse" }], par: "usurpateur" },
    qui: RAPHAEL,
  });
  assert.strictEqual(envoi.commande.kind, "approval.decide");
  assert.strictEqual(envoi.commande.par, RAPHAEL.par);
  assert.ok(!("par" in envoi.commande.payload), "qui décide ne vient jamais du corps");
  assert.strictEqual(store.approbation(plan.id).status, "pending");
  // Le dossier quitte la liste « à trancher » : la décision est partie.
  assert.strictEqual(approbationsRuns.dossiers(store).find((x) => x.approbationId === plan.id).tranche, true);
  refuse(() => approbationsRuns.demander(store, { approbationId: plan.id, demande: { decision: "rejected" }, qui: RAPHAEL }), 409, /déjà partie/);
});

test("les demandes vouées à l'échec sont refusées avant la file", () => {
  const { store, plan, budget } = bac();
  refuse(
    () => approbationsRuns.demander(store, { approbationId: plan.id, demande: { decision: "approved", actions: [{ action_id: "arb-1", decision: "approuve" }] }, qui: RAPHAEL }),
    400,
    /arb-2/
  );
  refuse(() => approbationsRuns.demander(store, { approbationId: budget.id, demande: { decision: "oriented", note: "  " }, qui: RAPHAEL }), 400, /consigne/);
  refuse(() => approbationsRuns.demander(store, { approbationId: "00000000-0000-4000-8000-000000000000", demande: { decision: "approved" }, qui: RAPHAEL }), 404, /inconnue/);
  store.deciderApprobation(budget.id, { decision: "approved", par: "cli" });
  refuse(() => approbationsRuns.demander(store, { approbationId: budget.id, demande: { decision: "approved" }, qui: RAPHAEL }), 409, /déjà tranchée/);
});

test("la note du vault porte la décision et qui l'a prise", () => {
  const { store, budget } = bac();
  const envoi = approbationsRuns.demander(store, { approbationId: budget.id, demande: { decision: "approved" }, qui: RAPHAEL });
  const tranche = approbationsRuns.dossierTranche(store, { ...envoi, qui: RAPHAEL });
  assert.strictEqual(tranche.tranche, true);
  assert.strictEqual(tranche.actions[0].decision, "approuve");
  assert.strictEqual(tranche.actions[0].decision_par, RAPHAEL.par);
});
