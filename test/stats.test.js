const assert = require("assert");
const path = require("path");

const { loader } = require("agent-orchestrator");
const { runPipeline } = require("agent-orchestrator").engine;
const stageHandlers = require("../src/stage-handlers");
const stats = require("../src/stats");
const { createHarness, loadPipeline, annonce, writeJson, readJson } = require("./harness");

const PIPELINE_PATH = path.join(__dirname, "..", "pipelines", "veille-ebay.json");

const SPEC = {
  project_name: "stats-test",
  marche: "booster box",
  questions: ["Quelle est la médiane des prix ?"],
};

const collecte = (prix, extra = {}) => ({
  collecte: prix.map((p, i) => ({ id: `a${i}`, prix: p, ...extra })),
  devises: ["EUR"],
  marketplace: "EBAY_FR",
});

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// LE test de non-régression. Le premier run réel contre eBay a rendu 46.99 comme médiane
// de ces 35 prix : la 19e valeur triée prise pour la 18e. Ce test tient cette valeur
// exacte, avec les prix exacts qui ont produit l'erreur.
test("médiane de 35 prix : la 18e valeur triée, pas la 19e", () => {
  const prix = [
    10.99, 10.99, 11.99, 12.99, 12.99, 12.99, 12.99, 12.99, 12.99, 16.99, 17.99, 21.99,
    29.99, 30.99, 32.99, 35.99, 40.99, 45.99, 46.99, 47.99, 49.99, 50.99, 52.99, 58.99,
    67.99, 77.99, 97.99, 134.99, 134.99, 144.99, 144.99, 195.99, 336.99, 466.99, 18999.99,
  ];
  const s = stats.statistiques(collecte(prix));
  assert.strictEqual(s.prix.n, 35);
  assert.strictEqual(s.prix.mediane, 45.99, "45.99 est la 18e valeur ; 46.99 est la 19e");
});

test("médiane d'un nombre pair de prix : moyenne des deux valeurs centrales", () => {
  const s = stats.statistiques(collecte([10, 20, 30, 40]));
  assert.strictEqual(s.prix.mediane, 25);
});

test("un prix extrême déplace la moyenne, pas la médiane", () => {
  const s = stats.statistiques(collecte([10, 20, 30, 40, 18999.99]));
  assert.strictEqual(s.prix.mediane, 30);
  assert.strictEqual(s.prix.moyenne, 3820, "la moyenne reste rendue, à côté, jamais à la place");
});

test("les quartiles sont des prix réellement affichés, sans interpolation", () => {
  const prix = [10, 20, 30, 40, 50];
  const s = stats.statistiques(collecte(prix));
  assert.ok(prix.includes(s.prix.q1), `q1=${s.prix.q1} doit être un prix de la collecte`);
  assert.ok(prix.includes(s.prix.q3), `q3=${s.prix.q3} doit être un prix de la collecte`);
});

test("collecte vide : des null, pas des NaN ni un crash", () => {
  const s = stats.statistiques({ collecte: [], devises: [] });
  assert.strictEqual(s.n, 0);
  assert.strictEqual(s.prix.mediane, null);
  assert.strictEqual(s.prix.moyenne, null);
  assert.strictEqual(s.devise_unique, null);
});

test("deux devises : devise_unique vaut null, pour qu'aucune médiane ne les mélange", () => {
  const s = stats.statistiques({ collecte: [{ id: "a", prix: 10 }], devises: ["EUR", "USD"] });
  assert.strictEqual(s.devise_unique, null);
  const seule = stats.statistiques(collecte([10]));
  assert.strictEqual(seule.devise_unique, "EUR");
});

// Sans second critère de tri, deux états à égalité changeraient d'ordre d'un run à
// l'autre, et une réponse citant `par_etat.0` désignerait autre chose sans que rien
// n'ait bougé dans les données.
test("groupement à effectifs égaux : ordre stable, décidé alphabétiquement", () => {
  const c = {
    collecte: [
      { id: "1", prix: 10, etat: "Used" },
      { id: "2", prix: 20, etat: "New" },
    ],
    devises: ["EUR"],
  };
  assert.deepStrictEqual(
    stats.statistiques(c).par_etat.map((e) => e.etat),
    ["New", "Used"]
  );
});

test("champs_absents chiffre ce qui manque, pour qu'une question sans réponse soit motivée", () => {
  const c = {
    collecte: [
      { id: "1", prix: 10, etat: "New", vendeur: "v", livraison_gratuite: true },
      { id: "2", prix: 20, etat: null, vendeur: null, livraison_gratuite: false },
    ],
    devises: ["EUR"],
  };
  const s = stats.statistiques(c);
  assert.strictEqual(s.champs_absents.vendeur, 1);
  assert.strictEqual(s.champs_absents.etat, 1);
  assert.strictEqual(s.champs_absents.prix, 0);
});

test("valeurAu résout un chemin, index de tableau compris, et rend undefined sur l'inconnu", () => {
  const s = stats.statistiques(collecte([10, 20, 30], { etat: "New" }));
  assert.strictEqual(stats.valeurAu(s, "prix.mediane"), 20);
  assert.strictEqual(stats.valeurAu(s, "par_etat.0.etat"), "New");
  assert.strictEqual(stats.valeurAu(s, "prix.inexistant"), undefined);
  assert.strictEqual(stats.valeurAu(s, "rien.du.tout"), undefined);
});

// --- le stage typé et le contrôle arithmétique, à travers le vrai moteur ---

function analyste(reponses) {
  return (_call, ws) => {
    const listings = readJson(ws, "listings.json");
    writeJson(ws, "veille-report.json", {
      reponses: reponses(readJson(ws, "stats.json"), listings),
      questions_sans_reponse: [],
    });
  };
}

async function run(reponses) {
  const h = createHarness({
    pipeline: loadPipeline(),
    spec: SPEC,
    script: { "veille-analyst": analyste(reponses) },
  });
  await runPipeline(h.ctx).catch(() => {});
  return h;
}

test("le stage stats écrit ses calculs avant l'agent, sans coûter un turn", async () => {
  const h = await run((s, l) => [
    { question: SPEC.questions[0], reponse: `médiane ${s.prix.mediane}`, valeurs: [{ cle: "prix.mediane", valeur: s.prix.mediane }], sources: [l.collecte[0].id] },
  ]);
  const s = readJson(h.workspaceDir, "stats.json");
  assert.strictEqual(s.n, 4);
  assert.strictEqual(readJson(h.workspaceDir, "verification.json").verdict, "COMPLETE");
  assert.strictEqual(h.calls["veille-analyst"], 1, "un seul appel : rien à corriger");
});

// Le cœur de la correction. Un agent qui recalcule au lieu de recopier produit un
// nombre plausible et sourcé : c'est exactement ce qui est passé en production.
test("une valeur recalculée qui diverge du calcul est rejetée, les deux nombres nommés", async () => {
  const h = await run((s, l) => [
    { question: SPEC.questions[0], reponse: "médiane 999", valeurs: [{ cle: "prix.mediane", valeur: 999 }], sources: [l.collecte[0].id] },
  ]);
  const v = readJson(h.workspaceDir, "verification.json");
  assert.strictEqual(v.verdict, "INCOMPLETE");
  const raison = v.manques.map((m) => m.raison).join(" ");
  assert.match(raison, /999/, "la valeur citée doit apparaître");
  assert.match(raison, new RegExp(String(readJson(h.workspaceDir, "stats.json").prix.mediane)), "la valeur calculée aussi");
});

test("une clé absente de stats.json est rejetée en la nommant", async () => {
  const h = await run((_s, l) => [
    { question: SPEC.questions[0], reponse: "médiane 42", valeurs: [{ cle: "prix.mediane_inventee", valeur: 42 }], sources: [l.collecte[0].id] },
  ]);
  const v = readJson(h.workspaceDir, "verification.json");
  assert.strictEqual(v.verdict, "INCOMPLETE");
  assert.match(v.manques.map((m) => m.raison).join(" "), /mediane_inventee/);
});

test("un chiffre écrit sans rien citer est rejeté : c'est la faille qui a laissé passer 46,99", async () => {
  const h = await run((_s, l) => [
    { question: SPEC.questions[0], reponse: "la médiane est de 46.99 EUR", sources: [l.collecte[0].id] },
  ]);
  const v = readJson(h.workspaceDir, "verification.json");
  assert.strictEqual(v.verdict, "INCOMPLETE");
  assert.match(v.manques.map((m) => m.raison).join(" "), /affirmation chiffrée sans valeur citée/);
});

test("une réponse sans aucun chiffre n'a rien à citer et passe", async () => {
  const h = await run((_s, l) => [
    { question: SPEC.questions[0], reponse: "les prix se concentrent sous la médiane", sources: [l.collecte[0].id] },
  ]);
  assert.strictEqual(readJson(h.workspaceDir, "verification.json").verdict, "COMPLETE");
});

test("un stage stats sans against ni output est rejeté au chargement", () => {
  const raw = loadPipeline();
  delete raw.stages[1].against;
  assert.throws(
    () => loader.loadPipeline(PIPELINE_PATH, { raw, stageValidators: stageHandlers.validators, backends: {} }),
    /type "stats" sans "against"/
  );
});

// Un gate sur ce stage rendrait la main à l'agent sur les nombres qu'on vient de lui
// retirer : c'est le seul moyen de défaire toute la correction sans toucher au code.
test("un gate sur le stage stats est refusé au chargement", () => {
  const raw = loadPipeline();
  raw.stages[1].gate = { report: "stats.json", pass_when: { field: "x", equals: "y" } };
  assert.throws(
    () => loader.loadPipeline(PIPELINE_PATH, { raw, stageValidators: stageHandlers.validators, backends: {} }),
    /stage "stats" ne porte pas de gate/
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests de statistiques OK`);
  process.exit(failed ? 1 : 0);
})();
