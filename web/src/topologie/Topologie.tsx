// L'accueil relie l'infrastructure, les projets et quelques jalons du dernier run.
import "@xyflow/react/dist/style.css";
import { Background, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { useCharge } from "../donnees/contexte";
import { CLASSES_TON, mot, ton, vivant } from "../format";
import type { ProjetTopologie as Projet, Topologie as DonneesTopologie } from "../types";
import { Erreur } from "../ui";
import { Kpis } from "../vues/Kpis";
import { disposer, idEtape, idMachine, idOrchestrateur, idProjet, roleDeMachine, type ExecutionProjet, type NoeudDispose } from "./disposition";

export type Selection = { type: "projet"; id: string } | { type: "machine"; id: string } | { type: "run"; id: string };

type DonneesNoeud = NoeudDispose & { selectionne: boolean; attenue: boolean };
type AreteFluide = Edge & { pathOptions: { borderRadius: number } };

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
    >
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${vivant(projet.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{projet.nom}</span>
        {attente && <span className="badge alerte" title={`${projet.approbationsEnAttente} décision(s) en attente`}>{projet.approbationsEnAttente}</span>}
      </span>
      <span className="sous">
        <span>{machine}</span>
        <span className="truncate">{projet.pipelines[0] ?? "sans pipeline"}</span>
        <span className="ml-auto shrink-0 text-accent">ouvrir →</span>
      </span>
    </button>
  );
}

function NoeudMachine({ data }: NodeProps<Node<DonneesNoeud>>) {
  const role = data.roleMachine!;
  const nom = role === "pc" ? "PC" : "NAS";
  const classe = data.etat ? CLASSES_TON[ton(data.etat)] : CLASSES_TON.doux;
  const selectionnable = Boolean(data.machine);
  const contenu = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${data.etat && vivant(data.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{nom}</span>
        {data.etat && <span className={`ml-auto text-[10px] ${classe.texte}`}>{mot(data.etat)}</span>}
      </span>
      <span className="sous"><span>{data.sousTitre}</span>{data.machine?.nom && <span className="truncate">{data.machine.nom}</span>}</span>
    </>
  );

  return selectionnable ? (
    <button type="button" className={`ao-noeud infrastructure clickable ${role} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label={`Ouvrir la machine ${nom}`}>
      {contenu}
    </button>
  ) : <div className={`ao-noeud infrastructure ${role} ${data.attenue ? "estompe" : ""}`}>{contenu}</div>;
}

function NoeudOrchestrateur({ data }: NodeProps<Node<DonneesNoeud>>) {
  const etat = data.maitre!.etat;
  const classe = CLASSES_TON[ton(etat)];
  return (
    <div className={`ao-noeud orchestrateur infrastructure ${data.attenue ? "estompe" : ""}`}>
      <span className="flex min-w-0 items-center gap-2"><i className={`h-2 w-2 rounded-full ${classe.plein} ${vivant(etat) ? "pulse-douce" : ""}`} /><span className="nom">Orchestrateur</span></span>
      <span className="sous"><span>{data.sousTitre}</span><span className="ml-auto">{mot(etat)}</span></span>
    </div>
  );
}

function NoeudEtape({ data }: NodeProps<Node<DonneesNoeud>>) {
  const etape = data.etape!;
  const classe = CLASSES_TON[ton(etape.statut)];
  return (
    <button type="button" className={`ao-noeud etape ${classe.texte} ${data.attenue ? "estompe" : ""}`} aria-label={`Ouvrir le run ${etape.runId}, étape ${etape.nom}`}>
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
  switch (props.data.type) {
    case "projet": return <NoeudProjet {...props} />;
    case "machine": return <NoeudMachine {...props} />;
    case "orchestrateur": return <NoeudOrchestrateur {...props} />;
    case "etape": return <NoeudEtape {...props} />;
  }
}

const TYPES_NOEUDS = { cockpit: NoeudGraphe };
const ZOOM_MAX = 1.2;
const ZONE_HAUTE = 64;
const ZONE_BASSE = 36;

function Arbre({ topologie, selection, onSelection }: { topologie: DonneesTopologie; selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { setViewport } = useReactFlow();
  const [conteneur, setConteneur] = useState<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<{ largeur: number; hauteur: number } | null>(null);
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
  const disposition = useMemo(() => disposer(topologie, executions.donnees ?? []), [topologie, executions.donnees]);
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
    style: { width: n.largeur, height: n.hauteur },
    draggable: false,
    connectable: false,
    data: {
      ...n,
      selectionne: (selection?.type === "projet" && n.projet?.id === selection.id) || (selection?.type === "machine" && n.machine?.machine === selection.id),
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
      type: "smoothstep",
      pathOptions: { borderRadius: 12 },
      label: active ? libelle : undefined,
      labelShowBg: true,
      labelBgPadding: [5, 3],
      className: `ao-flux ${famille} ${active ? "actif" : ""} ${attenuee ? "estompe" : ""} ${attente ? "attente" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: active ? 18 : 14, height: active ? 18 : 14, color: couleur },
      zIndex: active ? 1 : 0,
      style: { stroke: couleur, strokeWidth: active ? 2.75 : 2, strokeDasharray: famille === "pc" ? "6 4" : famille === "nas" ? "2 4" : famille === "etape" ? "1 5" : undefined, opacity: attenuee ? 0.08 : active ? 1 : 0.65 },
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
    relier(idMachine(role), idProjet(projet.id), role, projet.pipelines[0] ?? "pipeline", projet.etat === "actif" || (aFocal && estFocal), aFocal && !estFocal);
    const execution = executions.donnees?.find((entree) => entree.projetId === projet.id);
    if (!execution) continue;
    const etapes = disposition.noeuds.filter((noeud) => noeud.type === "etape" && noeud.etape?.runId === execution.run.id);
    for (const etape of etapes) {
      const statut = etape.etape?.statut;
      const attente = statut === "waiting_approval" || statut === "waiting_quota";
      const actif = statut === "running" || attente || (aFocal && estFocal);
      relier(idProjet(projet.id), etape.id, "etape", attente ? "décision attendue" : statut === "running" ? "en cours" : "étape clé", actif, aFocal && !estFocal, attente);
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

  useEffect(() => {
    if (!zone || !disposition.largeur || !disposition.hauteur) return;
    const marge = 16;
    const zoom = Math.min(
      (zone.largeur - marge * 2) / disposition.largeur,
      (zone.hauteur - ZONE_HAUTE - ZONE_BASSE) / disposition.hauteur,
      ZOOM_MAX,
    );
    const echelle = Math.max(zoom, 0.3);
    void setViewport({
      x: Math.max(marge, (zone.largeur - disposition.largeur * echelle) / 2),
      y: ZONE_HAUTE,
      zoom: echelle,
    });
  }, [zone, disposition.largeur, disposition.hauteur, setViewport]);

  return (
    <div ref={setConteneur} className="relative h-full w-full">
      <ReactFlow
        nodes={noeuds}
        edges={aretes}
        nodeTypes={TYPES_NOEUDS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, noeud) => {
          if (noeud.data.type === "projet" && noeud.data.projet) onSelection({ type: "projet", id: noeud.data.projet.id });
          if (noeud.data.type === "machine" && noeud.data.machine) onSelection({ type: "machine", id: noeud.data.machine.machine });
          if (noeud.data.type === "etape" && noeud.data.etape) onSelection({ type: "run", id: noeud.data.etape.runId });
        }}
        onPaneClick={() => onSelection(null)}
      >
        <Background gap={24} size={1} color="var(--color-trait-fort)" />
      </ReactFlow>
    </div>
  );
}

export function Topologie({ selection, onSelection }: { selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { donnees, erreur } = useCharge((source) => source.topologie(), []);
  if (erreur) return <Erreur>Liste des projets illisible : {erreur}</Erreur>;
  if (!donnees) return <p className="p-4 text-sm text-douce">Lecture des projets…</p>;
  const projets = donnees.projets.filter((projet) => projet.aFiche);

  return (
    <div className="flex h-full flex-col">
      {donnees.anomalies.length > 0 && <div className="mb-2">{donnees.anomalies.map((anomalie) => <Erreur key={anomalie}>{anomalie}</Erreur>)}</div>}
      <div className="ao-canevas min-h-0 flex-1">
        <Kpis flottant />
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
    </div>
  );
}
