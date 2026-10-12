const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { validateImport, sha } = require("./imports");
const { summarize } = require("./metrics");
function emptyState() { return { version: 1, revision: 0, mouvements: [], soldes: [], factures: [], imports: [], accountScopes: [] }; }
class FinanceError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
class FinanceService {
  constructor({ storageRoot, now = () => Date.now() }) {
    this.root = path.resolve(storageRoot); this.file = path.join(this.root, "finance.json"); this.now = now; this.previews = new Map();
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, "utf8")) : emptyState();
    if (this.state.version !== 1 || !Number.isSafeInteger(this.state.revision) || !["mouvements", "soldes", "factures", "imports"].every((k) => Array.isArray(this.state[k]))) throw new Error("Stockage Finance invalide ; aucun effacement automatique.");
    this.state.accountScopes ||= [];
    if (!Array.isArray(this.state.accountScopes)) throw new Error("Attributions de comptes illisibles.");
  }
  summary(query) { return summarize(this.state, query); }
  preview(input) {
    const checked = validateImport(input, this.state[input.kind] || []);
    for (const [token, p] of this.previews) if (p.expires < this.now()) this.previews.delete(token);
    if (this.previews.size >= 100) throw new FinanceError("Trop d’aperçus actifs. Réessayer dans quinze minutes.", 429);
    const token = crypto.randomUUID();
    // Copie du contrat reçu : le commit ne relit pas des paramètres modifiables.
    const frozen = JSON.parse(JSON.stringify(input));
    this.previews.set(token, { input: frozen, checked, revision: this.state.revision, expires: this.now() + 15 * 60_000 });
    return { token, revision: this.state.revision, headers: checked.headers, fields: checked.fields, delimiter: checked.delimiter, issues: checked.issues, newCount: checked.records.length, duplicateCount: checked.duplicates, rowCount: checked.rowCount, sample: checked.records.slice(0, 10), canConfirm: checked.issues.length === 0 && checked.rowCount > 0 };
  }
  confirm(token) {
    const p = this.previews.get(token);
    if (!p || p.expires < this.now()) throw new FinanceError("Aperçu expiré. Prévisualiser à nouveau.", 409);
    if (p.receipt) return p.receipt;
    if (p.revision !== this.state.revision) throw new FinanceError("Les données ont changé depuis l’aperçu. Prévisualiser à nouveau.", 409);
    if (p.checked.issues.length || !p.checked.rowCount) throw new FinanceError("Corriger les erreurs avant confirmation.");
    if (!p.checked.records.length) { p.receipt = { added: 0, duplicates: p.checked.duplicates, revision: this.state.revision, importId: null }; return p.receipt; }
    if (this.state.imports.length >= 1000) throw new FinanceError("Limite V1 de 1000 imports atteinte.", 409);
    const importedAt = new Date(this.now()).toISOString(); const id = crypto.randomUUID();
    const next = JSON.parse(JSON.stringify(this.state));
    next[p.input.kind].push(...p.checked.records.map((r) => ({ ...r, importId: id })));
    next.imports.push({ id, kind: p.input.kind, fileName: p.input.fileName, sha256: sha(p.input.csv), importedAt, rowCount: p.checked.rowCount, added: p.checked.records.length, duplicates: p.checked.duplicates, mapping: p.input.mapping || {}, csv: p.input.csv });
    next.revision++;
    if (["mouvements", "soldes", "factures"].reduce((n, k) => n + next[k].length, 0) > 100_000) throw new FinanceError("Limite V1 de 100 000 enregistrements atteinte.", 409);
    this.save(next);
    p.receipt = { added: p.checked.records.length, duplicates: p.checked.duplicates, revision: next.revision, importId: id, importedAt };
    return p.receipt;
  }
  setAccountScope({ accountId, ownership, businessId = "" }) {
    if (typeof accountId !== "string" || ![...this.state.mouvements, ...this.state.soldes].some((r) => r.data.account_id === accountId)) throw new FinanceError("Compte importé introuvable.");
    if (!["dedicated", "shared", "unknown"].includes(ownership) || typeof businessId !== "string" || businessId.length > 200 || (ownership === "dedicated" && !businessId.trim())) throw new FinanceError("Un compte dédié demande un business explicite.");
    const declaration = { accountId, ownership, businessId: ownership === "dedicated" ? businessId.trim() : "", updatedAt: new Date(this.now()).toISOString() };
    const next = JSON.parse(JSON.stringify(this.state)); next.accountScopes = next.accountScopes.filter((r) => r.accountId !== accountId); next.accountScopes.push(declaration); next.revision++;
    this.save(next); return declaration;
  }
  save(next) {
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 30_000_000) throw new FinanceError("Stockage V1 limité à 30 Mo.", 409);
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.root, `${crypto.randomUUID()}.tmp`);
    try { fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, this.file); }
    catch (error) { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); throw error; }
    this.state = next;
  }
  original(id) {
    const entry = this.state.imports.find((r) => r.id === id);
    if (!entry) throw new FinanceError("Import introuvable.", 404);
    return entry;
  }
}
module.exports = { FinanceService, FinanceError, emptyState };
