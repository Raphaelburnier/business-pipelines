import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useCharge, useSource } from '../donnees/contexte';

export function ReserveClaude() {
  const { source } = useSource();
  const [revision, recharger] = useState(0);
  const { donnees: etat, erreur: erreurLecture } = useCharge(s => s.reserveQuota?.() ?? Promise.resolve(null), [revision]);
  const [active, activer] = useState(false);
  const [seuil, choisirSeuil] = useState('');
  const [envoi, envoyer] = useState(false);
  const [commande, suivre] = useState<string | null>(null);
  const [erreur, signaler] = useState<string | null>(null);
  const dialogue = useRef<HTMLDialogElement>(null);
  const titre = useId(), champ = useId();
  const attente = commande || etat?.modificationEnCours?.id;
  const verrouille = !etat?.autorise || envoi || Boolean(attente);

  // Le flux est complété par une relecture : une mesure peut devenir périmée sans
  // nouvel événement et la commande doit rester visible après un rechargement.
  useEffect(() => {
    const t = setInterval(() => recharger(v => v + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!attente) return;
    let termine = false;
    const lire = async () => {
      try {
        const c = await source.commande(attente);
        if (termine) return;
        if (['done', 'refused'].includes(c.statut)) {
          suivre(null);
          signaler(c.statut === 'refused' ? c.resultat?.raison || 'Réglage refusé' : null);
          recharger(v => v + 1);
        }
      } catch (err) { if (!termine) signaler(err instanceof Error ? err.message : String(err)); }
    };
    void lire();
    const t = setInterval(() => void lire(), 1000);
    return () => { termine = true; clearInterval(t); };
  }, [attente, source]);

  function ouvrir() {
    activer(etat?.configuration.active ?? false);
    choisirSeuil(etat?.configuration.seuilUtilise?.toString() ?? '');
    signaler(null);
    dialogue.current?.showModal();
  }
  async function enregistrer(e: FormEvent) {
    e.preventDefault();
    if (verrouille || !source.reglerReserveQuota) return;
    const seuilUtilise = seuil.trim() ? Number(seuil) : null;
    if ((active && seuilUtilise === null) || (seuilUtilise !== null && (!Number.isInteger(seuilUtilise) || seuilUtilise < 1 || seuilUtilise > 100))) {
      signaler('Choisis un seuil entier de 1 à 100 % avant d’activer la réserve.'); return;
    }
    envoyer(true); signaler(null);
    try { suivre((await source.reglerReserveQuota({ active, seuilUtilise })).id); }
    catch (err) { signaler(err instanceof Error ? err.message : String(err)); }
    finally { envoyer(false); }
  }
  const libelle = !etat ? 'indisponible' : etat.etat === 'desactive' ? 'désactivée'
    : etat.etat === 'mesure-inconnue' ? 'mesure inconnue · en attente'
    : etat.etat === 'seuil-atteint' ? 'seuil atteint · en attente' : `active · ${etat.configuration.seuilUtilise} %`;
  return <>
    <button type="button" className="ao-kpi" onClick={ouvrir} aria-haspopup="dialog" title="Régler la réserve pour l’usage interactif de Claude">
      <span className="k">réserve Claude</span><span className="v">{attente ? 'modification en attente' : libelle}</span>
    </button>
    <dialog ref={dialogue} aria-labelledby={titre} className="ao-reserve-dialogue">
      <form onSubmit={e => void enregistrer(e)} noValidate>
        <h2 id={titre} className="text-lg font-semibold">Réserve Claude pour ton usage interactif</h2>
        <p className="mt-2 text-sm text-douce">Les runs attendent entre deux étapes quand la consommation de la fenêtre de 5 h atteint ton seuil. L’étape en cours finit normalement.</p>
        <p className="mt-2 text-sm" role="status">État appliqué : {libelle}.</p>
        <fieldset disabled={verrouille} className="mt-4 grid gap-3">
          <label htmlFor={champ}>Consommation maximale des runs (%)</label>
          <input id={champ} type="number" min="1" max="100" step="1" value={seuil} placeholder="Aucun seuil" onChange={e => choisirSeuil(e.target.value)} className="rounded border border-trait bg-carte px-3 py-2" />
          <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={e => activer(e.target.checked)} />Activer la réserve</label>
          <p className="text-sm text-douce">Aucun seuil n’est fixé au départ. Choisis-le avant d’activer. Une mesure absente ou de plus de 15 min met les nouveaux appels Claude en attente.</p>
        </fieldset>
        {!etat?.autorise && <p className="mt-3 text-sm">Réglage réservé à l’opérateur.</p>}
        {attente && <p role="status" className="mt-3 text-sm">Modification en attente d’application…</p>}
        {(erreur || erreurLecture) && <p role="alert" className="mt-3 text-sm text-danger">{erreur || erreurLecture}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={() => dialogue.current?.close()} className="rounded border border-trait px-3 py-2">Fermer</button>
          <button type="submit" disabled={verrouille} className="rounded bg-accent px-3 py-2 text-fond disabled:opacity-50">{envoi ? 'Envoi…' : 'Enregistrer'}</button>
        </div>
      </form>
    </dialog>
  </>;
}
