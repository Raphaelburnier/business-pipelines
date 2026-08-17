const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { loader } = require("agent-orchestrator");
const { runPipeline } = require("agent-orchestrator").engine;
const approval = require("../src/approval");
const execute = require("../src/execute");
const stageHandlers = require("../src/stage-handlers");
const {
  createHarness,
  loadPipeline,
  pipelinePath,
  writeJson,
  readJson,
  writeDecisions,
} = require("./harness");

const REGISTRE = "ajustement-prix.decisions.json";
const LEDGER = "ajustement-prix.ledger.json";

const SPEC = {
  project_name: "prix-test",
  marche: "booster box scellee",
  strategie: "aligner sur la médiane",
  mes_annonces: ["v1|101|0", "v1|102|0"],
};

function action(id, cible, vers) {
  return {
    id,
    type: "changement_prix",
    cible,
    valeur: { de: 82, vers, devise: "EUR" },
    justification: "annonces comparables plus basses",
    sources: ["v1|103|0"],
  };
}

const PLAN = [action("prix-001", "v1|101|0", 79), action("prix-002", "v1|102|0", 75)];

function planCorrect(_call, ws) {
  writeJson(ws, "actions.json", { actions: PLAN, raisonnement: ["marché entre 76 et 79"] });
}

// Approuve tout le plan dans le registre, comme le ferait l'opérateur après le premier
// arrêt du run.
function approuverTout(approvalsDir, refuse = []) {
  writeDecisions(approvalsDir, REGISTRE, {
    plan: approval.fingerprint(PLAN),
    decisions: PLAN.map((a) => ({
      action_id: a.id,
      decision: refuse.includes(a.id) ? "refuse" : "approuve",
      par: "raphael",
    })),
  });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- la garde, testée seule ----------

const approbationDe = (actions, executables) => ({
  empreinte: approval.fingerprint(actions),
  verdict: "APPROUVE",
  executables,
});

test("plan changé depuis l'approbation : bloquant, aucune action préparée", () => {
  const plan = execute.preparer({
    approbation: approbationDe(PLAN, PLAN),
    actions: [action("prix-001", "v1|101|0", 40)],
    ledger: {},
  });
  assert.match(plan.bloquant, /le plan a changé depuis l'approbation/);
  assert.strictEqual(plan.aFaire, undefined);
});

test("verdict autre qu'APPROUVE : bloquant", () => {
  const plan = execute.preparer({
    approbation: { ...approbationDe(PLAN, PLAN), verdict: "EN_ATTENTE" },
    actions: PLAN,
    ledger: {},
  });
  assert.match(plan.bloquant, /verdict "EN_ATTENTE"/);
});

// La liste de travail se lit dans `executables`, jamais dans le plan complet : c'est la
// liste courte, celle qu'un humain a validée.
test("seules les actions approuvées sont à faire, le reste est écarté et rapporté", () => {
  const plan = execute.preparer({
    approbation: approbationDe(PLAN, [PLAN[0]]),
    actions: PLAN,
    ledger: {},
  });
  assert.deepStrictEqual(plan.aFaire.map((a) => a.id), ["prix-001"]);
  assert.deepStrictEqual(plan.ecartees.map((a) => a.id), ["prix-002"]);
});

test("une action déjà consignée n'est pas refaite", () => {
  const empreinte = approval.fingerprint(PLAN);
  const plan = execute.preparer({
    approbation: approbationDe(PLAN, PLAN),
    actions: PLAN,
    ledger: { executees: [{ cle: execute.cle(empreinte, "prix-001") }] },
  });
  assert.deepStrictEqual(plan.aFaire.map((a) => a.id), ["prix-002"]);
  assert.deepStrictEqual(plan.deja.map((a) => a.id), ["prix-001"]);
});

// Le point subtil : un id comme "prix-001" revient d'un plan à l'autre en désignant
// autre chose. Sans l'empreinte dans la clé, un ajustement légitime serait sauté au
// motif qu'un homonyme a déjà eu lieu.
test("un id réutilisé dans un AUTRE plan est bien exécuté", () => {
  const autrePlan = [action("prix-001", "v1|101|0", 60)];
  const plan = execute.preparer({
    approbation: approbationDe(autrePlan, autrePlan),
    actions: autrePlan,
    // Consigné sous l'empreinte de l'ANCIEN plan.
    ledger: { executees: [{ cle: execute.cle(approval.fingerprint(PLAN), "prix-001") }] },
  });
  assert.deepStrictEqual(plan.aFaire.map((a) => a.id), ["prix-001"]);
  assert.deepStrictEqual(plan.deja, []);
});

test("type sans exécuteur : arrêt en le nommant, jamais de saut silencieux", async () => {
  const { reussies, echec } = await execute.executer({
    aFaire: [PLAN[0]],
    executeurs: {},
    empreinte: "x",
  });
  assert.deepStrictEqual(reussies, []);
  assert.match(echec.raison, /aucun exécuteur pour le type "changement_prix"/);
});

test("échec en cours de lot : arrêt, les précédentes restent acquises", async () => {
  let vues = 0;
  const { reussies, echec } = await execute.executer({
    aFaire: PLAN,
    executeurs: {
      changement_prix: async (a) => {
        vues += 1;
        if (a.id === "prix-002") throw new Error("API indisponible");
        return { ok: true };
      },
    },
    empreinte: "x",
  });

  assert.strictEqual(vues, 2, "on s'arrête à la casse, on ne tente pas la suite");
  assert.deepStrictEqual(reussies.map((r) => r.id), ["prix-001"]);
  assert.strictEqual(echec.action.id, "prix-002");
  assert.match(echec.raison, /API indisponible/);
});

// Consigner en bloc à la fin ferait rejouer, au run suivant, des actions déjà passées.
test("chaque succès est consigné immédiatement, pas à la fin du lot", async () => {
  const ordre = [];
  await execute.executer({
    aFaire: PLAN,
    executeurs: {
      changement_prix: async (a) => {
        ordre.push(`exec:${a.id}`);
        if (a.id === "prix-002") throw new Error("coupure");
      },
    },
    empreinte: "x",
    consigner: async (t) => ordre.push(`ledger:${t.id}`),
  });

  assert.deepStrictEqual(ordre, ["exec:prix-001", "ledger:prix-001", "exec:prix-002"]);
});

// ---------- le stage, dans le pipeline ----------

test("un stage execute avec un gate est rejeté au chargement", () => {
  const raw = loadPipeline("ajustement-prix");
  raw.stages[4].gate = {
    report: "x", pass_when: {}, fail_when: { equals: ["y"] }, items: "i", targets: {}, rerun_from: "plan",
  };
  assert.throws(
    () =>
      loader.loadPipeline(pipelinePath("ajustement-prix"), {
        raw,
        stageValidators: stageHandlers.validators,
        backends: {},
      }),
    /ne porte pas de gate/
  );
});

// L'état livré : la garde est en place, le geste n'existe pas. Le run doit le dire.
test("aucun exécuteur enregistré : le run s'arrête en nommant le type manquant", async () => {
  const h = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
  });
  approuverTout(h.approvalsDir);

  await assert.rejects(() => runPipeline(h.ctx), /aucun exécuteur pour le type "changement_prix"/);
  assert.strictEqual(readJson(h.workspaceDir, "execution.json").verdict, "PARTIEL");
});

test("avec un exécuteur : les approuvées passent, les refusées jamais", async () => {
  const faites = [];
  const h = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
    executeurs: { changement_prix: async (a) => { faites.push(a.id); return { applique: a.valeur.vers }; } },
  });
  approuverTout(h.approvalsDir, ["prix-002"]);

  await runPipeline(h.ctx);

  assert.deepStrictEqual(faites, ["prix-001"], "l'action refusée ne doit jamais partir");
  const etat = readJson(h.workspaceDir, "execution.json");
  assert.strictEqual(etat.verdict, "EXECUTE");
  assert.deepStrictEqual(etat.reussies.map((r) => r.id), ["prix-001"]);
  assert.deepStrictEqual(etat.ecartees, ["prix-002"]);
});

test("relance après un run complet : rien n'est refait", async () => {
  const faites = [];
  const executeurs = { changement_prix: async (a) => { faites.push(a.id); } };

  const premier = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
    executeurs,
  });
  approuverTout(premier.approvalsDir);
  await runPipeline(premier.ctx);
  assert.deepStrictEqual(faites, ["prix-001", "prix-002"]);

  // Second run, même registre et même ledger : le workspace est neuf, pas eux.
  const second = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
    executeurs,
  });
  second.ctx.approvalsDir = premier.approvalsDir;
  await runPipeline(second.ctx);

  assert.deepStrictEqual(faites, ["prix-001", "prix-002"], "aucune action ne doit repartir");
  const etat = readJson(second.workspaceDir, "execution.json");
  assert.deepStrictEqual(etat.deja, ["prix-001", "prix-002"]);
  assert.deepStrictEqual(etat.reussies, []);
});

test("le ledger vit hors du workspace, hors de portée des agents", async () => {
  const h = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
    executeurs: { changement_prix: async () => {} },
  });
  approuverTout(h.approvalsDir);
  await runPipeline(h.ctx);

  assert.ok(fs.existsSync(path.join(h.approvalsDir, LEDGER)), "le ledger est dans le dossier des décisions");
  assert.ok(
    !fs.existsSync(path.join(h.workspaceDir, LEDGER)),
    "il ne doit jamais apparaître dans le workspace"
  );
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✘ ${name}\n    ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests d'exécution OK`);
  process.exit(failed ? 1 : 0);
})();
