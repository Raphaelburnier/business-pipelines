// L'onglet Activité du Planning : les runs qui tournent ou attendent, et les publications pas
// encore finales. Chaque ligne s'ouvre sur ses attentes et son arrêt ; « Ouvrir le run » mène
// à sa page.
import { useEffect, useState } from 'react';
import type { Objectif, SourceCalendrier } from './calendrier/api';
import { Bouton } from './composants/Bouton';
import { EtatErreur, EtatVide, Squelette } from './composants/Etats';
import { Statut } from './composants/Statut';
import { suivreLien } from './coquille/Navigation';
import { useCharge } from './donnees/contexte';
import { ton, vivant } from './format';
import { naviguer } from './navigation';
import type { Run } from './types';
import type { Source } from './donnees/source';
import { Erreur } from './ui';
import { AttenteRun } from './vues/AttenteRun';
import { ControleRun } from './vues/ControleExecution';

const ETATS: Record<string, string> = {
  queued: 'En file', running: 'En cours', paused: 'En pause', waiting_quota: 'Attente de quota',
  waiting_auth: 'Connexion requise', waiting_machine: 'Attente du worker', waiting_approval: 'Décision requise',
  waiting_freshness: 'Base à synchroniser', succeeded: 'Exécution réussie', failed: 'Échoué', cancelled: 'Annulé',
};
const PUBLICATION = { pending: 'à préparer', pr_open: 'PR ouverte', ci_running: 'CI en cours', merge_blocked: 'fusion bloquée', merged: 'fusionnée', failed: 'échouée' } as const;

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
  if (erreur) return <Erreur>Détail indisponible : {erreur}</Erreur>;
  if (!run) return <Squelette lignes={2} libelle="Chargement du run…" />;
  return <div className="taskboard-run-detail">
    {run.mission?.objectif && <p>{run.mission.objectif}</p>}
    <AttenteRun key={run.attente?.id ?? run.id} run={run} />
    {run.statut === 'waiting_approval' && <a className="taskboard-lien" href="/decisions" onClick={suivreLien(naviguer, '/decisions')}>Examiner la décision requise</a>}
    <ControleRun run={run} />
  </div>;
}

/** Les runs restent la source de leur état ; les objectifs donnent le titre de chaque dépôt du groupe. */
export function ActiviteTaskBoard({ calendrier, revision, onActifs }: { calendrier: SourceCalendrier; revision: number; onActifs?: (n: number) => void }) {
  const { donnees: runs, erreur, detail, recharger } = useCharge(chargerActivite, []);
  const { donnees: objectifs, erreur: erreurObjectifs, recharger: rechargerObjectifs } = useCharge(() => calendrier.objectifs(), [calendrier, revision]);
  const [selection, setSelection] = useState<string | null>(null);
  const [historique, setHistorique] = useState(false);
  const actifs = (runs ?? []).filter(r => r.vivant || r.livraison && !r.livraison.finale);
  const recents = (runs ?? []).filter(r => !actifs.includes(r)).slice(0, 10);
  const lignes = historique ? [...actifs, ...recents] : actifs;
  const retenus = (objectifs ?? []).filter(o => o.active && (o.nextAt || o.occurrences[0]?.statut === 'queued'));
  const nombreActifs = runs ? actifs.length : null;
  useEffect(() => { if (nombreActifs !== null) onActifs?.(nombreActifs); }, [nombreActifs, onActifs]);

  return <section className="taskboard-activite" aria-label="Activité des runs">
    <header>
      <p className="taskboard-activite-resume">{runs ? `${actifs.length} suivi(s) actif(s)` : 'Runs en lecture'} · {objectifs ? `${retenus.length} départ(s) planifié(s) ou en file` : 'départs en lecture'}</p>
      <p className="taskboard-aide">Le statut de l’exécution est suivi ici. Les badges des lots décrivent leur avancement validé ; une exécution réussie ne prouve ni une fusion ni une mise en production.</p>
    </header>
    {erreur && <EtatErreur titre="Runs indisponibles" message={erreur} detail={detail} onReessayer={recharger} />}
    {erreurObjectifs && <EtatErreur titre="Planifications indisponibles" message={erreurObjectifs} onReessayer={rechargerObjectifs} />}
    {!runs && !erreur && <Squelette lignes={4} libelle="Chargement des runs…" />}
    {runs && !actifs.length && <EtatVide icone="ok" message="Aucun run ni publication en cours pour le moment." detail="Un départ planifié apparaît ici dès qu’il démarre." />}
    {lignes.length > 0 && <ul className="taskboard-activite-liste">{lignes.map(run => {
      const ouvert = selection === run.id;
      const lien = `/run/${encodeURIComponent(run.id)}`;
      return <li key={run.id}>
        <div className="taskboard-run-entete">
          <div className="taskboard-run-titre">
            <strong>{titreRun(run, objectifs ?? [])}</strong>
            <span>{run.projet || 'Projet inconnu'}</span>
          </div>
          <Statut ton={ton(run.statut)} vivant={vivant(run.statut)}>{ETATS[run.statut] ?? run.statut}</Statut>
          <div className="taskboard-run-actions">
            <Bouton taille="petit" variante="fantome" aria-expanded={ouvert} onClick={() => setSelection(ouvert ? null : run.id)}>{ouvert ? 'Masquer' : 'Suivre'} ici</Bouton>
            <a className="taskboard-lien" href={lien} onClick={suivreLien(naviguer, lien)}>Ouvrir le run</a>
          </div>
        </div>
        {run.attente && <p>{run.attente.raison}{run.attente.prochaineReprise ? ` · Nouvelle tentative : ${new Date(run.attente.prochaineReprise).toLocaleString('fr-CH', { timeZone: 'Europe/Zurich' })} (Europe/Zurich)` : run.attente.raisonManuelle ? ` · ${run.attente.raisonManuelle}` : ''}</p>}
        {run.livraison && <p>Publication : {PUBLICATION[run.livraison.statut]}{run.livraison.prUrl && <> · <a className="taskboard-lien" href={run.livraison.prUrl} target="_blank" rel="noreferrer">Ouvrir la PR</a></>}{run.livraison.raison && ` · ${run.livraison.raison}`}</p>}
        {ouvert && <DetailRun id={run.id} />}
      </li>;
    })}</ul>}
    {runs && (actifs.length > 0 || recents.length > 0) && <div><Bouton taille="petit" variante="fantome" aria-expanded={historique} onClick={() => setHistorique(v => !v)}>{historique ? 'Masquer les derniers résultats' : 'Voir les dix derniers résultats'}</Bouton></div>}
  </section>;
}
