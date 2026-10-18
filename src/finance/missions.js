const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { FinanceService } = require("./service");
const { MacroSourceService } = require("./sources");
const { PriceSourceService } = require("./prices");
const { catalogue, validerMetriques, exigences, validerRelecture } = require("./preuves");

const MAX_SNAPSHOT_BYTES = 700_000;
const MAX_REPORT_BYTES = 400_000;
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const safeName = (name) => {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(name) || name === "." || name === "..") {
    throw new Error(`Fichier Finance invalide : ${String(name)}.`);
  }
  return name;
};
function lireJson(dir, name, maxBytes) {
  const file = path.join(dir, safeName(name));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) throw new Error(`Fichier Finance invalide ou trop volumineux : ${name}.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function ecrireJson(dir, name, value, maxBytes) {
  const file = path.join(dir, safeName(name));
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(content) > maxBytes) throw new Error(`Fichier Finance au-dessus de la limite : ${name}.`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return content;
}
function compactCashflow(summary) {
  return {
    status: summary.empty ? "unknown" : "available",
    reason: summary.empty ? "Aucun journal financier importé ; montants inconnus, pas égaux à zéro." : null,
    revision: summary.revision,
    from: summary.from,
    to: summary.to,
    scope: summary.scope,
    businesses: summary.businesses,
    currencies: summary.buckets.map((b) => b.currency),
    buckets: summary.buckets.map((b) => ({
      currency: b.currency, opening: b.opening, closing: b.closing,
      receipts: b.receipts, refunds: b.refunds, netReceipts: b.netReceipts,
      expenses: b.expenses, operatingCashSurplus: b.operatingCashSurplus,
      ownerFunding: b.ownerFunding, transfers: b.transfers, unpaid: b.unpaid,
      movementCount: b.movementCount, accountBalances: b.accountBalances,
      points: b.points,
    })),
    warnings: summary.warnings,
    imports: summary.imports.map(({ id, kind, fileName, sha256, importedAt, rowCount }) => ({ id, kind, fileName, sha256, importedAt, rowCount })),
  };
}
function construireSnapshot({ finance, macro, prices, projectId, now }) {
  const cash = compactCashflow(finance.summary());
  const sources = cash.imports.map((entry) => ({
    id: `finance-import:${entry.id}`, kind: `csv-${entry.kind}`, provider: "cockpit-finance",
    name: entry.fileName, sha256: entry.sha256, observedAt: entry.importedAt,
    limitations: ["Import confirmé par l’utilisateur ; son exhaustivité n’est pas établie."],
  }));
  const macroView = macro.snapshot();
  let macroData = { status: "not_provided", collectedAt: null, sourceUpdatedAt: null, observations: [] };
  if (macroView.sha256) {
    const sourceId = `macro:${macroView.sha256}`;
    sources.push({ id: sourceId, kind: "macro-series", provider: macroView.provider, sha256: macroView.sha256, observedAt: macroView.collectedAt, sourceUpdatedAt: macroView.sourceUpdatedAt, url: macroView.requestUrl, limitations: ["Indicateurs annuels retardés ; pas des données temps réel."] });
    const units = new Map(macroView.indicators.map((item) => [item.id, item.unit || item.name]));
    macroData = { status: "available", collectedAt: macroView.collectedAt, sourceUpdatedAt: macroView.sourceUpdatedAt, cacheAgeDays: macroView.cacheAgeDays, stale: macroView.cacheStale, observations: macroView.series.flatMap((series) => series.points.filter((point) => point.value !== null).map((point) => ({ id: `macro:${series.id}:${point.year}`, countryId: series.countryId, indicatorId: series.indicatorId, year: point.year, value: point.value, unit: units.get(series.indicatorId) || "unit not specified", sourceId }))) };
  }
  const priceView = prices.snapshot();
  const marketPrices = [];
  for (const instrument of priceView.instruments) {
    if (!instrument.latest || !instrument.sha256) continue;
    const sourceId = `prices:${instrument.id}:${instrument.sha256}`;
    sources.push({ id: sourceId, kind: "daily-market-prices", provider: priceView.provider, sha256: instrument.sha256, observedAt: instrument.collectedAt, url: instrument.url || null, limitations: ["Cours historiques datés, non temps réel.", ...(instrument.dateNeedsCheck ? ["Dernière clôture ancienne ; vérifier avant usage."] : [])] });
    marketPrices.push({ id: instrument.id, symbol: instrument.symbol, exchange: instrument.exchange, currency: instrument.currency, collectedAt: instrument.collectedAt, ageDays: instrument.ageDays, stale: instrument.cacheStale, latest: instrument.latest, points: instrument.points.slice(-90).map((point) => ({ ...point, sourceId })), sourceId });
  }
  const snapshot = {
    schemaVersion: 1,
    snapshotId: crypto.randomUUID(),
    capturedAt: new Date(now()).toISOString(),
    synthetic: false,
    projectId,
    business: { id: projectId, status: cash.businesses.length ? "businesses-present" : "not-configured", names: cash.businesses },
    cashflow: cash,
    markets: {
      status: macroData.status === "not_provided" && marketPrices.length === 0 ? "not_provided" : "partial",
      macro: macroData,
      prices: marketPrices,
      missingData: [
        ...(macroData.status === "not_provided" ? ["Aucune série macroéconomique collectée."] : []),
        ...(marketPrices.length === 0 ? ["Aucun cours collecté."] : []),
        "La couverture mondiale complète n’est pas garantie par les sources configurées.",
        "Aucun taux de change consolidé n’est calculé.",
      ],
    },
    sources,
  };
  snapshot.metriquesDisponibles = catalogue(snapshot);
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > MAX_SNAPSHOT_BYTES) throw new Error(`Snapshot Finance trop volumineux (${bytes} octets ; limite ${MAX_SNAPSHOT_BYTES}). Réduire les données importées ou le suivi marché.`);
  return snapshot;
}
function validateReport(snapshot, report, spec = {}) {
  const manques = [];
  const manque = (message) => manques.push(message);
  if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.sources)) manque("Snapshot Finance absent ou version incompatible.");
  if (!report || report.version !== 2 || typeof report.resume !== "string" || !report.resume.trim()) manque("Le rapport doit contenir version: 2 et un résumé non vide.");
  for (const field of ["observations", "scenarios", "risques", "limites", "questions_sans_reponse"]) if (!Array.isArray(report?.[field])) manque(`Le champ ${field} doit être un tableau.`);
  if (manques.length) return manques;

  const sourceIds = new Set(snapshot.sources.map((source) => source.id));
  const observationIds = new Set();
  const covered = new Set();
  for (const item of report.observations) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || observationIds.has(item.id)) manque("Chaque observation doit avoir un identifiant unique.");
    else observationIds.add(item.id);
    if (typeof item?.question !== "string" || !item.question.trim() || typeof item?.texte !== "string" || !item.texte.trim()) manque(`Observation ${item?.id || "sans id"} : question et texte sont obligatoires.`);
    else covered.add(item.question);
    if (!["fait", "hypothese"].includes(item?.nature)) manque(`Observation ${item?.id || "sans id"} : nature doit être fait ou hypothese.`);
    if (!["haute", "moyenne", "basse"].includes(item?.confiance)) manque(`Observation ${item?.id || "sans id"} : niveau de confiance invalide.`);
    if (!Array.isArray(item?.sources)) manque(`Observation ${item?.id || "sans id"} : sources doit être un tableau.`);
    else {
      if (item.nature === "fait" && item.sources.length === 0) manque(`Observation ${item.id} : un fait doit citer une source.`);
      for (const id of item.sources) if (!sourceIds.has(id)) manque(`Observation ${item.id} : source inconnue « ${id} ».`);
    }
  }
  const unanswered = new Set();
  for (const item of report.questions_sans_reponse) {
    if (!item || typeof item.question !== "string" || !item.question.trim() || typeof item.raison !== "string" || !item.raison.trim()) manque("Chaque question sans réponse doit avoir une raison.");
    else { unanswered.add(item.question); covered.add(item.question); }
  }
  for (const question of spec.questions || []) if (!covered.has(question)) manque(`Question de la mission non traitée : ${question}`);
  for (const question of unanswered) if ((spec.questions || []).length && !spec.questions.includes(question)) manque(`Question sans réponse absente de la mission : ${question}`);
  for (const scenario of report.scenarios) {
    if (!scenario || typeof scenario.id !== "string" || !Array.isArray(scenario.hypotheses) || !Array.isArray(scenario.effets_possibles) || !Array.isArray(scenario.risques) || !Array.isArray(scenario.conditions_a_verifier)) manque("Chaque scénario doit préciser ses hypothèses, effets, risques et conditions à vérifier.");
  }
  if (snapshot.synthetic && !/synth[eé]tique|fictif/i.test(`${report.resume} ${(report.limites || []).join(" ")}`)) manque("Le rapport doit signaler que les données du snapshot sont synthétiques.");
  if (!manques.length) manques.push(...validerMetriques(snapshot, report, spec));
  return manques;
}

class FinanceReportArchive {
  constructor({ root, now = Date.now }) { this.root = path.resolve(root); this.now = now; }
  publier({ runId, projectId, snapshotText, reportText, validationText }) {
    if (!/^[a-f0-9-]{16,64}$/i.test(String(runId || ""))) throw new Error("Identifiant de run absent ou invalide ; publication refusée.");
    const snapshotHash = sha(snapshotText), reportHash = sha(reportText), validationHash = sha(validationText);
    const validation = JSON.parse(validationText);
    if (validation.version !== 2 || !validation.sessions?.auteur || !validation.sessions?.reviewer || validation.sessions.auteur === validation.sessions.reviewer || validation.verdict !== "PASS" || validation.snapshotSha256 !== snapshotHash || validation.reportSha256 !== reportHash) throw new Error("La validation PASS ne correspond pas aux artefacts de cette publication.");
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.root, 0o700);
    const dir = path.join(this.root, runId);
    if (fs.existsSync(dir)) {
      const dirStat = fs.lstatSync(dir);
      if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) throw new Error("Dossier d’archive Finance non sûr.");
      const current = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      if (current.runId !== runId || current.projectId !== projectId || current.snapshotSha256 !== snapshotHash || current.reportSha256 !== reportHash || current.validationSha256 !== validationHash) throw new Error("Un rapport différent existe déjà pour ce run ; publication refusée.");
      return { id: runId, publishedAt: current.publishedAt, reportSha256: current.reportSha256, duplicate: true };
    }
    const tempDir = path.join(this.root, `.${runId}.${crypto.randomUUID()}.tmp`);
    fs.mkdirSync(tempDir, { mode: 0o700 });
    const manifest = { version: 1, id: runId, runId, projectId, publishedAt: new Date(this.now()).toISOString(), snapshotSha256: snapshotHash, reportSha256: reportHash, validationSha256: validationHash };
    try {
      for (const [name, content] of [["finance-snapshot.json", snapshotText], ["finance-report.json", reportText], ["finance-validation.json", validationText]]) fs.writeFileSync(path.join(tempDir, name), content, { mode: 0o600, flag: "wx" });
      fs.writeFileSync(path.join(tempDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      fs.renameSync(tempDir, dir);
    } catch (error) { fs.rmSync(tempDir, { recursive: true, force: true }); throw error; }
    return { id: runId, publishedAt: manifest.publishedAt, reportSha256: reportHash, duplicate: false };
  }
  lister({ projectId } = {}) {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[a-f0-9-]{16,64}$/i.test(entry.name)).flatMap((entry) => {
      try { const manifest = JSON.parse(fs.readFileSync(path.join(this.root, entry.name, "manifest.json"), "utf8")); return (!projectId || manifest.projectId === projectId) ? [{ id: manifest.id, projectId: manifest.projectId, publishedAt: manifest.publishedAt, reportSha256: manifest.reportSha256 }] : []; } catch { return []; }
    }).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  }
  lire(id) {
    if (!/^[a-f0-9-]{16,64}$/i.test(String(id || ""))) throw Object.assign(new Error("Rapport introuvable."), { status: 404 });
    const dir = path.join(this.root, id);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
      const snapshotText = fs.readFileSync(path.join(dir, "finance-snapshot.json"), "utf8");
      const reportText = fs.readFileSync(path.join(dir, "finance-report.json"), "utf8");
      const validationText = fs.readFileSync(path.join(dir, "finance-validation.json"), "utf8");
      if (sha(snapshotText) !== manifest.snapshotSha256 || sha(reportText) !== manifest.reportSha256 || sha(validationText) !== manifest.validationSha256) throw new Error("Empreinte des artefacts archivés invalide.");
      return { ...manifest, report: JSON.parse(reportText), snapshot: JSON.parse(snapshotText), validation: JSON.parse(validationText) };
    } catch (error) { if (error.code === "ENOENT") throw Object.assign(new Error("Rapport introuvable."), { status: 404 }); throw error; }
  }
}

function creerHandlers({ storageRoot = process.env.FINANCE_STORAGE_ROOT || path.resolve("etat", "finance"), reportsRoot = process.env.FINANCE_REPORTS_ROOT || path.join(storageRoot, "reports"), token = process.env.EODHD_API_TOKEN || "", finance = null, macro = null, prices = null, now = Date.now } = {}) {
  const sourceFinance = finance || new FinanceService({ storageRoot });
  const sourceMacro = macro || new MacroSourceService({ storageRoot });
  const sourcePrices = prices || new PriceSourceService({ storageRoot, token });
  const archive = new FinanceReportArchive({ root: reportsRoot, now });
  const controler = (stage, ctx) => {
    const snapshotName = safeName(stage.snapshot || "finance-snapshot.json");
    const reportName = safeName(stage.report || "finance-report.json");
    const snapshot = lireJson(ctx.workspaceDir, snapshotName, MAX_SNAPSHOT_BYTES);
    const report = lireJson(ctx.workspaceDir, reportName, MAX_REPORT_BYTES);
    const reportText = fs.readFileSync(path.join(ctx.workspaceDir, reportName), "utf8");
    const snapshotText = fs.readFileSync(path.join(ctx.workspaceDir, snapshotName), "utf8");
    return { snapshot, report, reportText, snapshotText, manques: validateReport(snapshot, report, ctx.spec || {}) };
  };
  const handlers = {
    "finance-snapshot": async (stage, ctx) => {
      const projectId = String(ctx.spec?.project_name || "");
      if (!projectId) throw new Error("La spec Finance doit nommer project_name.");
      const snapshot = construireSnapshot({ finance: sourceFinance, macro: sourceMacro, prices: sourcePrices, projectId, now });
      ecrireJson(ctx.workspaceDir, stage.output || "finance-snapshot.json", snapshot, MAX_SNAPSHOT_BYTES);
    },
    "finance-report-check": async (stage, ctx) => {
      const { snapshot, reportText, snapshotText, manques } = controler(stage, ctx);
      ecrireJson(ctx.workspaceDir, stage.output || "finance-review-input.json", { version: 1, verdict: manques.length ? "FAIL" : "PASS", manques,
        snapshotSha256: sha(snapshotText), reportSha256: sha(reportText), metriquesDisponibles: catalogue(snapshot),
        exigences: [...exigences(ctx.spec || {}), { kind: "fond", text: "Cohérence économique, limites des données et absence de chiffres inventés" }],
      }, MAX_SNAPSHOT_BYTES);
    },
    "finance-report-validate": async (stage, ctx) => {
      const { report, reportText, snapshotText, manques } = controler(stage, ctx);
      let review = null;
      try { review = lireJson(ctx.workspaceDir, stage.review || "finance-review.json", MAX_REPORT_BYTES); }
      catch { manques.push("Rapport de relecture indépendant absent ou invalide."); }
      const etapes = ctx.reporter?.store?.etapes(ctx.reporter.runId) || [];
      const derniere = (agent) => [...etapes].reverse().find((e) => e.agent_ref?.startsWith(`${agent}@`));
      const auteur = derniere("financial-research-analyst"), reviewer = derniere("financial-research-reviewer");
      const sessions = { auteur: auteur?.status === "succeeded" ? auteur.session_id : null, reviewer: reviewer?.status === "succeeded" && reviewer.started_at >= auteur?.finished_at ? reviewer.session_id : null };
      manques.push(...validerRelecture({ snapshotText, reportText, review, spec: ctx.spec || {}, sessions }));
      const checks = Array.isArray(review?.checks) ? review.checks : [];
      const validation = { version: 2, verdict: manques.length ? "FAIL" : "PASS", manques, sessions, checks, reviewSha256: review ? sha(JSON.stringify(review)) : null,
        snapshotSha256: sha(snapshotText), reportSha256: sha(reportText), validatedAt: new Date(now()).toISOString() };
      ecrireJson(ctx.workspaceDir, stage.output || "finance-validation.json", validation, 64_000);
      const validationStep = [...etapes].reverse().find((e) => e.node_id === stage.id);
      ctx.reporter?.event?.("finance.validation.finished", { stepId: validationStep?.id || null, node: stage.id, ...validation,
        preuvesCriteres: checks.filter((c) => c?.kind === "critere").map((c) => ({
          texte: c.text, attendu: c.expected, motif: c.reason, statut: c.status,
          extrait: JSON.stringify({ observations: (report.observations || []).filter((o) => c.observations?.includes(o.id)),
            metriques: (report.metriques || []).filter((m) => c.metriques?.includes(m.id)) }).slice(0, 8000),
        })),
      });
    },
    "finance-report-publish": async (stage, ctx) => {
      const snapshotName = stage.snapshot || "finance-snapshot.json";
      const reportName = stage.report || "finance-report.json";
      const validationName = stage.validation || "finance-validation.json";
      const validation = lireJson(ctx.workspaceDir, validationName, 64_000);
      if (validation.version !== 2 || !validation.sessions?.reviewer || validation.sessions.auteur === validation.sessions.reviewer) throw new Error("Publication Finance : validation indépendante v2 requise.");
      const published = archive.publier({
        runId: ctx.reporter?.runId,
        projectId: ctx.spec?.project_name,
        snapshotText: fs.readFileSync(path.join(ctx.workspaceDir, safeName(snapshotName)), "utf8"),
        reportText: fs.readFileSync(path.join(ctx.workspaceDir, safeName(reportName)), "utf8"),
        validationText: fs.readFileSync(path.join(ctx.workspaceDir, safeName(validationName)), "utf8"),
      });
      if (ctx.reporter?.event) ctx.reporter.event("finance.report.published", { id: published.id, projectId: ctx.spec?.project_name, reportSha256: published.reportSha256, duplicate: published.duplicate });
    },
  };
  return { handlers, archive, disponibles: () => Object.keys(handlers) };
}

module.exports = { MAX_SNAPSHOT_BYTES, MAX_REPORT_BYTES, compactCashflow, construireSnapshot, validateReport, FinanceReportArchive, creerHandlers };
