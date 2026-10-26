import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { AVenir, AgentsAttribution } from './avenir/AVenir';
import { LOTS, DEFAUTS } from './avenir/feuille';
import objectifsSysteme from './avenir/objectifs.json';
import { sensibiliteEtape } from './avenir/sensibilite';
import { Calendrier } from './calendrier/Calendrier';
import { sourceCalendrierApi, sourceCalendrierMaquette, type Objectif } from './calendrier/api';
import { dateCivile, instantZurich } from './calendrier/semaine';
import { useCharge, useSource } from './donnees/contexte';
import type { PropositionPlan, SpecMission } from './donnees/missions';
import { InterrupteurPrioritaire } from './InterrupteurPrioritaire';
import { EquipeTaches } from './AgentsTache';
import './taskboard.css';

type Tache = { type?: string; ref?: string; titre?: string; detail?: string; fichiers?: string[]; commandeId?: string; prevuLe?: string;
  objectif?: { id: string; revision: number; heure: string; nextAt?: string | null; aDeplacer?: boolean } };
type Proposition = { projectId: string; spec: SpecMission; reponse: PropositionPlan; modifie: boolean; index: number | null };
const TACHES = new Map<string,Tache>([...LOTS.flatMap(l=>l.etapes.map(e=>[e.id,{type:'fonctionnalite',ref:e.id,titre:e.titre,detail:e.detail}] as const)),...DEFAUTS.map(d=>[d.id,{type:'fix',ref:d.id,titre:d.titre,detail:d.correctif}] as const)]);
const ALIAS: Record<string,string> = { BP:'business-pipelines', AO:'agent-orchestrator', REG:'agent-registry', AS:'agent-secrets' };

export function TaskBoard() {
  const { source } = useSource();
  const { donnees: topo } = useCharge(s => s.topologie(), []);
  const { donnees: usage } = useCharge(s => s.usage(), []);
  const calendrier = useMemo(() => source.nom === 'maquette' ? sourceCalendrierMaquette() : sourceCalendrierApi, [source.nom]);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [glissement, setGlissement] = useState(false);
  const [agentsParProjet, setAgentsParProjet] = useState<Record<string, NonNullable<SpecMission['agents']>>>({});
  const panneau = useRef<HTMLElement>(null);
  const verrou = useRef(false);
  const [tache, setTache] = useState<(Tache & { date: string }) | null>(null);
  const [projets, setProjets] = useState<string[]>([]);
  const [propositions, setPropositions] = useState<Proposition[]>([]);
  const [accepteDegrade, setAccepteDegrade] = useState(false);
  const [prioritaire, setPrioritaire] = useState(false);
  const [sensible, setSensible] = useState(false);
  const groupe = useRef('');
  const tentatives = useRef(new Map<string,string>());
  useEffect(() => { if(tache) panneau.current?.scrollIntoView({block:'nearest',behavior:'smooth'}); }, [tache?.ref, tache?.date]);
  useEffect(() => {
    if (!topo || !tache || propositions.length) return;
    setProjets(ids => {
      const disponibles = ids.filter(id => topo.projets.some(p => p.id === id && p.aFiche && p.pipelines.length));
      return disponibles.length === ids.length ? ids : disponibles;
    });
  }, [topo, tache?.ref, propositions.length]);
  const objectifCatalogue = objectifsSysteme.find(o => o.id === tache?.ref);
  const depotsAnnonces = objectifCatalogue ? [...new Set([objectifCatalogue.projet, ...objectifCatalogue.fichiers.flatMap(f => { const a=/^([A-Z]{2,5})\s/.exec(f)?.[1]; return a && ALIAS[a] ? [ALIAS[a]!] : []; })].filter((id): id is string => Boolean(id)))] : [];
  const risque = sensibiliteEtape(objectifCatalogue ?? { fichiers: [] });
  const quota = usage?.quota;
  const quotaTexte = `Quota restant · Claude ${quota?.fournisseurs?.claude ? `${quota.fournisseurs.claude.restant}%` : 'inconnu'} · Codex ${quota?.fournisseurs?.codex ? `${quota.fournisseurs.codex.restant}%` : 'inconnu'} · ${quota?.statut === 'bas' ? 'reprises, prioritaires, puis FIFO (<25 %)' : quota?.statut === 'normal' ? 'ordre normal' : 'mesure incomplète, ordre normal'}.`;
  const nettoyer = () => document.querySelectorAll('.taskboard-drop-cible').forEach(c => c.classList.remove('taskboard-drop-cible'));
  function glisser(e: DragEvent<HTMLDivElement>) {
    const cible = (e.target as HTMLElement).closest<HTMLElement>('[data-task-payload]');
    if (!cible || !(e.target as HTMLElement).closest('[draggable="true"]') || (e.target as HTMLElement).closest('button:not(.cal-carte), a:not(.cal-carte), input, select, textarea')) { e.preventDefault(); return; }
    setGlissement(true);
    e.dataTransfer.setData('application/x-taskboard-task', cible.dataset.taskPayload || '');
    e.dataTransfer.effectAllowed = 'move';
  }
  async function deposer(e: DragEvent<HTMLDivElement>) {
    const date = (e.target as HTMLElement).closest<HTMLElement>('[data-calendar-date]')?.dataset.calendarDate;
    const brut = e.dataTransfer.getData('application/x-taskboard-task'); nettoyer(); setGlissement(false);
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
        else if (cible.objectif) { const o = cible.objectif; await calendrier.modifier(o.id, { revision:o.revision, date, heure:o.nextAt || o.aDeplacer ? o.heure : '00:00', active:true }); }
        setRevision(r => r+1); setMessage(`Travail planifié le ${date}, dès que quota et worker sont disponibles.`);
      } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
      finally { verrou.current=false; setEnvoi(false); }
      return;
    }
    ouvrir(cible,date);
  }
  function ouvrir(cible: Tache,date: string) {
    if (date<dateCivile(Date.now()).date) {setMessage('Choisis aujourd’hui ou un jour futur.');return;}
    const reference = objectifsSysteme.find(o => o.id === cible.ref);
    if (!reference) { setMessage('Cette tâche est terminée, en cours ou périmée : recharge le tableau.'); return; }
    const ids = [...new Set([reference.projet, ...reference.fichiers.flatMap(f => { const a=/^([A-Z]{2,5})\s/.exec(f)?.[1]; return a && ALIAS[a] ? [ALIAS[a]!] : []; })].filter((id): id is string => Boolean(id)))];
    setTache({ ...cible, fichiers:reference.fichiers, date });
    setProjets(ids); setAgentsParProjet({});
    setPropositions([]); setMessage(''); setSensible(false); setPrioritaire(false); setAccepteDegrade(false);
    groupe.current=crypto.randomUUID(); tentatives.current.clear();
  }
  async function proposer() {
    if (!tache || !objectifCatalogue) return;
    const retenus = projets.filter(id => topo?.projets.some(p => p.id === id && p.aFiche && p.pipelines.length));
    if (!retenus.length) { setMessage('Choisis au moins un dépôt disponible.'); return; }
    setEnvoi(true); setMessage('');
    try {
      const reponses = await Promise.all(retenus.map(async projectId => {
        const spec: SpecMission = { projectId, objectif:`${tache.ref} · ${tache.titre}`, criteres:[(tache.detail || 'Réaliser le changement avec ses preuves de vérification.').slice(0,950)],
          document:`${tache.detail || ''}\n\nFichiers annoncés : ${objectifCatalogue.fichiers.join(', ')}. Dépôts retenus : ${retenus.join(', ')}.`,
          directives:'Respecter les instructions du dépôt et produire les preuves de vérification du changement.', exclusions:`Ce run ne modifie que ${projectId}. Les autres dépôts font l’objet des autres plans validés du groupe.`,
          exigences:risque.sensible || sensible ? ['revue-securite'] : [], runtimesExclus:['omniroute'],
          agents: agentsParProjet[projectId] || [], contexte:{_taskBoardObjective:{id:objectifCatalogue.id,revision:objectifCatalogue.revision}} };
        const reponse=await source.proposerPlan(spec);
        return {projectId,spec,reponse,modifie:false,index:reponse.plan?.pipeline.index??null};
      }));
      setPropositions(reponses); setAccepteDegrade(false);
    } catch(err) {setMessage(err instanceof Error ? err.message : String(err));}
    finally{setEnvoi(false);}
  }
  async function recalculer(p: Proposition) {
    setEnvoi(true); setMessage('');
    try {const reponse=await source.proposerPlan(p.spec); setPropositions(ps=>ps.map(x=>x.projectId===p.projectId?{...p,reponse,modifie:false,index:reponse.plan?.pipeline.index??p.index}:x));setAccepteDegrade(false);}
    catch(err){setMessage(err instanceof Error ? err.message : String(err));} finally{setEnvoi(false);}
  }
  async function valider() {
    if (!tache || verrou.current || propositions.some(p=>p.modifie || !p.reponse.empreinte)) return;
    verrou.current=true; setEnvoi(true);setMessage('');
    try {
      const missions=propositions.map(p=>{if(!tentatives.current.has(p.projectId))tentatives.current.set(p.projectId,crypto.randomUUID());return {spec:p.spec,empreinte:p.reponse.empreinte!,requestId:tentatives.current.get(p.projectId)!,accepterDegrade:accepteDegrade,scheduling:{source:'calendar' as const,notBefore:instantZurich(tache.date,'00:00'),priority:prioritaire?'haute' as const:'normale' as const}};});
      await source.planifierGroupe({groupeId:groupe.current,missions});
      setMessage(`${propositions.length} tâche(s) planifiée(s) le ${tache.date}.`);setRevision(r=>r+1);setTache(null);setPropositions([]);
    }catch(err){setMessage(err instanceof Error?err.message:String(err));}finally{verrou.current=false;setEnvoi(false);}
  }
  function sansGlisser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();const f=new FormData(e.currentTarget),ref=String(f.get('tache'));const cible=TACHES.get(ref);
    if(cible)ouvrir(cible,String(f.get('jour')));
  }
  return <EquipeTaches><div className={`taskboard-page ${glissement ? "taskboard-glissement" : ""}`} onDragStart={glisser} onDragEnd={()=>{nettoyer();setGlissement(false);}} onDragOver={e=>{const j=(e.target as HTMLElement).closest<HTMLElement>('[data-calendar-date]');if(j && e.dataTransfer.types.includes('application/x-taskboard-task')){e.preventDefault();e.dataTransfer.dropEffect='move';nettoyer();j.classList.add('taskboard-drop-cible');}}} onDrop={e=>void deposer(e)}>
    <header className="taskboard-entete"><div><p className="kicker">Planification · Europe/Zurich</p><h2>Planifier le travail</h2><p>Depuis la poignée « Glisser », dépose une tâche sur un jour. Les agents démarrent dès que leur quota le permet.</p><p className="taskboard-quota" aria-live="polite">{quotaTexte}</p></div></header>
    <details className="taskboard-system-plan"><summary>Planifier une tâche sans glisser</summary><form onSubmit={sansGlisser}><fieldset disabled={envoi}>
      <label>Tâche à planifier<select name="tache" required defaultValue=""><option value="" disabled>Choisir une tâche…</option>{objectifsSysteme.map(o=><option key={o.id} value={o.id}>{o.id} · {TACHES.get(o.id)?.titre ?? o.id}</option>)}</select></label>
      <label>Journée<input type="date" name="jour" required min={dateCivile(Date.now()).date} defaultValue={dateCivile(Date.now()).date}/></label><button type="submit">Préparer la planification</button>
    </fieldset></form></details>
    {message && <p className="taskboard-retour" role="status">{message}</p>}
    {tache && <section ref={panneau} className="taskboard-system-plan" aria-label="Planifier une tâche système"><header><h3>Planifier « {tache.titre} » le {tache.date}</h3><button type="button" disabled={envoi} onClick={()=>setTache(null)}>Annuler</button></header>
      {!propositions.length ? <><p>Valide le périmètre proposé puis les plans. Tous seront enregistrés ensemble.</p><fieldset disabled={envoi}><legend>Dépôts concernés</legend>{topo?.projets.filter(p=>p.aFiche && p.pipelines.length && (!objectifCatalogue?.projet || depotsAnnonces.includes(p.id))).map(p=><label key={p.id}><input type="checkbox" checked={projets.includes(p.id)} onChange={e=>setProjets(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>{p.nom}</label>)}</fieldset>
        {!!projets.length && <div className="taskboard-equipes">{projets.filter(id=>topo?.projets.some(p=>p.id===id&&p.aFiche)).map(id=><AgentsAttribution key={id} projectId={id} index={0} titre={`Agents · ${topo?.projets.find(p=>p.id===id)?.nom || id}`} choix={agentsParProjet[id] || []} disabled={envoi} onChange={agents=>setAgentsParProjet(choix=>({...choix,[id]:agents}))}/>)}</div>}
        <InterrupteurPrioritaire checked={prioritaire} disabled={envoi} onChange={setPrioritaire}/><label className="taskboard-case"><input aria-label="Tâche sensible" type="checkbox" checked={risque.sensible||sensible} disabled={risque.sensible||envoi} onChange={e=>setSensible(e.target.checked)}/> Sensible — revue et vérifications renforcées</label>
        <button type="button" disabled={envoi||!topo||!projets.length} onClick={()=>void proposer()}>Proposer les plans</button></> : <>
        {propositions.map(p=><article key={p.projectId}><h4>{p.reponse.projet?.nom||p.projectId} · {p.reponse.statut}</h4>{p.reponse.blocages.map((b,i)=><p key={i}>{b.message}</p>)}
          {p.reponse.plan && <><p>{p.reponse.plan.pipeline.titre} — {p.reponse.plan.pipeline.raison}</p>{p.reponse.plan.etapes.map(e=><p key={e.noeud}>{e.nom} · {e.llm?.via}:{e.llm?.model}</p>)}<details><summary>Critères et avertissements</summary>{p.reponse.plan.criteres.map(c=><p key={c.texte}>{c.texte}</p>)}{p.reponse.plan.avertissements.map((a,i)=><p key={i}>{a}</p>)}</details></>}
          {p.index!==null && <AgentsAttribution projectId={p.projectId} index={p.index} choix={p.spec.agents||[]} disabled={envoi} onChange={agents=>setPropositions(ps=>ps.map(x=>x.projectId===p.projectId?{...x,spec:{...x.spec,agents},modifie:true}:x))}/>}
          {p.modifie && <button type="button" disabled={envoi} onClick={()=>void recalculer(p)}>Appliquer les choix et recalculer le plan</button>}</article>)}
        {propositions.some(p=>p.reponse.statut==='degrade') && <label><input type="checkbox" checked={accepteDegrade} onChange={e=>setAccepteDegrade(e.target.checked)}/>Accepter tous les plans dégradés</label>}
        <button type="button" disabled={envoi||propositions.some(p=>p.modifie||!p.reponse.empreinte||p.reponse.statut==='bloque')||propositions.some(p=>p.reponse.statut==='degrade')&&!accepteDegrade} onClick={()=>void valider()}>Valider tous les plans et planifier</button><button type="button" disabled={envoi} onClick={()=>setPropositions([])}>Modifier le périmètre</button></>}
    </section>}
    <div className="taskboard-grille"><section className="taskboard-calendrier" id="taskboard-calendrier" aria-label="Calendrier des runs"><div className="taskboard-cal-titre"><h3>Calendrier</h3><p>Glisser une tâche sur une journée</p></div><Calendrier integre sourceCalendrier={calendrier} revisionExterne={revision} onChangement={()=>setRevision(r=>r+1)}/></section><aside className="taskboard-taches" aria-label="Tâches à venir"><AVenir integre sourceCalendrier={calendrier} revisionExterne={revision} onChangement={()=>setRevision(r=>r+1)}/></aside></div>
  </div></EquipeTaches>;
}
