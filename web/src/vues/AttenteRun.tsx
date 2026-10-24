import { useState } from "react";
import { useSource } from "../donnees/contexte";
import type { RunDetaille } from "../types";

export function AttenteRun({ run }: { run: RunDetaille }) {
  const { source } = useSource();
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [commande, setCommande] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const attente = run.attente;
  if (!attente) return null;
  const connexion = attente.statut === "waiting_auth";
  const fraicheur = attente.statut === "waiting_freshness";
  const machine = attente.statut === "waiting_machine";
  const enFile = commande || attente.commande;
  async function reprendre() {
    if (!attente) return;
    setEnvoi(true); setErreur(null);
    try { setCommande((await source.reprendreRun(run.id, attente.id, confirmation)).id); }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  return <div className="rounded-lg border-l-4 border-alerte bg-alerte-fond p-3 text-sm">
    <p className="font-semibold">{attente.raison}</p>
    {!fraicheur && !machine && <p className="mt-1 text-xs text-douce">{attente.runtime ?? "runtime inconnu"} · {attente.machine ?? "machine inconnue"} · {attente.compte}</p>}
    {machine && <>
      <p className="mt-2">{attente.prochaineReprise ? "Le même run reprendra quand le worker sera connecté et disponible." : attente.raisonManuelle}</p>
      <p className="mt-1 text-xs text-douce">{attente.tentatives}/{attente.maximum} reprises automatiques · limite : {new Date(attente.limiteLe).toLocaleString("fr-CH")}</p>
    </>}
    {fraicheur && <>
      <p className="mt-2">Le run est suspendu avant l'étape suivante. La branche par défaut n'a pas pu être intégrée ou vérifiée.</p>
      {!!attente.fraicheur?.fichiers && Array.isArray(attente.fraicheur.fichiers) && attente.fraicheur.fichiers.length > 0 && <ul className="mt-2 list-disc pl-5">{attente.fraicheur.fichiers.map((f) => <li key={String(f)}><code>{String(f)}</code></li>)}</ul>}
      <p className="mt-2">Vérifie la fraîcheur du contexte, puis demande explicitement la reprise si elle reste pertinente. Aucune reprise automatique n'est planifiée.</p>
    </>}
    {connexion ? <p className="mt-2">Reconnecte le runtime sur sa machine : <code>{attente.reconnexion ?? "connexion du fournisseur"}</code>. La reprise attend ta confirmation.</p> : !fraicheur && !machine && <>
      <p className="mt-2">{attente.resetAt ? `Échéance fournisseur : ${new Date(attente.resetAt).toLocaleString("fr-CH")}` : attente.prochaineReprise ? "Échéance fournisseur inconnue : nouvelle tentative après un délai de prudence, sans garantie de réinitialisation du quota." : "Échéance fournisseur inconnue : reprise manuelle disponible."}</p>
      <p>{attente.prochaineReprise ? `Prochaine reprise automatique : ${new Date(attente.prochaineReprise).toLocaleString("fr-CH")}` : attente.raisonManuelle}</p>
      <p className="mt-1 text-xs text-douce">{attente.tentatives}/{attente.maximum} reprises automatiques · limite : {new Date(attente.limiteLe).toLocaleString("fr-CH")}</p>
    </>}
    {connexion && !enFile && <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={confirmation} onChange={e => setConfirmation(e.target.checked)} />J'ai reconnecté ce runtime sur cette machine</label>}
    {enFile ? <p role="status" className="mt-3">Reprise mise en file pour ce run.</p> : attente.actions.length > 0 && <button type="button" className="mt-3 rounded border border-accent px-3 py-1.5 font-semibold text-accent disabled:opacity-50" disabled={envoi || (connexion && !confirmation)} onClick={() => void reprendre()}>{envoi ? "Mise en file…" : fraicheur ? "Revérifier et reprendre le run" : "Reprendre le même run"}</button>}
    {erreur && <p role="alert" className="mt-2 text-alerte">{erreur}</p>}
  </div>;
}
