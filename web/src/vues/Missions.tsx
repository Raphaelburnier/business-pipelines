// Une nouvelle mission, de deux façons : confier une spec au planificateur (PlanMission), ou
// composer soi-même l'équipe d'un workflow du projet. Dans les deux cas, rien ne part avant une
// relecture et un second clic.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bouton } from "../composants/Bouton";
import { EtatErreur, Squelette } from "../composants/Etats";
import { useToasts } from "../composants/Toasts";
import { useCharge, useSource } from "../donnees/contexte";
import { suivreCommande } from "../donnees/lancement";
import { classer } from "../donnees/modeles";
import { lignes, specStructuree, type OptionsMission, type ChoixAgentMission } from "../donnees/missions";
import { libelleNature } from "../donnees/natures";
import { Erreur } from "../ui";
import { PlanMission } from "./PlanMission";
import type { ReponseModeles } from "../types";
import type { BrouillonEquipe } from "../donnees/discussions";

const champ = "w-full rounded-lg border border-trait bg-carte px-3 py-2 text-sm";
const cleLlm = (llm: { via: string; model: string }) => `${llm.via}:${llm.model}`;

export function Missions({ projetInitial, brouillonId = null, aller }: { projetInitial: string | null; brouillonId?: string | null; aller: (href: string) => void }) {
  const topo = useCharge((s) => s.topologie(), []);
  const brouillon = useCharge((s) => brouillonId ? s.brouillonEquipe(brouillonId) : Promise.resolve(null), [brouillonId]);
  const [projetId, setProjetId] = useState(projetInitial ?? "");
  const [index, setIndex] = useState(0);
  const [occupe, setOccupe] = useState(false);
  // Une spec venue d'une discussion d'équipe préremplit la composition : on l'ouvre directement.
  const [mode, setMode] = useState<"plan" | "equipe">(brouillonId ? "equipe" : "plan");
  const projet = topo.donnees?.projets.find((p) => p.id === projetId);
  const draft = brouillon.donnees;
  const entete = <div className="flex flex-col gap-3">
    <div>
      <h2 className="text-lg font-semibold text-encre">Nouvelle mission</h2>
      <p className="text-sm text-douce">{mode === "plan" ? "Confie une spec : le planificateur choisit le workflow et les agents disponibles, puis te montre le plan." : "Choisis le projet, son équipe et le résultat attendu."}</p>
    </div>
    <div className="ao-segment" role="group" aria-label="Façon de lancer la mission">
      {([["plan", "Confier une spec"], ["equipe", "Composer l'équipe"]] as const).map(([m, libelle]) =>
        <button key={m} type="button" aria-pressed={mode === m} disabled={occupe} onClick={() => setMode(m)}>{libelle}</button>)}
    </div>
  </div>;
  if (mode === "plan") return <section className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
    {entete}
    <PlanMission projetInitial={projetInitial} aller={aller} />
  </section>;
  return <section className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
    {entete}
    {topo.erreur && <EtatErreur titre="Projets illisibles" message={topo.erreur} detail={topo.detail} onReessayer={topo.recharger} />}
    {brouillon.erreur && <EtatErreur titre="Spec illisible" message={brouillon.erreur} detail={brouillon.detail} onReessayer={brouillon.recharger} />}
    {draft && <p className="rounded-lg border border-trait bg-carte p-3 text-sm">Spec issue de la discussion marketing : {draft.titre}. Relis le workflow, l'équipe dev et les critères avant lancement. <a className="text-accent underline" href={`/marketing/${draft.projectId}/${draft.origine.fil}`}>Revenir au fil</a></p>}
    {!!draft?.directives.length && <details className="rounded-lg border border-trait p-3 text-sm"><summary className="cursor-pointer">Directives du fil transmises comme contexte</summary><ul className="mt-2 list-disc pl-5">{draft.directives.map((d, i) => <li key={i} className="whitespace-pre-wrap">{d}</li>)}</ul></details>}
    <label className="flex flex-col gap-1 text-sm">Projet
      <select className={champ} disabled={occupe || Boolean(brouillonId)} value={projetId} onChange={(e) => { setProjetId(e.target.value); setIndex(0); }}>
        <option value="">Choisir un projet…</option>
        {topo.donnees?.projets.filter((p) => p.aFiche && p.pipelines.length).map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
      </select>
    </label>
    {projet && <label className="flex flex-col gap-1 text-sm">Workflow de l'équipe
      <select className={champ} disabled={occupe} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
        {projet.pipelines.map((p, i) => <option key={`${p}:${i}`} value={i}>{p}</option>)}
      </select>
      <span className="text-xs text-douce">Changer de projet ou de workflow réinitialise la mission.</span>
    </label>}
    {brouillonId && !draft && !brouillon.erreur && <Squelette lignes={3} libelle="Lecture de la spec…" />}
    {draft && draft.projectId !== projetId && <Erreur>Cette spec appartient à un autre projet.</Erreur>}
    {projet && (!brouillonId || draft?.projectId === projetId) && <FormulaireMission key={`${projet.id}:${index}:${brouillonId}`} projectId={projet.id} index={index} brouillon={draft} aller={aller} surEnvoi={setOccupe} />}
  </section>;
}

function FormulaireMission({ projectId, index, brouillon, aller, surEnvoi }: { projectId: string; index: number; brouillon: BrouillonEquipe | null; aller: (href: string) => void; surEnvoi: (envoi: boolean) => void }) {
  const { source } = useSource();
  const toasts = useToasts();
  const catalogue = useCharge((s) => s.modeles(), []);
  const { donnees: natures } = useCharge((s) => s.natures(), []);
  const [options, setOptions] = useState<OptionsMission | null>(null);
  const [agents, setAgents] = useState<ChoixAgentMission[]>([]);
  const [objectif, setObjectif] = useState(brouillon?.objectif ?? "");
  const [criteres, setCriteres] = useState(brouillon?.criteres.join("\n") ?? "");
  const [document, setDocument] = useState(brouillon?.document ?? "");
  const [directives, setDirectives] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [spec, setSpec] = useState("{}");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [commandeId, setCommandeId] = useState<string | null>(null);
  const [relecture, setRelecture] = useState(false);
  const [chargement, setChargement] = useState(0);
  const tentative = useRef<{ contenu: string; id: string } | null>(null);

  useEffect(() => {
    let annule = false;
    setOptions(null);
    source.preparerMission(projectId, index).then((o) => {
      if (annule) return;
      setOptions(o);
      setSpec(JSON.stringify(o.spec, null, 2));
      setAgents(o.roles.map((r) => ({ noeud: r.noeud, membre: r.membre,
        llm: r.membres.find((m) => m.id === r.membre)?.llm ?? r.llm })));
      setErreur(null);
      setRelecture(false);
    }).catch((err: unknown) => { if (!annule) setErreur(err instanceof Error ? err.message : String(err)); });
    return () => { annule = true; };
  }, [source, projectId, index, chargement]);

  useEffect(() => {
    if (!commandeId) return;
    return suivreCommande(source, commandeId, {
      surCommande: (c) => {
        if (c.run) aller(`/run/${encodeURIComponent(c.run)}`);
        else if (c.statut === "refused" || c.statut === "done") {
          setErreur(c.resultat?.raison || "La commande s'est terminée sans run associé.");
          setCommandeId(null);
          setEnvoi(false);
          surEnvoi(false);
          tentative.current = null;
        }
      },
      surErreur: (err) => setErreur(`Suivi momentanément indisponible : ${err.message}`),
    });
  }, [source, commandeId, aller, surEnvoi]);

  async function envoyer(event: FormEvent) {
    event.preventDefault();
    if (!options || envoi) return;
    setErreur(null);
    try {
      const demande = { objectif: objectif.trim(), criteres: lignes(criteres), directives, exclusions, document, spec: specStructuree(spec), agents };
      if (!demande.objectif || !demande.criteres.length) throw new Error("Indique l'objectif et au moins un critère de réussite.");
      if (!relecture) { setRelecture(true); return; }
      if (brouillon && options.nature !== "developpement") throw new Error("Choisis un workflow de développement pour cette spec.");
      const origine = brouillon ? { brouillonId: brouillon.id } : {};
      const contenu = JSON.stringify({ projectId, pipelineIndex: index, configuration: options.configuration, demande, ...origine });
      if (tentative.current?.contenu !== contenu) tentative.current = { contenu, id: crypto.randomUUID() };
      setEnvoi(true);
      surEnvoi(true);
      const c = await source.lancerMission({ projectId, pipelineIndex: index, configuration: options.configuration,
        requestId: tentative.current.id, demande, ...origine });
      setCommandeId(c.id);
      toasts.info("Mission mise en file : son run s'ouvrira dès son admission.");
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); setEnvoi(false); surEnvoi(false); }
  }

  if (!options) return erreur
    ? <EtatErreur titre="Préparation de l'équipe impossible" message={erreur} onReessayer={() => setChargement((n) => n + 1)} />
    : <Squelette lignes={5} libelle="Préparation de l'équipe…" className="rounded-xl border border-trait bg-surface p-4" />;
  const changerAgent = (noeud: string, suite: Partial<ChoixAgentMission>) => { setAgents((a) => a.map((c) => c.noeud === noeud ? { ...c, ...suite } : c)); setRelecture(false); };
  return <form onSubmit={envoyer} className="flex flex-col gap-4">
    <p className="text-sm text-douce">{options.titre} · {libelleNature(natures?.natures, options.nature)}</p>
    {!!options.blocages?.length && <div role="status" className="rounded-lg border border-alerte p-3 text-sm"><p className="font-semibold">Mission indisponible</p>{options.blocages.map((b) => <p key={b}>{b}</p>)}</div>}
    {catalogue.erreur && <p role="status" className="text-sm text-alerte">Catalogue indisponible : les modèles configurés restent affichés. {catalogue.erreur}</p>}
    <fieldset disabled={envoi} className="flex flex-col gap-4 disabled:opacity-70" onChange={() => setRelecture(false)}>
      <legend className="mb-2 text-sm font-semibold">Agents de la mission</legend>
      {options.roles.map((r) => {
        const c = agents.find((c) => c.noeud === r.noeud)!;
        return <div key={r.noeud} className="grid gap-2 rounded-xl border border-trait bg-surface p-3 sm:grid-cols-2">
          <p className="text-sm font-semibold sm:col-span-2">{r.noeud} · {r.type === "review" ? "Revue indépendante" : options.nature === "finance" ? "Analyse financière" : "Production"} <span className="font-normal text-douce">{r.agent}</span></p>
          <label className="text-xs">Agent
            <select className={champ} value={c.membre ?? ""} onChange={(e) => {
              const membre = r.membres.find((m) => m.id === e.target.value);
              changerAgent(r.noeud, { membre: membre?.id ?? null, llm: membre?.llm ?? r.llm });
            }}>
              <option value="">Agent du workflow</option>
              {r.membres.map((m) => <option key={m.id} value={m.id}>{m.nom} · {m.role}</option>)}
            </select>
          </label>
          <ModeleMission choix={c} catalogue={catalogue.donnees} changer={(llm) => changerAgent(r.noeud, { llm })} />
        </div>;
      })}
      <label className="text-sm">Objectif<textarea className={champ} required maxLength={4000} rows={3} value={objectif} onChange={(e) => setObjectif(e.target.value)} placeholder="Quel résultat cette équipe doit-elle obtenir ?" /></label>
      <label className="text-sm">Critères de réussite · un par ligne<textarea className={champ} required rows={3} value={criteres} onChange={(e) => setCriteres(e.target.value)} /></label>
      <label className="text-sm">Spec détaillée<textarea className={champ} rows={7} maxLength={30000} value={document} onChange={(e) => setDocument(e.target.value)} placeholder="Colle ici ta spec ou tes instructions détaillées." /></label>
      <label className="text-sm">Directives<textarea className={champ} rows={2} maxLength={4000} value={directives} onChange={(e) => setDirectives(e.target.value)} /></label>
      <label className="text-sm">Hors périmètre<textarea className={champ} rows={2} maxLength={4000} value={exclusions} onChange={(e) => setExclusions(e.target.value)} /></label>
      <details><summary className="cursor-pointer text-sm">Contexte structuré du projet</summary>
        <label className="text-xs">Données de la spec (JSON)<textarea className={`${champ} mt-2 font-mono`} rows={8} value={spec} onChange={(e) => setSpec(e.target.value)} /></label>
      </details>
    </fieldset>
    {relecture && <div className="rounded-xl border border-accent bg-carte p-4 text-sm" aria-live="polite">
      <h3 className="font-semibold">Mission à lancer sur {options.nom}</h3>
      <p className="mt-2 whitespace-pre-wrap">{objectif}</p>
      <ul className="mt-2 list-disc pl-5">{lignes(criteres).map((c, i) => <li key={i}>{c}</li>)}</ul>
      <p className="mt-2">{agents.length} rôles · {agents.map((c) => `${c.noeud} : ${cleLlm(c.llm)}`).join(" · ")}</p>
      <p className="mt-2 text-douce">{options.publication ? "Code, vérifications, PR et suivi de fusion. Une PR sensible attend ta décision." : "Livrables et décisions du workflow."} La demande sera conservée pour ce run et ses reprises.</p>
    </div>}
    {commandeId && <p role="status" className="text-sm text-ok">Mission mise en file. Le run s'ouvrira dès son admission.</p>}
    {erreur && <Erreur>{erreur}</Erreur>}
    <div><Bouton type="submit" variante={relecture ? "primaire" : "secondaire"} disabled={!options.roles.length || Boolean(options.blocages?.length)} enCours={envoi} libelleEnCours="Lancement en cours…">{relecture ? "Lancer cette mission" : "Relire la mission"}</Bouton></div>
  </form>;
}

export function ModeleMission({ choix, catalogue, changer, vias }: { choix: ChoixAgentMission; catalogue: ReponseModeles | null; changer: (llm: ChoixAgentMission["llm"]) => void; vias?: readonly string[] }) {
  const disponibles = catalogue ? classer(catalogue).utilisables.flatMap(([, ms]) => ms).filter((m) => !vias || vias.includes(m.llm.via)) : [];
  const cle = cleLlm(choix.llm);
  const connus = disponibles.some((m) => cleLlm(m.llm) === cle);
  return <label className="text-xs">Modèle
    <select className={champ} value={cle} onChange={(e) => { const m = disponibles.find((m) => cleLlm(m.llm) === e.target.value); if (m) changer(m.llm); }}>
      {!connus && <option value={cle}>{choix.llm.via} · {choix.llm.model} (choix configuré, disponibilité à confirmer)</option>}
      {disponibles.map((m) => <option key={m.id} value={cleLlm(m.llm)}>{m.llm.via} · {m.nom}</option>)}
    </select>
  </label>;
}
