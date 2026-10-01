// Le graphe d'architecture reste volontairement grand : on préfère déplacer la carte plutôt
// que réduire ses libellés jusqu'à l'illisible. Un filtre cadre le trajet choisi et atténue
// les autres liaisons sans faire disparaître le contexte du système.
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo } from "react";
import {
  BRIQUES,
  HAUTEUR_BRIQUE,
  LARGEUR_BRIQUE,
  LIENS,
  ZONES,
  type Brique,
  type Famille,
  type Statut,
  type ZoneCarte,
} from "./carte";

type Cote = "haut" | "droite" | "bas" | "gauche";
type DonneesZone = { zone: ZoneCarte };
type DonneesBrique = { brique: Brique; selectionnee: boolean; eteinte: boolean };

const POSITIONS: Record<Cote, Position> = {
  haut: Position.Top,
  droite: Position.Right,
  bas: Position.Bottom,
  gauche: Position.Left,
};
const MOT_STATUT: Record<Statut, string> = { actif: "en service", partiel: "partiel", arrete: "arrêté" };
const PAR_ID = new Map(BRIQUES.map((b) => [b.id, b]));

function poignees(largeur: number, hauteur: number) {
  const points: Record<Cote, { x: number; y: number }> = {
    haut: { x: largeur / 2, y: 0 },
    droite: { x: largeur, y: hauteur / 2 },
    bas: { x: largeur / 2, y: hauteur },
    gauche: { x: 0, y: hauteur / 2 },
  };
  return (Object.keys(points) as Cote[]).flatMap((cote) => [
    { id: `s-${cote}`, type: "source" as const, position: POSITIONS[cote], ...points[cote], width: 1, height: 1 },
    { id: `t-${cote}`, type: "target" as const, position: POSITIONS[cote], ...points[cote], width: 1, height: 1 },
  ]);
}

function Poignees() {
  return (
    <>
      {(Object.keys(POSITIONS) as Cote[]).map((cote) => (
        <span key={cote}>
          <Handle id={`s-${cote}`} type="source" position={POSITIONS[cote]} className="sy-poignee" />
          <Handle id={`t-${cote}`} type="target" position={POSITIONS[cote]} className="sy-poignee" />
        </span>
      ))}
    </>
  );
}

function NoeudZone({ data }: NodeProps<Node<DonneesZone>>) {
  return (
    <div className={`sy-zone ${data.zone.id}`}>
      <span className="titre">{data.zone.titre}</span>
      <span className="sous">{data.zone.sous}</span>
    </div>
  );
}

function NoeudBrique({ data }: NodeProps<Node<DonneesBrique>>) {
  const b = data.brique;
  return (
    <div
      className={`sy-brique ${b.genre} ${b.zone} ${data.selectionnee ? "selectionnee" : ""} ${data.eteinte ? "eteinte" : ""}`}
      title={b.resume}
    >
      <Poignees />
      <div className="ligne">
        <span className={`point ${b.statut}`} aria-hidden="true" />
        <span className="nom">{b.titre}</span>
        {b.statut !== "actif" ? <span className={`etiquette ${b.statut}`}>{MOT_STATUT[b.statut]}</span> : null}
      </div>
      <div className="sous">{b.sous}</div>
    </div>
  );
}

const TYPES_NOEUDS = { zone: NoeudZone, brique: NoeudBrique };

function centre(brique: Brique) {
  return { x: brique.x + LARGEUR_BRIQUE / 2, y: brique.y + HAUTEUR_BRIQUE / 2 };
}

function cotes(de: { x: number; y: number }, vers: { x: number; y: number }): [Cote, Cote] {
  const dx = vers.x - de.x;
  const dy = vers.y - de.y;
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return dx > 0 ? ["droite", "gauche"] : ["gauche", "droite"];
  return dy > 0 ? ["bas", "haut"] : ["haut", "bas"];
}

function Cadrage({ flux }: { flux: Famille | null }) {
  const { fitView, getNodes } = useReactFlow();

  useEffect(() => {
    const ids = flux ? new Set(LIENS.filter((l) => l.famille === flux).flatMap((l) => [l.de, l.vers])) : null;
    const minuterie = window.setTimeout(() => {
      const noeuds = getNodes().filter((n) => n.type === "brique" && (!ids || ids.has(n.id)));
      void fitView({
        nodes: noeuds,
        padding: flux ? 0.2 : 0.08,
        duration: 420,
        minZoom: flux ? 0.76 : 0.68,
        maxZoom: flux ? 1.05 : 0.82,
      });
    }, 0);
    return () => window.clearTimeout(minuterie);
  }, [fitView, flux, getNodes]);

  return null;
}

function Graphe({ flux, selection, onSelection }: Props) {
  const noeudsRelies = useMemo(
    () => new Set(flux ? LIENS.filter((l) => l.famille === flux).flatMap((l) => [l.de, l.vers]) : []),
    [flux],
  );
  const voisins = useMemo(() => {
    const ids = new Set<string>();
    if (!selection) return ids;
    for (const lien of LIENS) {
      if (flux && lien.famille !== flux) continue;
      if (lien.de === selection) ids.add(lien.vers);
      if (lien.vers === selection) ids.add(lien.de);
    }
    return ids;
  }, [flux, selection]);

  const noeuds = useMemo<Node[]>(
    () => [
      ...ZONES.map<Node<DonneesZone>>((zone) => ({
        id: `zone-${zone.id}`,
        type: "zone",
        position: { x: zone.x, y: zone.y },
        width: zone.largeur,
        height: zone.hauteur,
        style: { width: zone.largeur, height: zone.hauteur },
        selectable: false,
        draggable: false,
        connectable: false,
        zIndex: -1,
        data: { zone },
      })),
      ...BRIQUES.map<Node<DonneesBrique>>((brique) => ({
        id: brique.id,
        type: "brique",
        position: { x: brique.x, y: brique.y },
        width: LARGEUR_BRIQUE,
        height: HAUTEUR_BRIQUE,
        style: { width: LARGEUR_BRIQUE, height: HAUTEUR_BRIQUE },
        handles: poignees(LARGEUR_BRIQUE, HAUTEUR_BRIQUE),
        draggable: false,
        connectable: false,
        data: {
          brique,
          selectionnee: brique.id === selection,
          eteinte: selection
            ? brique.id !== selection && !voisins.has(brique.id)
            : flux !== null && !noeudsRelies.has(brique.id),
        },
      })),
    ],
    [flux, noeudsRelies, selection, voisins],
  );

  const aretes = useMemo<Edge[]>(
    () =>
      LIENS.flatMap((lien, index) => {
        const de = PAR_ID.get(lien.de);
        const vers = PAR_ID.get(lien.vers);
        if (!de || !vers) return [];
        const [sortie, entree] = cotes(centre(de), centre(vers));
        const familleActive = flux === null || flux === lien.famille;
        const touche = selection !== null && (lien.de === selection || lien.vers === selection);
        const attenuee = !familleActive || (selection !== null && !touche);
        const active = !attenuee && (flux !== null || touche);
        return [
          {
            id: `${lien.famille}-${lien.de}-${lien.vers}-${index}`,
            source: lien.de,
            target: lien.vers,
            sourceHandle: `s-${sortie}`,
            targetHandle: `t-${entree}`,
            type: "smoothstep",
            pathOptions: { borderRadius: 12 },
            label: active ? lien.libelle : undefined,
            labelShowBg: true,
            labelBgPadding: [5, 3] as [number, number],
            className: `sy-lien ${lien.famille} ${active ? "vif" : ""} ${attenuee ? "efface" : ""} ${lien.bloque ? "bloque" : ""}`,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: active ? 18 : 14,
              height: active ? 18 : 14,
              color: lien.bloque ? "var(--color-danger)" : `var(--sy-${lien.famille})`,
            },
            zIndex: active ? 3 : 1,
          },
        ];
      }),
    [flux, selection],
  );

  return (
    <ReactFlow
      nodes={noeuds}
      edges={aretes}
      nodeTypes={TYPES_NOEUDS}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      minZoom={0.38}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, noeud) => {
        if (noeud.type === "brique") onSelection(noeud.id === selection ? null : noeud.id);
      }}
      onPaneClick={() => onSelection(null)}
      aria-label="Graphe de l'architecture AgenticOS"
    >
      <Cadrage flux={flux} />
      <Background gap={24} size={1} color="var(--color-trait)" />
      <Controls showInteractive={false} position="bottom-left" className="sy-zoom" />
    </ReactFlow>
  );
}

interface Props {
  flux: Famille | null;
  selection: string | null;
  onSelection: (id: string | null) => void;
}

export function GrapheArchitecture(props: Props) {
  return (
    <ReactFlowProvider>
      <Graphe {...props} />
    </ReactFlowProvider>
  );
}
