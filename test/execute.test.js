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

test("type sans exécuteur : arrêt systémique, jamais de saut silencieux", async () => {
  const { reussies, arret } = await execute.executer({
    aFaire: [PLAN[0]],
    executeurs: {},
    empreinte: "x",
  });
  assert.deepStrictEqual(reussies, []);
  assert.strictEqual(arret.nature, "systemique", "un défaut de configuration n'est pas une cible perdue");
  assert.match(arret.raison, /aucun exécuteur pour le type "changement_prix"/);
});

// Fail-closed : seul un exécuteur peut déclarer une perte de cible. Une erreur nue vaut
// panne, parce que deviner dans le sens permissif enchaînerait les appels sur une API
// déjà en difficulté.
test("une erreur non classée vaut panne et arrête le lot", async () => {
  let vues = 0;
  const { reussies, arret } = await execute.executer({
    aFaire: PLAN,
    executeurs: {
      changement_prix: async (a) => {
        vues += 1;
        if (a.id === "prix-002") throw new Error("API indisponible");
      },
    },
    empreinte: "x",
  });

  assert.strictEqual(vues, 2, "on ne tente pas la suite après une panne");
  assert.deepStrictEqual(reussies.map((r) => r.id), ["prix-001"]);
  assert.strictEqual(arret.nature, "systemique");
  assert.strictEqual(execute.natureDe(new Error("nue")), "systemique");
});

// Le cas qui a motivé le changement : une annonce supprimée ne doit pas bloquer les
// autres. Le blocage coûterait une réapprobation complète, puisque retirer l'action du
// plan changerait son empreinte.
test("échec de cible : le lot continue, l'échec est consigné", async () => {
  const faites = [];
  const { reussies, echecs, arret } = await execute.executer({
    aFaire: PLAN,
    executeurs: {
      changement_prix: async (a) => {
        if (a.id === "prix-001") {
          const err = new Error("annonce supprimée");
          err.cible = true;
          throw err;
        }
        faites.push(a.id);
      },
    },
    empreinte: "x",
  });

  assert.deepStrictEqual(faites, ["prix-002"], "l'action suivante doit avoir été tentée");
  assert.deepStrictEqual(reussies.map((r) => r.id), ["prix-002"]);
  assert.strictEqual(echecs.length, 1);
  assert.strictEqual(echecs[0].nature, "cible");
  assert.strictEqual(arret, null, "une cible perdue n'interrompt pas le lot");
});

// Une API qui renvoie 404 sur tout parce qu'un identifiant a changé de périmètre
// ressemble à quarante mauvaises cibles. Ce motif doit couper.
test("trois échecs de cible consécutifs : le motif ressemble à une panne, arrêt", async () => {
  const perdue = () => {
    const err = new Error("introuvable");
    err.cible = true;
    throw err;
  };
  const quatre = ["a", "b", "c", "d"].map((id) => ({ ...PLAN[0], id }));

  const { echecs, arret } = await execute.executer({
    aFaire: quatre,
    executeurs: { changement_prix: async () => perdue() },
    empreinte: "x",
  });

  assert.strictEqual(echecs.length, 3, "on coupe au troisième, la quatrième n'est pas tentée");
  assert.strictEqual(arret.nature, "serie");
  assert.match(arret.raison, /3 échecs de cible consécutifs/);
});

test("une réussite remet le compteur de série à zéro", async () => {
  const perdues = new Set(["a", "b", "d", "e"]);
  const cinq = ["a", "b", "c", "d", "e"].map((id) => ({ ...PLAN[0], id }));

  const { reussies, echecs, arret } = await execute.executer({
    aFaire: cinq,
    executeurs: {
      changement_prix: async (action) => {
        if (perdues.has(action.id)) {
          const err = new Error("introuvable");
          err.cible = true;
          throw err;
        }
      },
    },
    empreinte: "x",
  });

  assert.deepStrictEqual(reussies.map((r) => r.id), ["c"]);
  assert.strictEqual(echecs.length, 4, "deux séries de deux ne valent pas une série de trois");
  assert.strictEqual(arret, null);
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

// ---------- le gel et la péremption ----------

const PLAN_GELE = "ajustement-prix.plan.json";

// Écrit un plan gelé comme le ferait le pipeline de planification, avec une collecte
// datée de `ilYaHeures` heures.
function gelerPlan(approvalsDir, { actions = PLAN, ilYaHeures = 0, sansDate = false } = {}) {
  const plan = { empreinte: approval.fingerprint(actions), actions };
  // `sansDate` retire les DEUX dates : sans collecte_le, le chargement se rabat sur
  // gele_le, qui approche l'heure de collecte puisque le gel suit immédiatement.
  if (!sansDate) {
    plan.gele_le = new Date().toISOString();
    plan.collecte_le = new Date(Date.now() - ilYaHeures * 3600 * 1000).toISOString();
  }
  fs.writeFileSync(path.join(approvalsDir, PLAN_GELE), JSON.stringify(plan, null, 2));
}

const appliquer = (opts = {}) =>
  createHarness({ pipeline: loadPipeline("ajustement-prix-appliquer"), spec: SPEC, script: {}, ...opts });

// LA régression. Le cycle ne pouvait pas aboutir : le second run replanifiait, un modèle
// ne redonne pas deux fois le même plan, donc l'empreinte approuvée ne couvrait plus rien
// et l'arrêt se répétait sans fin. Le gel casse la boucle.
test("cycle complet : un planificateur non déterministe n'empêche plus d'aboutir", async () => {
  const planifier = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
  });
  await assert.rejects(() => runPipeline(planifier.ctx), /attendent ton approbation/);

  const gele = JSON.parse(fs.readFileSync(path.join(planifier.approvalsDir, PLAN_GELE), "utf-8"));
  writeDecisions(planifier.approvalsDir, REGISTRE, {
    plan: gele.empreinte,
    decisions: PLAN.map((a) => ({ action_id: a.id, decision: "approuve" })),
  });

  // Le run d'application ne rejoue AUCUN agent : le planificateur pourrait proposer tout
  // autre chose, ça ne changerait rien.
  const faites = [];
  const application = appliquer({
    executeurs: { changement_prix: async (a) => faites.push(a.id) },
  });
  application.ctx.approvalsDir = planifier.approvalsDir;

  await runPipeline(application.ctx);

  assert.deepStrictEqual(faites, ["prix-001", "prix-002"]);
  assert.strictEqual(readJson(application.workspaceDir, "execution.json").verdict, "EXECUTE");
});

test("le gel porte l'empreinte, l'heure de collecte, et le texte exact des actions", async () => {
  const h = createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
  });
  await assert.rejects(() => runPipeline(h.ctx), (err) => {
    assert.match(err.message, /Le plan est gelé dans/);
    assert.match(err.message, /pipeline d'application, pas celui-ci/);
    return true;
  });

  const gele = JSON.parse(fs.readFileSync(path.join(h.approvalsDir, PLAN_GELE), "utf-8"));
  assert.strictEqual(gele.empreinte, approval.fingerprint(PLAN));
  assert.deepStrictEqual(gele.actions.map((a) => a.id), ["prix-001", "prix-002"]);
  assert.ok(gele.collecte_le, "l'heure de collecte doit suivre le plan");
});

// La péremption se juge sur l'heure de COLLECTE : c'est la donnée de marché qui vieillit,
// pas la décision.
test("plan périmé : refusé, en disant depuis combien de temps", async () => {
  const h = appliquer();
  gelerPlan(h.approvalsDir, { ilYaHeures: 20 });
  approuverTout(h.approvalsDir);

  await assert.rejects(() => runPipeline(h.ctx), (err) => {
    assert.match(err.message, /plan périmé/);
    assert.match(err.message, /il y a 20\.0 h/);
    assert.match(err.message, /maximum déclaré est 12 h/);
    return true;
  });
});

test("plan encore frais : chargé, et sa fraîcheur est tracée", async () => {
  const h = appliquer({ executeurs: { changement_prix: async () => {} } });
  gelerPlan(h.approvalsDir, { ilYaHeures: 2 });
  approuverTout(h.approvalsDir);

  await runPipeline(h.ctx);
  const trace = h.reporter.events.find((e) => e.type === "charger:fraicheur");
  assert.ok(trace.age_heures >= 2 && trace.age_heures < 2.1);
});

// Sans date, la fraîcheur est invérifiable. Refuser vaut mieux qu'appliquer à l'aveugle.
test("plan sans date : refusé plutôt qu'appliqué à l'aveugle", async () => {
  const h = appliquer();
  gelerPlan(h.approvalsDir, { sansDate: true });
  approuverTout(h.approvalsDir);

  await assert.rejects(() => runPipeline(h.ctx), /aucune date, sa fraîcheur est invérifiable/);
});

test("aucun plan gelé : le message dit quoi lancer", async () => {
  const h = appliquer();
  await assert.rejects(() => runPipeline(h.ctx), /Lancer d'abord le pipeline de planification/);
});

test("max_age_heures mal typé : rejeté au chargement", () => {
  const raw = loadPipeline("ajustement-prix-appliquer");
  raw.stages[0].max_age_heures = "12";
  assert.throws(
    () =>
      loader.loadPipeline(pipelinePath("ajustement-prix-appliquer"), {
        raw,
        stageValidators: stageHandlers.validators,
        backends: {},
      }),
    /"max_age_heures" doit être un nombre positif/
  );
});

// ---------- la boîte des décisions en attente ----------

const lireBoite = (dir) => {
  const p = path.join(dir, "EN-ATTENTE.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : null;
};

const planifier = (opts = {}) =>
  createHarness({
    pipeline: loadPipeline("ajustement-prix"),
    spec: SPEC,
    script: { "price-planner": planCorrect },
    ...opts,
  });

// Un arrêt qui ne s'écrit que dans un terminal est invisible quand le run vient d'un cron
// sur un NAS : le pipeline s'arrêterait et l'attente durerait indéfiniment.
test("l'arrêt sur approbation dépose la demande dans la boîte", async () => {
  const h = planifier();
  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);

  const boite = lireBoite(h.approvalsDir);
  assert.strictEqual(boite.en_attente.length, 1);
  const demande = boite.en_attente[0];
  assert.strictEqual(demande.dossier, "ajustement-prix");
  assert.strictEqual(demande.actions, 2);
  assert.strictEqual(demande.empreinte, approval.fingerprint(PLAN));
  assert.ok(demande.depuis, "l'attente doit être datée, sinon impossible de dire depuis quand");
});

test("la demande nomme le registre à remplir et le pipeline à lancer ensuite", async () => {
  const h = planifier();
  await assert.rejects(() => runPipeline(h.ctx));

  const demande = lireBoite(h.approvalsDir).en_attente[0];
  assert.match(demande.registre, /ajustement-prix\.decisions\.json$/);
  assert.match(demande.plan_gele, /ajustement-prix\.plan\.json$/);
  assert.strictEqual(demande.appliquer_avec, "ajustement-prix-appliquer");
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

// La demande est créée par la planification et consommée par l'application : deux
// pipelines différents, d'où la clé par dossier et non par pipeline.
test("une fois tout décidé et appliqué, la demande sort de la boîte", async () => {
  const p = planifier();
  await assert.rejects(() => runPipeline(p.ctx));
  assert.strictEqual(lireBoite(p.approvalsDir).en_attente.length, 1);

  approuverTout(p.approvalsDir);

  const a = appliquer({ executeurs: { changement_prix: async () => {} } });
  a.ctx.approvalsDir = p.approvalsDir;
  await runPipeline(a.ctx);

  assert.deepStrictEqual(lireBoite(p.approvalsDir).en_attente, []);
});

test("sans dossier déclaré, aucune boîte n'est touchée", async () => {
  const pipeline = loadPipeline("ajustement-prix");
  delete pipeline.stages[3].dossier;
  const h = createHarness({ pipeline, spec: SPEC, script: { "price-planner": planCorrect } });

  await assert.rejects(() => runPipeline(h.ctx), /attendent ton approbation/);
  assert.strictEqual(lireBoite(h.approvalsDir), null, "la boîte est optionnelle");
});

// ---------- le stage execute, dans le pipeline ----------

test("un stage execute avec un gate est rejeté au chargement", () => {
  const raw = loadPipeline("ajustement-prix-appliquer");
  raw.stages[2].gate = {
    report: "x", pass_when: {}, fail_when: { equals: ["y"] }, items: "i", targets: {}, rerun_from: "chargement",
  };
  assert.throws(
    () =>
      loader.loadPipeline(pipelinePath("ajustement-prix-appliquer"), {
        raw,
        stageValidators: stageHandlers.validators,
        backends: {},
      }),
    /ne porte pas de gate/
  );
});

// L'état livré : la garde est en place, le geste n'existe pas. Le run doit le dire.
test("aucun exécuteur enregistré : le run s'arrête en nommant le type manquant", async () => {
  const h = appliquer();
  gelerPlan(h.approvalsDir);
  approuverTout(h.approvalsDir);

  await assert.rejects(() => runPipeline(h.ctx), /aucun exécuteur pour le type "changement_prix"/);
  assert.strictEqual(readJson(h.workspaceDir, "execution.json").verdict, "INTERROMPU");
});

// Un système sain qui rencontre la réalité ne doit pas produire un "run raté" : ça
// apprend à ignorer les échecs. Le run aboutit, le verdict le dit, le rapport le nomme.
test("une cible perdue ne fait pas échouer le run, elle le rend PARTIEL", async () => {
  const h = appliquer({
    executeurs: {
      changement_prix: async (a) => {
        if (a.id === "prix-001") {
          const err = new Error("annonce supprimée par le vendeur");
          err.cible = true;
          throw err;
        }
      },
    },
  });
  gelerPlan(h.approvalsDir);
  approuverTout(h.approvalsDir);

  await runPipeline(h.ctx);

  const etat = readJson(h.workspaceDir, "execution.json");
  assert.strictEqual(etat.verdict, "PARTIEL");
  assert.deepStrictEqual(etat.reussies.map((r) => r.id), ["prix-002"], "l'autre action est passée");
  assert.strictEqual(etat.echecs[0].nature, "cible");
  assert.match(etat.echecs[0].raison, /annonce supprimée/);
  assert.strictEqual(etat.arret, null);
});

// Ce qui reste approuvé mais non tenté est la seule chose que l'opérateur doit
// reprendre : le rapport doit le nommer, pas le laisser déduire.
test("lot interrompu : les actions approuvées non tentées sont nommées", async () => {
  const h = appliquer({
    executeurs: {
      changement_prix: async (a) => {
        if (a.id === "prix-001") throw new Error("401 identifiants expirés");
      },
    },
  });
  gelerPlan(h.approvalsDir);
  approuverTout(h.approvalsDir);

  await assert.rejects(() => runPipeline(h.ctx), /lot interrompu \(systemique\)/);

  const etat = readJson(h.workspaceDir, "execution.json");
  assert.strictEqual(etat.verdict, "INTERROMPU");
  assert.deepStrictEqual(etat.non_tentees, ["prix-002"], "l'action jamais tentée doit être nommée");
  assert.deepStrictEqual(etat.reussies, []);
});

test("avec un exécuteur : les approuvées passent, les refusées jamais", async () => {
  const faites = [];
  const h = appliquer({
    executeurs: { changement_prix: async (a) => { faites.push(a.id); return { applique: a.valeur.vers }; } },
  });
  gelerPlan(h.approvalsDir);
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

  const premier = appliquer({ executeurs });
  gelerPlan(premier.approvalsDir);
  approuverTout(premier.approvalsDir);
  await runPipeline(premier.ctx);
  assert.deepStrictEqual(faites, ["prix-001", "prix-002"]);

  // Second run, même registre, même plan gelé et même ledger : le workspace est neuf,
  // pas eux.
  const second = appliquer({ executeurs });
  second.ctx.approvalsDir = premier.approvalsDir;
  await runPipeline(second.ctx);

  assert.deepStrictEqual(faites, ["prix-001", "prix-002"], "aucune action ne doit repartir");
  const etat = readJson(second.workspaceDir, "execution.json");
  assert.deepStrictEqual(etat.deja, ["prix-001", "prix-002"]);
  assert.deepStrictEqual(etat.reussies, []);
});

test("le ledger vit hors du workspace, hors de portée des agents", async () => {
  const h = appliquer({ executeurs: { changement_prix: async () => {} } });
  gelerPlan(h.approvalsDir);
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
