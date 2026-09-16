const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { loader } = require("agent-orchestrator");
const { runPipeline } = require("agent-orchestrator").engine;
const approval = require("../src/approval");
const stageHandlers = require("../src/stage-handlers");
const {
  stageParId,
  createHarness,
  loadPipeline,
  loadFixture,
  fixturePath,
  writeJson,
  readJson,
  writeDecisions,
} = require("./harness");

const REGISTRE = "exemple.decisions.json";
const PLAN_GELE = "exemple.plan.json";

const SPEC = { project_name: "approbation-test", demande: "proposer deux publications" };

function action(id, cible, texte) {
  return {
    id,
    type: "publication",
    cible,
    valeur: { texte },
    justification: "la page ne dit pas encore ce que fait l'offre",
  };
}

const PLAN = [action("pub-001", "page-accueil", "Titre A"), action("pub-002", "page-offre", "Titre B")];

// Un planificateur correct : deux actions.
function planCorrect(_call, ws) {
  writeJson(ws, "actions.json", { actions: PLAN });
}

const planifier = (opts = {}) =>
  createHarness({
    pipeline: loadFixture("approbation"),
    spec: SPEC,
    script: { planificateur: planCorrect },
    ...opts,
  });

const lireBoite = (dir) => {
  const p = path.join(dir, "EN-ATTENTE.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
};

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------- le juge, testé seul ----------

test("empreinte : stable au reformatage, changée dès qu'une valeur bouge", () => {
  const a = [action("pub-001", "page-accueil", "Titre A")];
  const reformate = [{ ...a[0], justification: "autre phrase" }];
  const modifie = [action("pub-001", "page-accueil", "Titre C")];

  assert.strictEqual(approval.fingerprint(a), approval.fingerprint(reformate));
  assert.notStrictEqual(approval.fingerprint(a), approval.fingerprint(modifie));
});

test("fail-closed : sans liste \"auto\", toute action demande une approbation", () => {
  const etat = approval.evaluate({ actions: [action("a", "c", "t")], decisions: null, auto: [] });
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.executables.length, 0);
});

test("une décision mal orthographiée ne vaut pas approbation", () => {
  const actions = [action("a", "c", "t")];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      decisions: [{ action_id: "a", decision: "approuvé" }],
    },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "EN_ATTENTE", "seul \"approuve\" exactement vaut accord");
});

test("un refus est une décision, pas un blocage : le plan aboutit sans l'action", () => {
  const actions = [action("a", "c1", "t1"), action("b", "c2", "t2")];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      decisions: [
        { action_id: "a", decision: "approuve" },
        { action_id: "b", decision: "refuse", motif: "hors ton" },
      ],
    },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "APPROUVE");
  assert.deepStrictEqual(etat.executables.map((x) => x.id), ["a"]);
  assert.strictEqual(etat.refusees[0].motif, "hors ton");
});

test("une décision orpheline est signalée sans bloquer", () => {
  const actions = [action("a", "c", "t")];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      decisions: [
        { action_id: "a", decision: "approuve" },
        { action_id: "disparue", decision: "approuve" },
      ],
    },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "APPROUVE");
  assert.deepStrictEqual(etat.orphelines, ["disparue"]);
});

test("\"auto\" dispense un type, et lui seul", () => {
  const actions = [
    { id: "a", type: "note", cible: "c", valeur: 1 },
    { id: "b", type: "publication", cible: "c", valeur: 2 },
  ];
  const etat = approval.evaluate({ actions, decisions: null, auto: ["note"] });
  assert.deepStrictEqual(etat.automatiques.map((x) => x.id), ["a"]);
  assert.deepStrictEqual(etat.en_attente.map((x) => x.id), ["b"]);
});

test("réponse libre : le plan repart au travail, rien ne s'exécute", () => {
  const actions = [action("a", "c", "t1"), action("b", "c", "t2")];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      reponse: "  Reprends l'angle prix, pas l'angle image.  ",
      decisions: [{ action_id: "a", decision: "approuve" }],
    },
    auto: ["publication"],
  });
  assert.strictEqual(etat.verdict, "ORIENTE");
  assert.strictEqual(etat.orientation, "Reprends l'angle prix, pas l'angle image.");
  // Ni l'action approuvée ni le type automatique ne passent : l'opérateur a demandé
  // autre chose, exécuter le plan qu'il vient de renvoyer serait lui désobéir.
  assert.deepStrictEqual(etat.executables, []);
});

test("une réponse blanche ne vaut pas orientation et ne débloque rien", () => {
  const actions = [action("a", "c", "t")];
  const etat = approval.evaluate({
    actions,
    decisions: { plan: approval.fingerprint(actions), reponse: "   \n  ", decisions: [] },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.orientation, null);
});

test("une réponse portant sur un plan périmé ne vaut rien", () => {
  const actions = [action("a", "c", "t")];
  const etat = approval.evaluate({
    actions,
    decisions: { plan: "empreinte-d-un-autre-plan", reponse: "vas-y", decisions: [] },
    auto: ["publication"],
  });
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.orientation, null);
  assert.ok(etat.perimee);
});

test("sans réponse libre, le verdict d'avant est inchangé", () => {
  const actions = [action("a", "c", "t")];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      decisions: [{ action_id: "a", decision: "approuve" }],
    },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "APPROUVE");
  assert.strictEqual(etat.orientation, null);
  assert.strictEqual(etat.executables.length, 1);
});

// ---------- les pipelines livrés ----------

test("le pipeline marketing se charge avec les validateurs du dépôt", () => {
  const pipeline = loadPipeline("marketing");
  assert.strictEqual(stageParId(pipeline, "approbation").type, "approval");
  assert.strictEqual(stageParId(pipeline, "couverture").type, "verify-couverture");
  assert.strictEqual(stageParId(pipeline, "consigne").type, "consigne");
  assert.ok(!stageParId(pipeline, "approbation").gate, "l'approbation ne porte pas de gate");
});

test("un stage approval avec un gate est rejeté au chargement", () => {
  const raw = loadFixture("approbation");
  stageParId(raw, "approbation").gate = { report: "x", pass_when: {}, fail_when: { equals: ["y"] }, items: "i", targets: {}, rerun_from: "plan" };
  assert.throws(
    () =>
      loader.loadPipeline(fixturePath("approbation"), {
        raw,
        stageValidators: stageHandlers.validators,
        backends: {},
      }),
    /ne porte pas de gate/
  );
});

// ---------- l'approbation dans un run ----------

test("sans décision : le run s'arrête en nommant chaque action en attente", async () => {
  const h = planifier();

  await assert.rejects(() => runPipeline(h.ctx), (err) => {
    assert.match(err.message, /2 action\(s\) attendent ton approbation/);
    assert.match(err.message, /pub-001 : publication sur page-accueil/);
    assert.match(err.message, /"plan": "[0-9a-f]{16}"/, "l'empreinte à recopier doit être donnée");
    return true;
  });

  // L'état complet est écrit malgré l'arrêt : c'est ce qui rend la reprise possible.
  const etat = readJson(h.workspaceDir, "approbation.json");
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.en_attente.length, 2);
});

test("décisions complètes : le run aboutit et n'expose que les actions approuvées", async () => {
  const h = planifier();
  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: approval.fingerprint(PLAN),
    decisions: [
      { action_id: "pub-001", decision: "approuve", par: "raphael", le: "2026-08-17" },
      { action_id: "pub-002", decision: "refuse", motif: "hors ton" },
    ],
  });

  await runPipeline(h.ctx);

  const etat = readJson(h.workspaceDir, "approbation.json");
  assert.strictEqual(etat.verdict, "APPROUVE");
  assert.deepStrictEqual(etat.executables.map((a) => a.id), ["pub-001"]);
  assert.deepStrictEqual(etat.refusees.map((a) => a.id), ["pub-002"]);
});

// Le TOCTOU : approuver un plan puis en exécuter un autre. L'approbation porte sur
// l'empreinte, donc elle meurt avec le plan qu'elle visait.
test("le plan change après la décision : arrêt, aucune action n'est exécutable", async () => {
  const neuf = [action("pub-001", "page-accueil", "Titre bien différent")];
  const h = planifier({
    script: { planificateur: (_call, ws) => writeJson(ws, "actions.json", { actions: neuf }) },
  });

  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: approval.fingerprint([action("pub-001", "page-accueil", "Titre A")]),
    decisions: [{ action_id: "pub-001", decision: "approuve" }],
  });

  await assert.rejects(() => runPipeline(h.ctx), /le plan a changé depuis la décision/);
  assert.strictEqual(readJson(h.workspaceDir, "approbation.json").executables.length, 0);

  // Refuser d'exécuter est juste. Refuser de DÉPOSER ne l'était pas : le nouveau plan
  // restait invisible, donc rien à décider dans le cockpit et aucune alerte.
  const boite = lireBoite(h.approvalsDir);
  assert.strictEqual(boite.en_attente.length, 1, "le plan neuf doit entrer dans la boîte");
  const gele = JSON.parse(fs.readFileSync(path.join(h.approvalsDir, PLAN_GELE), "utf-8"));
  assert.strictEqual(
    gele.empreinte,
    approval.fingerprint(neuf),
    "c'est le plan NEUF qui est gelé, pas celui que l'ancienne décision visait"
  );
  assert.strictEqual(boite.en_attente[0].empreinte, gele.empreinte);
});

// Le seul cas où s'arrêter sec reste juste : plus rien à faire attendre, donc rien à
// déposer, et un registre caduc qu'on ne veut surtout pas voir servir.
test("registre caduc et aucune action à attendre : arrêt net, la boîte reste vide", async () => {
  const h = planifier({
    script: { planificateur: (_call, ws) => writeJson(ws, "actions.json", { actions: [] }) },
  });

  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: approval.fingerprint([action("pub-001", "page-accueil", "Titre A")]),
    decisions: [{ action_id: "pub-001", decision: "approuve" }],
  });

  await assert.rejects(() => runPipeline(h.ctx), /le plan a changé depuis la décision/);
  assert.strictEqual(
    lireBoite(h.approvalsDir),
    null,
    "sans action en attente, il n'y a rien à déposer et la boîte ne doit pas être inventée"
  );
});

test("le registre vit hors du workspace, hors de portée des agents", async () => {
  const h = planifier();
  await assert.rejects(() => runPipeline(h.ctx));

  assert.notStrictEqual(h.approvalsDir, h.workspaceDir);
  assert.ok(
    !fs.existsSync(path.join(h.workspaceDir, REGISTRE)),
    "le registre ne doit jamais apparaître dans le workspace"
  );
});

test("plan vide : aucune action, aucune approbation à demander, le run aboutit", async () => {
  const h = planifier({
    script: { planificateur: (_call, ws) => writeJson(ws, "actions.json", { actions: [] }) },
  });

  await runPipeline(h.ctx);
  assert.strictEqual(readJson(h.workspaceDir, "approbation.json").verdict, "APPROUVE");
});

test("réponse libre de bout en bout : la consigne est déposée, rien n'est exécutable", async () => {
  const h = planifier();
  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: approval.fingerprint(PLAN),
    reponse: "Parle du prix avant de parler de l'image.",
    // Une décision déjà prise ne doit pas passer non plus : la réponse libre prime.
    decisions: [{ action_id: "pub-001", decision: "approuve" }],
  });

  await assert.rejects(() => runPipeline(h.ctx), (err) => {
    assert.match(err.message, /réponse libre reçue/);
    assert.match(err.message, /Parle du prix avant de parler de l'image/);
    return true;
  });

  const orientation = readJson(h.workspaceDir, "orientation.json");
  assert.strictEqual(orientation.empreinte, approval.fingerprint(PLAN));
  assert.match(orientation.consigne, /^Parle du prix/);
  assert.ok(orientation.recue_le, "la consigne est datée");

  const etat = readJson(h.workspaceDir, "approbation.json");
  assert.strictEqual(etat.verdict, "ORIENTE");
  assert.deepStrictEqual(etat.executables, []);
});

// ---------- le gel et la boîte des décisions en attente ----------

test("le gel porte l'empreinte, sa date, et le texte exact des actions", async () => {
  const h = planifier();
  await assert.rejects(() => runPipeline(h.ctx), /Le plan est gelé dans/);

  const gele = JSON.parse(fs.readFileSync(path.join(h.approvalsDir, PLAN_GELE), "utf-8"));
  assert.strictEqual(gele.empreinte, approval.fingerprint(PLAN));
  assert.deepStrictEqual(gele.actions, PLAN);
  assert.ok(gele.gele_le, "le gel est daté");
});

// Un arrêt qui ne s'écrit que dans un terminal est invisible quand le run tourne sur une
// autre machine : le pipeline s'arrêterait et l'attente durerait indéfiniment.
test("l'arrêt sur approbation dépose la demande dans la boîte", async () => {
  const h = planifier();
  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);

  const boite = lireBoite(h.approvalsDir);
  assert.strictEqual(boite.en_attente.length, 1);
  const demande = boite.en_attente[0];
  assert.strictEqual(demande.dossier, "exemple");
  assert.strictEqual(demande.actions, 2);
  assert.strictEqual(demande.empreinte, approval.fingerprint(PLAN));
  assert.ok(demande.depuis, "l'attente doit être datée, sinon impossible de dire depuis quand");
});

test("la demande nomme le registre à remplir et le plan gelé", async () => {
  const h = planifier();
  await assert.rejects(() => runPipeline(h.ctx));

  const demande = lireBoite(h.approvalsDir).en_attente[0];
  assert.match(demande.registre, /exemple\.decisions\.json$/);
  assert.match(demande.plan_gele, /exemple\.plan\.json$/);
});

// Replanifier remplace la demande. L'empiler laisserait dans la boîte des demandes
// portant sur des plans qui n'existent plus, et une boîte pleine de faux se fait ignorer.
test("replanifier remplace la demande au lieu de l'empiler", async () => {
  const premier = planifier();
  await assert.rejects(() => runPipeline(premier.ctx));

  const second = planifier();
  second.ctx.approvalsDir = premier.approvalsDir;
  await assert.rejects(() => runPipeline(second.ctx));

  assert.strictEqual(lireBoite(premier.approvalsDir).en_attente.length, 1);
});

test("une fois tout décidé, la demande sort de la boîte au passage suivant", async () => {
  const p = planifier();
  await assert.rejects(() => runPipeline(p.ctx));
  assert.strictEqual(lireBoite(p.approvalsDir).en_attente.length, 1);

  writeDecisions(p.approvalsDir, REGISTRE, {
    plan: approval.fingerprint(PLAN),
    decisions: PLAN.map((a) => ({ action_id: a.id, decision: "approuve" })),
  });

  const relecture = planifier();
  relecture.ctx.approvalsDir = p.approvalsDir;
  await runPipeline(relecture.ctx);

  assert.deepStrictEqual(lireBoite(p.approvalsDir).en_attente, []);
});

test("sans dossier déclaré, aucune boîte n'est touchée", async () => {
  const pipeline = loadFixture("approbation");
  delete stageParId(pipeline, "approbation").dossier;
  const h = createHarness({ pipeline, spec: SPEC, script: { planificateur: planCorrect } });

  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);
  assert.strictEqual(lireBoite(h.approvalsDir), null, "la boîte est optionnelle");
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests d'approbation OK`);
  process.exit(failed ? 1 : 0);
})();
