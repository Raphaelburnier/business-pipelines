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
    version: 1, resume: "Les données synthétiques restent limitées.",
    observations: [{ id: "o1", question: "Que sait-on ?", texte: "Fait documenté.", nature: "fait", sources: [sourceId], confiance: "haute" }],
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
  const snapshot = { schemaVersion: 1, synthetic: false, sources: [{ id: "macro:source" }] };
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
  const validationText = `${JSON.stringify({ verdict: "PASS", snapshotSha256: hash(snapshotText), reportSha256: hash(reportText) })}\n`;
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
  const ctx = { workspaceDir: ws, spec: { project_name: "finance", questions: ["Que sait-on ?"] }, reporter: { runId: "12345678-1234-1234", event: () => {} } };
  await runtime.handlers["finance-snapshot"]({ output: "finance-snapshot.json" }, ctx);
  const snapshot = JSON.parse(fs.readFileSync(path.join(ws, "finance-snapshot.json"), "utf8"));
  snapshot.sources.push({ id: "macro:source" });
  fs.writeFileSync(path.join(ws, "finance-snapshot.json"), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(ws, "finance-report.json"), JSON.stringify(bonRapport()));
  await runtime.handlers["finance-report-validate"]({ snapshot: "finance-snapshot.json", report: "finance-report.json", output: "finance-validation.json" }, ctx);
  const validation = JSON.parse(fs.readFileSync(path.join(ws, "finance-validation.json"), "utf8"));
  assert.equal(validation.verdict, "PASS");
  await runtime.handlers["finance-report-publish"]({ snapshot: "finance-snapshot.json", report: "finance-report.json", validation: "finance-validation.json" }, ctx);
  assert.equal(runtime.archive.lister({ projectId: "finance" }).length, 1);
});

test("la capacité réelle liste les trois handlers seulement sur le NAS", () => {
  assert.deepEqual(financeHandlerNames, ["finance-snapshot", "finance-report-validate", "finance-report-publish"]);
  for (const name of financeHandlerNames) assert.equal(financeDisponible(name, "nas", {}), true);
  assert.equal(financeDisponible("finance-snapshot", "pc", {}), false);
  assert.equal(financeDisponible("handler-inconnu", "nas", {}), false);
});
