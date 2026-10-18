// Les valeurs affichées viennent d'un catalogue construit par le serveur, jamais
// d'une conversion ou d'un chemin arbitraire choisi par le modèle.
const crypto = require("node:crypto");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");

function catalogue(snapshot) {
  const result = [];
  const cashSources = (snapshot.sources || []).filter((s) => /^csv-|synthetic_fixture/.test(s.kind || "")).map((s) => s.id);
  const add = (path, value, unit, currency, date, sources) => {
    if (typeof value === "number" && Number.isFinite(value)) result.push({ path, value, unit, currency, date, sources });
  };
  for (const [i, b] of (snapshot.cashflow?.buckets || []).entries()) {
    for (const field of ["opening", "closing", "receipts", "refunds", "netReceipts", "expenses", "operatingCashSurplus", "ownerFunding", "transfers", "unpaid"]) {
      add(`/cashflow/buckets/${i}/${field}`, b[field], "minor", b.currency, snapshot.cashflow.to || snapshot.capturedAt, cashSources);
    }
  }
  // La fixture F08 historique porte explicitement le suffixe Minor.
  for (const [i, b] of (snapshot.cashflow?.currencies || []).entries()) {
    for (const field of ["openingBalanceMinor", "grossCustomerPaymentsMinor", "customerRefundsMinor", "netCustomerReceiptsMinor", "operatingExpensesMinor", "operatingSurplusMinor", "ownerFundingNetMinor", "internalTransfersNetMinor", "closingCashMinor", "unpaidInvoicesMinor"]) {
      add(`/cashflow/currencies/${i}/${field}`, b[field], "minor", b.currency, snapshot.period?.toExclusive || snapshot.preparedAt, cashSources);
    }
  }
  for (const [i, o] of (snapshot.markets?.macro?.observations || []).entries()) add(`/markets/macro/observations/${i}/value`, o.value, o.unit, null, String(o.year), [o.sourceId]);
  for (const [i, instrument] of (snapshot.markets?.prices || []).entries()) {
    if (instrument.latest) add(`/markets/prices/${i}/latest/close`, instrument.latest.close, "price", instrument.currency, instrument.latest.date, [instrument.sourceId]);
  }
  return result;
}

function validerMetriques(snapshot, report, spec = {}) {
  const errors = [];
  if (report.version !== 2 || report.snapshotId !== snapshot.snapshotId || !Array.isArray(report.metriques)) return ["Rapport v2, snapshotId exact et tableau metriques requis."];
  const entries = new Map(catalogue(snapshot).map((x) => [x.path, x]));
  const ids = new Set();
  for (const m of report.metriques) {
    if (!m || typeof m.id !== "string" || !/^[a-z][a-z0-9-]{0,60}$/.test(m.id) || ids.has(m.id)) { errors.push("Identifiant de métrique absent ou dupliqué."); continue; }
    ids.add(m.id);
    const expected = entries.get(m.path);
    if (!expected || !expected.sources.length || !expected.date || !expected.unit ||
        ["value", "unit", "currency", "date"].some((k) => m[k] !== expected[k]) ||
        !Array.isArray(m.sources) || JSON.stringify([...m.sources].sort()) !== JSON.stringify([...expected.sources].sort())) {
      errors.push(`Métrique ${m.id} : valeur, unité, devise, date ou sources différentes du snapshot.`);
    }
  }
  const used = new Set();
  for (const o of report.observations) {
    if (!Array.isArray(o?.metriques)) { errors.push(`Observation ${o?.id} : tableau metriques requis.`); continue; }
    for (const id of o.metriques) {
      used.add(id);
      const m = report.metriques.find((x) => x?.id === id);
      if (!m || !m.sources?.every((s) => o.sources?.includes(s))) errors.push(`Observation ${o.id} : métrique inconnue ou provenance non citée.`);
    }
  }
  for (const id of ids) if (!used.has(id)) errors.push(`Métrique ${id} non reliée à une observation.`);
  // Une quantité dans le texte échappe à la comparaison structurée. Les dates,
  // unités et montants se consultent dans les métriques rendues par l'interface.
  const questionsLibres = [...report.observations, ...report.questions_sans_reponse].map((o) => o.question).filter((q) => !(spec.questions || []).includes(q));
  const text = [...questionsLibres, report.resume, ...report.observations.flatMap((o) => [o?.texte]),
    ...report.scenarios.flatMap((s) => [...(s.hypotheses || []), ...(s.effets_possibles || []), ...(s.risques || []), ...(s.conditions_a_verifier || [])]),
    ...report.risques, ...report.limites, ...report.questions_sans_reponse.flatMap((q) => [q?.raison])];
  if (text.some((t) => typeof t !== "string" || /\p{N}/u.test(t))) errors.push("Texte libre : valeurs chiffrées interdites ; utiliser exclusivement les métriques vérifiées.");
  return errors;
}

function exigences(spec) {
  const mission = spec._mission || {};
  return [
    ...(mission.criteres || []).map((text) => ({ kind: "critere", text })),
    ...(spec.questions || []).map((text) => ({ kind: "question", text })),
    ...[spec.contraintes, mission.directives, mission.exclusions, mission.document, spec.perimetre ? JSON.stringify(spec.perimetre) : null].flatMap((text) => Array.isArray(text) ? text : text ? [text] : []).map((text) => ({ kind: "contrainte", text })),
  ];
}

function validerRelecture({ snapshotText, reportText, review, spec, sessions }) {
  const errors = [];
  if (!sessions?.auteur || !sessions?.reviewer || sessions.auteur === sessions.reviewer) errors.push("Relecture : sessions auteur et reviewer indépendantes requises.");
  if (!review || review.version !== 1 || review.snapshotSha256 !== hash(snapshotText) || review.reportSha256 !== hash(reportText) || !Array.isArray(review.checks)) return [...errors, "Relecture absente ou liée à d’autres artefacts."];
  const report = JSON.parse(reportText);
  const observations = new Set(report.observations.map((o) => o.id));
  const metrics = new Set(report.metriques.map((m) => m.id));
  const required = [...exigences(spec), { kind: "fond", text: "Cohérence économique, limites des données et absence de chiffres inventés" }];
  for (const r of required) {
    const checks = review.checks.filter((c) => c?.kind === r.kind && c.text === r.text);
    const c = checks[0];
    if (checks.length !== 1 || c?.status !== "verified" || typeof c.expected !== "string" || !c.expected.trim() || typeof c.reason !== "string" || !c.reason.trim() || /\p{N}/u.test(c.reason + c.expected) ||
        !Array.isArray(c.observations) || !c.observations.length || !c.observations.every((id) => observations.has(id)) ||
        !Array.isArray(c.metriques) || !c.metriques.every((id) => metrics.has(id))) errors.push(`Relecture non concluante : ${r.kind} « ${r.text} ».`);
  }
  if (review.checks.some((c) => !required.some((r) => c?.kind === r.kind && c.text === r.text))) errors.push("Relecture : exigence étrangère à la mission.");
  return errors;
}

module.exports = { catalogue, validerMetriques, exigences, validerRelecture, hash };
