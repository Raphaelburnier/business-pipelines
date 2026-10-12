import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { suivreCommande } from "../donnees/lancement";
import { classer } from "../donnees/modeles";
import { lignes, specStructuree, type OptionsMission, type ChoixAgentMission } from "../donnees/missions";
import { Erreur, Titre } from "../ui";
import { PlanMission } from "./PlanMission";
import type { ReponseModeles } from "../types";

const champ = "w-full rounded-lg border border-trait bg-carte px-3 py-2 text-sm";
const cleLlm = (llm: { via: string; model: string }) => `${llm.via}:${llm.model}`;

export function Missions({ projetInitial, aller }: { projetInitial: string | null; aller: (href: string) => void }) {
  const topo = useCharge((s) => s.topologie(), []);
  const [projetId, setProjetId] = useState(projetInitial ?? "");
  const [index, setIndex] = useState(0);
  const [occupe, setOccupe] = useState(false);
  const [mode, setMode] = useState<"plan" | "equipe">("plan");
  const projet = topo.donnees?.projets.find((p) => p.id === projetId);
  const onglet = (m: typeof mode, libelle: string) => <button type="button" aria-pressed={mode === m} disabled={occupe} onClick={() => setMode(m)}
    className={`rounded-lg px-3 py-2 text-sm ${mode === m ? "bg-accent font-semibold text-sur-accent" : "border border-trait"}`}>{libelle}</button>;
  if (mode === "plan") return <section className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
    <div><Titre>Nouvelle mission</Titre><p className="text-sm text-douce">Confie une spec : le planificateur choisit le workflow et les agents disponibles, puis te montre le plan.</p></div>
    <div className="flex gap-2">{onglet("plan", "Confier une spec")}{onglet("equipe", "Composer l'équipe")}</div>
    <PlanMission projetInitial={projetInitial} aller={aller} />
  </section>;
  return <section className="mx-auto flex max-w-4xl flex-col gap-4 pb-6">
    <div><Titre>Nouvelle mission</Titre><p className="text-sm text-douce">Choisis le projet, son équipe et le résultat attendu.</p></div>
    <div className="flex gap-2">{onglet("plan", "Confier une spec")}{onglet("equipe", "Composer l'équipe")}</div>
    {topo.erreur && <Erreur>{topo.erreur}</Erreur>}
    <label className="flex flex-col gap-1 text-sm">Projet
      <select className={champ} disabled={occupe} value={projetId} onChange={(e) => { setProjetId(e.target.value); setIndex(0); }}>
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
    {projet && <FormulaireMission key={`${projet.id}:${index}`} projectId={projet.id} index={index} aller={aller} surEnvoi={setOccupe} />}
  </section>;
}

function FormulaireMission({ projectId, index, aller, surEnvoi }: { projectId: string; index: number; aller: (href: string) => void; surEnvoi: (envoi: boolean) => void }) {
  const { source } = useSource();
  const catalogue = useCharge((s) => s.modeles(), []);
  const [options, setOptions] = useState<OptionsMission | null>(null);
  const [agents, setAgents] = useState<ChoixAgentMission[]>([]);
  const [objectif, setObjectif] = useState("");
  const [criteres, setCriteres] = useState("");
  const [document, setDocument] = useState("");
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
        if (c.run) aller(`/runs/${encodeURIComponent(c.run)}`);
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
      const contenu = JSON.stringify({ projectId, pipelineIndex: index, configuration: options.configuration, demande });
      if (tentative.current?.contenu !== contenu) tentative.current = { contenu, id: crypto.randomUUID() };
      setEnvoi(true);
      surEnvoi(true);
      const c = await source.lancerMission({ projectId, pipelineIndex: index, configuration: options.configuration,
        requestId: tentative.current.id, demande });
      setCommandeId(c.id);
    } catch (err) { setErreur(err instanceof Error ? err.message : String(err)); setEnvoi(false); surEnvoi(false); }
  }

  if (!options) return <div>{erreur ? <><Erreur>{erreur}</Erreur><button className={champ} onClick={() => setChargement((n) => n + 1)}>Relire le projet</button></> : <p>Préparation de l'équipe…</p>}</div>;
  const changerAgent = (noeud: string, suite: Partial<ChoixAgentMission>) => { setAgents((a) => a.map((c) => c.noeud === noeud ? { ...c, ...suite } : c)); setRelecture(false); };
  return <form onSubmit={envoyer} className="flex flex-col gap-4">
    <p className="text-sm text-douce">{options.titre} · {options.nature === "developpement" ? "Développement" : options.nature === "marketing" ? "Marketing" : "Mission"}</p>
    {catalogue.erreur && <p role="status" className="text-sm text-alerte">Catalogue indisponible : les modèles configurés restent affichés. {catalogue.erreur}</p>}
    <fieldset disabled={envoi} className="flex flex-col gap-4 disabled:opacity-70" onChange={() => setRelecture(false)}>
      <legend className="mb-2 text-sm font-semibold">Agents de la mission</legend>
      {options.roles.map((r) => {
        const c = agents.find((c) => c.noeud === r.noeud)!;
        return <div key={r.noeud} className="grid gap-2 rounded-xl border border-trait bg-surface p-3 sm:grid-cols-2">
          <p className="text-sm font-semibold sm:col-span-2">{r.noeud} · {r.type === "review" ? "Revue indépendante" : "Production"} <span className="font-normal text-douce">{r.agent}</span></p>
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
    <button type="submit" disabled={envoi || !options.roles.length} className="rounded-lg bg-accent px-4 py-3 text-sm font-semibold text-sur-accent disabled:opacity-50">{envoi ? "Lancement en cours…" : relecture ? "Lancer cette mission" : "Relire la mission"}</button>
  </form>;
}

function ModeleMission({ choix, catalogue, changer }: { choix: ChoixAgentMission; catalogue: ReponseModeles | null; changer: (llm: ChoixAgentMission["llm"]) => void }) {
  const disponibles = catalogue ? classer(catalogue).utilisables.flatMap(([, ms]) => ms) : [];
  const cle = cleLlm(choix.llm);
  const connus = disponibles.some((m) => cleLlm(m.llm) === cle);
  return <label className="text-xs">Modèle
    <select className={champ} value={cle} onChange={(e) => { const m = disponibles.find((m) => cleLlm(m.llm) === e.target.value); if (m) changer(m.llm); }}>
      {!connus && <option value={cle}>{choix.llm.via} · {choix.llm.model} (choix configuré, disponibilité à confirmer)</option>}
      {disponibles.map((m) => <option key={m.id} value={cleLlm(m.llm)}>{m.llm.via} · {m.nom}</option>)}
    </select>
  </label>;
}
