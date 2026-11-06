import { useState } from 'react';
import type { Objectif, SourceCalendrier } from './calendrier/api';
import { useCharge } from './donnees/contexte';
import type { Run } from './types';
import type { Source } from './donnees/source';
import { AttenteRun } from './vues/AttenteRun';
import { ControleRun } from './vues/ControleExecution';

const ETATS: Record<string, string> = {
  queued: 'En file', running: 'En cours', paused: 'En pause', waiting_quota: 'Attente de quota',
  waiting_auth: 'Connexion requise', waiting_machine: 'Attente du worker', waiting_approval: 'Décision requise',
  waiting_freshness: 'Base à synchroniser', succeeded: 'Exécution réussie', failed: 'Échoué', cancelled: 'Annulé',
};

export async function chargerActivite(source: Source): Promise<Run[]> {
  // Les attentes anciennes ne doivent pas disparaître derrière les derniers runs terminés.
  const statuts = ['queued', 'running', 'paused', 'waiting_quota', 'waiting_auth', 'waiting_machine', 'waiting_approval', 'waiting_freshness'] as const;
  const listes = await Promise.all([source.runs({ limite: 100 }), ...statuts.map(status => source.runs({ status, limite: 100 }))]);
  return [...new Map(listes.flat().map(run => [run.id, run])).values()]
    .sort((a, b) => Date.parse(b.debut || '') - Date.parse(a.debut || ''));
}

export function titreRun(run: Run, objectifs: Objectif[]): string {
  return objectifs.find(o => o.occurrences.some(occ => occ.runId === run.id))?.titre || run.pipeline;
}

function DetailRun({ id }: { id: string }) {
  const { donnees: run, erreur } = useCharge(s => s.run(id), [id]);
  if (erreur) return <p role="alert">Détail indisponible : {erreur}</p>;
  if (!run) return <p role="status">Chargement du run…</p>;
  return <div className="taskboard-run-detail">
    {run.mission?.objectif && <p>{run.mission.objectif}</p>}
    <AttenteRun key={run.attente?.id ?? run.id} run={run} />
    {run.statut === 'waiting_approval' && <a href="/approbations">Examiner la décision requise</a>}
    <ControleRun run={run} />
    <a href={`/runs/${encodeURIComponent(id)}`}>Ouvrir le graphe, les étapes et les preuves du run</a>
  </div>;
}

/** Les runs restent la source de leur état ; les objectifs donnent le titre de chaque dépôt du groupe. */
export function ActiviteTaskBoard({ calendrier, revision }: { calendrier: SourceCalendrier; revision: number }) {
  const { donnees: runs, erreur } = useCharge(chargerActivite, []);
  const { donnees: objectifs, erreur: erreurObjectifs } = useCharge(() => calendrier.objectifs(), [calendrier, revision]);
  const [selection, setSelection] = useState<string | null>(null);
  const [historique, setHistorique] = useState(false);
  const actifs = (runs ?? []).filter(r => r.vivant || r.livraison && !r.livraison.finale);
  const recents = (runs ?? []).filter(r => !actifs.includes(r)).slice(0, 10);
  const lignes = historique ? [...actifs, ...recents] : actifs;
  const retenus = (objectifs ?? []).filter(o => o.active && (o.nextAt || o.occurrences[0]?.statut === 'queued'));
  return <section className="taskboard-activite" aria-label="Activité des runs">
    <header><h3>Activité des runs</h3><p>{actifs.length} suivi(s) actif(s) · {retenus.length} départ(s) planifié(s) ou en file</p></header>
    <p>Le statut de l’exécution est suivi ici. Les badges des lots décrivent leur avancement validé ; une exécution réussie ne prouve ni une fusion ni une mise en production.</p>
    {erreur && <p role="alert">Runs indisponibles : {erreur}</p>}
    {erreurObjectifs && <p role="alert">Planifications indisponibles : {erreurObjectifs}</p>}
    {!runs && !erreur && <p role="status">Chargement des runs…</p>}
    {runs && !actifs.length && <p>Aucun run ni publication en cours pour le moment.</p>}
    <button type="button" className="av-action" aria-expanded={historique} onClick={() => setHistorique(v => !v)}>{historique ? 'Masquer les derniers résultats' : 'Voir les dix derniers résultats'}</button>
    <ul>{lignes.map(run => <li key={run.id}>
      <div className="taskboard-run-entete"><strong>{titreRun(run, objectifs ?? [])}</strong><span>{run.projet || 'Projet inconnu'} · {ETATS[run.statut] ?? run.statut}</span>
        <button type="button" className="av-action" aria-expanded={selection === run.id} onClick={() => setSelection(id => id === run.id ? null : run.id)}>{selection === run.id ? 'Fermer' : 'Suivre'} le run {run.id.slice(0, 8)}</button></div>
      {run.attente && <p>{run.attente.raison}{run.attente.prochaineReprise ? ` · Nouvelle tentative : ${new Date(run.attente.prochaineReprise).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })} (Europe/Zurich)` : run.attente.raisonManuelle ? ` · ${run.attente.raisonManuelle}` : ''}</p>}
      {run.livraison && <p>Publication : {({ pending: 'à préparer', pr_open: 'PR ouverte', ci_running: 'CI en cours', merge_blocked: 'fusion bloquée', merged: 'fusionnée', failed: 'échouée' })[run.livraison.statut]}{run.livraison.prUrl && <> · <a href={run.livraison.prUrl}>Ouvrir la PR</a></>}{run.livraison.raison && ` · ${run.livraison.raison}`}</p>}
      {selection === run.id && <DetailRun id={run.id} />}
    </li>)}</ul>
  </section>;
}
