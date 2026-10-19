import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { suivreCommande } from "../donnees/lancement";
import { lignes, specStructuree, type PropositionPlan, type SpecMission } from "../donnees/missions";
import { lireSpecChat, oublierSpecChat } from "../donnees/specChat";
import { Erreur, Titre } from "../ui";

const champ = "w-full rounded-lg border border-trait bg-carte px-3 py-2 text-sm";
const ROLES: Record<string, string> = { planification: "Planification", developpement: "Développement", verification: "Tests du projet",
  revue: "Revue indépendante", analyse: "Analyse", synthese: "Synthèse", controle: "Contrôle", decision: "Décision", production: "Production", collecte: "Collecte", validation: "Validation des sources", publication: "Archivage du rapport" };

// Une spec confiée au planificateur : il choisit le pipeline et les agents, le serveur fige
// le plan dans le contrat. L'écran montre le plan avant tout lancement.
export function PlanMission({ projetInitial, aller }: { projetInitial: string | null; aller: (href: string) => void }) {
  const { source } = useSource();
  const topo = useCharge((s) => s.topologie(), []);
  // Une spec écrite par un conseiller de « Demander » préremplit le formulaire, une fois.
  const [depuisChat] = useState(() => lireSpecChat());
  useEffect(() => oublierSpecChat(), []);
  const [projetId, setProjetId] = useState(depuisChat?.projectId ?? projetInitial ?? "");
  const [nature, setNature] = useState<NonNullable<SpecMission["nature"]> | "">(depuisChat?.nature ?? "");
  const [objectif, setObjectif] = useState(depuisChat?.objectif ?? "");
  const [criteres, setCriteres] = useState((depuisChat?.criteres ?? []).join("\n"));
  const [document, setDocument] = useState(depuisChat?.document ?? "");
  const [directives, setDirectives] = useState(depuisChat?.directives ?? "");
  const [exclusions, setExclusions] = useState(depuisChat?.exclusions ?? "");
  const [contexte, setContexte] = useState(depuisChat?.contexte && Object.keys(depuisChat.contexte).length ? JSON.stringify(depuisChat.contexte, null, 2) : "{}");
  const [securite, setSecurite] = useState(Boolean(depuisChat?.exigences?.includes("revue-securite")));
  const [proposition, setProposition] = useState<{ spec: SpecMission; reponse: PropositionPlan } | null>(null);
  const [accepte, setAccepte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [attente, setAttente] = useState(false);
  const [commandeId, setCommandeId] = useState<string | null>(null);
  const tentative = useRef<{ empreinte: string; id: string } | null>(null);

  useEffect(() => {
    if (!commandeId) return;
    return suivreCommande(source, commandeId, {
      surCommande: (c) => {
        if (c.run) aller(`/runs/${encodeURIComponent(c.run)}`);
        else if (c.statut === "refused" || c.statut === "done") {
          setErreur(c.resultat?.raison || "La commande s'est terminée sans run associé.");
          setCommandeId(null);
          setAttente(false);
          tentative.current = null;
        }
      },
      surErreur: (err) => setErreur(`Suivi momentanément indisponible : ${err.message}`),
    });
  }, [source, commandeId, aller]);

  const modifier = <T,>(set: (v: T) => void) => (v: T) => { set(v); setProposition(null); setAccepte(false); };

  async function proposer(event: FormEvent) {
    event.preventDefault();
    setErreur(null);
    try {
      const spec: SpecMission = { projectId: projetId, objectif: objectif.trim(), criteres: lignes(criteres), document, directives, exclusions,
        contexte: specStructuree(contexte), exigences: securite ? ["revue-securite"] : [], ...(nature ? { nature } : {}),
        // Le formulaire n'expose pas les runtimes exclus : ceux d'une spec du chat sont gardés.
        ...(depuisChat?.runtimesExclus?.length ? { runtimesExclus: depuisChat.runtimesExclus } : {}) };
      if (!spec.projectId || !spec.objectif || !spec.criteres.length) throw new Error("Choisis le projet, l'objectif et au moins un critère de réussite.");
      setAttente(true);
      setProposition({ spec, reponse: await source.proposerPlan(spec) });
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); }
    finally { setAttente(false); }
  }

  async function lancer() {
    if (!proposition?.reponse.empreinte) return;
    setErreur(null);
    const { empreinte } = proposition.reponse;
    if (tentative.current?.empreinte !== empreinte) tentative.current = { empreinte, id: crypto.randomUUID() };
    setAttente(true);
    try {
      const c = await source.lancerPlan({ spec: proposition.spec, empreinte, requestId: tentative.current.id, accepterDegrade: accepte });
      setCommandeId(c.id);
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); setAttente(false); }
  }

  const r = proposition?.reponse;
  return <div className="flex flex-col gap-4">
    {depuisChat && <p className="rounded-lg border border-trait bg-carte p-3 text-sm">Spec rédigée dans « Demander ». Relis-la, puis propose le plan : rien n'est lancé avant ton clic sur « Lancer ce plan ».</p>}
    <form onSubmit={proposer} className="flex flex-col gap-4">
      <fieldset disabled={attente || Boolean(commandeId)} className="flex flex-col gap-4 disabled:opacity-70">
        {topo.erreur && <Erreur>{topo.erreur}</Erreur>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">Projet
            <select className={champ} value={projetId} onChange={(e) => modifier(setProjetId)(e.target.value)}>
              <option value="">Choisir un projet…</option>
              {topo.donnees?.projets.filter((p) => p.aFiche && p.pipelines.length).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">Nature
            <select className={champ} value={nature} onChange={(e) => modifier(setNature)(e.target.value as typeof nature)}>
              <option value="">Déduite du projet</option>
              <option value="developpement">Développement</option>
              <option value="marketing">Marketing</option>
              <option value="finance">Finance</option>
            </select>
          </label>
        </div>
        <label className="text-sm">Objectif<textarea className={champ} required maxLength={4000} rows={3} value={objectif} onChange={(e) => modifier(setObjectif)(e.target.value)} placeholder="Quel résultat attends-tu ?" /></label>
        <label className="text-sm">Critères d'acceptation · un par ligne<textarea className={champ} required rows={3} value={criteres} onChange={(e) => modifier(setCriteres)(e.target.value)} /></label>
        <label className="text-sm">Spec détaillée<textarea className={champ} rows={7} maxLength={30000} value={document} onChange={(e) => modifier(setDocument)(e.target.value)} placeholder="Colle ici ta spec." /></label>
        <label className="text-sm">Contraintes et directives<textarea className={champ} rows={2} maxLength={4000} value={directives} onChange={(e) => modifier(setDirectives)(e.target.value)} /></label>
        <label className="text-sm">Hors périmètre<textarea className={champ} rows={2} maxLength={4000} value={exclusions} onChange={(e) => modifier(setExclusions)(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={securite} onChange={(e) => modifier(setSecurite)(e.target.checked)} />Exiger une revue de sécurité</label>
        <details><summary className="cursor-pointer text-sm">Contexte structuré (JSON)</summary>
          <textarea className={`${champ} mt-2 font-mono`} rows={6} value={contexte} onChange={(e) => modifier(setContexte)(e.target.value)} />
        </details>
      </fieldset>
      <button type="submit" disabled={attente || Boolean(commandeId)} className="rounded-lg border border-accent px-4 py-3 text-sm font-semibold disabled:opacity-50">{attente && !r ? "Planification…" : "Proposer un plan"}</button>
    </form>

    {r && <section className="flex flex-col gap-3 rounded-xl border border-accent bg-carte p-4 text-sm" aria-live="polite">
      <h3 className="font-semibold">{r.statut === "bloque" ? "Plan non lançable" : r.statut === "degrade" ? "Plan dégradé" : "Plan proposé"}{r.projet ? ` · ${r.projet.nom}` : ""}</h3>
      {r.blocages.map((b, i) => <div key={i} className="rounded-lg border border-alerte p-3">
        <p>{b.message}</p>
        {b.arbitrage && <p className="mt-1 font-semibold">Arbitrage demandé : {b.arbitrage}</p>}
      </div>)}
      {r.plan && <PlanLisible plan={r.plan} />}
      {r.statut === "degrade" && <label className="flex items-center gap-2"><input type="checkbox" checked={accepte} onChange={(e) => setAccepte(e.target.checked)} />J'accepte ce plan dégradé et ses avertissements</label>}
      {r.statut !== "bloque" && <button type="button" onClick={lancer} disabled={attente || Boolean(commandeId) || (r.statut === "degrade" && !accepte)}
        className="rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-sur-accent disabled:opacity-50">{commandeId ? "Mission en file…" : "Lancer ce plan"}</button>}
    </section>}
    {erreur && <Erreur>{erreur}</Erreur>}
  </div>;
}

export function PlanLisible({ plan }: { plan: NonNullable<PropositionPlan["plan"]> }) {
  const l = plan.limites;
  return <div className="flex flex-col gap-3">
    <p><span className="font-semibold">{plan.pipeline.titre}</span> <span className="text-douce">({plan.pipeline.ref})</span> · {plan.pipeline.raison}</p>
    <ol className="flex flex-col gap-2">
      {plan.etapes.map((e) => <li key={e.noeud} className="rounded-lg border border-trait bg-surface p-2">
        <p><span className="font-semibold">{ROLES[e.role] ?? e.role}</span> · {e.nom}{e.agent ? <span className="text-douce"> ({e.agent})</span> : null}
          {e.llm && <span className="text-douce"> · {e.llm.via}:{e.llm.model}</span>}{e.machine && <span className="text-douce"> · {e.machine}</span>}</p>
        {e.raisons.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-douce">{e.raisons.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </li>)}
    </ol>
    <div><p className="font-semibold">Critères couverts</p>
      <ul className="list-disc pl-5">{plan.criteres.map((c, i) => <li key={i}>{c.texte} <span className="text-xs text-douce">· réalisé par {c.realisePar.join(", ") || "aucune étape"} · jugé par {c.jugePar.join(", ") || "aucune étape"}</span></li>)}</ul>
    </div>
    {plan.independance.length > 0 && <p className="text-xs text-douce">Indépendance : {plan.independance.map((i) => `${i.revue} relit ${i.auteurs.join(", ")} en session neuve${i.membreDistinct ? ", autre membre" : ""}${i.runtimeDistinct ? ", autre runtime" : ""}`).join(" · ")}</p>}
    <p className="text-xs text-douce">Limites : {l.usdPerRun ?? "?"} $ par run{l.usdPerMonth !== null ? `, ${l.usdPerMonth} $ par mois` : ""}{l.maxTurnsPerAgent !== null ? `, ${l.maxTurnsPerAgent} tours par agent` : ""}{l.corrections.map((c) => `, ${c.maxLoops} corrections au plus (${c.cycle})`).join("")}.</p>
    <p>{plan.resultat.description}</p>
    {plan.avertissements.length > 0 && <ul className="list-disc pl-5 text-alerte">{plan.avertissements.map((a, i) => <li key={i}>{a}</li>)}</ul>}
  </div>;
}
