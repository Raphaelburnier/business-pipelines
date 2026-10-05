// L'accueil est le graphe des projets. Les détails d'exécution s'ouvrent au clic sur une carte.
import "@xyflow/react/dist/style.css";
import { Background, ReactFlow, ReactFlowProvider, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { useCharge } from "../donnees/contexte";
import { CLASSES_TON, mot, ton, vivant } from "../format";
import type { ProjetTopologie as Projet, Topologie as DonneesTopologie } from "../types";
import { Erreur } from "../ui";
import { Kpis } from "../vues/Kpis";
import { disposer, type NoeudDispose } from "./disposition";

export type Selection = { type: "projet"; id: string } | { type: "machine"; id: string } | { type: "run"; id: string };

type DonneesNoeud = NoeudDispose & { selectionne: boolean };

function NoeudProjet({ data }: NodeProps<Node<DonneesNoeud>>) {
  const projet: Projet = data.projet;
  const classe = CLASSES_TON[ton(projet.etat)];
  const attente = projet.approbationsEnAttente > 0;

  return (
    <button
      type="button"
      className={`ao-noeud projet ${classe.texte} ${attente ? "attente" : ""} ${data.selectionne ? "selectionne" : ""}`}
      aria-label={`Ouvrir la fiche de ${projet.nom}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${vivant(projet.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{projet.nom}</span>
        {attente && <span className="badge alerte" title={`${projet.approbationsEnAttente} décision(s) en attente`}>{projet.approbationsEnAttente}</span>}
      </span>
      <span className="sous">
        <span>{mot(projet.etat)}</span>
        <span className="ml-auto text-accent">Ouvrir la fiche →</span>
      </span>
    </button>
  );
}

const TYPES_NOEUDS = { cockpit: NoeudProjet };
const ZOOM_MAX = 1.2;
const ZONE_HAUTE = 64;
const ZONE_BASSE = 36;

function Arbre({ topologie, selection, onSelection }: { topologie: DonneesTopologie; selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { setViewport } = useReactFlow();
  const [conteneur, setConteneur] = useState<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<{ largeur: number; hauteur: number } | null>(null);
  const colonnes = zone && zone.largeur < 720 ? 1 : zone && zone.largeur < 1120 ? 2 : 3;
  const disposition = useMemo(() => disposer(topologie, colonnes), [topologie, colonnes]);
  const noeuds: Node<DonneesNoeud>[] = disposition.noeuds.map((n) => ({
    id: n.id,
    type: "cockpit",
    position: { x: n.x, y: n.y },
    width: n.largeur,
    height: n.hauteur,
    style: { width: n.largeur, height: n.hauteur },
    draggable: false,
    connectable: false,
    data: { ...n, selectionne: selection?.type === "projet" && n.projet.id === selection.id },
  }));

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

  if (!noeuds.length) {
    return (
      <div ref={setConteneur} className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-sm rounded-xl border border-trait bg-surface p-6">
          <h2 className="font-semibold">Aucun projet enregistré</h2>
          <p className="mt-2 text-sm text-douce">Les projets apparaîtront ici lorsqu’ils auront une fiche dans le registre.</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={setConteneur} className="relative h-full w-full">
      <ReactFlow
        nodes={noeuds}
        edges={[]}
        nodeTypes={TYPES_NOEUDS}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.3}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, noeud) => onSelection({ type: "projet", id: noeud.data.projet.id })}
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
      {donnees.anomalies.length > 0 && (
        <div className="mb-2">
          {donnees.anomalies.map((anomalie) => <Erreur key={anomalie}>{anomalie}</Erreur>)}
        </div>
      )}
      <div className="ao-canevas min-h-0 flex-1">
        <Kpis flottant />
        <ReactFlowProvider>
          <Arbre topologie={donnees} selection={selection} onSelection={onSelection} />
        </ReactFlowProvider>
        <div className="ao-legende-graphe">
          <span>{projets.length} projet{projets.length === 1 ? "" : "s"}</span>
          <span><i className="wait" />à valider</span>
        </div>
      </div>
    </div>
  );
}
