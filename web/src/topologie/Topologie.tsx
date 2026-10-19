// L'accueil relie l'infrastructure, les projets et quelques jalons du dernier run.
import "@xyflow/react/dist/style.css";
import "./accueil.css";
import { Background, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCharge } from "../donnees/contexte";
import { CLASSES_TON, mot, ton, vivant } from "../format";
import type { ProjetTopologie as Projet, Topologie as DonneesTopologie } from "../types";
import { Erreur } from "../ui";
import { Kpis } from "../vues/Kpis";
import { Icone } from "../icones";
import { disposer, idMachine, idOrchestrateur, idProjet, roleDeMachine, type ExecutionProjet, type NoeudDispose } from "./disposition";

export type Selection = { type: "projet"; id: string } | { type: "machine"; id: string } | { type: "run"; id: string; etapeId?: string } | { type: "orchestrateur"; id: "maitre" };

type DonneesNoeud = NoeudDispose & { selectionne: boolean; attenue: boolean };
type AreteFluide = Edge & { pathOptions: { borderRadius: number; offset: number } };

function nomEtape(nom: string): string {
  const connus: Record<string, string> = {
    consigne: "Briefing",
    economie: "Analyse économique",
    marque: "Analyse de marque",
    synthese: "Synthèse",
    couverture: "Vérification",
    approbation: "Approbation",
  };
  return connus[nom] ?? nom.replace(/[-_]+/g, " ").replace(/^./, (lettre) => lettre.toLocaleUpperCase("fr"));
}

function NoeudProjet({ data }: NodeProps<Node<DonneesNoeud>>) {
  const projet: Projet = data.projet!;
  const classe = CLASSES_TON[ton(projet.etat)];
  const attente = projet.approbationsEnAttente > 0;
  const machine = /nas|synology/i.test(projet.homeMachine) ? "NAS" : /pc|destrobimobile|windows/i.test(projet.homeMachine) ? "PC" : projet.homeMachine;

  return (
    <button
      type="button"
      className={`ao-noeud projet ${classe.texte} ${attente ? "attente" : ""} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`}
      aria-label={`Ouvrir la fiche de ${projet.nom}`}
      aria-pressed={data.selectionne}
    >
      <span className="ao-noeud-kicker"><Icone nom="mission" taille={12} />{projet.categorie}<span>{mot(projet.etat)}</span></span>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${vivant(projet.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{projet.nom}</span>
        {attente && <span className="badge alerte" title={`${projet.approbationsEnAttente} décision(s) en attente`}>{projet.approbationsEnAttente}</span>}
      </span>
      <span className="sous">
        <span>{machine}</span>
        <span className="truncate">{projet.pipelines[0] ?? "sans pipeline"}</span>
        <span className="ml-auto shrink-0 text-accent">inspecter ↗</span>
      </span>
    </button>
  );
}

function NoeudMachine({ data }: NodeProps<Node<DonneesNoeud>>) {
  const role = data.roleMachine!;
  const nom = role === "pc" ? "PC" : "NAS";
  const classe = data.etat ? CLASSES_TON[ton(data.etat)] : CLASSES_TON.doux;
  const contenu = (
    <>
      <span className="ao-noeud-kicker"><Icone nom="systeme" taille={12} />{role === "pc" ? "Calcul" : "Hébergement"}</span>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${data.etat && vivant(data.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{nom}</span>
        {data.etat && <span className={`ml-auto text-[10px] ${classe.texte}`}>{mot(data.etat)}</span>}
      </span>
      <span className="sous"><span>{data.sousTitre}</span>{data.machine?.nom && <span className="truncate">{data.machine.nom}</span>}</span>
    </>
  );

  return (
    <button type="button" className={`ao-noeud infrastructure clickable ${role} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label={`Ouvrir la machine ${nom}`} aria-pressed={data.selectionne}>
      {contenu}
    </button>
  );
}

function NoeudOrchestrateur({ data }: NodeProps<Node<DonneesNoeud>>) {
  const etat = data.maitre!.etat;
  const classe = CLASSES_TON[ton(etat)];
  return (
    <button type="button" className={`ao-noeud orchestrateur infrastructure ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label="Inspecter l’orchestrateur" aria-pressed={data.selectionne}>
      <span className="ao-noeud-kicker"><Icone nom="graphe" taille={12} />Pilotage</span>
      <span className="flex min-w-0 items-center gap-2"><i className={`h-2 w-2 rounded-full ${classe.plein} ${vivant(etat) ? "pulse-douce" : ""}`} /><span className="nom">Orchestrateur</span></span>
      <span className="sous"><span>{data.sousTitre}</span><span className="ml-auto">{mot(etat)}</span></span>
    </button>
  );
}

function NoeudEtape({ data }: NodeProps<Node<DonneesNoeud>>) {
  const etape = data.etape!;
  const classe = CLASSES_TON[ton(etape.statut)];
  return (
    <button type="button" className={`ao-noeud etape ${classe.texte} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label={`Ouvrir le run ${etape.runId}, étape ${etape.nom}`} aria-pressed={data.selectionne}>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2 w-2 shrink-0 rounded-full ${classe.plein} ${vivant(etape.statut) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{nomEtape(etape.nom)}</span>
        {etape.tour > 0 && <span className="text-[10px] text-douce">t{etape.tour + 1}</span>}
      </span>
      <span className="sous"><span className="truncate">{etape.detail}</span><span className="ml-auto shrink-0">{mot(etape.statut)}</span></span>
    </button>
  );
}

function NoeudGraphe(props: NodeProps<Node<DonneesNoeud>>) {
  const type = props.data.type;
  return (
    <>
      {type !== "orchestrateur" && <Handle id="entree" type="target" position={type === "machine" ? Position.Top : Position.Left} className="ao-port" />}
      {type === "projet" && <NoeudProjet {...props} />}
      {type === "machine" && <NoeudMachine {...props} />}
      {type === "orchestrateur" && <NoeudOrchestrateur {...props} />}
      {type === "etape" && <NoeudEtape {...props} />}
      {type !== "etape" && <Handle id="sortie" type="source" position={type === "orchestrateur" || type === "machine" ? Position.Bottom : Position.Left} className="ao-port" />}
    </>
  );
}

const TYPES_NOEUDS = { cockpit: NoeudGraphe };

// Sortir sous les machines avant de rejoindre le couloir latéral. En vue compacte,
// une sortie sur le côté du NAS traverserait la cellule PC placée juste à sa gauche.
function FluxMachine({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps) {
  const y = sourceY + (data?.famille === "nas" ? 40 : 24);
  const x = targetX - (data?.famille === "nas" ? 34 : 20);
  const r = 10;
  const path = `M${sourceX},${sourceY} L${sourceX},${y - r} Q${sourceX},${y} ${sourceX - r},${y} L${x + r},${y} Q${x},${y} ${x},${y + r} L${x},${targetY - r} Q${x},${targetY} ${x + r},${targetY} L${targetX},${targetY}`;
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const TYPES_ARETES = { machine: FluxMachine };
const ZOOM_MAX = 1.2;
const ZONE_HAUTE = 24;
const ZONE_BASSE = 36;

function Arbre({ topologie, selection, onSelection }: { topologie: DonneesTopologie; selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { setViewport } = useReactFlow();
  const [conteneur, setConteneur] = useState<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<{ largeur: number; hauteur: number } | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const suivre = () => setCompact(media.matches);
    media.addEventListener("change", suivre);
    return () => media.removeEventListener("change", suivre);
  }, []);
  const cleRuns = topologie.projets.map((projet) => `${projet.id}:${projet.dernierRun?.id ?? ""}`).join("|");
  const executions = useCharge(async (source) => {
    const projets = topologie.projets.filter((projet) => projet.aFiche && projet.dernierRun);
    const chargees = await Promise.all(projets.map(async (projet) => {
      try {
        const run = await source.run(projet.dernierRun!.id);
        return run ? { projetId: projet.id, run } : null;
      } catch {
        return null;
      }
    }));
    return chargees.filter((execution): execution is ExecutionProjet => execution !== null);
  }, [cleRuns]);
  const disposition = useMemo(() => disposer(topologie, executions.donnees ?? [], compact), [topologie, executions.donnees, compact]);
  const executionParRun = new Map((executions.donnees ?? []).map((execution) => [execution.run.id, execution.projetId]));
  const projetFocal = selection?.type === "projet"
    ? selection.id
    : selection?.type === "run"
      ? executionParRun.get(selection.id) ?? null
      : null;
  const machineFocale = selection?.type === "machine"
    ? roleDeMachine(topologie.machines.find((machine) => machine.machine === selection.id) ?? {
        machine: selection.id, nom: null, etat: "offline", dernierHeartbeat: null, depuisSecondes: null, meta: null,
      })
    : null;
  const projetsFocaux = new Set(topologie.projets
    .filter((projet) => projet.aFiche && (projet.id === projetFocal || (machineFocale !== null && (/nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc") === machineFocale)))
    .map((projet) => projet.id));
  const aFocal = projetFocal !== null || machineFocale !== null;
  const noeuds: Node<DonneesNoeud>[] = disposition.noeuds.map((n) => ({
    id: n.id,
    type: "cockpit",
    position: { x: n.x, y: n.y },
    width: n.largeur,
    height: n.hauteur,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    // Les ancrages sont connus : les flux ne disparaissent pas pendant une mesure DOM
    // ou un rafraîchissement SSE. Ils correspondent aux Handle du composant ci-dessus.
    handles: [
      ...(n.type === "orchestrateur" ? [] : [{ id: "entree", type: "target" as const, position: n.type === "machine" ? Position.Top : Position.Left, x: n.type === "machine" ? n.largeur / 2 : 0, y: n.type === "machine" ? 0 : n.hauteur / 2, width: 6, height: 6 }]),
      ...(n.type === "etape" ? [] : [{ id: "sortie", type: "source" as const, position: n.type === "orchestrateur" || n.type === "machine" ? Position.Bottom : Position.Left, x: n.type === "orchestrateur" || n.type === "machine" ? n.largeur / 2 : 0, y: n.type === "orchestrateur" || n.type === "machine" ? n.hauteur : n.hauteur / 2, width: 6, height: 6 }]),
    ],
    style: { width: n.largeur, height: n.hauteur },
    draggable: false,
    connectable: false,
    data: {
      ...n,
      selectionne: (selection?.type === "projet" && n.projet?.id === selection.id)
        || (selection?.type === "machine" && (n.machine?.machine ?? n.roleMachine) === selection.id)
        || (selection?.type === "orchestrateur" && n.type === "orchestrateur")
        || (selection?.type === "run" && n.etape?.runId === selection.id && (!selection.etapeId || n.etape.id === selection.etapeId)),
      attenue: aFocal && (
        (n.type === "projet" && !projetsFocaux.has(n.projet?.id ?? "")) ||
        (n.type === "etape" && !projetsFocaux.has(executionParRun.get(n.etape?.runId ?? "") ?? "")) ||
        (n.type === "machine" && machineFocale !== null && n.roleMachine !== machineFocale)
      ),
    },
  }));
  const aretes: AreteFluide[] = [];
  const relier = (source: string, target: string, famille: "pc" | "nas" | "commande" | "etape", libelle: string, active: boolean, attenuee: boolean, attente = false) => {
    const couleur = attente ? "var(--color-givre)" : famille === "pc" ? "var(--color-pc)" : famille === "nas" ? "var(--color-nas)" : famille === "commande" ? "var(--color-accent)" : "var(--color-ok)";
    aretes.push({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: "sortie",
      targetHandle: "entree",
      type: source.startsWith("machine:") ? "machine" : "smoothstep",
      data: { famille },
      pathOptions: { borderRadius: 16, offset: famille === "etape" ? 20 : 34 },
      label: source === idOrchestrateur ? libelle : attente ? libelle : undefined,
      labelShowBg: true,
      labelBgPadding: [5, 3],
      className: `ao-flux ${famille} ${active ? "actif" : ""} ${aFocal && !attenuee ? "focal" : ""} ${attenuee ? "estompe" : ""} ${attente ? "attente" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: active ? 18 : 14, height: active ? 18 : 14, color: couleur },
      zIndex: active ? 1 : 0,
      style: { stroke: couleur, strokeWidth: active || aFocal && !attenuee ? 2.75 : 1.75, strokeDasharray: attente ? "2 5" : active ? "7 5" : undefined, opacity: attenuee ? 0.12 : 0.85 },
    });
  };
  const projetsParRole = (role: "pc" | "nas") => topologie.projets.filter((projet) => projet.aFiche && (/nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc") === role);
  const roleEnFocus = (role: "pc" | "nas") => !aFocal || machineFocale === role || projetsFocaux.size > 0 && projetsParRole(role).some((projet) => projetsFocaux.has(projet.id));
  for (const role of ["pc", "nas"] as const) {
    const projetsMachine = projetsParRole(role);
    const enCours = projetsMachine.some((projet) => projet.etat === "actif");
    relier(idOrchestrateur, idMachine(role), role, role === "pc" ? "worker" : "hôte NAS", enCours || (role === "pc" && topologie.machines.find((machine) => roleDeMachine(machine) === "pc" && (machine.etat === "busy" || machine.etat === "waking")) !== undefined), aFocal && !roleEnFocus(role));
  }
  for (const projet of topologie.projets.filter((entree) => entree.aFiche)) {
    const role = /nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc";
    const estFocal = !aFocal || projetsFocaux.has(projet.id);
    relier(idMachine(role), idProjet(projet.id), role, projet.pipelines[0] ?? "pipeline", projet.etat === "actif", aFocal && !estFocal);
    const execution = executions.donnees?.find((entree) => entree.projetId === projet.id);
    if (!execution) continue;
    const etapes = disposition.noeuds.filter((noeud) => noeud.type === "etape" && noeud.etape?.runId === execution.run.id);
    for (const etape of etapes) {
      const statut = etape.etape?.statut;
      const attente = statut === "waiting_approval" || statut === "waiting_quota" || statut === "waiting_auth" || statut === "waiting_freshness";
      const actif = statut === "running";
      const libelle = statut === "waiting_approval" ? "à valider" : statut === "waiting_quota" ? "quota" : statut === "waiting_auth" ? "connexion requise" : statut === "waiting_freshness" ? "base à synchroniser" : "étape clé";
      relier(idProjet(projet.id), etape.id, "etape", libelle, actif, aFocal && !estFocal, attente);
    }
  }

  useEffect(() => {
    if (!conteneur) return undefined;
    const observateur = new ResizeObserver(([entree]) => {
      if (entree) setZone({ largeur: entree.contentRect.width, hauteur: entree.contentRect.height });
    });
    observateur.observe(conteneur);
    return () => observateur.disconnect();
  }, [conteneur]);

  const recadrer = useCallback(() => {
    if (!zone || !disposition.largeur || !disposition.hauteur) return;
    const marge = 16;
    const zoom = Math.min(
      (zone.largeur - marge * 2) / disposition.largeur,
      // Sur téléphone, cadrer la largeur plutôt que rapetisser toutes les cellules pour
      // faire tenir la hauteur. Le canevas se parcourt au doigt, les textes restent lisibles.
      compact ? ZOOM_MAX : (zone.hauteur - ZONE_HAUTE - ZONE_BASSE) / disposition.hauteur,
      ZOOM_MAX,
    );
    const echelle = Math.max(zoom, 0.3);
    void setViewport({
      x: Math.max(marge, (zone.largeur - disposition.largeur * echelle) / 2),
      y: ZONE_HAUTE,
      zoom: echelle,
    });
  }, [zone, disposition.largeur, disposition.hauteur, compact, setViewport]);
  useEffect(recadrer, [recadrer]);

  return (
    <div ref={setConteneur} className="relative h-full w-full">
      <ReactFlow
        nodes={noeuds}
        edges={aretes}
        nodeTypes={TYPES_NOEUDS}
        edgeTypes={TYPES_ARETES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.3}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, noeud) => {
          if (noeud.data.type === "projet" && noeud.data.projet) onSelection({ type: "projet", id: noeud.data.projet.id });
          if (noeud.data.type === "machine") onSelection({ type: "machine", id: noeud.data.machine?.machine ?? noeud.data.roleMachine! });
          if (noeud.data.type === "orchestrateur") onSelection({ type: "orchestrateur", id: "maitre" });
          if (noeud.data.type === "etape" && noeud.data.etape) onSelection({ type: "run", id: noeud.data.etape.runId, etapeId: noeud.data.etape.id });
        }}
        onPaneClick={() => onSelection(null)}
      >
        <Background gap={24} size={1} color="var(--color-trait-fort)" />
      </ReactFlow>
      <div className="ao-graphe-outils"><button type="button" onClick={recadrer} aria-label="Recentrer les flux"><Icone nom="graphe" taille={16} /><span>Recentrer</span></button></div>
    </div>
  );
}

export function Topologie({ selection, onSelection }: { selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { donnees, erreur } = useCharge((source) => source.topologie(), []);
  if (erreur) return <Erreur>Liste des projets illisible : {erreur}</Erreur>;
  if (!donnees) return <p className="p-4 text-sm text-douce">Lecture des projets…</p>;
  const projets = donnees.projets.filter((projet) => projet.aFiche);

  return (
    <section className="ao-accueil">
      <header className="ao-accueil-tete">
        <div><span className="ao-accueil-kicker">Vue d’ensemble</span><h2>Chaque projet, son flux.</h2><p>Explore les machines, les projets et les étapes de leur dernier run.</p></div>
        <div className="ao-accueil-parcours" aria-label="Lecture des flux"><span>Pilotage</span><b aria-hidden="true">→</b><span>Machines</span><b aria-hidden="true">→</b><span>Projets</span><b aria-hidden="true">→</b><span>Étapes</span></div>
      </header>
      <Kpis />
      {donnees.anomalies.length > 0 && <div className="mb-2">{donnees.anomalies.map((anomalie) => <Erreur key={anomalie}>{anomalie}</Erreur>)}</div>}
      <div className="ao-canevas min-h-0 flex-1">
        <ReactFlowProvider>
          <Arbre topologie={donnees} selection={selection} onSelection={onSelection} />
        </ReactFlowProvider>
        <div className="ao-legende-graphe">
          <span>{projets.length} projet{projets.length === 1 ? "" : "s"}</span>
          <span><i className="pc" />PC</span>
          <span><i className="nas" />NAS</span>
          <span><i className="etape" />étapes</span>
          <span><i className="wait" />décision en attente</span>
          <span><i className="run" />étape en cours</span>
        </div>
      </div>
      <footer className="ao-accueil-note"><Icone nom="ouvrir" taille={13} /><span><span className="ao-accueil-mobile-note">Glisse pour explorer. </span>Clique sur une cellule pour l’inspecter.</span></footer>
    </section>
  );
}
