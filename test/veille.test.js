const assert = require("assert");
const path = require("path");

const { loader } = require("agent-orchestrator");
const { runPipeline } = require("agent-orchestrator").engine;
const stageHandlers = require("../src/stage-handlers");
const { createHarness, loadPipeline, fakeEbay, annonce, writeJson, readJson } = require("./harness");

const SPEC = {
  project_name: "veille-test",
  marche: "booster box scellee",
  questions: ["Quelle est la médiane des prix ?", "Combien livrent gratuitement ?"],
};

const PIPELINE_PATH = path.join(__dirname, "..", "pipelines", "veille-ebay.json");

// Un analyste irréprochable : chaque question traitée, chaque réponse sourcée sur une
// annonce réellement collectée.
function analysteComplet(_call, ws) {
  const listings = readJson(ws, "listings.json");
  writeJson(ws, "veille-report.json", {
    reponses: SPEC.questions.map((q) => ({
      question: q,
      reponse: `calculé sur ${listings.collecte.length} annonces`,
      sources: [listings.collecte[0].id],
    })),
    questions_sans_reponse: [],
  });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("le pipeline livré est valide (chargé avec les vrais validateurs)", () => {
  const pipeline = loadPipeline();
  assert.strictEqual(pipeline.stages[0].type, "fetch");
  assert.strictEqual(pipeline.stages[2].type, "verify");
  assert.ok(pipeline.stages[2].gate, "le gate est porté par le stage déterministe");
});

test("chemin heureux : collecte, analyse, vérification déterministe, gate vert", async () => {
  const pipeline = loadPipeline();
  const h = createHarness({ pipeline, spec: SPEC, script: { "veille-analyst": analysteComplet } });
  await runPipeline(h.ctx);

  const listings = readJson(h.workspaceDir, "listings.json");
  assert.strictEqual(listings.collecte.length, 4);
  assert.strictEqual(listings.query, SPEC.marche, "la requête vient du spec, pas du pipeline");

  const verif = readJson(h.workspaceDir, "verification.json");
  assert.strictEqual(verif.verdict, "COMPLETE");
  assert.strictEqual(verif.questions_attendues, 2);
  assert.strictEqual(h.calls["veille-analyst"], 1);
});

// Le point central de ce spike : l'accès au monde extérieur est déterministe et gratuit.
// Si un jour la collecte passe par un agent, ce test tombe.
test("la collecte ne consomme ni turn ni dollar", async () => {
  const pipeline = loadPipeline();
  const h = createHarness({ pipeline, spec: SPEC, script: { "veille-analyst": analysteComplet } });
  await runPipeline(h.ctx);

  assert.strictEqual(h.reporter.events.find((e) => e.type === "fetch:done").items, 4);
  const appels = h.reporter.events.filter((e) => e.type === "agent:done");
  assert.strictEqual(appels.length, 1, "seule l'analyse doit coûter des tokens");
});

test("les données collectées arrivent dans le prompt de l'agent", async () => {
  const pipeline = loadPipeline();
  const h = createHarness({ pipeline, spec: SPEC, script: { "veille-analyst": analysteComplet } });
  await runPipeline(h.ctx);

  const prompt = h.prompts.find((p) => p.agent === "veille-analyst").userMessage;
  assert.match(prompt, /ARTEFACT D'ENTRÉE listings\.json/);
  assert.match(prompt, /Booster box 1/, "le contenu collecté doit être injecté, pas juste nommé");
  assert.match(prompt, /Quelle est la médiane/, "la tranche de spec doit être injectée");
});

// Le cas qui justifie tout le stage de vérification : l'agent ne déclare aucun verdict,
// donc il ne peut pas masquer une omission. Un gate qui aurait lu son propre rapport
// n'aurait rien vu ici.
test("une question purement omise est rattrapée par le vérificateur", async () => {
  const pipeline = loadPipeline();
  const script = {
    "veille-analyst": (call, ws) => {
      if (call === 1) {
        const listings = readJson(ws, "listings.json");
        writeJson(ws, "veille-report.json", {
          reponses: [
            { question: SPEC.questions[0], reponse: "82 EUR", sources: [listings.collecte[0].id] },
          ],
          questions_sans_reponse: [],
        });
      } else {
        analysteComplet(call, ws);
      }
    },
  };
  const h = createHarness({ pipeline, spec: SPEC, script });
  await runPipeline(h.ctx);

  assert.strictEqual(h.calls["veille-analyst"], 2, "l'omission doit revenir à l'analyste");
  const fix = h.prompts.find((p) => p.call === 2);
  assert.match(fix.userMessage, /CYCLE DE CORRECTION 1\/2/);
  assert.match(fix.userMessage, /question non traitée/);
  assert.match(fix.userMessage, /Combien livrent gratuitement/);
});

test("une source inventée est rejetée en nommant l'id fautif", async () => {
  const pipeline = loadPipeline();
  const script = {
    "veille-analyst": (call, ws) => {
      if (call === 1) {
        writeJson(ws, "veille-report.json", {
          reponses: SPEC.questions.map((q) => ({
            question: q,
            reponse: "inventé",
            sources: ["v1|999999|0"],
          })),
          questions_sans_reponse: [],
        });
      } else {
        analysteComplet(call, ws);
      }
    },
  };
  const h = createHarness({ pipeline, spec: SPEC, script });
  await runPipeline(h.ctx);

  const fix = h.prompts.find((p) => p.call === 2);
  assert.match(fix.userMessage, /sources absentes de la collecte : v1\|999999\|0/);
});

test("une réponse sans aucune source est rejetée", async () => {
  const pipeline = loadPipeline();
  const script = {
    "veille-analyst": (call, ws) => {
      if (call === 1) {
        writeJson(ws, "veille-report.json", {
          reponses: SPEC.questions.map((q) => ({ question: q, reponse: "de mémoire", sources: [] })),
          questions_sans_reponse: [],
        });
      } else {
        analysteComplet(call, ws);
      }
    },
  };
  const h = createHarness({ pipeline, spec: SPEC, script });
  await runPipeline(h.ctx);

  const fix = h.prompts.find((p) => p.call === 2);
  assert.match(fix.userMessage, /réponse sans aucune source/);
});

// Une question déclarée sans réponse, avec sa raison, est un résultat propre et non un
// échec : le pipeline doit aboutir.
test("une question déclarée sans réponse passe le gate", async () => {
  const pipeline = loadPipeline();
  const script = {
    "veille-analyst": (_call, ws) => {
      const listings = readJson(ws, "listings.json");
      writeJson(ws, "veille-report.json", {
        reponses: [
          { question: SPEC.questions[0], reponse: "82 EUR", sources: [listings.collecte[0].id] },
        ],
        questions_sans_reponse: [
          {
            component: "analyse",
            question: SPEC.questions[1],
            raison: "aucune annonce ne porte de coût de livraison",
          },
        ],
      });
    },
  };
  const h = createHarness({ pipeline, spec: SPEC, script });
  await runPipeline(h.ctx);

  assert.strictEqual(h.calls["veille-analyst"], 1, "un manque assumé ne déclenche aucun cycle");
  assert.strictEqual(readJson(h.workspaceDir, "verification.json").verdict, "COMPLETE");
});

// rerun_from pointe sur la vérification, pas sur la collecte : sans ça, chaque cycle de
// correction retaperait l'API pour rien.
test("un cycle de correction ne relance pas la collecte", async () => {
  const pipeline = loadPipeline();
  let appelsApi = 0;
  const transport = async (...args) => {
    appelsApi += 1;
    return fakeEbay([annonce(1), annonce(2)])(...args);
  };
  const script = {
    "veille-analyst": (call, ws) => {
      if (call === 1) writeJson(ws, "veille-report.json", { reponses: [], questions_sans_reponse: [] });
      else analysteComplet(call, ws);
    },
  };
  const h = createHarness({ pipeline, spec: SPEC, script, transport });
  await runPipeline(h.ctx);

  assert.strictEqual(appelsApi, 1, "l'API ne doit être appelée qu'une fois");
});

test("analyste qui ne corrige jamais : borné, pas de succès silencieux", async () => {
  const pipeline = loadPipeline();
  const script = {
    "veille-analyst": (_call, ws) =>
      writeJson(ws, "veille-report.json", { reponses: [], questions_sans_reponse: [] }),
  };
  const h = createHarness({ pipeline, spec: SPEC, script });
  await assert.rejects(() => runPipeline(h.ctx), /toujours en échec après 2 cycles/);
});

test("source inconnue : rejetée au chargement, pas après la collecte", () => {
  const raw = loadPipeline();
  raw.stages[0].source = "amazon";
  assert.throws(
    () => loader.loadPipeline(PIPELINE_PATH, { raw, stageValidators: stageHandlers.validators, backends: {} }),
    /source inconnue "amazon"/
  );
});

test("stage verify amputé d'un champ : rejeté au chargement", () => {
  const raw = loadPipeline();
  delete raw.stages[2].against;
  assert.throws(
    () => loader.loadPipeline(PIPELINE_PATH, { raw, stageValidators: stageHandlers.validators, backends: {} }),
    /type "verify" sans "against"/
  );
});

test("requête absente du spec : erreur qui nomme le champ manquant", async () => {
  const pipeline = loadPipeline();
  const h = createHarness({
    pipeline,
    spec: { project_name: "x", marche: "", questions: [] },
    script: { "veille-analyst": analysteComplet },
  });
  await assert.rejects(() => runPipeline(h.ctx), /n'a pas de champ "marche"/);
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests de veille OK`);
  process.exit(failed ? 1 : 0);
})();
