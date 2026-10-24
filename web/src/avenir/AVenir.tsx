// « À venir » : toutes les tâches au même endroit, filtrables. La feuille de route et les défauts
// vivent dans feuille.ts (une PR qui avance un point met son statut à jour) ; les tâches des
// projets sont les objectifs de l'atelier, ceux du calendrier.
import "./avenir.css";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { dateCivile, FUSEAU, instantZurich } from "../calendrier/semaine";
import { useCharge, useSource } from "../donnees/contexte";
import { lignes, type OptionsMission, type PropositionPlan, type SpecMission } from "../donnees/missions";
import type { AttributionAvenir } from "../donnees/source";
import { type Objectif, type SourceCalendrier, sourceCalendrierApi, sourceCalendrierMaquette } from "../calendrier/api";
import { Planifier } from "../calendrier/Calendrier";
import { MOT_REPETITION } from "../calendrier/semaine";
import { DATE_AUDIT, DEFAUTS, LOTS_PRIORISES, PRIORITES, SUGGESTIONS, estAttribuable, projetObjectif, revisionObjectif, type Etape, type Statut } from "./feuille";
import { compter, construireTaches, filtrer, FILTRE_DEFAUT, parSeverite, projetsDisponibles, type Filtre, type Tache } from "./taches";
import { sensibiliteEtape } from "./sensibilite";
import { InterrupteurPrioritaire } from "../InterrupteurPrioritaire";



const MOT_STATUT: Record<Statut, string> = { "a-faire": "à faire", "en-cours": "en cours", fait: "fait" };

function Pastille({ statut }: { statut: Statut }) {
  return <span className={`av-statut ${statut}`}>{MOT_STATUT[statut]}</span>;
}

const STATUT_ATTRIBUTION: Record<string, string> = {
  queued: "en file", running: "en cours", waiting_quota: "en attente de quota", waiting_machine: "en attente du worker", waiting_freshness: "base à synchroniser",
  waiting_approval: "en attente d'arbitrage", waiting_auth: "en attente d'authentification", paused: "en pause", succeeded: "terminé", completed: "terminé", failed: "échoué",
  cancelled: "annulé", review: "en revue",
};

const PREFIXES: Record<string, string> = { "business-pipelines": "BP ", "agent-orchestrator": "AO " };
const prefixeDepot = (projectId: string) => PREFIXES[projectId] ?? `${projectId} `;

// Pas de choix de runtime : un pipeline de développement planifie et relit avec Claude et code
// avec Codex. Exclure l'un des deux bloquait le plan ; le planificateur choisit étape par étape.
export function construireSpecAttribution(etape: Etape, projectId: string, criteres: string[], sensibleManuel = false): SpecMission {
  const ailleurs = etape.fichiers.filter((f) => !f.startsWith(prefixeDepot(projectId)));
  const sensibilite = sensibiliteEtape(etape);
  return {
    projectId, objectif: `${etape.titre} — ${etape.detail}`, criteres,
    document: `${etape.detail}\n\nFichiers annoncés : ${etape.fichiers.join(", ")}.${sensibilite.sensible ? `\n\nSensibilité :\n${sensibilite.raisons.join("\n")}` : ""}`,
    directives: "Respecter les instructions du dépôt et produire une PR vérifiable.",
    exclusions: ailleurs.length ? `Ce run ne modifie que ${projectId}. Hors périmètre, à traiter dans une autre mission : ${ailleurs.join(", ")}.` : "",
    exigences: sensibilite.sensible || sensibleManuel ? ["revue-securite"] : [], runtimesExclus: ["omniroute"],
    contexte: { _roadmapObjective: { id: etape.id, revision: revisionObjectif(etape.id) ?? 1 } },
  };
}

type ChoixAgents = NonNullable<SpecMission["agents"]>;

export function AgentsAttribution({ projectId, index, choix, onChange, disabled }: {
  projectId: string; index: number; choix: ChoixAgents; onChange: (choix: ChoixAgents) => void; disabled: boolean;
}) {
  const { source } = useSource();
  const [options, setOptions] = useState<OptionsMission | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let annule = false;
    setOptions(null); setErreur(null);
    source.preparerMission(projectId, index).then((o) => { if (!annule) setOptions(o); })
      .catch((err: unknown) => { if (!annule) setErreur(err instanceof Error ? err.message : String(err)); });
    return () => { annule = true; };
  }, [source, projectId, index]);
  return <fieldset className="av-choix-agents" disabled={disabled}>
    <legend>Agents du plan</legend>
    <p>Le choix automatique tient compte des disponibilités. Un agent choisi explicitement doit être disponible pour lancer le run.</p>
    {erreur && <p role="status">Choix des agents indisponible : {erreur}</p>}
    {!options && !erreur && <p>Chargement des agents compatibles…</p>}
    {options?.roles.map((r) => <label key={r.noeud}>{r.noeud}{r.type === "review" ? " · revue indépendante" : ""}
      <select value={choix.find((c) => c.noeud === r.noeud)?.membre ?? ""} onChange={(e) => {
        const autres = choix.filter((c) => c.noeud !== r.noeud);
        onChange(e.target.value ? [...autres, { noeud: r.noeud, membre: e.target.value }] : autres);
      }}>
        <option value="">Automatique — orchestrateur</option>
        {r.membres.map((m) => <option key={m.id} value={m.id}>{m.nom} · {m.role} · {m.llm.via}</option>)}
      </select>
    </label>)}
  </fieldset>;
}

export function expliquerConflitAttribution(message: string): string {
  return /déjà attribué|objectif.*actif|OBJECTIF_OCCUPE/i.test(message)
    ? "Cet objectif vient d'être pris par un autre run. Son attribution affichée ci-dessus va être actualisée."
    : message;
}

function Attribution({ etape, attribution, projetNom, agentNom, onRefresh }: {
  etape: Etape;
  attribution: AttributionAvenir;
  projetNom: string;
  agentNom: string;
  onRefresh: () => void;
}) {
  const projectId = projetObjectif(etape.id);
  const { source } = useSource();
  const [ouvert, setOuvert] = useState(false);
  const [proposition, setProposition] = useState<{ spec: SpecMission; reponse: PropositionPlan } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [attente, setAttente] = useState(false);
  const [sensibleManuel, setSensibleManuel] = useState(false);
  const [choixAgents, setChoixAgents] = useState<ChoixAgents>([]);
  const [choixModifies, setChoixModifies] = useState(false);
  const [indexAgents, setIndexAgents] = useState<number | null>(null);
  const [accepteDegrade, setAccepteDegrade] = useState(false);
  const [priorite, setPriorite] = useState<"haute" | "normale">(attribution.priorite === "haute" ? "haute" : "normale");
  const [reclassement, setReclassement] = useState(false);
  const [commandeId, setCommandeId] = useState<string | null>(null);
  // « Planifier » place le départ dans le calendrier au lieu de le lancer tout de suite (11.5).
  const [quand, setQuand] = useState<{ planifie: boolean; date: string; heure: string }>(() => {
    const demain = dateCivile(Date.now() + 86_400_000);
    return { planifie: false, date: demain.date, heure: "" };
  });
  const tentative = useRef<{ empreinte: string; requestId: string } | null>(null);
  async function proposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = new FormData(event.currentTarget);
    const criteres = lignes(String(formulaire.get("criteres") || ""));
    if (!projectId) return;
    if (!criteres.length) { setErreur("Renseigne au moins un critère."); return; }
    const spec = construireSpecAttribution(etape, projectId, criteres, sensibleManuel);
    setChoixAgents([]); setChoixModifies(false); setIndexAgents(null);
    setErreur(null); setAttente(true);
    try {
      const reponse = await source.proposerPlan(spec);
      setProposition({ spec, reponse }); setIndexAgents(reponse.plan?.pipeline.index ?? null); setAccepteDegrade(false);
    }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setAttente(false); }
  }

  async function recalculer() {
    if (!proposition) return;
    const spec = { ...proposition.spec, agents: choixAgents };
    setErreur(null); setAttente(true);
    try {
      const reponse = await source.proposerPlan(spec);
      setProposition({ spec, reponse });
      if (reponse.plan) setIndexAgents(reponse.plan.pipeline.index);
      setChoixModifies(false); setAccepteDegrade(false); tentative.current = null;
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setAttente(false); }
  }

  async function lancer() {
    if (!proposition?.reponse.empreinte || choixModifies) return;
    let notBefore: string | undefined;
    try { notBefore = quand.planifie ? instantZurich(quand.date, quand.heure || "00:00") : undefined; }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); return; }
    setErreur(null); setAttente(true);
    try {
      const empreinte = proposition.reponse.empreinte;
      if (tentative.current?.empreinte !== empreinte) tentative.current = { empreinte, requestId: crypto.randomUUID() };
      await source.lancerPlan({ spec: proposition.spec, empreinte: proposition.reponse.empreinte,
        requestId: tentative.current.requestId, accepterDegrade: accepteDegrade,
        scheduling: notBefore ? { priority: priorite, source: "calendar", notBefore } : { priority: priorite } });
      setCommandeId("envoyée");
      setOuvert(false);
      onRefresh();
      setProposition(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErreur(expliquerConflitAttribution(message));
      onRefresh();
    } finally { setAttente(false); }
  }

  async function reclasser(nouvelle: "haute" | "normale") {
    setErreur(null); setReclassement(true);
    try {
      await source.reclasserObjectif(etape.id, nouvelle);
      setPriorite(nouvelle);
      onRefresh();
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); onRefresh(); }
    finally { setReclassement(false); }
  }

  const plan = proposition?.reponse;
  const indisponible = ["queued", "running", "paused", "waiting_quota", "waiting_machine", "waiting_freshness", "waiting_approval", "waiting_auth", "review"].includes(attribution.statut);
  return <div className="av-attribution">
    <div className="av-attribution-meta">
      <span>{agentNom}</span><span>{projetNom}</span>
      {attribution.runId ? <a href={`/runs/${encodeURIComponent(attribution.runId)}`}>Run {attribution.runId.slice(0, 8)}</a> : <span>Commande {attribution.commandeId.slice(0, 8)}</span>}
      <span className={`av-statut ${indisponible ? "en-cours" : attribution.statut === "failed" ? "a-faire" : "fait"}`}>{STATUT_ATTRIBUTION[attribution.statut] ?? attribution.statut}</span>
      {attribution.prevuLe && !attribution.runId && <a href="/calendrier">Prévu le {new Date(attribution.prevuLe).toLocaleString("fr-CH", { timeZone: FUSEAU, dateStyle: "medium", timeStyle: "short" })}</a>}
      {attribution.positionFile != null && <span>Objectifs #{attribution.positionFile}</span>}
      <span>{attribution.priorite === "haute" ? "Prioritaire" : "Non prioritaire"}</span>
    </div>
    {attribution.statut === "waiting_quota" && attribution.attente?.commandeStatut === "pending" && attribution.attente.commandeAutomatique && <p className="av-file-attente">Reprise automatique en file{attribution.attente.runtime ? ` · ${attribution.attente.runtime}` : ""}</p>}
    {attribution.statut === "waiting_quota" && attribution.attente?.commandeStatut === "pending" && !attribution.attente.commandeAutomatique && <p className="av-file-attente">Reprise manuelle en file{attribution.attente.runtime ? ` · ${attribution.attente.runtime}` : ""}</p>}
    {attribution.statut === "waiting_quota" && attribution.attente?.commandeStatut === "taken" && <p className="av-file-attente">{attribution.attente.commandeAutomatique ? "Reprise automatique en cours" : "Reprise manuelle en cours"}{attribution.attente.runtime ? ` · ${attribution.attente.runtime}` : ""}</p>}
    {attribution.statut === "waiting_quota" && !attribution.attente?.commandeStatut && <p className="av-file-attente">Quota atteint{attribution.attente?.runtime ? ` · ${attribution.attente.runtime}` : ""}{attribution.attente?.prochaineReprise ? ` · reprise automatique prévue ${new Date(attribution.attente.prochaineReprise).toLocaleString("fr-CH")}` : " · aucune reprise automatique planifiée"}</p>}
    {attribution.attente?.raisonManuelle && <p className="av-attribution-erreur">Reprise manuelle requise : {attribution.attente.raisonManuelle}</p>}
    {attribution.raison && <p className="av-attribution-erreur">{attribution.raison}</p>}
    {attribution.reclassable && <InterrupteurPrioritaire libelleAccessible={`Run prioritaire ${etape.id}`} checked={priorite === "haute"} disabled={reclassement} onChange={(prioritaire) => void reclasser(prioritaire ? "haute" : "normale")} />}
    {commandeId && <p role="status">{quand.planifie ? <>Mission planifiée : elle apparaît dans le <a href="/calendrier">calendrier</a> et partira à l'heure dite.</> : "Mission envoyée au cockpit. L'attribution se mettra à jour avec le prochain événement."}</p>}
    {!projectId && <p className="av-attribution-erreur">Touche plusieurs dépôts ou un dépôt hors du cockpit : à traiter à la main.</p>}
    {projectId && etape.statut === "a-faire" && !indisponible && <button type="button" className="av-action" onClick={() => { setOuvert((v) => !v); setProposition(null); setErreur(null); setCommandeId(null); }}>
      {ouvert ? "Fermer" : attribution.statut === "failed" || attribution.statut === "cancelled" ? "Relancer l'objectif" : "Attribuer"}
    </button>}
    {erreur && <p className="av-attribution-erreur" role="alert">{erreur}</p>}
    {ouvert && etape.statut === "a-faire" && !indisponible && !proposition && !commandeId && <form className="av-form" onSubmit={proposer}>
      <p className="av-form-depot">Dépôt : <code>{projectId}</code></p>
      <p className="av-form-depot">Le plan propose les agents ; tu peux ensuite les choisir pour chaque rôle.</p>
      <label><input type="checkbox" checked={sensibiliteEtape(etape).sensible || sensibleManuel} disabled={sensibiliteEtape(etape).sensible} onChange={(e) => setSensibleManuel(e.target.checked)} /> Sensible — revue de sécurité et vérifications renforcées</label>
      {sensibiliteEtape(etape).sensible && <p className="av-form-depot">Imposé par les fichiers annoncés ou le risque du cadrage. Le serveur revérifie cette exigence.</p>}
      <InterrupteurPrioritaire checked={priorite === "haute"} onChange={(prioritaire) => setPriorite(prioritaire ? "haute" : "normale")} />
      <label className="av-form-criteres">Critères de réussite<textarea name="criteres" required defaultValue={`Le changement répond à l'objectif « ${etape.titre} ».\nLes vérifications pertinentes passent et les résultats sont documentés.`} rows={3} /></label>
      <button type="submit" disabled={attente}>{attente ? "Préparation du plan…" : "Proposer le plan"}</button>
    </form>}
    {plan && <section className="av-plan" aria-live="polite"><b>{plan.statut === "bloque" ? "Plan bloqué" : "Plan proposé"}{plan.projet ? ` · ${plan.projet.nom}` : ""}</b>
      {plan.blocages.map((b, i) => <p key={i}>{b.message}</p>)}
      {plan.plan?.etapes.map((e) => <p key={e.noeud}>{e.nom} · {e.llm?.via}:{e.llm?.model}</p>)}
      {indexAgents !== null && <>
        <AgentsAttribution projectId={projectId!} index={indexAgents} choix={choixAgents} disabled={attente} onChange={(choix) => { setChoixAgents(choix); setChoixModifies(true); }} />
        {choixModifies && <button type="button" disabled={attente} onClick={() => void recalculer()}>{attente ? "Recalcul du plan…" : "Appliquer les choix et recalculer le plan"}</button>}
      </>}
      {plan.plan && <details><summary>Critères vérifiés par le plan</summary><ul>{plan.plan.criteres.map((c) => <li key={c.texte}>{c.texte}</li>)}</ul></details>}
      {plan.statut === "degrade" && <label><input type="checkbox" checked={accepteDegrade} onChange={(e) => setAccepteDegrade(e.target.checked)} /> Accepter ce plan dégradé</label>}
      {plan.statut !== "bloque" && <fieldset className="av-quand">
        <legend>Départ</legend>
        <label><input type="radio" name={`quand-${etape.id}`} checked={!quand.planifie} onChange={() => setQuand({ ...quand, planifie: false })} /> Tout de suite</label>
        <label><input type="radio" name={`quand-${etape.id}`} checked={quand.planifie} onChange={() => setQuand({ ...quand, planifie: true })} /> Planifier</label>
        {quand.planifie && <>
          <label>Date<input type="date" value={quand.date} min={dateCivile(Date.now()).date} onChange={(e) => setQuand({ ...quand, date: e.target.value })} /></label>
          <label>Heure ({FUSEAU}, facultative : minuit si vide)<input type="time" value={quand.heure} onChange={(e) => setQuand({ ...quand, heure: e.target.value })} /></label>
        </>}
      </fieldset>}
      {plan.statut !== "bloque" && <button type="button" disabled={attente || choixModifies || (plan.statut === "degrade" && !accepteDegrade) || (quand.planifie && !quand.date)} onClick={lancer}>{attente ? "Envoi…" : quand.planifie ? "Planifier la mission" : "Lancer la mission"}</button>}
      <button type="button" disabled={attente} onClick={() => { setProposition(null); tentative.current = null; }}>Modifier la mission</button>
    </section>}
  </div>;
}

function EtapeLigne({ e, attribution, projetNom, onRefresh, reservations = [] }: { reservations?: Objectif[]; e: Etape; attribution: AttributionAvenir | undefined; projetNom: string; onRefresh: () => void }) {
  const sensibilite = sensibiliteEtape(e);
  return <li id={`av-etape-${e.id}`} draggable={e.statut === "a-faire" && !reservations.length} data-task-payload={JSON.stringify({ type: "fonctionnalite", titre: e.titre, detail: e.detail, ref: e.id, fichiers: e.fichiers })}>
    <div className="av-ligne">
      <b>{e.id}</b>
      <span className="av-titre">{e.titre}</span>
      {sensibilite.sensible && <span className="av-sensible" title={`Revue de sécurité demandée. ${sensibilite.raisons.join(" ")} La fusion explicite dépend des fichiers réellement modifiés.`}>sensible</span>}
      <Pastille statut={e.statut} />
    </div>
    <p>{e.detail}</p>
    {!!reservations.length && <p>Planifiée pour {reservations.map(o=>`${o.projectId} (${o.date})`).join(", ")} · <a href="#taskboard-calendrier">Voir dans le calendrier</a></p>}
    {attribution && <Attribution etape={e} attribution={attribution} onRefresh={onRefresh} projetNom={projetNom} agentNom={attribution.agent?.nom ?? "Agent inconnu"} />}
    {estAttribuable(e) && !attribution && !reservations.length && <Attribution etape={e} onRefresh={onRefresh} attribution={{ objectif: { id: e.id, revision: revisionObjectif(e.id) ?? 1 }, commandeId: "", runId: null, projetId: "", agent: null, statut: "non_attribue", creeLe: "", raison: null, livraison: null }} projetNom="" agentNom="" />}
    <div className="av-fichiers">{e.fichiers.map((f) => <code key={f}>{f}</code>)}</div>
  </li>;
}

function TacheProjet({ tache }: { tache: Tache }) {
  const o = tache.objectif!;
  const prochain = o.nextAt ? new Date(o.nextAt).toLocaleString("fr-CH", { timeZone: FUSEAU, dateStyle: "medium", timeStyle: "short" }) : null;
  const dernier = o.occurrences[0];
  return <li draggable={tache.statut === "a-faire"} data-task-payload={JSON.stringify({ type: tache.type, titre: tache.titre, detail: tache.detail, objectif: { id: o.id, revision: o.revision, heure: o.heure, nextAt: o.nextAt, active: o.active, aDeplacer: o.occurrences.some((occurrence) => occurrence.statut === "queued") } })}>
    <div className="av-ligne">
      <span className="av-type projet">{tache.ref}</span>
      <span className="av-titre">{o.titre}</span>
      <Pastille statut={tache.statut} />
    </div>
    <p>{tache.detail}</p>
    <div className="av-attribution-meta">
      {prochain && o.active ? <a href="/calendrier">Prochain départ le {prochain}</a> : <a href="/calendrier">{o.active ? "Aucun départ prévu" : "À planifier : en pause dans le calendrier"}</a>}
      {o.repetition !== "none" && <span>{MOT_REPETITION[o.repetition]}</span>}
      <span>{o.priority === "haute" ? "Prioritaire" : "Non prioritaire"}</span>
      {dernier?.runId && <a href={`/runs/${encodeURIComponent(dernier.runId)}`}>Dernier run {dernier.runId.slice(0, 8)} · {STATUT_ATTRIBUTION[dernier.statut] ?? dernier.statut}</a>}
    </div>
  </li>;
}

function Fix({ tache, reservations = [] }: { tache: Tache; reservations?: Objectif[] }) {
  const d = DEFAUTS.find((x) => x.id === tache.ref)!;
  return <li id={`av-etape-${d.id}`} draggable={d.statut === "a-faire" && !reservations.length} data-task-payload={JSON.stringify({ type: tache.type, titre: tache.titre, detail: `${d.correctif} · ${d.fichiers}`, ref: d.id, fichiers: d.fichiers.split(/,\s*(?=(?:BP|AO|REG|AS)\s)/) })} className={`av-defaut av-compact ${d.severite}`} title={d.fichiers}>
    <div className="av-ligne">
      <b>{d.id}</b>
      <span className={`av-severite ${d.severite}`}>{d.severite}</span>
      <span className="av-titre">{d.titre}</span>
      <span className="av-correctif">{d.correctif}</span>
      {!!reservations.length && <a href="#taskboard-calendrier">Planifiée ({reservations.length} dépôt(s))</a>}
      <Pastille statut={d.statut} />
    </div>
  </li>;
}

const TYPES: Array<{ id: Filtre["type"]; nom: string }> = [
  { id: "tous", nom: "Tout" },
  { id: "projet", nom: "Tâches projet" },
  { id: "fonctionnalite", nom: "Fonctionnalités système" },
  { id: "fix", nom: "Fix" },
];

export function AVenir({ integre = false, sourceCalendrier, revisionExterne = 0, onChangement }: { integre?: boolean; sourceCalendrier?: SourceCalendrier; revisionExterne?: number; onChangement?: () => void } = {}) {
  const { source } = useSource();
  const calendrier = useMemo(() => (sourceCalendrier ?? (source.nom === "maquette" ? sourceCalendrierMaquette() : sourceCalendrierApi)), [source.nom, sourceCalendrier]);
  const [revision, setRevision] = useState(0);
  const { donnees: attributions } = useCharge((s) => s.attributionsAvenir(), [revision, revisionExterne]);
  const { donnees: topo } = useCharge((s) => s.topologie(), []);
  const { donnees: objectifs, erreur: erreurObjectifs } = useCharge(() => calendrier.objectifs(), [calendrier, revision, revisionExterne]);
  const [filtre, setFiltre] = useState<Filtre>(FILTRE_DEFAUT);
  const [nouvelle, setNouvelle] = useState(false);
  const rafraichir = () => { setRevision((n) => n + 1); onChangement?.(); };
  // Le calendrier renvoie vers une étape : la page arrive en chargement différé, on y défile ensuite.
  useEffect(() => {
    if (window.location.hash) document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "center" });
  }, []);

  const taches = useMemo(() => construireTaches(LOTS_PRIORISES, DEFAUTS, objectifs ?? []), [objectifs]);
  const visibles = filtrer(taches, filtre);
  const projets = projetsDisponibles(taches, (topo?.projets ?? []).map((p) => ({ id: p.id, nom: p.nom })));
  const reservations = (id: string) => (objectifs ?? []).filter(o=>o.taskBoard?.id===id && (o.nextAt || ['queued','running','waiting_quota','waiting_machine','waiting_approval','waiting_auth','waiting_freshness'].includes(o.occurrences[0]?.statut || '')));
  const nomProjet = (id: string) => projets.find((p) => p.id === id)?.nom ?? id;
  const parObjectif = new Map((attributions ?? []).map((a) => [a.objectif.id, a]));
  const ouvertesDe = (projet: string) => taches.filter((t) => t.projet === projet && t.statut !== "fait").length;

  const projetsVisibles = [...new Set(visibles.filter((t) => t.type === "projet").map((t) => t.projet))];
  const fix = visibles.filter((t) => t.type === "fix").sort(parSeverite);
  const etapesVisibles = new Set(visibles.filter((t) => t.type === "fonctionnalite").map((t) => t.ref));
  const lots = LOTS_PRIORISES.filter((l) => l.etapes.some((e) => etapesVisibles.has(e.id)));
  const critiques = taches.filter((t) => t.type === "fix" && t.severite === "critique" && t.statut !== "fait").length;
  const aujourdhui = dateCivile(Date.now()).date;
  // En vue « Tout », les longues listes système restent repliées derrière leur résumé.
  const deplier = (type: Filtre["type"]) => filtre.type === type || filtre.recherche.trim() !== "";
  const ancre = typeof window === "undefined" ? "" : window.location.hash;

  return (
    <div className={`av-page ${integre ? "av-embarque" : ""}`}>
      {!integre && <section className="av-hero">
        <div>
          <span className="kicker">Audit du {DATE_AUDIT} · tâches des projets en direct</span>
          <h2>Tâches à venir</h2>
          <p>Les tâches des projets (dev, marketing, finance), les fonctionnalités système de la feuille de route et les fix, au même endroit. Filtre par projet ou par type ; une tâche datée apparaît aussi dans le <a href="/calendrier">calendrier</a>.</p>
          <p>Le badge « sensible » demande une revue de sécurité : il vient des fichiers annoncés ou d'un risque motivé. La fusion est contrôlée sur les fichiers réellement modifiés.</p>
        </div>
        <dl className="av-chiffres">
          <div><dt>tâches projet</dt><dd>{compter(taches, "projet")}</dd></div>
          <div><dt>fonctionnalités</dt><dd>{compter(taches, "fonctionnalite")}</dd></div>
          <div><dt>fix ouverts</dt><dd>{compter(taches, "fix")}</dd></div>
          <div className={critiques ? "alerte" : ""}><dt>critiques</dt><dd>{critiques}</dd></div>
        </dl>
      </section>}
      {integre && <header className="av-embarque-titre">
        <div><span className="kicker">À planifier</span><h2>Tâches</h2></div>
        <dl className="av-chiffres av-chiffres-compact">
          <div><dt>projets</dt><dd>{compter(taches, "projet")}</dd></div>
          <div><dt>fonctionnalités</dt><dd>{compter(taches, "fonctionnalite")}</dd></div>
          <div><dt>fix ouverts</dt><dd>{compter(taches, "fix")}</dd></div>
          <div className={critiques ? "alerte" : ""}><dt>critiques</dt><dd>{critiques}</dd></div>
        </dl>
      </header>}

      <section className="av-filtres-bloc" aria-label="Filtres">
        <div className="av-filtres" role="group" aria-label="Filtrer par projet">
          <span className="av-filtre-titre">Projet</span>
          {[{ id: "tous", nom: "Tous" }, ...projets].map((p) => (
            <button key={p.id} type="button" aria-pressed={filtre.projet === p.id} onClick={() => setFiltre({ ...filtre, projet: p.id })}>
              {p.nom} <span>{p.id === "tous" ? taches.filter((t) => t.statut !== "fait").length : ouvertesDe(p.id)}</span>
            </button>
          ))}
        </div>
        <div className="av-filtres" role="group" aria-label="Filtrer par type">
          <span className="av-filtre-titre">Type</span>
          {TYPES.map((t) => <button key={t.id} type="button" aria-pressed={filtre.type === t.id} onClick={() => setFiltre({ ...filtre, type: t.id })}>{t.nom}</button>)}
          <label>Statut<select value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value as Filtre["statut"] })}>
            <option value="ouvertes">À faire et en cours</option><option value="toutes">Toutes</option><option value="faites">Faites</option>
          </select></label>
          <input type="search" aria-label="Rechercher une tâche" placeholder="Rechercher…" value={filtre.recherche} onChange={(e) => setFiltre({ ...filtre, recherche: e.target.value })} />
          <button type="button" className="av-action" onClick={() => setNouvelle((v) => !v)} aria-expanded={nouvelle}>Nouvelle tâche projet</button>
        </div>
      </section>

      {nouvelle && <>
        <p className="av-vide">Une tâche projet lance un pipeline du projet. Décoche « Activer » pour la garder à planifier plus tard.</p>
        <Planifier source={calendrier} aujourdhui={aujourdhui} onFermer={() => setNouvelle(false)} onPlanifie={() => { setNouvelle(false); rafraichir(); }} />
      </>}
      {erreurObjectifs && <p className="av-attribution-erreur" role="alert">Tâches projet indisponibles : {erreurObjectifs}</p>}
      {!visibles.length && <p className="av-vide">Rien à afficher avec ces filtres.</p>}

      {projetsVisibles.map((projet) => (
        <section key={projet} className="av-lot" aria-labelledby={`av-projet-${projet}`}>
          <header>
            <span className="kicker">Tâches projet</span>
            <h3 id={`av-projet-${projet}`}>{nomProjet(projet)}</h3>
          </header>
          <ul>{visibles.filter((t) => t.type === "projet" && t.projet === projet).map((t) => <TacheProjet key={t.cle} tache={t} />)}</ul>
        </section>
      ))}

      {!!fix.length && <details className="av-lot av-section" open={deplier("fix")}>
        <summary>
          <span className="kicker">Système · du plus grave au moins grave</span>
          <span className="av-section-titre">Fix</span>
          <span className="av-section-compte">{fix.length}{fix.some((t) => t.severite === "critique") ? ` · ${fix.filter((t) => t.severite === "critique").length} critique(s)` : ""}</span>
        </summary>
        <ul className="av-liste">{fix.map((t) => <Fix key={t.cle} tache={t} reservations={reservations(t.ref)} />)}</ul>
      </details>}

      {!!lots.length && <>
        <details className="av-lot av-ordre">
          <summary><span className="kicker">Classement du 22 octobre 2026</span> Ordre de travail des fonctionnalités système</summary>
          <ol className="av-suggestions">
            {PRIORITES.map((priorite, index) => <li key={priorite.titre}>
              <b>{index + 1}. {priorite.titre}</b>
              <p>{priorite.detail}</p>
              <p>{priorite.lots.map((id, i) => <span key={id}>{i > 0 && " · "}<a href={`#av-lot-${id}`}>Lot {id}</a></span>)}</p>
            </li>)}
          </ol>
        </details>
        <ol className="av-lots">
          {lots.map((lot) => {
            const faits = lot.etapes.filter((e) => e.statut === "fait").length;
            return <li key={lot.id} id={`av-lot-${lot.id}`}><details className="av-lot av-section" open={deplier("fonctionnalite") || lot.etapes.some((e) => ancre === `#av-etape-${e.id}`)}>
              <summary>
                <span className="kicker">Fonctionnalité système · lot {lot.id}{lot.prerequis ? ` · après ${lot.prerequis}` : ""}</span>
                <span className="av-section-titre">{lot.titre}</span>
                <span className="av-section-compte" aria-label={`${faits} étapes faites sur ${lot.etapes.length}`}>{faits}/{lot.etapes.length}</span>
                <span className="av-section-but">{lot.but}</span>
              </summary>
              <ul>
                {lot.etapes.filter((e) => etapesVisibles.has(e.id)).map((e) => <EtapeLigne key={e.id} e={e} reservations={reservations(e.id)} attribution={parObjectif.get(e.id)} onRefresh={rafraichir}
                  projetNom={topo?.projets.find((p) => p.id === parObjectif.get(e.id)?.projetId)?.nom ?? parObjectif.get(e.id)?.projetId ?? ""} />)}
              </ul>
            </details></li>;
          })}
        </ol>
      </>}

      <details className="av-lot av-ordre">
        <summary><span className="kicker">Idées</span> Suggestions</summary>
        <ul className="av-suggestions">{SUGGESTIONS.map((s) => <li key={s}>{s}</li>)}</ul>
      </details>
    </div>
  );
}
