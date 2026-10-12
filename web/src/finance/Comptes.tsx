import { useState } from "react";
import { financeRequest, type Summary } from "./api";
export function Comptes({ data, onSaved }: { data: Summary; onSaved: () => void }) {
  const [accountId, setAccountId] = useState(data.accounts[0] || "");
  const [ownership, setOwnership] = useState("unknown"); const [businessId, setBusinessId] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  if (!data.accounts.length) return null;
  async function save() {
    setBusy(true); setError("");
    try { await financeRequest("accounts/scope", { accountId, ownership, businessId }); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="fin-panel"><details><summary>Attribuer les comptes aux business</summary><p>Un compte partagé ou sans attribution garde une trésorerie business inconnue. Déclare un compte dédié seulement si son solde et tous les mouvements importés appartiennent à ce business. Cette attribution s’applique à tout l’historique importé ; elle ne modélise pas les changements de propriétaire.</p>
    <ul>{data.accounts.map((id) => { const scope = data.accountScopes.find((a) => a.accountId === id); return <li key={id}>{id} : {scope?.ownership === "dedicated" ? `dédié à ${scope.businessId}` : scope?.ownership === "shared" ? "partagé" : "attribution inconnue"}{scope && ` · confirmé le ${new Date(scope.updatedAt).toLocaleString("fr-CH")}`}</li>; })}</ul>
    <div className="fin-form"><label>Compte à attribuer<select value={accountId} disabled={busy} onChange={(e) => { setAccountId(e.target.value); setOwnership("unknown"); setBusinessId(""); }} >{data.accounts.map((id) => <option key={id}>{id}</option>)}</select></label>
    <label>Propriété<select value={ownership} disabled={busy} onChange={(e) => setOwnership(e.target.value)}><option value="unknown">Inconnue</option><option value="shared">Compte partagé</option><option value="dedicated">Dédié à un business</option></select></label>
    {ownership === "dedicated" && <label>Identifiant du business<input list="fin-business-list" value={businessId} disabled={busy} onChange={(e) => setBusinessId(e.target.value)} maxLength={200} /><datalist id="fin-business-list">{data.businesses.map((id) => <option key={id} value={id} />)}</datalist></label>}
    <button type="button" className="fin-primary" disabled={busy || (ownership === "dedicated" && !businessId.trim())} onClick={save}>Confirmer l’attribution</button></div>{error && <p role="alert" className="fin-error">{error}</p>}
  </details></section>;
}
