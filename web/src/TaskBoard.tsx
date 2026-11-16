// Le Planning : trois onglets dans l'adresse (/taskboard, /taskboard/taches,
// /taskboard/activite). Les trois panneaux restent montés : changer d'onglet garde la semaine,
// les filtres et une tâche en cours de glisser. Une tâche glissée depuis « Tâches » ouvre
// l'onglet Calendrier quand elle survole son onglet, puis se dépose sur un jour.
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { AVenir, AgentsAttribution } from './avenir/AVenir';
import { LOTS, DEFAUTS } from './avenir/feuille';
import objectifsSysteme from './avenir/objectifs.json';
import { sensibiliteEtape } from './avenir/sensibilite';
import { Calendrier } from './calendrier/Calendrier';
import { sourceCalendrierApi, sourceCalendrierMaquette } from './calendrier/api';
import { dateCivile, instantZurich } from './calendrier/semaine';
import { Bouton } from './composants/Bouton';
import { Onglets } from './composants/Onglets';
import { useToasts } from './composants/Toasts';
import { useCharge, useSource } from './donnees/contexte';
import type { PropositionPlan, SpecMission } from './donnees/missions';
import { Icone } from './icones';
import { InterrupteurPrioritaire } from './InterrupteurPrioritaire';
import { EquipeTaches } from './AgentsTache';
import { ActiviteTaskBoard } from './ActiviteTaskBoard';
import { adressePlanning, type OngletPlanning } from './routes';
import './taskboard.css';

type Tache = { type?: string; ref?: string; titre?: string; detail?: string; fichiers?: string[]; commandeId?: string; prevuLe?: string;
  objectif?: { id: string; revision: number; heure: string; nextAt?: string | null; aDeplacer?: boolean } };
type Proposition = { projectId: string; spec: SpecMission; reponse: PropositionPlan; modifie: boolean; index: number | null };
const TACHES = new Map<string, Tache>([
  ...LOTS.flatMap(l => l.etapes.map(e => [e.id, { type: 'fonctionnalite', ref: e.id, titre: e.titre, detail: e.detail }] as const)),
  ...DEFAUTS.map(d => [d.id, { type: 'fix', ref: d.id, titre: d.titre, detail: d.correctif }] as const),
]);
const ALIAS: Record<string, string> = { BP: 'business-pipelines', AO: 'agent-orchestrator', REG: 'agent-registry', AS: 'agent-secrets' };
const TYPE_GLISSE = 'application/x-taskboard-task';
/** Le temps de survol d'un onglet, une tâche en main, avant qu'il s'ouvre. */
const SURVOL_ONGLET_MS = 600;

export function TaskBoard({ onglet, aller }: { onglet: OngletPlanning; aller: (href: string) => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const { donnees: topo } = useCharge(s => s.topologie(), []);
  const { donnees: usage } = useCharge(s => s.usage(), []);
  const calendrier = useMemo(() => source.nom === 'maquette' ? sourceCalendrierMaquette() : sourceCalendrierApi, [source.nom]);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [glissement, setGlissement] = useState(false);
  const [actifs, setActifs] = useState<number | null>(null);
  const [agentsParProjet, setAgentsParProjet] = useState<Record<string, NonNullable<SpecMission['agents']>>>({});
  const panneau = useRef<HTMLElement>(null);
  const verrou = useRef(false);
  const survol = useRef<{ cle: OngletPlanning; minuterie: number } | null>(null);
  const [tache, setTache] = useState<(Tache & { date: string }) | null>(null);
  const [projets, setProjets] = useState<string[]>([]);
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [accepteDegrade, setAccepteDegrade] = useState(false);
  const [prioritaire, setPrioritaire] = useState(false);
  const [sensible, setSensible] = useState(false);
  const groupe = useRef('');
  const tentatives = useRef(new Map<string, string>());
  useEffect(() => { if (tache) panneau.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [tache?.ref, tache?.date]);
  // « Planifiée » dans une tâche renvoie au calendrier par l'ancre de son ancien emplacement.
  useEffect(() => {
    const suivre = () => { if (window.location.hash === '#taskboard-calendrier') aller(adressePlanning('calendrier')); };
    window.addEventListener('hashchange', suivre);
    return () => window.removeEventListener('hashchange', suivre);
  }, [aller]);
  useEffect(() => () => { if (survol.current) window.clearTimeout(survol.current.minuterie); }, []);

  const objectifCatalogue = objectifsSysteme.find(o => o.id === tache?.ref);
  const depotsAnnonces = objectifCatalogue ? depotsDe(objectifCatalogue) : [];
  const depotsIndisponibles = topo ? projets.filter(id => !topo.projets.some(p => p.id === id && p.aFiche && p.pipelines.length)) : [];
  const risque = sensibiliteEtape(objectifCatalogue ?? { fichiers: [] });
  const quota = usage?.quota;
  const quotaTexte = `Claude ${quota?.fournisseurs?.claude ? `${quota.fournisseurs.claude.restant} %` : 'inconnu'} · Codex ${quota?.fournisseurs?.codex ? `${quota.fournisseurs.codex.restant} %` : 'inconnu'}`;
  const ordreTexte = quota?.statut === 'bas' ? 'quota bas : reprises, prioritaires, puis ordre d’arrivée' : quota?.statut === 'normal' ? 'ordre normal' : 'mesure incomplète, ordre normal';

  const nettoyer = () => document.querySelectorAll('.taskboard-drop-cible').forEach(c => c.classList.remove('taskboard-drop-cible'));
  function oublierSurvol() {
    if (survol.current) window.clearTimeout(survol.current.minuterie);
    survol.current = null;
  }
  function terminerGlisser() {
    nettoyer();
    oublierSurvol();
    setGlissement(false);
  }
  function glisser(e: DragEvent<HTMLDivElement>) {
    const cible = (e.target as HTMLElement).closest<HTMLElement>('[data-task-payload]');
    if (!cible || !(e.target as HTMLElement).closest('[draggable="true"]') || (e.target as HTMLElement).closest('button:not(.cal-carte), a:not(.cal-carte), input, select, textarea')) { e.preventDefault(); return; }
    setGlissement(true);
    e.dataTransfer.setData(TYPE_GLISSE, cible.dataset.taskPayload || '');
    e.dataTransfer.effectAllowed = 'move';
  }
  function survoler(e: DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(TYPE_GLISSE)) return;
    const element = e.target as HTMLElement;
    // Survoler un onglet, une tâche en main, l'ouvre après un court instant.
    const cle = element.closest<HTMLElement>('[role="tab"][data-cle]')?.dataset.cle as OngletPlanning | undefined;
    if (cle && cle !== onglet) {
      if (survol.current?.cle !== cle) {
        oublierSurvol();
        survol.current = { cle, minuterie: window.setTimeout(() => { survol.current = null; aller(adressePlanning(cle)); }, SURVOL_ONGLET_MS) };
      }
    } else oublierSurvol();
    const jour = element.closest<HTMLElement>('[data-calendar-date]');
    if (jour) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      nettoyer();
      jour.classList.add('taskboard-drop-cible');
    }
  }
  async function deposer(e: DragEvent<HTMLDivElement>) {
    const date = (e.target as HTMLElement).closest<HTMLElement>('[data-calendar-date]')?.dataset.calendarDate;
    const brut = e.dataTransfer.getData(TYPE_GLISSE);
    terminerGlisser();
    if (!date || !brut || verrou.current || envoi) return;
    e.preventDefault();
    if (date < dateCivile(Date.now()).date) { setMessage('Choisis aujourd’hui ou un jour futur.'); return; }
    let cible: Tache;
    try { cible = JSON.parse(brut); if (!cible || typeof cible !== 'object') throw new Error(); }
    catch { setMessage('Cette tâche ne peut pas être lue.'); return; }
    if (cible.type === 'projet' && cible.objectif || cible.type === 'depart') {
      verrou.current = true; setEnvoi(true); setMessage('');
      try {
        if (cible.type === 'depart' && cible.commandeId && cible.prevuLe) await source.deplacerPlan({ commandeId: cible.commandeId, prevuLe: cible.prevuLe, date });
        else if (cible.objectif) { const o = cible.objectif; await calendrier.modifier(o.id, { revision: o.revision, date, heure: o.nextAt || o.aDeplacer ? o.heure : '00:00', active: true }); }
        setRevision(r => r + 1);
        toasts.succes(`Travail planifié le ${date}, dès que quota et worker sont disponibles.`);
      } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
      finally { verrou.current = false; setEnvoi(false); }
      return;
    }
    ouvrir(cible, date);
  }
  function ouvrir(cible: Tache, date: string) {
    if (date < dateCivile(Date.now()).date) { setMessage('Choisis aujourd’hui ou un jour futur.'); return; }
    const reference = objectifsSysteme.find(o => o.id === cible.ref);
    if (!reference) { setMessage('Cette tâche ne dispose pas encore d’un plan exécutable dans le cockpit.'); return; }
    setTache({ ...cible, fichiers: reference.fichiers, date });
    setProjets(depotsDe(reference)); setAgentsParProjet({});
    setPropositions([]); setMessage(''); setSensible(false); setPrioritaire(false); setAccepteDegrade(false);
    groupe.current = crypto.randomUUID(); tentatives.current.clear();
  }
  async function proposer() {
    if (!tache || !objectifCatalogue) return;
    if (depotsIndisponibles.length) { setMessage(`Plan incomplet : les dépôts ${depotsIndisponibles.join(', ')} doivent être configurés dans le cockpit avant cette planification.`); return; }
    const retenus = projets.filter(id => topo?.projets.some(p => p.id === id && p.aFiche && p.pipelines.length));
    if (!retenus.length) { setMessage('Choisis au moins un dépôt disponible.'); return; }
    setEnvoi(true); setMessage('');
    try {
      const reponses = await Promise.all(retenus.map(async projectId => {
        const spec: SpecMission = { projectId, objectif: `${tache.ref} · ${tache.titre}`, criteres: [(tache.detail || 'Réaliser le changement avec ses preuves de vérification.').slice(0, 950)],
          document: `${tache.detail || ''}\n\nFichiers annoncés : ${objectifCatalogue.fichiers.join(', ')}. Dépôts retenus : ${retenus.join(', ')}.`,
          directives: 'Respecter les instructions du dépôt et produire les preuves de vérification du changement.', exclusions: `Ce run ne modifie que ${projectId}. Les autres dépôts font l’objet des autres plans validés du groupe.`,
          exigences: risque.sensible || sensible ? ['revue-securite'] : [], runtimesExclus: ['omniroute'],
          agents: agentsParProjet[projectId] || [], contexte: { _taskBoardObjective: { id: objectifCatalogue.id, revision: objectifCatalogue.revision } } };
        const reponse = await source.proposerPlan(spec);
        return { projectId, spec, reponse, modifie: false, index: reponse.plan?.pipeline.index ?? null };
      }));
      setPropositions(reponses); setAccepteDegrade(false);
    } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  async function recalculer(p: Proposition) {
    setEnvoi(true); setMessage('');
    try { const reponse = await source.proposerPlan(p.spec); setPropositions(ps => ps.map(x => x.projectId === p.projectId ? { ...p, reponse, modifie: false, index: reponse.plan?.pipeline.index ?? p.index } : x)); setAccepteDegrade(false); }
    catch (err) { setMessage(err instanceof Error ? err.message : String(err)); } finally { setEnvoi(false); }
  }
  async function valider() {
    if (!tache || verrou.current || propositions.some(p => p.modifie || !p.reponse.empreinte)) return;
    verrou.current = true; setEnvoi(true); setMessage('');
    try {
      const missions = propositions.map(p => {
        if (!tentatives.current.has(p.projectId)) tentatives.current.set(p.projectId, crypto.randomUUID());
        return { spec: p.spec, empreinte: p.reponse.empreinte!, requestId: tentatives.current.get(p.projectId)!, accepterDegrade: accepteDegrade,
          scheduling: { source: 'calendar' as const, notBefore: instantZurich(tache.date, '00:00'), priority: prioritaire ? 'haute' as const : 'normale' as const } };
      });
      await source.planifierGroupe({ groupeId: groupe.current, missions });
      toasts.succes(`${propositions.length} tâche(s) planifiée(s) le ${tache.date}.`);
      setRevision(r => r + 1); setTache(null); setPropositions([]);
    } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); } finally { verrou.current = false; setEnvoi(false); }
  }
  function sansGlisser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget), ref = String(f.get('tache')); const cible = TACHES.get(ref);
    if (cible) ouvrir(cible, String(f.get('jour')));
  }
  const bloque = propositions.some(p => p.modifie || !p.reponse.empreinte || p.reponse.statut === 'bloque') || propositions.some(p => p.reponse.statut === 'degrade') && !accepteDegrade;

  return <EquipeTaches><div className={`taskboard-page ${glissement ? 'taskboard-glissement' : ''}`} onDragStart={glisser} onDragEnd={terminerGlisser} onDragOver={survoler} onDrop={e => void deposer(e)}>
    <header className="taskboard-entete">
      <p>Dépose une tâche sur un jour du calendrier, ou clique « Planifier » dans l’onglet Tâches. Les agents démarrent dès que leur quota le permet ; les heures sont celles de Zurich.</p>
      <p className="taskboard-quota" aria-live="polite"><Icone nom="horloge" taille={14} />Quota restant · {quotaTexte} · {ordreTexte}</p>
    </header>

    {message && <p className="taskboard-retour" role="alert"><Icone nom="alerte" taille={16} />{message}</p>}

    {tache && <section ref={panneau} className="taskboard-system-plan" aria-label="Planifier une tâche système">
      <header><h3>Planifier « {tache.titre} » le {tache.date}</h3><Bouton variante="fantome" disabled={envoi} onClick={() => setTache(null)}>Annuler</Bouton></header>
      <label>Journée de départ<input className="ao-champ" type="date" min={dateCivile(Date.now()).date} value={tache.date} disabled={envoi} onChange={e => setTache(t => t ? { ...t, date: e.target.value } : t)} required /></label>
      {!propositions.length ? <>
        <p>Valide le périmètre proposé puis les plans. Tous seront enregistrés ensemble.</p>
        {!!depotsIndisponibles.length && <p role="alert">Plan incomplet : {depotsIndisponibles.join(', ')} non configuré(s) dans le cockpit. Prépare leurs projets et pipelines avant de planifier ce travail ; aucun dépôt ne sera omis.</p>}
        <fieldset disabled={envoi}><legend>Dépôts concernés</legend>{topo?.projets.filter(p => p.aFiche && p.pipelines.length && (!objectifCatalogue?.projet || depotsAnnonces.includes(p.id))).map(p => <label key={p.id}><input type="checkbox" checked={projets.includes(p.id)} onChange={e => setProjets(ids => e.target.checked ? [...ids, p.id] : ids.filter(id => id !== p.id))} />{p.nom}</label>)}</fieldset>
        {!!projets.length && <div className="taskboard-equipes">{projets.filter(id => topo?.projets.some(p => p.id === id && p.aFiche)).map(id => <AgentsAttribution key={id} projectId={id} index={0} titre={`Agents · ${topo?.projets.find(p => p.id === id)?.nom || id}`} choix={agentsParProjet[id] || []} disabled={envoi} onChange={agents => setAgentsParProjet(choix => ({ ...choix, [id]: agents }))} />)}</div>}
        <InterrupteurPrioritaire checked={prioritaire} disabled={envoi} onChange={setPrioritaire} />
        <label className="taskboard-case"><input aria-label="Tâche sensible" type="checkbox" checked={risque.sensible || sensible} disabled={risque.sensible || envoi} onChange={e => setSensible(e.target.checked)} /> Sensible : revue et vérifications renforcées</label>
        <Bouton variante="primaire" disabled={!topo || !projets.length || !tache.date || Boolean(depotsIndisponibles.length)} enCours={envoi} libelleEnCours="Calcul des plans…" onClick={() => proposer()}>Proposer les plans</Bouton>
      </> : <>
        {propositions.map(p => <article key={p.projectId}><h4>{p.reponse.projet?.nom || p.projectId} · {p.reponse.statut}</h4>{p.reponse.blocages.map((b, i) => <p key={i}>{b.message}</p>)}
          {p.reponse.plan && <><p>{p.reponse.plan.pipeline.titre} : {p.reponse.plan.pipeline.raison}</p>{p.reponse.plan.etapes.map(e => <p key={e.noeud}>{e.nom} · {e.llm?.via}:{e.llm?.model}</p>)}<details><summary>Critères et avertissements</summary>{p.reponse.plan.criteres.map(c => <p key={c.texte}>{c.texte}</p>)}{p.reponse.plan.avertissements.map((a, i) => <p key={i}>{a}</p>)}</details></>}
          {p.index !== null && <AgentsAttribution projectId={p.projectId} index={p.index} choix={p.spec.agents || []} disabled={envoi} onChange={agents => setPropositions(ps => ps.map(x => x.projectId === p.projectId ? { ...x, spec: { ...x.spec, agents }, modifie: true } : x))} />}
          {p.modifie && <Bouton disabled={envoi} onClick={() => recalculer(p)}>Appliquer les choix et recalculer le plan</Bouton>}</article>)}
        {propositions.some(p => p.reponse.statut === 'degrade') && <label className="taskboard-case"><input type="checkbox" checked={accepteDegrade} onChange={e => setAccepteDegrade(e.target.checked)} />Accepter tous les plans dégradés</label>}
        <div className="taskboard-boutons">
          <Bouton variante="primaire" disabled={bloque} enCours={envoi} libelleEnCours="Planification…" onClick={() => valider()}>Valider tous les plans et planifier</Bouton>
          <Bouton disabled={envoi} onClick={() => setPropositions([])}>Modifier le périmètre</Bouton>
        </div>
      </>}
    </section>}

    <div className="taskboard-onglets" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) oublierSurvol(); }}>
      <Onglets<OngletPlanning>
        libelle="Planning"
        actif={onglet}
        onChoisir={cle => aller(adressePlanning(cle))}
        onglets={[
          { cle: 'calendrier', libelle: 'Calendrier' },
          { cle: 'taches', libelle: 'Tâches' },
          { cle: 'activite', libelle: 'Activité', compte: actifs ?? undefined },
        ]}
      />
    </div>

    <section role="tabpanel" aria-label="Calendrier" hidden={onglet !== 'calendrier'} className="taskboard-calendrier" id="taskboard-calendrier">
      <Calendrier integre sourceCalendrier={calendrier} revisionExterne={revision} onChangement={() => setRevision(r => r + 1)} />
    </section>
    <section role="tabpanel" aria-label="Tâches" hidden={onglet !== 'taches'} className="taskboard-taches">
      <p className="taskboard-aide"><Icone nom="info" taille={15} />« Planifier » choisit le jour et les dépôts. Pour glisser une tâche, prends-la par sa poignée et survole l’onglet Calendrier : il s’ouvre, dépose-la sur un jour.</p>
      <details className="taskboard-sans-glisser"><summary>Planifier une tâche du catalogue par sa référence</summary><form onSubmit={sansGlisser}><fieldset disabled={envoi}>
        <label>Tâche à planifier<select className="ao-champ" name="tache" required defaultValue=""><option value="" disabled>Choisir une tâche…</option>{objectifsSysteme.map(o => <option key={o.id} value={o.id}>{o.id} · {TACHES.get(o.id)?.titre ?? o.id}</option>)}</select></label>
        <label>Journée<input className="ao-champ" type="date" name="jour" required min={dateCivile(Date.now()).date} defaultValue={dateCivile(Date.now()).date} /></label>
        <Bouton type="submit" variante="primaire">Préparer la planification</Bouton>
      </fieldset></form></details>
      <AVenir integre onPlanifier={ref => { const cible = TACHES.get(ref); if (cible) ouvrir(cible, dateCivile(Date.now()).date); }} sourceCalendrier={calendrier} revisionExterne={revision} onChangement={() => setRevision(r => r + 1)} />
    </section>
    <section role="tabpanel" aria-label="Activité" hidden={onglet !== 'activite'} className="taskboard-activite-panneau">
      <ActiviteTaskBoard calendrier={calendrier} revision={revision} onActifs={setActifs} />
    </section>
  </div></EquipeTaches>;
}

/** Les dépôts d'une tâche du catalogue : son projet et ceux de ses fichiers annoncés (« BP web/… »). */
function depotsDe(reference: { projet?: string | null; fichiers: string[] }): string[] {
  return [...new Set([reference.projet, ...reference.fichiers.flatMap(f => { const a = /^([A-Z]{2,5})\s/.exec(f)?.[1]; return a && ALIAS[a] ? [ALIAS[a]!] : []; })].filter((id): id is string => Boolean(id)))];
}
