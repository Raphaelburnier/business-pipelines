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
  pipelinePath,
  writeJson,
  readJson,
  writeDecisions,
} = require("./harness");

const REGISTRE = "ajustement-prix.decisions.json";

const SPEC = {
  project_name: "prix-test",
  marche: "booster box scellee",
  strategie: "aligner sur la médiane des annonces neuves",
  mes_annonces: ["v1|101|0", "v1|102|0"],
};

function action(id, cible, vers) {
  return {
    id,
    type: "changement_prix",
    cible,
    valeur: { de: 82, vers, devise: "EUR" },
    justification: "quatre annonces comparables plus basses",
    sources: ["v1|103|0"],
  };
}

// Un planificateur correct : deux actions chiffrées sur mes propres annonces.
function planCorrect(_call, ws) {
  writeJson(ws, "actions.json", {
    actions: [action("prix-001", "v1|101|0", 79), action("prix-002", "v1|102|0", 75)],
    raisonnement: ["le marché neuf est entre 76 et 79 EUR"],
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ---------- le juge, testé seul ----------

test("empreinte : stable au reformatage, changée dès qu'un montant bouge", () => {
  const a = [action("prix-001", "v1|101|0", 79)];
  const reformate = [{ ...a[0], justification: "autre phrase", sources: [] }];
  const modifie = [action("prix-001", "v1|101|0", 70)];

  assert.strictEqual(approval.fingerprint(a), approval.fingerprint(reformate));
  assert.notStrictEqual(approval.fingerprint(a), approval.fingerprint(modifie));
});

test("fail-closed : sans liste \"auto\", toute action demande une approbation", () => {
  const etat = approval.evaluate({ actions: [action("a", "c", 1)], decisions: null, auto: [] });
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.executables.length, 0);
});

test("une décision mal orthographiée ne vaut pas approbation", () => {
  const actions = [action("a", "c", 1)];
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
  const actions = [action("a", "c1", 1), action("b", "c2", 2)];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      decisions: [
        { action_id: "a", decision: "approuve" },
        { action_id: "b", decision: "refuse", motif: "trop bas" },
      ],
    },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "APPROUVE");
  assert.deepStrictEqual(etat.executables.map((x) => x.id), ["a"]);
  assert.strictEqual(etat.refusees[0].motif, "trop bas");
});

test("une décision orpheline est signalée sans bloquer", () => {
  const actions = [action("a", "c", 1)];
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
    { id: "a", type: "veille", cible: "c", valeur: 1 },
    { id: "b", type: "changement_prix", cible: "c", valeur: 2 },
  ];
  const etat = approval.evaluate({ actions, decisions: null, auto: ["veille"] });
  assert.deepStrictEqual(etat.automatiques.map((x) => x.id), ["a"]);
  assert.deepStrictEqual(etat.en_attente.map((x) => x.id), ["b"]);
});

// ---------- le pipeline complet ----------

test("le pipeline ajustement-prix est valide", () => {
  const pipeline = loadPipeline("ajustement-prix");
  assert.strictEqual(stageParId(pipeline, "approbation").type, "approval");
  assert.ok(!stageParId(pipeline, "approbation").gate, "l'approbation ne porte pas de gate");
});

test("un stage approval avec un gate est rejeté au chargement", () => {
  const raw = loadPipeline("ajustement-prix");
  stageParId(raw, "approbation").gate = { report: "x", pass_when: {}, fail_when: { equals: ["y"] }, items: "i", targets: {}, rerun_from: "plan" };
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

test("sans décision : le run s'arrête en nommant chaque action en attente", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({ pipeline, spec: SPEC, script: { "price-planner": planCorrect } });

  await assert.rejects(() => runPipeline(h.ctx), (err) => {
    assert.match(err.message, /2 action\(s\) attendent ton approbation/);
    assert.match(err.message, /prix-001 : changement_prix sur v1\|101\|0/);
    assert.match(err.message, /"plan": "[0-9a-f]{16}"/, "l'empreinte à recopier doit être donnée");
    return true;
  });

  // L'état complet est écrit malgré l'arrêt : c'est ce qui rend la reprise possible.
  const etat = readJson(h.workspaceDir, "approbation.json");
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.en_attente.length, 2);
});

test("décisions complètes : le run aboutit et n'expose que les actions approuvées", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  // Un exécuteur muet : ce test porte sur ce que l'approbation expose, pas sur ce que
  // l'exécution en fait. Sans lui le run s'arrêterait faute d'exécuteur, ce qui est le
  // comportement voulu mais pas le sujet ici.
  const h = createHarness({
    pipeline,
    spec: SPEC,
    script: { "price-planner": planCorrect },
    executeurs: { changement_prix: async () => {} },
  });

  // On rejoue le plan pour connaître l'empreinte, comme le ferait l'opérateur en lisant
  // le message d'arrêt du premier run.
  planCorrect(1, h.workspaceDir);
  const empreinte = approval.fingerprint(readJson(h.workspaceDir, "actions.json").actions);
  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: empreinte,
    decisions: [
      { action_id: "prix-001", decision: "approuve", par: "raphael", le: "2026-08-17" },
      { action_id: "prix-002", decision: "refuse", motif: "marge trop faible" },
    ],
  });

  await runPipeline(h.ctx);

  const etat = readJson(h.workspaceDir, "approbation.json");
  assert.strictEqual(etat.verdict, "APPROUVE");
  assert.deepStrictEqual(etat.executables.map((a) => a.id), ["prix-001"]);
  assert.deepStrictEqual(etat.refusees.map((a) => a.id), ["prix-002"]);
});

// Le TOCTOU nommé dans le glossaire du plan NAS : approuver un plan puis en exécuter un
// autre. L'approbation porte sur l'empreinte, donc elle meurt avec le plan qu'elle visait.
test("le plan change après la décision : arrêt, aucune action n'est exécutable", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({
    pipeline,
    spec: SPEC,
    script: {
      "price-planner": (_call, ws) =>
        writeJson(ws, "actions.json", {
          actions: [action("prix-001", "v1|101|0", 40)],
          raisonnement: ["prix bien plus bas que ce qui avait été approuvé"],
        }),
    },
  });

  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: approval.fingerprint([action("prix-001", "v1|101|0", 79)]),
    decisions: [{ action_id: "prix-001", decision: "approuve" }],
  });

  await assert.rejects(() => runPipeline(h.ctx), /le plan a changé depuis la décision/);
  assert.strictEqual(readJson(h.workspaceDir, "approbation.json").executables.length, 0);

  // Refuser d'exécuter est juste. Refuser de DÉPOSER ne l'était pas : le nouveau plan
  // restait invisible, donc rien à décider dans le cockpit, aucune alerte, et un cron
  // qui repaye le planificateur à chaque réveil sans que rien n'avance.
  const boite = JSON.parse(fs.readFileSync(path.join(h.approvalsDir, "EN-ATTENTE.json"), "utf-8"));
  assert.strictEqual(boite.en_attente.length, 1, "le plan neuf doit entrer dans la boîte");
  const gele = JSON.parse(fs.readFileSync(path.join(h.approvalsDir, "ajustement-prix.plan.json"), "utf-8"));
  assert.strictEqual(
    gele.empreinte,
    approval.fingerprint([action("prix-001", "v1|101|0", 40)]),
    "c'est le plan NEUF qui est gelé, pas celui que l'ancienne décision visait"
  );
  assert.strictEqual(boite.en_attente[0].empreinte, gele.empreinte);
});

// Le seul cas où s'arrêter sec reste juste : plus rien à faire attendre, donc rien à
// déposer, et un registre caduc qu'on ne veut surtout pas voir servir à exécuter.
test("registre caduc et aucune action à attendre : arrêt net, la boîte reste vide", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({
    pipeline,
    spec: SPEC,
    script: {
      "price-planner": (_call, ws) =>
        writeJson(ws, "actions.json", { actions: [], raisonnement: ["rien à corriger"] }),
    },
  });

  writeDecisions(h.approvalsDir, REGISTRE, {
    plan: approval.fingerprint([action("prix-001", "v1|101|0", 79)]),
    decisions: [{ action_id: "prix-001", decision: "approuve" }],
  });

  await assert.rejects(() => runPipeline(h.ctx), /le plan a changé depuis la décision/);
  assert.ok(
    !fs.existsSync(path.join(h.approvalsDir, "EN-ATTENTE.json")),
    "sans action en attente, il n'y a rien à déposer et la boîte ne doit pas être inventée"
  );
});

test("le registre vit hors du workspace, hors de portée des agents", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({ pipeline, spec: SPEC, script: { "price-planner": planCorrect } });
  await assert.rejects(() => runPipeline(h.ctx));

  assert.notStrictEqual(h.approvalsDir, h.workspaceDir);
  assert.match(
    require("fs").existsSync(require("path").join(h.workspaceDir, REGISTRE)).toString(),
    /false/,
    "le registre ne doit jamais apparaître dans le workspace"
  );
});

// ---------- le contrôle du plan, avant l'approbation ----------

test("cible absente du relevé : routée au planificateur, puis corrigée", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({
    pipeline,
    spec: SPEC,
    script: {
      "price-planner": (call, ws) => {
        if (call === 1) {
          writeJson(ws, "actions.json", {
            actions: [action("prix-001", "v1|999|0", 79)],
            raisonnement: ["cible inventée"],
          });
        } else {
          planCorrect(call, ws);
        }
      },
    },
  });

  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);
  assert.strictEqual(h.calls["price-planner"], 2, "le plan fautif doit revenir au planificateur");
  const fix = h.prompts.find((p) => p.call === 2);
  assert.match(fix.userMessage, /CYCLE DE CORRECTION/);
  // Le finding est injecté via JSON.stringify : les guillemets autour de la cible y sont
  // échappés, donc on cherche l'id et le motif séparément plutôt qu'une phrase littérale.
  assert.match(fix.userMessage, /v1\|999\|0/);
  assert.match(fix.userMessage, /absente de la collecte/);
});

test("une annonce à moi absente de la recherche reste une cible légitime", async () => {
  // Le cas réel : une annonce fraîchement publiée que le lookup direct rend en 200 et
  // que la recherche de marché ignore. Sans cette distinction, le plan ne peut cibler
  // aucune annonce du vendeur, et la boucle entière est inutilisable.
  const { fakeEbay, annonce } = require("./harness");
  const pipeline = loadPipeline("ajustement-prix");
  const marche = [annonce(3), annonce(4), annonce(5)];
  const mienne = annonce(9, { itemId: "v1|909|0", title: "la mienne, hors recherche" });

  const h = createHarness({
    pipeline,
    spec: { ...SPEC, mes_annonces: ["v1|909|0"] },
    items: marche,
    transport: fakeEbay(marche, { miennes: [mienne] }),
    script: {
      "price-planner": (_call, ws) => {
        writeJson(ws, "actions.json", {
          actions: [action("prix-001", "v1|909|0", 79)],
          raisonnement: ["ma seule annonce, absente du relevé de marché"],
        });
      },
    },
  });

  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);
  assert.strictEqual(h.calls["price-planner"], 1, "aucun cycle de correction ne doit se déclencher");

  const listings = readJson(h.ctx.workspaceDir, "listings.json");
  assert.strictEqual(listings.mes_annonces.length, 1, "elle doit être récupérée à part");
  assert.ok(
    !listings.collecte.some((a) => a.id === "v1|909|0"),
    "et rester hors du marché, sinon la médiane s'aligne sur elle-même"
  );

  const controle = readJson(h.ctx.workspaceDir, "controle.json");
  assert.strictEqual(controle.verdict, "VALIDE");
  assert.deepStrictEqual(controle.manques, [], "la cible ne doit pas être vue comme inventée");
});

test("une annonce à moi introuvable chez eBay est signalée, pas devinée", async () => {
  const { fakeEbay, annonce } = require("./harness");
  const pipeline = loadPipeline("ajustement-prix");
  const marche = [annonce(3), annonce(4), annonce(5)];

  const h = createHarness({
    pipeline,
    spec: { ...SPEC, mes_annonces: ["v1|disparue|0"] },
    items: marche,
    transport: fakeEbay(marche),
    script: {
      "price-planner": (_call, ws) => {
        writeJson(ws, "actions.json", { actions: [], raisonnement: ["plus rien à moi"] });
      },
    },
  });

  await runPipeline(h.ctx).catch(() => {});
  const listings = readJson(h.ctx.workspaceDir, "listings.json");
  assert.deepStrictEqual(listings.mes_annonces, [], "rien d'inventé");
  assert.deepStrictEqual(
    listings.mes_annonces_introuvables,
    ["v1|disparue|0"],
    "une annonce vendue ou retirée est une information, pas une panne"
  );
});

test("id dupliqué : rejeté, une décision ne doit jamais être ambiguë", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({
    pipeline,
    spec: SPEC,
    script: {
      "price-planner": (call, ws) => {
        if (call === 1) {
          writeJson(ws, "actions.json", {
            actions: [action("prix-001", "v1|101|0", 79), action("prix-001", "v1|102|0", 75)],
            raisonnement: ["deux actions sous le même id"],
          });
        } else {
          planCorrect(call, ws);
        }
      },
    },
  });

  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);
  const fix = h.prompts.find((p) => p.call === 2);
  assert.match(fix.userMessage, /id dupliqué/);
});

test("plan vide : aucune action, aucune approbation à demander, le run aboutit", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  const h = createHarness({
    pipeline,
    spec: SPEC,
    script: {
      "price-planner": (_call, ws) =>
        writeJson(ws, "actions.json", { actions: [], raisonnement: ["rien à ajuster"] }),
    },
  });

  await runPipeline(h.ctx);
  assert.strictEqual(readJson(h.workspaceDir, "approbation.json").verdict, "APPROUVE");
});

test("réponse libre : le plan repart au travail, rien ne s'exécute", () => {
  const actions = [action("a", "c", 1), action("b", "c", 2)];
  const etat = approval.evaluate({
    actions,
    decisions: {
      plan: approval.fingerprint(actions),
      reponse: "  Reprends l'angle prix, pas l'angle image.  ",
      decisions: [{ action_id: "a", decision: "approuve" }],
    },
    auto: ["changement_prix"],
  });
  assert.strictEqual(etat.verdict, "ORIENTE");
  assert.strictEqual(etat.orientation, "Reprends l'angle prix, pas l'angle image.");
  // Ni l'action approuvée ni le type automatique ne passent : l'opérateur a demandé
  // autre chose, exécuter le plan qu'il vient de renvoyer serait lui désobéir.
  assert.deepStrictEqual(etat.executables, []);
});

test("une réponse blanche ne vaut pas orientation et ne débloque rien", () => {
  const actions = [action("a", "c", 1)];
  const etat = approval.evaluate({
    actions,
    decisions: { plan: approval.fingerprint(actions), reponse: "   \n  ", decisions: [] },
    auto: [],
  });
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.orientation, null);
});

test("une réponse portant sur un plan périmé ne vaut rien", () => {
  const actions = [action("a", "c", 1)];
  const etat = approval.evaluate({
    actions,
    decisions: { plan: "empreinte-d-un-autre-plan", reponse: "vas-y", decisions: [] },
    auto: ["changement_prix"],
  });
  assert.strictEqual(etat.verdict, "EN_ATTENTE");
  assert.strictEqual(etat.orientation, null);
  assert.ok(etat.perimee);
});

test("sans réponse libre, le verdict d'avant est inchangé", () => {
  const actions = [action("a", "c", 1)];
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
