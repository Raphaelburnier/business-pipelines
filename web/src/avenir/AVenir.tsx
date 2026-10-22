// « Fix et fonctionnalités à venir » : la feuille de route de l'audit et les défauts à corriger.
// Les données vivent dans feuille.ts ; une PR qui avance un point met son statut à jour.
import "./avenir.css";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { lignes, type PropositionPlan, type SpecMission } from "../donnees/missions";
import type { AttributionAvenir } from "../donnees/source";
import { DATE_AUDIT, DEFAUTS, LOTS, LOTS_PRIORISES, PRIORITES, SUGGESTIONS, estAttribuable, projetObjectif, revisionObjectif, type Etape, type Severite, type Statut } from "./feuille";

type Onglet = "feuille" | "defauts" | "suggestions";

const ONGLETS: Array<{ id: Onglet; nom: string }> = [
  { id: "feuille", nom: "Feuille de route" },
  { id: "defauts", nom: "Bugs et failles" },
  { id: "suggestions", nom: "Suggestions" },
];

const MOT_STATUT: Record<Statut, string> = { "a-faire": "à faire", "en-cours": "en cours", fait: "fait" };
const SEVERITES: Severite[] = ["critique", "haute", "moyenne", "basse"];

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
export function construireSpecAttribution(etape: Etape, projectId: string, criteres: string[]): SpecMission {
  const ailleurs = etape.fichiers.filter((f) => !f.startsWith(prefixeDepot(projectId)));
  return {
    projectId, objectif: `${etape.titre} — ${etape.detail}`, criteres,
    document: `${etape.detail}\n\nFichiers repérés par l'audit : ${etape.fichiers.join(", ")}.`,
    directives: "Respecter les instructions du dépôt et produire une PR vérifiable.",
    exclusions: ailleurs.length ? `Ce run ne modifie que ${projectId}. Hors périmètre, à traiter dans une autre mission : ${ailleurs.join(", ")}.` : "",
    exigences: [], runtimesExclus: ["omniroute"],
    contexte: { _roadmapObjective: { id: etape.id, revision: revisionObjectif(etape.id) ?? 1 } },
  };
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
  const [accepteDegrade, setAccepteDegrade] = useState(false);
  const [priorite, setPriorite] = useState<"haute" | "normale" | "basse">(attribution.priorite ?? "normale");
  const [reclassement, setReclassement] = useState(false);
  const [commandeId, setCommandeId] = useState<string | null>(null);
  const tentative = useRef<{ empreinte: string; requestId: string } | null>(null);
  async function proposer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formulaire = new FormData(event.currentTarget);
    const criteres = lignes(String(formulaire.get("criteres") || ""));
    if (!projectId) return;
    if (!criteres.length) { setErreur("Renseigne au moins un critère."); return; }
    const spec = construireSpecAttribution(etape, projectId, criteres);
    setErreur(null); setAttente(true);
    try { setProposition({ spec, reponse: await source.proposerPlan(spec) }); setAccepteDegrade(false); }
    catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setAttente(false); }
  }

  async function lancer() {
    if (!proposition?.reponse.empreinte) return;
    setErreur(null); setAttente(true);
    try {
      const empreinte = proposition.reponse.empreinte;
      if (tentative.current?.empreinte !== empreinte) tentative.current = { empreinte, requestId: crypto.randomUUID() };
      await source.lancerPlan({ spec: proposition.spec, empreinte: proposition.reponse.empreinte,
        requestId: tentative.current.requestId, accepterDegrade: accepteDegrade, scheduling: { priority: priorite } });
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

  async function reclasser(nouvelle: "haute" | "normale" | "basse") {
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
      {attribution.positionFile != null && <span>Objectifs #{attribution.positionFile}</span>}
      <span>Priorité {attribution.priorite ?? "normale"}</span>
    </div>
    {attribution.statut === "waiting_quota" && attribution.attente?.commandeStatut === "pending" && attribution.attente.commandeAutomatique && <p className="av-file-attente">Reprise automatique en file{attribution.attente.runtime ? ` · ${attribution.attente.runtime}` : ""}</p>}
    {attribution.statut === "waiting_quota" && attribution.attente?.commandeStatut === "pending" && !attribution.attente.commandeAutomatique && <p className="av-file-attente">Reprise manuelle en file{attribution.attente.runtime ? ` · ${attribution.attente.runtime}` : ""}</p>}
    {attribution.statut === "waiting_quota" && attribution.attente?.commandeStatut === "taken" && <p className="av-file-attente">{attribution.attente.commandeAutomatique ? "Reprise automatique en cours" : "Reprise manuelle en cours"}{attribution.attente.runtime ? ` · ${attribution.attente.runtime}` : ""}</p>}
    {attribution.statut === "waiting_quota" && !attribution.attente?.commandeStatut && <p className="av-file-attente">Quota atteint{attribution.attente?.runtime ? ` · ${attribution.attente.runtime}` : ""}{attribution.attente?.prochaineReprise ? ` · reprise automatique prévue ${new Date(attribution.attente.prochaineReprise).toLocaleString("fr-CH")}` : " · aucune reprise automatique planifiée"}</p>}
    {attribution.attente?.raisonManuelle && <p className="av-attribution-erreur">Reprise manuelle requise : {attribution.attente.raisonManuelle}</p>}
    {attribution.raison && <p className="av-attribution-erreur">{attribution.raison}</p>}
    {attribution.reclassable && <label className="av-priorite">Priorité de file<select aria-label={`Priorité ${etape.id}`} value={priorite} disabled={reclassement} onChange={(event) => void reclasser(event.target.value as "haute" | "normale" | "basse")}>
      <option value="haute">Haute</option><option value="normale">Normale</option><option value="basse">Basse</option>
    </select></label>}
    {commandeId && <p role="status">Mission envoyée au cockpit. L'attribution se mettra à jour avec le prochain événement.</p>}
    {!projectId && <p className="av-attribution-erreur">Touche plusieurs dépôts ou un dépôt hors du cockpit : à traiter à la main.</p>}
    {projectId && etape.statut === "a-faire" && !indisponible && <button type="button" className="av-action" onClick={() => { setOuvert((v) => !v); setProposition(null); setErreur(null); setCommandeId(null); }}>
      {ouvert ? "Fermer" : attribution.statut === "failed" || attribution.statut === "cancelled" ? "Relancer l'objectif" : "Attribuer"}
    </button>}
    {erreur && <p className="av-attribution-erreur" role="alert">{erreur}</p>}
    {ouvert && etape.statut === "a-faire" && !indisponible && !proposition && !commandeId && <form className="av-form" onSubmit={proposer}>
      <p className="av-form-depot">Dépôt : <code>{projectId}</code></p>
      <p className="av-form-depot">Agents : choisis par le planificateur, visibles dans le plan.</p>
      <label>Priorité<select value={priorite} onChange={(event) => setPriorite(event.target.value as "haute" | "normale" | "basse")}><option value="haute">Haute</option><option value="normale">Normale</option><option value="basse">Basse</option></select></label>
      <label className="av-form-criteres">Critères de réussite<textarea name="criteres" required defaultValue={`Le changement répond à l'objectif « ${etape.titre} ».\nLes vérifications pertinentes passent et les résultats sont documentés.`} rows={3} /></label>
      <button type="submit" disabled={attente}>{attente ? "Préparation du plan…" : "Proposer le plan"}</button>
    </form>}
    {plan && <section className="av-plan" aria-live="polite"><b>{plan.statut === "bloque" ? "Plan bloqué" : "Plan proposé"}{plan.projet ? ` · ${plan.projet.nom}` : ""}</b>
      {plan.blocages.map((b, i) => <p key={i}>{b.message}</p>)}
      {plan.plan?.etapes.map((e) => <p key={e.noeud}>{e.nom} · {e.llm?.via}:{e.llm?.model}</p>)}
      {plan.statut === "degrade" && <label><input type="checkbox" checked={accepteDegrade} onChange={(e) => setAccepteDegrade(e.target.checked)} /> Accepter ce plan dégradé</label>}
      {plan.statut !== "bloque" && <button type="button" disabled={attente || (plan.statut === "degrade" && !accepteDegrade)} onClick={lancer}>{attente ? "Lancement…" : "Lancer la mission"}</button>}
      <button type="button" disabled={attente} onClick={() => { setProposition(null); tentative.current = null; }}>Modifier la mission</button>
    </section>}
  </div>;
}

function FeuilleDeRoute() {
  const [revision, setRevision] = useState(0);
  const { donnees: attributions } = useCharge((s) => s.attributionsAvenir(), [revision]);
  const { donnees: topo } = useCharge((s) => s.topologie(), []);
  const parObjectif = new Map((attributions ?? []).map((a) => [a.objectif.id, a]));
  return (
    <>
    <section className="av-lot" aria-labelledby="av-priorites">
      <header>
        <span className="kicker">Classement du 22 octobre 2026</span>
        <h3 id="av-priorites">Ordre de travail</h3>
        <p>Les prérequis de chaque lot restent applicables.</p>
      </header>
      <ol className="av-suggestions">
        {PRIORITES.map((priorite, index) => <li key={priorite.titre}>
          <b>{index + 1}. {priorite.titre}</b>
          <p>{priorite.detail}</p>
          <p>{priorite.lots.map((id, i) => <span key={id}>{i > 0 && " · "}<a href={`#av-lot-${id}`}>Lot {id}</a></span>)}</p>
        </li>)}
      </ol>
    </section>
    <ol className="av-lots">
      {LOTS_PRIORISES.map((lot) => {
        const faits = lot.etapes.filter((e) => e.statut === "fait").length;
        return (
          <li key={lot.id} id={`av-lot-${lot.id}`} className="av-lot">
            <header>
              <span className="kicker">Lot {lot.id}{lot.prerequis ? ` · après ${lot.prerequis}` : ""}</span>
              <h3>{lot.titre}</h3>
              <p>{lot.but}</p>
              <span className="av-avancement" aria-label={`${faits} étapes faites sur ${lot.etapes.length}`}>
                {faits}/{lot.etapes.length}
              </span>
            </header>
            <ul>
              {lot.etapes.map((e) => (
                <li key={e.id}>
                  <div className="av-ligne">
                    <b>{e.id}</b>
                    <span className="av-titre">{e.titre}</span>
                    {e.sensible && <span className="av-sensible" title="Touche un fichier sensible : fusion explicite">sensible</span>}
                    <Pastille statut={e.statut} />
                  </div>
                  <p>{e.detail}</p>
                  {parObjectif.get(e.id) && <Attribution etape={e} attribution={parObjectif.get(e.id)!} onRefresh={() => setRevision((n) => n + 1)}
                    projetNom={topo?.projets.find((p) => p.id === parObjectif.get(e.id)?.projetId)?.nom ?? parObjectif.get(e.id)!.projetId}
                    agentNom={parObjectif.get(e.id)!.agent?.nom ?? "Agent inconnu"} />}
                  {estAttribuable(e) && !parObjectif.has(e.id) && <Attribution etape={e} onRefresh={() => setRevision((n) => n + 1)} attribution={{ objectif: { id: e.id, revision: revisionObjectif(e.id) ?? 1 }, commandeId: "", runId: null, projetId: "", agent: null, statut: "non_attribue", creeLe: "", raison: null, livraison: null }} projetNom="" agentNom="" />}
                  <div className="av-fichiers">
                    {e.fichiers.map((f) => <code key={f}>{f}</code>)}
                  </div>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
    </>
  );
}

function Defauts() {
  const [severite, setSeverite] = useState<Severite | "toutes">("toutes");
  const [masquerFaits, setMasquerFaits] = useState(true);
  const visibles = useMemo(
    () => DEFAUTS.filter((d) => (severite === "toutes" || d.severite === severite) && (!masquerFaits || d.statut !== "fait")),
    [severite, masquerFaits]
  );
  return (
    <section className="av-defauts">
      <div className="av-filtres" role="group" aria-label="Filtrer par sévérité">
        {(["toutes", ...SEVERITES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={severite === s} onClick={() => setSeverite(s)}>
            {s} {s !== "toutes" && <span>{DEFAUTS.filter((d) => d.severite === s).length}</span>}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={masquerFaits} onChange={(e) => setMasquerFaits(e.target.checked)} />
          masquer les corrigés
        </label>
      </div>
      {visibles.length === 0 ? (
        <p className="av-vide">Rien à afficher avec ces filtres.</p>
      ) : (
        <ul className="av-liste">
          {visibles.map((d) => (
            <li key={d.id} className={`av-defaut ${d.severite}`}>
              <div className="av-ligne">
                <b>{d.id}</b>
                <span className={`av-severite ${d.severite}`}>{d.severite}</span>
                <span className="av-titre">{d.titre}</span>
                <Pastille statut={d.statut} />
              </div>
              <div className="av-fichiers"><code>{d.fichiers}</code></div>
              <p>Correctif : {d.correctif}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AVenir() {
  const [onglet, setOnglet] = useState<Onglet>("feuille");
  const etapes = LOTS.flatMap((l) => l.etapes);
  const ouverts = DEFAUTS.filter((d) => d.statut !== "fait");
  const critiques = ouverts.filter((d) => d.severite === "critique").length;
  return (
    <div className="av-page">
      <section className="av-hero">
        <div>
          <span className="kicker">Audit du {DATE_AUDIT}</span>
          <h2>Fix et fonctionnalités à venir</h2>
          <p>
            Les tâches classées par priorité : fiabilité des runs, sécurité, garde-fous d'exploitation, puis pilotage et
            extensions métier. Le superviseur attend que ses protections soient en service.
          </p>
        </div>
        <dl className="av-chiffres">
          <div><dt>étapes faites</dt><dd>{etapes.filter((e) => e.statut === "fait").length}/{etapes.length}</dd></div>
          <div><dt>défauts ouverts</dt><dd>{ouverts.length}</dd></div>
          <div className={critiques ? "alerte" : ""}><dt>critiques</dt><dd>{critiques}</dd></div>
        </dl>
      </section>
      <div className="av-onglets" role="tablist">
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}>
            {o.nom}
          </button>
        ))}
      </div>
      {onglet === "feuille" && <FeuilleDeRoute />}
      {onglet === "defauts" && <Defauts />}
      {onglet === "suggestions" && (
        <ul className="av-suggestions">
          {SUGGESTIONS.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}
    </div>
  );
}
