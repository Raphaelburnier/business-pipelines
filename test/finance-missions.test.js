const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { FinanceReportArchive, construireSnapshot, validateReport, creerHandlers } = require("../src/finance/missions");
const { financeDisponible, financeHandlerNames } = require("../src/stage-handlers");

function dossier() { return fs.mkdtempSync(path.join(os.tmpdir(), "finance-missions-")); }
function services() {
  return {
    finance: { summary: () => ({ empty: true, revision: 0, from: null, to: null, scope: "accounts", businesses: [], buckets: [], warnings: [], imports: [] }) },
    macro: { snapshot: () => ({ provider: { name: "World Bank" }, indicators: [], series: [], sha256: null, cacheStale: true }) },
    prices: { snapshot: () => ({ provider: "eodhd", instruments: [] }) },
  };
}
function bonRapport(sourceId = "macro:source") {
  return {
    version: 2, snapshotId: "test-snapshot", metriques: [], resume: "Les données synthétiques restent limitées.",
    observations: [{ id: "o1", question: "Que sait-on ?", texte: "Fait documenté.", nature: "fait", sources: [sourceId], metriques: [], confiance: "haute" }],
    scenarios: [{ id: "s1", hypotheses: ["Si les conditions restent identiques"], effets_possibles: ["Effet incertain"], risques: ["Risque identifié"], conditions_a_verifier: ["Vérifier la source"] }],
    risques: ["Données incomplètes"], limites: ["Snapshot synthétique."], questions_sans_reponse: [],
  };
}

test("le snapshot n'invente ni trésorerie ni cours et conserve les limites", () => {
  const fake = services();
  const snapshot = construireSnapshot({ ...fake, projectId: "finance", now: () => Date.parse("2026-10-14T10:00:00Z") });
  assert.equal(snapshot.cashflow.status, "unknown");
  assert.equal(snapshot.cashflow.reason.includes("pas égaux à zéro"), true);
  assert.equal(snapshot.markets.status, "not_provided");
  assert.deepEqual(snapshot.markets.prices, []);
  assert.equal(snapshot.sources.length, 0);
});

test("le validateur couvre les questions et refuse les sources étrangères", () => {
  const snapshot = { schemaVersion: 1, snapshotId: "test-snapshot", synthetic: false, sources: [{ id: "macro:source" }] };
  assert.deepEqual(validateReport(snapshot, bonRapport(), { questions: ["Que sait-on ?"] }), []);
  const missing = bonRapport("source-absente");
  assert(validateReport(snapshot, missing, { questions: ["Question oubliée ?"] }).some((m) => /source inconnue/.test(m)));
  assert(validateReport(snapshot, missing, { questions: ["Question oubliée ?"] }).some((m) => /non traitée/.test(m)));
});

test("la publication privée ne s'ouvre qu'avec le PASS correspondant et reste idempotente", (t) => {
  const root = dossier(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const archive = new FinanceReportArchive({ root: path.join(root, "reports"), now: () => Date.parse("2026-10-14T10:00:00Z") });
  const snapshotText = '{"schemaVersion":1}\n';
  const reportText = '{"version":1}\n';
  const { createHash } = require("node:crypto");
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  const validationText = `${JSON.stringify({ version: 2, sessions: { auteur: "auteur", reviewer: "reviewer" }, verdict: "PASS", snapshotSha256: hash(snapshotText), reportSha256: hash(reportText) })}\n`;
  assert.throws(() => archive.publier({ runId: "12345678-1234-1234", projectId: "finance", snapshotText, reportText, validationText: '{"verdict":"FAIL"}' }), /PASS/);
  const result = archive.publier({ runId: "12345678-1234-1234", projectId: "finance", snapshotText, reportText, validationText });
  assert.equal(result.duplicate, false);
  assert.equal(archive.publier({ runId: "12345678-1234-1234", projectId: "finance", snapshotText, reportText, validationText }).duplicate, true);
  assert.equal(fs.statSync(path.join(root, "reports")).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(root, "reports", result.id, "finance-report.json")).mode & 0o777, 0o600);
  assert.equal(archive.lire(result.id).report.version, 1);
  assert.throws(() => archive.publier({ runId: "12345678-1234-1234", projectId: "finance", snapshotText, reportText: '{"version":2}', validationText }), /PASS ne correspond/);
});

test("les handlers enregistrés exécutent collecte → validation → archive sans modèle", async (t) => {
  const root = dossier(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const fake = services();
  const runtime = creerHandlers({ storageRoot: path.join(root, "data"), reportsRoot: path.join(root, "reports"), ...fake, now: () => Date.parse("2026-10-14T10:00:00Z") });
  const ws = path.join(root, "workspace"); fs.mkdirSync(ws, { mode: 0o700 });
  const ctx = { workspaceDir: ws, spec: { project_name: "finance", questions: ["Que sait-on ?"] }, reporter: { runId: "12345678-1234-1234", event: () => {}, store: { etapes: () => [
    { agent_ref: "financial-research-analyst@2", status: "succeeded", session_id: "auteur", finished_at: "2026-10-17T10:00:00Z" },
    { agent_ref: "financial-research-reviewer@1", status: "succeeded", session_id: "reviewer", started_at: "2026-10-17T10:01:00Z" },
  ] } } };
  await runtime.handlers["finance-snapshot"]({ output: "finance-snapshot.json" }, ctx);
  const snapshot = JSON.parse(fs.readFileSync(path.join(ws, "finance-snapshot.json"), "utf8"));
  snapshot.snapshotId = "test-snapshot";
  snapshot.sources.push({ id: "macro:source" });
  fs.writeFileSync(path.join(ws, "finance-snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(ws, "finance-report.json"), JSON.stringify(bonRapport()));
  await runtime.handlers["finance-report-check"]({}, ctx);
  const input = JSON.parse(fs.readFileSync(path.join(ws, "finance-review-input.json")));
  fs.writeFileSync(path.join(ws, "finance-review.json"), JSON.stringify({ version: 1, snapshotSha256: input.snapshotSha256, reportSha256: input.reportSha256,
    checks: input.exigences.map((r) => ({ ...r, status: "verified", expected: "Documenter les limites", reason: "Les limites sont signalées", observations: ["o1"], metriques: [] })) }));
  await runtime.handlers["finance-report-validate"]({ snapshot: "finance-snapshot.json", report: "finance-report.json", output: "finance-validation.json" }, ctx);
  const validation = JSON.parse(fs.readFileSync(path.join(ws, "finance-validation.json"), "utf8"));
  assert.equal(validation.verdict, "PASS");
  await runtime.handlers["finance-report-publish"]({ snapshot: "finance-snapshot.json", report: "finance-report.json", validation: "finance-validation.json" }, ctx);
  assert.equal(runtime.archive.lister({ projectId: "finance" }).length, 1);
});

test("la capacité réelle liste les trois handlers seulement sur le NAS", () => {
  assert.deepEqual(financeHandlerNames, ["finance-snapshot", "finance-report-check", "finance-report-validate", "finance-report-publish"]);
  for (const name of financeHandlerNames) assert.equal(financeDisponible(name, "nas", {}), true);
  assert.equal(financeDisponible("finance-snapshot", "pc", {}), false);
  assert.equal(financeDisponible("handler-inconnu", "nas", {}), false);
});

test("A4 : une source existante ne valide ni montant faux, ni unité, devise, date ou chemin inventés", () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/finance/mission-fixtures/finance-snapshot.json")));
  const report = bonRapport("finance-csv-examples");
  report.snapshotId = snapshot.snapshotId;
  report.metriques = [{ id: "solde", path: "/cashflow/currencies/0/closingCashMinor", value: 210000, unit: "minor", currency: "CHF", date: "2026-11-01", sources: ["finance-csv-examples"] }];
  report.observations[0].metriques = ["solde"];
  assert.deepEqual(validateReport(snapshot, report), []);
  for (const mutation of [{ value: 999999 }, { unit: "CHF" }, { currency: "EUR" }, { date: "2026-10-01" }, { path: "/cashflow/currencies/1/closingCashMinor" }, { sources: [] }, { value: null }]) {
    const bad = structuredClone(report); Object.assign(bad.metriques[0], mutation);
    assert(validateReport(snapshot, bad).length, JSON.stringify(mutation));
  }
  const prose = structuredClone(report); prose.resume = "Solde 999999 CHF.";
  assert(validateReport(snapshot, prose).some((e) => /Texte libre/.test(e)));
  const absent = structuredClone(report); absent.snapshotId = "ancien-snapshot";
  assert(validateReport(snapshot, absent).length);
  const unknown = structuredClone(snapshot); unknown.cashflow.currencies[0].closingCashMinor = null;
  assert(validateReport(unknown, report).length, "inconnu n'est pas zéro");
});

test("A4 : contrainte oubliée, reviewer auteur, preuve périmée et réserve empêchent la validation", () => {
  const { exigences, hash, validerRelecture } = require("../src/finance/preuves");
  const reportText = JSON.stringify(bonRapport()), snapshotText = "snapshot figé";
  const spec = { questions: ["Que sait-on ?"], contraintes: ["Aucun ordre courtier"], _mission: { criteres: ["Sources datées"], exclusions: "Aucune conversion de devise" } };
  const checks = [...exigences(spec), { kind: "fond", text: "Cohérence économique, limites des données et absence de chiffres inventés" }]
    .map((r) => ({ ...r, status: "verified", expected: "Respecter cette exigence", reason: "Le rapport décrit les limites observées", observations: ["o1"], metriques: [] }));
  const input = { snapshotText, reportText, review: { version: 1, snapshotSha256: hash(snapshotText), reportSha256: hash(reportText), checks }, spec, sessions: { auteur: "a", reviewer: "b" } };
  assert.deepEqual(validerRelecture(input), []);
  assert(validerRelecture({ ...input, sessions: { auteur: "a", reviewer: "a" } }).length);
  assert(validerRelecture({ ...input, reportText: `${reportText}\n` }).length);
  for (const status of ["failed", "not_verified"]) {
    const bad = structuredClone(input); bad.review.checks[0].status = status;
    assert(validerRelecture(bad).length);
  }
  const missing = structuredClone(input); missing.review.checks = missing.review.checks.filter((c) => c.kind !== "contrainte");
  assert(validerRelecture(missing).some((e) => /contrainte/.test(e)));
  const fake = structuredClone(input); fake.review.checks[0].observations = ["inventée"];
  assert(validerRelecture(fake).length);
});

for (const scenario of ["corrige", "montant-persistant", "contrainte-ignoree"]) test(`A4 graphe : ${scenario}, correction bornée et publication contrôlée`, async (t) => {
  const { EventStore } = require("agent-orchestrator");
  const { Reporter } = require("agent-orchestrator/src/reporter");
  const { BudgetTracker } = require("agent-orchestrator/src/budget-tracker");
  const { runGraphe } = require("agent-orchestrator/src/graphe");
  const { chargerPipeline } = require("agent-orchestrator/src/registre");
  const resumeLedger = require("agent-orchestrator/src/resume");
  const root = dossier(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = path.join(root, "workspace"); fs.mkdirSync(ws);
  const store = new EventStore(path.join(root, "events.sqlite")); t.after(() => store.fermer());
  const { pipeline, agents } = chargerPipeline(path.join(__dirname, "fixtures/registre-planificateur"), "finance-research@2");
  for (const n of pipeline.nodes) if (n.type === "agent") n.llm = { via: "claude", model: "sonnet" };
  const spec = { project_name: "finance", questions: ["Que sait-on ?"], contraintes: ["Aucun ordre courtier"], perimetre: "Données synthétiques", _mission: { criteres: ["Données tracées"] } };
  const runtime = creerHandlers({ storageRoot: path.join(root, "data"), reportsRoot: path.join(root, "reports"), ...services() });
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/finance/mission-fixtures/finance-snapshot.json")));
  runtime.handlers["finance-snapshot"] = async () => fs.writeFileSync(path.join(ws, "finance-snapshot.json"), JSON.stringify(source));
  let analyses = 0, reviews = 0;
  const runId = store.creerRun({ pipelineRef: "finance-research@2", projectId: "finance" });
  const reporter = new Reporter(ws, { store, runId, silencieux: true });
  const resume = resumeLedger.open(ws, { pipeline, spec, fresh: true }); resume.setRunId(runId);
  const execution = runGraphe({ pipeline, agents, spec, workspaceDir: ws, stageHandlers: runtime.handlers, backends: {}, env: {},
    budget: new BudgetTracker({}, { lever: false }), budgetBase: {}, reporter, resume, abortController: new AbortController(),
    runAgent: async (options) => {
      const review = options.definition.name === "financial-research-reviewer";
      const sessionId = review ? `review-${++reviews}` : `author-${++analyses}`;
      options.onMessage({ type: "system", subtype: "init", session_id: sessionId, model: "sonnet" });
      if (review) {
        const input = JSON.parse(fs.readFileSync(path.join(ws, "finance-review-input.json")));
        fs.writeFileSync(path.join(ws, "finance-review.json"), JSON.stringify({ version: 1, snapshotSha256: input.snapshotSha256, reportSha256: input.reportSha256,
          checks: input.exigences.map((e) => ({ ...e, status: scenario === "contrainte-ignoree" && e.kind === "contrainte" ? "failed" : "verified", expected: "Restituer la source sans ordre", reason: "Le montant reste fictif et aucune instruction courtier n'est donnée", observations: ["o1"], metriques: ["solde"] })) }));
      } else {
        const report = bonRapport("finance-csv-examples"); report.snapshotId = source.snapshotId;
        report.metriques = [{ id: "solde", path: "/cashflow/currencies/0/closingCashMinor", value: scenario === "montant-persistant" || (scenario === "corrige" && analyses === 1) ? 999999 : 210000, unit: "minor", currency: "CHF", date: "2026-11-01", sources: ["finance-csv-examples"] }];
        report.observations[0].metriques = ["solde"];
        fs.writeFileSync(path.join(ws, "finance-report.json"), JSON.stringify(report));
      }
      return { sessionId, summary: "fixture contrôlée", costUsd: 0, turns: 1, usage: {} };
    },
  });
  if (scenario !== "corrige") {
    await assert.rejects(execution, /Cycle .*épuisé/);
    assert.equal(analyses, 2); assert.equal(reviews, scenario === "montant-persistant" ? 0 : 2);
    assert.equal(runtime.archive.lister().length, 0);
    return;
  }
  await execution;
  assert.equal(analyses, 2); assert.equal(reviews, 1);
  assert.equal(runtime.archive.lister().length, 1);
  const archived = runtime.archive.lire(runId);
  assert.equal(archived.report.metriques[0].value, 210000);
  assert.equal(archived.validation.version, 2);
  const events = store.evenements({ runId });
  assert.equal(events.filter((e) => e.type === "finance.report.published").length, 1);
  const etapes = store.etapes(runId).map((e) => ({ id: e.id, noeud: e.node_id, statut: e.status, outcome: e.outcome, session: e.session_id, fin: e.finished_at }));
  const criteres = require("../src/planificateur").resultatCriteres({ criteres: [{ texte: "Données tracées", realisePar: ["analyse"], jugePar: ["validation"] }] }, etapes, events);
  assert.equal(criteres[0].etat, "valide");
  assert.match(criteres[0].preuves[0].fichiers[0].extrait, /210000/);
});
