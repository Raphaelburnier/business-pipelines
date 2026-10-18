// Le panneau latéral (§11.2) : ouvert par un clic sur un nœud, jamais en modale, pour que
// l'arbre reste visible. Trois contenus : un projet, un run, une machine.
//
// Le lancement est la première action de phase 5. Pause, stop et décisions migreront ici
// ensuite ; chaque bouton n'apparaît que lorsque son chemin serveur existe réellement.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCharge, useHorloge, useSource } from "../donnees/contexte";
import { VIDE, depuis, duree, jetons, mot, usd } from "../format";
import type { Etape, EtapeAvecOutils, RunDetaille, RunDetailleAvecOutils } from "../types";
import { Erreur, Etat, Titre, Vide } from "../ui";
import type { Selection } from "../topologie/Topologie";
import { naviguer } from "../navigation";
import { BlocLivraison, PastilleLivraison } from "./LivraisonRun";
import { BlocMotifs, BlocRevues } from "./RevuesRun";
import { AttenteRun } from "./AttenteRun";
import { PlanLisible } from "./PlanMission";
import { Icone } from "../icones";

const ETATS_CRITERE = { "a-venir": "À venir", "en-cours": "En cours", valide: "Validé", echec: "Échec", "non-verifie": "Non vérifié" } as const;

export function Panneau({ selection, onSelection, onFermer, modePage = false }: { selection: Selection; onSelection: (s: Selection) => void; onFermer: () => void; modePage?: boolean }) {
  const fermeture = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!modePage) fermeture.current?.focus({ preventScroll: true });
  }, [modePage]);
  return (
    <section className={`flex h-full flex-col gap-4 overflow-y-auto rounded-xl border border-trait bg-surface p-4 ${modePage ? "detail-page" : "inspection-contenu"}`}>
      <div className="ao-inspection-tete">
        <span className="text-xs font-bold uppercase tracking-wider text-douce">
          <span className="ao-inspection-kicker">Inspection</span>
          {selection.type === "projet" ? "Projet" : selection.type === "run" ? "Run" : selection.type === "orchestrateur" ? "Orchestrateur" : "Machine"}
        </span>
        <button ref={fermeture} type="button" onClick={onFermer} className={modePage ? "ml-auto px-3 py-2 text-xs text-douce hover:text-accent" : "ao-bouton-icone"} aria-label="Fermer le panneau" title="Fermer (Échap)">
          {modePage ? "← Retour au graphe" : <Icone nom="fermer" />}
        </button>
      </div>
      {selection.type === "projet" && <PanneauProjet key={selection.id} id={selection.id} onSelection={onSelection} />}
      {selection.type === "run" && <PanneauRun key={`${selection.id}:${selection.etapeId ?? ""}`} id={selection.id} etapeInitiale={selection.etapeId} />}
      {selection.type === "machine" && <PanneauMachine id={selection.id} />}
      {selection.type === "orchestrateur" && <PanneauOrchestrateur onSelection={onSelection} />}
    </section>
  );
}

function PanneauProjet({ id, onSelection }: { id: string; onSelection: (s: Selection) => void }) {
  const maintenant = useHorloge(5000);
  const { source } = useSource();
  const topo = useCharge((s) => s.topologie(), []);
  const runs = useCharge((s) => s.runs({ project: id, limite: 5 }), [id]);
  const projet = topo.donnees?.projets.find((p) => p.id === id);
  const [executionRecente, setExecutionRecente] = useState<{ agents: string[]; outils: string[]; etapes: string[] }>({ agents: [], outils: [], etapes: [] });

  useEffect(() => {
    let abandonnee = false;
    const lignes = runs.donnees ?? [];
    if (!lignes.length) {
      setExecutionRecente({ agents: [], outils: [], etapes: [] });
      return () => { abandonnee = true; };
    }

    void Promise.all(lignes.map((run) => source.run(run.id)))
      .then((details) => {
        if (abandonnee) return;
        const etapes = details.flatMap((run) => run?.etapes ?? []);
        setExecutionRecente({
          agents: [...new Set(etapes.map((etape) => etape.agent).filter((agent): agent is string => Boolean(agent)))].sort(),
          outils: [...new Set(etapes.flatMap((etape) => etape.outils))].sort(),
          etapes: [...new Set(etapes.map((etape) => `${etape.noeud} · ${etape.agent ?? etape.type}`))].sort(),
        });
      })
      .catch(() => {
        if (!abandonnee) setExecutionRecente({ agents: [], outils: [], etapes: [] });
      });

    return () => { abandonnee = true; };
  }, [runs.donnees, source]);

  if (topo.erreur) return <Erreur>{topo.erreur}</Erreur>;
  if (!topo.donnees) return <p className="text-sm text-douce">Lecture du projet…</p>;
  if (!projet) return <Erreur>Projet inconnu : {id}</Erreur>;
  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{projet.nom}</span>
          <Etat etat={projet.etat} />
        </div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-douce">pipelines configurés</dt>
          <dd className="font-mono text-[12px]">{projet.pipelines.join(", ") || VIDE}</dd>
        </dl>
      </div>
      <div>
        <Titre>Agents observés</Titre>
        <p className="mb-2 text-[11px] text-douce">D’après les cinq dernières exécutions du projet.</p>
        {executionRecente.agents.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {executionRecente.agents.map((agent) => <li key={agent} className="rounded border border-trait px-2 py-1 font-mono text-[11px]">{agent}</li>)}
          </ul>
        ) : <Vide>Aucun agent observé dans les derniers runs.</Vide>}
        <p className="mb-2 mt-3 text-sm font-semibold">Outils observés</p>
        {executionRecente.outils.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {executionRecente.outils.map((outil) => <li key={outil} className="rounded border border-trait px-2 py-1 font-mono text-[11px]">{outil}</li>)}
          </ul>
        ) : <p className="text-xs text-douce">Aucun outil consigné dans les derniers runs.</p>}
        {executionRecente.etapes.length > 0 && (
          <details className="mt-3 rounded-lg border border-trait bg-carte px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium">Étapes observées</summary>
            <ul className="mt-2 flex flex-col gap-1 text-[12px] text-douce">
              {executionRecente.etapes.map((etape) => <li key={etape} className="font-mono">{etape}</li>)}
            </ul>
          </details>
        )}
      </div>
      {projet.url && (
        // Un vrai lien, pas un bouton : il s'ouvre dans un nouvel onglet au clic du milieu et
        // se partage comme une adresse.
        <a
          href={projet.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg border border-accent px-3 py-2 text-center text-sm font-semibold text-accent hover:bg-accent hover:text-sur-accent"
        >
          Ouvrir l’app ↗
        </a>
      )}
      {projet.aFiche && projet.pipelines.length > 0 && (
        <div>
          <Titre>Lancer une mission</Titre>
          <a href={`/missions/${encodeURIComponent(id)}`} className="block rounded-lg bg-accent px-3 py-2 text-center text-sm font-semibold text-sur-accent">Choisir l'équipe et l'objectif</a>
          <a href={`/marketing/${encodeURIComponent(id)}`} className="mt-2 block rounded-lg border border-trait px-3 py-2 text-center text-sm">Discuter avec l'équipe marketing</a>
        </div>
      )}
      <div>
        <Titre compteur={runs.donnees?.length}>5 derniers runs</Titre>
        {runs.erreur && <Erreur>{runs.erreur}</Erreur>}
        {runs.donnees && !runs.donnees.length && <Vide>Aucun run pour ce projet.</Vide>}
        <ul className="flex flex-col gap-1">
          {runs.donnees?.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelection({ type: "run", id: r.id })}
                className="flex w-full items-center gap-2 rounded-lg border border-trait bg-carte px-2 py-1.5 text-left text-sm hover:border-accent"
              >
                <span className="truncate font-mono text-[11px] text-douce">{r.pipeline}</span>
                <span className="ml-auto text-[11px] tabular-nums text-douce">il y a {depuis(r.debut, maintenant)}</span>
                <Etat etat={r.statut} />
                {r.livraison && <PastilleLivraison statut={r.livraison.statut} />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ---------- run ----------

function PanneauRun({ id, etapeInitiale }: { id: string; etapeInitiale?: string }) {
  const maintenant = useHorloge();
  const { donnees: run, erreur } = useCharge((s) => s.run(id), [id]);
  const [choisie, setChoisie] = useState<string | null>(etapeInitiale ?? null);

  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (run === null) return <p className="text-sm text-douce">Lecture du run…</p>;
  const fin = run.fin ? Date.parse(run.fin) : maintenant;
  const etape = run.etapes.find((e) => e.id === choisie) ?? null;

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-lg font-bold">{run.projet ?? "sans projet"}</span>
          <Etat etat={run.statut} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-douce tabular-nums">
          <span className="font-mono">{run.pipeline}</span>
          <span>{duree(fin - Date.parse(run.debut ?? ""))}</span>
          <span title="Sur abonnement, un équivalent API, pas une dépense">{usd(run.coutEquivalentUsd)} équivalent</span>
        </div>
      </div>

      {run.mission && <div className="rounded-xl border border-trait bg-carte p-3 text-sm">
        <Titre>Mission</Titre>
        {run.mission.origine && <a className="text-xs text-accent underline" href={`/marketing/${run.projet}/${run.mission.origine.fil}`}>Discussion marketing à l'origine de cette spec</a>}
        <p className="whitespace-pre-wrap">{run.mission.objectif}</p>
        {run.criteres
          ? <ul className="mt-2 flex flex-col gap-1">{run.criteres.map((c, i) => <li key={i}><span className={c.etat === "valide" ? "text-ok" : c.etat === "echec" ? "text-alerte" : "text-douce"}>{ETATS_CRITERE[c.etat]}</span> · {c.texte}
            <span className="text-xs text-douce"> ({c.jugements.map((j) => `${j.noeud} ${j.outcome ?? j.statut}`).join(", ") || "aucun juge"})</span>
            {c.motif && <p className="text-xs text-douce">{c.motif}</p>}
            {c.preuves?.map((p, j) => <details key={j} className="mt-1 text-xs"><summary className="cursor-pointer">Consulter la preuve · {p.noeud} · {p.methode}</summary>
              <p>Attendu : {p.attendu}</p><p>{p.motif}</p><p className="font-mono break-all">Artefact / arbre {p.arbre}</p>
              {p.fichiers.map((f, k) => <div key={k}><p>{f.fichier}:{f.ligne}</p><pre className="overflow-auto whitespace-pre-wrap">{f.extrait}</pre><p className="break-all">SHA-256 {f.sha256}</p></div>)}
            </details>)}
          </li>)}</ul>
          : <ul className="mt-2 list-disc pl-5">{run.mission.criteres.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        {run.mission.plan && <details className="mt-2"><summary className="cursor-pointer text-xs">Plan figé du planificateur</summary><div className="mt-2"><PlanLisible plan={run.mission.plan} /></div></details>}
        <p className="mt-2 text-xs text-douce">{run.mission.participants.map((p) => `${p.nom} (${p.noeud}, ${p.llm.via}:${p.llm.model})`).join(" · ")}</p>
        <details className="mt-2"><summary className="cursor-pointer text-xs">Spec et directives conservées</summary>
          <p className="mt-2 whitespace-pre-wrap">{run.mission.document || "Aucune spec détaillée."}</p>
          {run.mission.directives && <p className="mt-2 whitespace-pre-wrap">Directives : {run.mission.directives}</p>}
          {run.mission.exclusions && <p className="mt-2 whitespace-pre-wrap">Hors périmètre : {run.mission.exclusions}</p>}
        </details>
      </div>}

      {etape && <DetailEtape etape={etape} runId={run.id} />}

      {run.approbations.length > 0 && (
        <div className="rounded-lg border-l-4 border-alerte bg-alerte-fond p-2 text-sm">
          {run.approbations.map((a) => (
            <div key={a.id}>
              <div className="font-semibold">{a.question ?? `décision sur ${a.noeud}`}</div>
              <div className="text-[11px] text-douce">
                {a.actions} action{a.actions > 1 ? "s" : ""} à trancher, depuis {depuis(a.ouverteLe, maintenant)}
              </div>
            </div>
          ))}
          <a className="mt-1 inline-block text-xs font-semibold text-accent underline" href="/decisions">
            Aller décider
          </a>
        </div>
      )}

      <AttenteRun key={run.attente?.id ?? run.id} run={run} />
      <BlocMotifs revues={run.revues} livraison={run.livraison} />

      {run.livraison && <BlocLivraison livraison={run.livraison} maintenant={maintenant} />}

      <BlocRevues revues={run.revues} />

      <div>
        <Titre>Exécution</Titre>
        <Timeline run={run} maintenant={maintenant} choisie={choisie} onChoisir={setChoisie} />
      </div>

      <div>
        <Titre compteur={run.etapes.length}>Étapes</Titre>
        <ul className="flex flex-col gap-1">
          {run.etapes.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setChoisie(e.id === choisie ? null : e.id)}
                className={`flex w-full flex-col gap-0.5 rounded-lg border bg-carte px-2 py-1.5 text-left ${e.id === choisie ? "border-accent" : "border-trait hover:border-accent"}`}
              >
                <span className="flex items-center gap-2 text-sm">
                  <span className="truncate font-medium">{e.noeud}</span>
                  {e.tour > 0 && <span className="text-[11px] text-alerte">tour {e.tour + 1}</span>}
                  <span className="ml-auto">
                    <Etat etat={e.statut} />
                  </span>
                </span>
                <span className="flex flex-wrap gap-x-2 text-[11px] text-douce tabular-nums">
                  <span className="font-mono">{e.agent ?? e.type}</span>
                  {e.llm && <span>{e.llm.model}</span>}
                  <span>{e.machine}</span>
                  <span>{e.debut ? duree((e.fin ? Date.parse(e.fin) : maintenant) - Date.parse(e.debut)) : VIDE}</span>
                  {e.tokens.entree > 0 && <span>{jetons(e.tokens.entree + e.tokens.sortie)} jetons</span>}
                  {e.coutEquivalentUsd > 0 && <span>{usd(e.coutEquivalentUsd)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

    </>
  );
}

function DetailEtape({ etape, runId }: { etape: EtapeAvecOutils; runId: string }) {
  // La question est pré-remplie, jamais envoyée : rien ne part sans le clic de Raphaël.
  const question = `Explique l'étape « ${etape.noeud} » (étape ${etape.id}) du run ${runId} : ce qu'elle a fait, et pourquoi elle se termine en « ${mot(etape.statut)} ».`;
  const lignes: Array<[string, string]> = [
    ["agent", etape.agent ?? VIDE],
    ["outils utilisés", etape.outils.join(", ") || VIDE],
    ["modèle", etape.llm ? `${etape.llm.via}:${etape.llm.model}` : VIDE],
    ["machine", etape.machine ?? VIDE],
    ["issue", etape.outcome ?? VIDE],
    ["session", etape.session ?? VIDE],
    ["checkpoint", etape.checkpoint ? etape.checkpoint.slice(0, 10) : VIDE],
    ["jetons", `${jetons(etape.tokens.entree)} → ${jetons(etape.tokens.sortie)}`],
  ];
  return (
    <div className="rounded-lg border border-trait bg-carte p-2">
      <Titre>Détail de {etape.noeud}</Titre>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        {lignes.map(([cle, valeur]) => (
          <div key={cle} className="contents">
            <dt className="text-douce">{cle}</dt>
            <dd className="truncate font-mono" title={valeur}>
              {valeur}
            </dd>
          </div>
        ))}
      </dl>
      <button
        type="button"
        onClick={() => naviguer(`/demander?question=${encodeURIComponent(question)}`)}
        className="mt-2 rounded-lg border border-trait px-2 py-1 text-xs font-semibold text-accent hover:border-accent"
      >
        Expliquer cette étape
      </button>
    </div>
  );
}

// La timeline d'un run : une voie par machine, une barre par étape, à l'échelle. Deux étapes
// qui se chevauchent sur une machine descendent sur des lignes distinctes : c'est le
// parallélisme que la vue existe pour montrer.
function Timeline({ run, maintenant, choisie, onChoisir }: { run: RunDetaille | RunDetailleAvecOutils; maintenant: number; choisie: string | null; onChoisir: (id: string | null) => void }) {
  const lecture = useMemo(() => {
    const avecDates = run.etapes.filter((e) => e.debut);
    if (!avecDates.length) return null;
    const debut = Math.min(...avecDates.map((e) => Date.parse(e.debut!)));
    const fin = Math.max(...avecDates.map((e) => (e.fin ? Date.parse(e.fin) : maintenant)));
    const total = Math.max(fin - debut, 1);
    const voies = new Map<string, Array<Etape & { d: number; f: number }>>();
    for (const e of avecDates) {
      const m = e.machine ?? "?";
      const liste = voies.get(m) ?? [];
      liste.push({ ...e, d: Date.parse(e.debut!), f: e.fin ? Date.parse(e.fin) : maintenant });
      voies.set(m, liste);
    }
    const empiler = (barres: Array<Etape & { d: number; f: number }>) => {
      const lignes: Array<typeof barres> = [];
      for (const b of [...barres].sort((x, y) => x.d - y.d)) {
        const libre = lignes.find((l) => l[l.length - 1]!.f <= b.d);
        if (libre) libre.push(b);
        else lignes.push([b]);
      }
      return lignes;
    };
    return { debut, total, voies: [...voies.entries()].map(([machine, barres]) => ({ machine, lignes: empiler(barres) })) };
  }, [run, maintenant]);

  if (!lecture) return <Vide>Aucune étape pour l'instant.</Vide>;
  const couleur: Record<Etape["statut"], string> = {
    succeeded: "bg-ok/70",
    running: "bg-accent pulse-douce",
    failed: "bg-danger/80",
    cancelled: "bg-douce/40",
    waiting_quota: "bg-alerte/70",
    waiting_auth: "bg-alerte/70",
    waiting_approval: "bg-alerte/70",
  };
  return (
    <div className="rounded-lg border border-trait bg-carte p-2">
      <div className="mb-1 flex justify-between text-[10px] tabular-nums text-douce">
        <span>0 s</span>
        <span>{duree(lecture.total)}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {lecture.voies.map((voie) => (
          <div key={voie.machine}>
            <div className="font-mono text-[10px] text-douce">{voie.machine}</div>
            <div className="flex flex-col gap-0.5 rounded bg-fond p-0.5">
              {voie.lignes.map((ligne, i) => (
                <div key={i} className="relative h-4">
                  {ligne.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      title={`${b.noeud} · ${duree(b.f - b.d)}`}
                      onClick={() => onChoisir(b.id === choisie ? null : b.id)}
                      className={`absolute top-0 h-4 min-w-[4px] overflow-hidden rounded px-1 text-left text-[10px] font-semibold text-encre ${couleur[b.statut]} ${b.id === choisie ? "ring-2 ring-accent" : ""}`}
                      style={{ left: `${((b.d - lecture.debut) / lecture.total) * 100}%`, width: `${Math.max(((b.f - b.d) / lecture.total) * 100, 1.5)}%` }}
                    >
                      <span className="block truncate">{b.noeud}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- machine ----------

function PanneauOrchestrateur({ onSelection }: { onSelection: (selection: Selection) => void }) {
  const { donnees, erreur } = useCharge((s) => s.topologie(), []);
  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!donnees) return <p className="text-sm text-douce">Lecture de l’orchestrateur…</p>;
  return (
    <>
      <div className="flex items-center gap-2"><h2 className="text-lg font-bold">{donnees.maitre.nom}</h2><Etat etat={donnees.maitre.etat} /></div>
      <p className="text-sm text-douce">L’orchestrateur pilote les runs et les confie aux machines disponibles.</p>
      <Titre compteur={donnees.machines.length}>Machines observées</Titre>
      {donnees.machines.map((machine) => <button key={machine.machine} type="button" className="flex items-center gap-2 border border-trait bg-carte p-3 text-left hover:border-accent" onClick={() => onSelection({ type: "machine", id: machine.machine })}><span>{machine.nom ?? machine.machine}</span><span className="ml-auto"><Etat etat={machine.etat} /></span></button>)}
      <Titre compteur={donnees.projets.filter((p) => p.aFiche).length}>Projets enregistrés</Titre>
      {donnees.projets.filter((p) => p.aFiche).map((projet) => <button key={projet.id} type="button" className="flex items-center gap-2 border border-trait bg-carte p-3 text-left hover:border-accent" onClick={() => onSelection({ type: "projet", id: projet.id })}><span>{projet.nom}</span><span className="ml-auto"><Etat etat={projet.etat} /></span></button>)}
    </>
  );
}

function PanneauMachine({ id }: { id: string }) {
  const maintenant = useHorloge(5000);
  const { donnees, erreur } = useCharge((s) => s.topologie(), []);
  if (erreur) return <Erreur>{erreur}</Erreur>;
  const machine = donnees?.machines.find((m) => m.machine === id);
  if (!donnees) return <p className="text-sm text-douce">Lecture de la machine…</p>;
  if (!machine) return <Vide>Machine « {id} » : aucun worker ne l'a encore annoncée.</Vide>;

  const enCours = Array.isArray(machine.meta?.etapesEnCours) ? (machine.meta.etapesEnCours as unknown[]).length : 0;
  const projets = donnees.projets.filter((p) => p.machines.includes(id));
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">{machine.nom ?? machine.machine}</span>
        <Etat etat={machine.etat} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-douce">dernier signe de vie</dt>
        <dd>{machine.dernierHeartbeat ? `il y a ${depuis(machine.dernierHeartbeat, maintenant)}` : "jamais"}</dd>
        <dt className="text-douce">étapes en cours</dt>
        <dd className="tabular-nums">{enCours}</dd>
        <dt className="text-douce">projets</dt>
        <dd>{projets.map((p) => p.nom).join(", ") || VIDE}</dd>
      </dl>
      {machine.etat === "sleeping" && (
        <p className="text-[12px] text-douce">En veille. Les tâches de développement restent indisponibles jusqu'au réveil manuel du PC.</p>
      )}
    </>
  );
}
