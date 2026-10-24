const AGE_MAX_MS = 15 * 60_000;

function etatQuota(store, maintenant = Date.now()) {
  const lignes = store.db.prepare("SELECT ts,payload_json FROM events WHERE type='runtime.quota_snapshot' ORDER BY id DESC LIMIT 100").all();
  const derniers = new Map();
  for (const ligne of lignes) {
    let payload;
    try { payload = JSON.parse(ligne.payload_json); } catch { continue; }
    if (!["claude", "codex"].includes(payload.runtime) || derniers.has(payload.runtime)) continue;
    // La dernière mesure invalide ou périmée rend le fournisseur inconnu : ne pas
    // retomber sur un ancien snapshot encore dans la fenêtre de fraîcheur.
    derniers.set(payload.runtime, null);
    const dateObservation = Date.parse(ligne.ts);
    if (!Number.isFinite(dateObservation) || dateObservation > maintenant || maintenant - dateObservation > AGE_MAX_MS || !Array.isArray(payload.fenetres)) continue;
    const fenetres = payload.fenetres.filter((f) => Number.isFinite(f.restant) && f.restant >= 0 && f.restant <= 100
      && (!f.reinitialisation || Date.parse(f.reinitialisation) > maintenant));
    if (fenetres.length) derniers.set(payload.runtime, { observeLe: ligne.ts, restant: Math.min(...fenetres.map((f) => f.restant)), fenetres });
  }
  const claude = derniers.get("claude") || null;
  const codex = derniers.get("codex") || null;
  if (!claude || !codex) return { statut: "inconnu", claude, codex, restantLePlusBas: null, sousSeuil: false };
  const restantLePlusBas = Math.min(claude.restant, codex.restant);
  return { statut: restantLePlusBas < 25 ? "bas" : "normal", claude, codex, restantLePlusBas, sousSeuil: restantLePlusBas < 25 };
}

module.exports = { etatQuota, AGE_MAX_MS };
