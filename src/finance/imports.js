const crypto = require("node:crypto");

const SCHEMAS = {
  mouvements: [
    "source",
    "source_record_id",
    "business_id",
    "account_id",
    "booked_on",
    "currency",
    "amount_minor",
    "category",
    "transfer_group_id",
    "document_id",
    "label",
  ],
  soldes: [
    "account_id",
    "currency",
    "as_of",
    "balance_minor",
    "source_record_id",
  ],
  factures: [
    "document_id",
    "business_id",
    "issued_on",
    "due_on",
    "currency",
    "total_minor",
    "tax_minor",
    "status",
  ],
};
const OPTIONAL = new Set([
  "transfer_group_id",
  "document_id",
  "label",
  "tax_minor",
]);
const CATEGORIES = [
  "customer_payment",
  "customer_refund",
  "operating_expense",
  "owner_funding",
  "internal_transfer",
];
const CURRENCIES = ["CHF", "EUR", "USD"];
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
function dateValid(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
// CSV avec guillemets échappés, retours à la ligne dans les cellules et numéros de
// lignes physiques. On ne découpe pas un relevé bancaire avec split(",").
function parseCsv(csv) {
  if (typeof csv !== "string" || Buffer.byteLength(csv) > 1_000_000)
    throw new Error("CSV attendu, limité à 1 Mo.");
  const text = csv.replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = first.includes(";") ? ";" : ",";
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const push = () => {
    row.push(cell);
    if (row.some((v) => v.trim())) rows.push({ cells: row, line: start });
    row = [];
    cell = "";
    closed = false;
    start = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += c;
        if (c === "\n") line++;
      }
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
      closed = false;
    } else if (c === "\n" || c === "\r") {
      push();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
      start = line;
    } else if (c === '"' || closed)
      throw new Error(`Guillemets invalides à la ligne ${line}.`);
    else cell += c;
    if (rows.length > 10_001)
      throw new Error("Maximum 10 000 lignes par import.");
  }
  if (quoted) throw new Error(`Guillemet non fermé à la ligne ${start}.`);
  if (cell || row.length) push();
  if (rows.length > 10_001)
    throw new Error("Maximum 10 000 lignes par import.");
  if (!rows.length) throw new Error("Le CSV est vide.");
  const headers = rows.shift().cells.map((s) => s.trim());
  if (new Set(headers).size !== headers.length || headers.some((s) => !s))
    throw new Error("Les noms de colonnes doivent être uniques et non vides.");
  return { headers, rows, delimiter };
}
function key(kind, r) {
  const parts =
    kind === "mouvements"
      ? [r.source, r.source_record_id]
      : kind === "soldes"
        ? [r.account_id, r.currency, r.source_record_id]
        : [r.business_id, r.document_id];
  return JSON.stringify(parts);
}
function validateImport(input, stored) {
  const fields = Object.hasOwn(SCHEMAS, input.kind)
    ? SCHEMAS[input.kind]
    : null;
  if (!fields) throw new Error("Type d’import inconnu.");
  if (typeof input.fileName !== "string" || input.fileName.length > 200)
    throw new Error("Nom de fichier attendu (200 caractères maximum).");
  const { headers, rows, delimiter } = parseCsv(input.csv);
  const mapping = input.mapping || {};
  if (typeof mapping !== "object" || Array.isArray(mapping))
    throw new Error("Mapping de colonnes invalide.");
  const indices = Object.fromEntries(
    fields.map((field) => [field, headers.indexOf(mapping[field] || field)]),
  );
  const issues = [];
  const records = [];
  let duplicates = 0;
  const seen = new Map(stored.map((r) => [key(input.kind, r.data), r.data]));
  const observationKey = (r) =>
    JSON.stringify([r.account_id, r.currency, r.as_of]);
  const observations = new Map(
    input.kind === "soldes"
      ? stored.map((r) => [observationKey(r.data), r.data.balance_minor])
      : [],
  );
  for (const field of fields)
    if (indices[field] === -1)
      issues.push({ line: 1, field, message: `Colonne manquante : ${field}.` });
  if (issues.length)
    return {
      headers,
      fields,
      delimiter,
      issues,
      records,
      duplicates,
      rowCount: rows.length,
    };
  for (const { cells, line } of rows) {
    const data = Object.fromEntries(
      fields.map((field) => [field, (cells[indices[field]] || "").trim()]),
    );
    const before = issues.length;
    if (cells.length !== headers.length)
      issues.push({
        line,
        message: "Nombre de cellules différent de l’en-tête.",
      });
    for (const field of fields) {
      const value = data[field];
      const optional =
        OPTIONAL.has(field) &&
        (field !== "document_id" || input.kind === "mouvements");
      if (!value && !optional)
        issues.push({ line, field, message: `Valeur requise : ${field}.` });
      if (value.length > (field === "label" ? 1000 : 200))
        issues.push({ line, field, message: `Valeur trop longue : ${field}.` });
      if (
        ["booked_on", "as_of", "issued_on", "due_on"].includes(field) &&
        !dateValid(value)
      )
        issues.push({
          line,
          field,
          message: `Date YYYY-MM-DD invalide : ${field}.`,
        });
      if (field.endsWith("_minor") && (value || !optional)) {
        if (
          !/^-?\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value)) ||
          Math.abs(Number(value)) > 1_000_000_000_000
        )
          issues.push({
            line,
            field,
            message: `Montant entier en centimes attendu : ${field}.`,
          });
        else data[field] = Number(value);
      }
    }
    if (!CURRENCIES.includes(data.currency))
      issues.push({
        line,
        field: "currency",
        message: "Devise V1 : CHF, EUR ou USD. Aucune conversion automatique.",
      });
    if (input.kind === "mouvements") {
      if (!CATEGORIES.includes(data.category))
        issues.push({
          line,
          field: "category",
          message: `Catégorie inconnue. Choisir : ${CATEGORIES.join(", ")}.`,
        });
      if (
        (data.category === "customer_payment" && data.amount_minor <= 0) ||
        (["customer_refund", "operating_expense"].includes(data.category) &&
          data.amount_minor >= 0) ||
        data.amount_minor === 0
      )
        issues.push({
          line,
          field: "amount_minor",
          message:
            "Signe incompatible : encaissement positif, remboursement/dépense négatif, mouvement non nul.",
        });
      if (data.category === "internal_transfer" && !data.transfer_group_id)
        issues.push({
          line,
          field: "transfer_group_id",
          message: "Un virement interne demande un identifiant de groupe.",
        });
    }
    if (input.kind === "factures") {
      if (!["paid", "unpaid", "cancelled"].includes(data.status))
        issues.push({
          line,
          field: "status",
          message: "Statut attendu : paid, unpaid ou cancelled.",
        });
      if (
        data.total_minor < 0 ||
        (data.tax_minor !== "" &&
          (data.tax_minor < 0 || data.tax_minor > data.total_minor))
      )
        issues.push({ line, message: "Total/taxe de facture incohérents." });
      if (data.due_on < data.issued_on)
        issues.push({ line, message: "Échéance antérieure à l’émission." });
    }
    if (issues.length !== before) continue;
    const id = key(input.kind, data);
    const previous = seen.get(id);
    if (previous) {
      if (JSON.stringify(previous) === JSON.stringify(data)) duplicates++;
      else
        issues.push({
          line,
          message:
            "Conflit : cet identifiant existe avec un contenu différent. Aucun remplacement automatique.",
        });
      continue;
    }
    if (input.kind === "soldes") {
      const observation = observations.get(observationKey(data));
      if (observation !== undefined && observation !== data.balance_minor) {
        issues.push({
          line,
          message:
            "Deux soldes différents pour ce compte, cette devise et cette date.",
        });
        continue;
      }
      observations.set(observationKey(data), data.balance_minor);
    }
    seen.set(id, data);
    records.push({ data, line });
  }
  return {
    headers,
    fields,
    delimiter,
    issues,
    records,
    duplicates,
    rowCount: rows.length,
  };
}
module.exports = {
  SCHEMAS,
  CATEGORIES,
  CURRENCIES,
  sha,
  dateValid,
  parseCsv,
  validateImport,
};
