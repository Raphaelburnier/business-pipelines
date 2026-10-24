import { AVenir } from "./avenir/AVenir";
import { Calendrier } from "./calendrier/Calendrier";
import { useRef, useState, type DragEvent } from "react";
import { useCharge, useSource } from "./donnees/contexte";
import { sourceCalendrierApi, sourceCalendrierMaquette } from "./calendrier/api";
import { dateCivile, instantZurich } from "./calendrier/semaine";
import type { PropositionPlan, SpecMission } from "./donnees/missions";
import { InterrupteurPrioritaire } from "./InterrupteurPrioritaire";
import "./taskboard.css";

/** Tableau commun pour choisir une tâche et la retrouver dans le calendrier. */
export function TaskBoard() {
  const { source } = useSource();
  const { donnees: topo } = useCharge((s) => s.topologie(), []);
  const { donnees: usage } = useCharge((s) => s.usage(), []);
  const calendrier = source.nom === "maquette" ? sourceCalendrierMaquette() : sourceCalendrierApi;
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [tacheSysteme, setTacheSysteme] = useState<{ type?: string; titre?: string; detail?: string; ref?: string; fichiers?: string[]; date: string } | null>(null);
  const [projets, setProjets] = useState<string[]>([]);
  const [propositions, setPropositions] = useState<Array<{ projectId: string; spec: SpecMission; reponse: PropositionPlan }>>([]);
  const [accepteDegrade, setAccepteDegrade] = useState(false);
  const [prioritaire, setPrioritaire] = useState(false);
  const tentatives = useRef(new Map<string, string>());
  const quota = usage?.quota;
  const quotaTexte = `Quota restant · Claude ${quota?.fournisseurs?.claude ? `${quota.fournisseurs.claude.restant}%` : "inconnu"} · Codex ${quota?.fournisseurs?.codex ? `${quota.fournisseurs.codex.restant}%` : "inconnu"} · ${quota?.statut === "bas" ? "reprises, prioritaires, puis FIFO (<25 %)" : quota?.statut === "normal" ? "ordre normal" : "mesure incomplète, ordre normal"}.`;
  function glisser(event: DragEvent<HTMLDivElement>) {
    const cible = (event.target as HTMLElement).closest<HTMLElement>("[data-task-payload]");
    if (!cible) return;
    event.dataTransfer.setData("application/x-taskboard-task", cible.dataset.taskPayload || "");
    event.dataTransfer.effectAllowed = "move";
  }
  function survoler(event: DragEvent<HTMLDivElement>) {
    const jour = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-date]");
    if (jour) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      document.querySelectorAll(".taskboard-drop-cible").forEach((cellule) => cellule.classList.remove("taskboard-drop-cible"));
      jour.classList.add("taskboard-drop-cible");
    }
  }
  async function deposer(event: DragEvent<HTMLDivElement>) {
    const jour = (event.target as HTMLElement).closest<HTMLElement>("[data-calendar-date]")?.dataset.calendarDate;
    const donnees = event.dataTransfer.getData("application/x-taskboard-task");
    document.querySelectorAll(".taskboard-drop-cible").forEach((cellule) => cellule.classList.remove("taskboard-drop-cible"));
    if (!jour || !donnees) return;
    event.preventDefault();
    if (jour < dateCivile(Date.now()).date) { setMessage("Choisis aujourd’hui ou un jour futur."); return; }
    let tache: { type?: string; titre?: string; detail?: string; ref?: string; fichiers?: string[]; objectif?: { id: string; revision: number; heure: string; nextAt: string | null; active: boolean; aDeplacer?: boolean } };
    try { tache = JSON.parse(donnees); } catch { setMessage("Cette tâche ne peut pas être lue."); return; }
    if (tache.type !== "projet" || !tache.objectif) {
      setTacheSysteme({ ...tache, date: jour });
      setPropositions([]); setMessage(""); setAccepteDegrade(false);
      const alias: Record<string, string> = { BP: "business-pipelines", AO: "agent-orchestrator", REG: "agent-registry", AS: "agent-secrets" };
      const cibles = [...new Set((tache.fichiers ?? []).flatMap((f) => {
        const code = /^([A-Z]{2,5})\s/.exec(f)?.[1];
        const id = code ? alias[code] : null;
        return id && topo?.projets.some((p) => p.id === id) ? [id] : [];
      }))];
      setProjets(cibles);
      return;
    }
    setEnvoi(true); setMessage("");
    try {
      const { objectif } = tache;
      const heure = objectif.nextAt || objectif.aDeplacer ? objectif.heure : "00:00";
      await calendrier.modifier(objectif.id, { revision: objectif.revision, date: jour, heure, active: true });
      setMessage(`« ${tache.titre} » planifiée le ${jour} ; elle pourra démarrer dès que quota et worker seront disponibles.`);
    } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  async function proposerPlan() {
    if (!tacheSysteme || !projets.length) return;
    const fichiers = tacheSysteme.fichiers ?? [];
    const alias: Record<string, string> = { BP: "business-pipelines", AO: "agent-orchestrator", REG: "agent-registry", AS: "agent-secrets" };
    const critereTravail = (tacheSysteme.detail || "").trim().slice(0, 950);
    const depotsParFichier = new Map(fichiers.map((f) => {
      const code = /^([A-Z]{2,5})\s/.exec(f)?.[1];
      return [f, code ? alias[code] || projets[0]! : projets[0]!];
    }));
    setEnvoi(true); setMessage("");
    try {
      const reponses = await Promise.all(projets.map(async (projectId) => {
        const fichiersProjet = fichiers.filter((f) => depotsParFichier.get(f) === projectId);
        const spec: SpecMission = {
          projectId,
          objectif: `${tacheSysteme.ref ? `${tacheSysteme.ref} · ` : ""}${tacheSysteme.titre || "Tâche système"}`,
          criteres: [critereTravail || "Réaliser la part de travail décrite et fournir les preuves de vérification adaptées."],
          document: `${tacheSysteme.detail || ""}\n\nFichiers de ce dépôt : ${fichiersProjet.length ? fichiersProjet.join(", ") : "à déterminer par l’agent"}\nDépôts concernés par la tâche complète : ${projets.join(", ")}`,
          directives: "Proposer un plan propre à ce dépôt. Respecter ses instructions. Le lancement attend la validation explicite de tous les plans proposés.",
          exclusions: `Le groupe TaskBoard comprend les dépôts ${projets.join(", ")}. Ce run ne modifie que ${projectId}; les autres dépôts sont traités par leurs runs du même groupe.`,
          exigences: fichiersProjet.some((f) => /(^|\/)(\.github|migrations?|Dockerfile|docker-compose|\.env|terraform|infra)(\/|$)/i.test(f.replace(/^[A-Z]{2,5}\s+/, ""))) ? ["revue-securite"] : [],
          runtimesExclus: ["omniroute"],
          contexte: { taskBoard: { type: tacheSysteme.type, ref: tacheSysteme.ref, fichiers: fichiersProjet, groupeDepots: projets } },
        };
        return { projectId, spec, reponse: await source.proposerPlan(spec) };
      }));
      setPropositions(reponses); setAccepteDegrade(false);
    }
    catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  async function lancerPlanValide() {
    if (!tacheSysteme || !propositions.length || propositions.some((p) => p.reponse.statut === "bloque" || !p.reponse.empreinte)) return;
    setEnvoi(true); setMessage("");
    try {
      await Promise.all(propositions.map((proposition) => {
        const empreinte = `${proposition.reponse.empreinte}:${tacheSysteme.date}`;
        const cle = `${proposition.projectId}:${empreinte}`;
        if (!tentatives.current.has(cle)) tentatives.current.set(cle, crypto.randomUUID());
        return source.lancerPlan({ spec: proposition.spec, empreinte: proposition.reponse.empreinte!,
          requestId: tentatives.current.get(cle)!, accepterDegrade: accepteDegrade,
          scheduling: { priority: prioritaire ? "haute" : "normale", source: "calendar", notBefore: instantZurich(tacheSysteme.date, "00:00") } });
      }));
      setMessage(`« ${tacheSysteme.titre} » : ${propositions.length} run(s) planifié(s) le ${tacheSysteme.date}.`);
      tentatives.current.clear(); setTacheSysteme(null); setPropositions([]);
    } catch (err) { setMessage(err instanceof Error ? err.message : String(err)); }
    finally { setEnvoi(false); }
  }
  return <div className="taskboard-page" onDragStart={glisser} onDragOver={survoler} onDragEnd={() => document.querySelectorAll(".taskboard-drop-cible").forEach((cellule) => cellule.classList.remove("taskboard-drop-cible"))} onDrop={(event) => void deposer(event)}>
    <header className="taskboard-entete">
      <div>
        <p className="kicker">Planification · Europe/Zurich</p>
        <h2>Un tableau pour planifier et suivre le travail</h2>
        <p>Consulte les runs prévus et retrouve les objectifs, fonctionnalités et correctifs à planifier.</p>
        <p className="taskboard-quota" aria-live="polite">{quotaTexte}</p>
      </div>
    </header>
    {message && <p className="taskboard-retour" role="status">{envoi ? "Planification… " : ""}{message}</p>}
    {tacheSysteme && <section className="taskboard-system-plan" aria-label="Planifier une tâche système">
      <header><h3>Planifier « {tacheSysteme.titre} » le {tacheSysteme.date}</h3><button type="button" onClick={() => { setTacheSysteme(null); setPropositions([]); }}>Annuler</button></header>
      {!propositions.length && <>
        <p>Sélectionne les dépôts concernés. L’orchestrateur propose un pipeline et des agents pour chacun ; valide tous les plans avant la mise en file simultanée.</p>
        <fieldset><legend>Dépôts concernés</legend>
          {(topo?.projets ?? []).map((p) => <label key={p.id}><input type="checkbox" checked={projets.includes(p.id)} onChange={(e) => setProjets((anciens) => e.target.checked ? [...anciens, p.id] : anciens.filter((id) => id !== p.id))} /> {p.nom}</label>)}
        </fieldset>
        <InterrupteurPrioritaire checked={prioritaire} onChange={setPrioritaire} />
        <button type="button" disabled={!projets.length || envoi} onClick={() => void proposerPlan()}>{envoi ? "Analyse…" : "Proposer les plans"}</button>
      </>}
      {!!propositions.length && <>
        {propositions.map((proposition) => <article key={proposition.projectId}>
          <h4>{topo?.projets.find((p) => p.id === proposition.projectId)?.nom ?? proposition.projectId} · {proposition.reponse.statut}</h4>
          {proposition.reponse.blocages.map((b, i) => <p key={i}>{b.message}</p>)}
          {proposition.reponse.plan && <p>{proposition.reponse.plan.pipeline.titre} — {proposition.reponse.plan.pipeline.raison}<br />Résultat : {proposition.reponse.plan.resultat.description}</p>}
          {proposition.reponse.plan?.etapes.map((e) => <p key={e.noeud}>{e.nom} · {e.llm?.via}:{e.llm?.model}</p>)}
          {proposition.reponse.plan?.avertissements.map((a, i) => <p key={`avertissement-${i}`}>{a}</p>)}
        </article>)}
        {propositions.some((p) => p.reponse.statut === "degrade") && <label><input type="checkbox" checked={accepteDegrade} onChange={(e) => setAccepteDegrade(e.target.checked)} /> Accepter tous les plans dégradés</label>}
        <button type="button" disabled={envoi || propositions.some((p) => p.reponse.statut === "bloque" || !p.reponse.empreinte) || (propositions.some((p) => p.reponse.statut === "degrade") && !accepteDegrade)} onClick={() => void lancerPlanValide()}>{envoi ? "Planification…" : "Valider tous les plans et planifier"}</button>
        <button type="button" disabled={envoi} onClick={() => setPropositions([])}>Modifier les dépôts</button>
      </>}
      {message && <p role="alert">{message}</p>}
    </section>}
    <div className="taskboard-grille">
      <section className="taskboard-calendrier" aria-label="Calendrier des runs">
        <Calendrier integre />
      </section>
      <aside className="taskboard-taches" aria-label="Tâches à venir">
        <AVenir integre />
      </aside>
    </div>
  </div>;
}
