// La topologie (§11.1) : maître → machines → catégories → projets, en arbre descendant.
//
// Positions calculées (voir disposition.ts), nœuds non déplaçables. Clic : panneau latéral.
// Double-clic sur une machine ou une catégorie : plier ou déplier, état gardé dans le
// navigateur. Clic droit : menu contextuel. Le flux met l'arbre à jour en direct.
import "@xyflow/react/dist/style.css";
import { Background, BaseEdge, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { useCharge, useHorloge } from "../donnees/contexte";
import { CLASSES_TON, depuis, mot, ton, vivant } from "../format";
import type { Topologie as DonneesTopologie } from "../types";
import { Erreur } from "../ui";
import { Kpis } from "../vues/Kpis";
import { disposer, pliable, type NoeudDispose } from "./disposition";

export type Selection = { type: "projet"; id: string } | { type: "machine"; id: string } | { type: "run"; id: string };

const CLE_PLIS = "cockpit.topologie.plis";

// L'état plié vit dans le navigateur, par utilisateur (§11.1). Un stockage indisponible
// (navigation privée) ne casse rien : l'arbre s'ouvre simplement déplié.
function lirePlis(): Set<string> | null {
  try {
    const brut = localStorage.getItem(CLE_PLIS);
    return brut ? new Set(JSON.parse(brut) as string[]) : null;
  } catch {
    return null;
  }
}

function ecrirePlis(plis: ReadonlySet<string>) {
  try {
    localStorage.setItem(CLE_PLIS, JSON.stringify([...plis]));
  } catch {
    // Pas de stockage : le pli ne survivra pas au rechargement, et c'est tout.
  }
}

type DonneesNoeud = NoeudDispose & { maintenant: number; selectionne: boolean };

/** PC ou NAS : la forme distingue la machine même sans la couleur (angles vifs contre arrondis). */
function genreMachine(n: NoeudDispose): "pc" | "nas" | "" {
  const m = n.machine?.machine ?? n.categorie?.machine ?? n.projet?.homeMachine;
  if (!m) return "";
  return /nas/i.test(m) ? "nas" : "pc";
}

function NoeudCockpit({ data }: NodeProps<Node<DonneesNoeud>>) {
  const n = data;
  const etat = n.projet?.etat ?? n.machine?.etat ?? n.maitre?.etat ?? null;
  const c = etat ? CLASSES_TON[ton(etat)] : CLASSES_TON.doux;
  const genre = n.type === "maitre" ? "maitre" : n.type === "categorie" ? "categorie" : genreMachine(n);
  const attente = (n.projet?.approbationsEnAttente ?? 0) > 0 || n.projet?.etat === "attente";

  return (
    <div
      className={`ao-noeud ${genre} ${attente ? "attente" : ""} ${n.selectionne ? "selectionne" : ""}`}
      title={pliable(n.type) ? "Double-clic pour plier ou déplier" : undefined}
    >
      <Handle type="target" position={Position.Top} className="!h-1 !w-1 !border-0 !bg-trait-fort" />
      <div className="flex items-center gap-2">
        {etat && n.type !== "maitre" && <span className={`h-2 w-2 shrink-0 rounded-full ${c.plein} ${vivant(etat) ? "pulse-douce" : ""}`} />}
        <span className="nom">{n.maitre?.nom ?? n.machine?.nom ?? n.machine?.machine ?? n.categorie?.nom ?? n.projet?.nom}</span>
        {n.plie && n.masques > 0 && <span className="ml-auto font-mono text-[10px] text-douce">+{n.masques}</span>}
      </div>
      <div className="sous">
        {n.type === "maitre" && <span>orchestrateur · {mot(n.maitre!.etat)}</span>}
        {n.machine && (
          <>
            <span className={c.texte}>{mot(n.machine.etat)}</span>
            <span>vue il y a {depuis(n.machine.dernierHeartbeat, n.maintenant)}</span>
          </>
        )}
        {n.categorie && (
          <span>
            {n.categorie.projets} projet{n.categorie.projets > 1 ? "s" : ""}
          </span>
        )}
        {n.projet && (
          <>
            <span className={c.texte}>{mot(n.projet.etat)}</span>
            <span>{n.projet.pipelines[0] ?? "sans pipeline"}</span>
            {n.projet.machines.length > 1 && <span>multi-machine</span>}
            {!n.projet.aFiche && <span className="text-alerte">sans fiche</span>}
          </>
        )}
      </div>
      {attente && n.projet && (
        <span className="badge alerte" title={`${n.projet.approbationsEnAttente} décision(s) en attente`}>
          {n.projet.approbationsEnAttente || "!"}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} className="!h-1 !w-1 !border-0 !bg-trait-fort" />
    </div>
  );
}

const TYPES_NOEUDS = { cockpit: NoeudCockpit };

const ZOOM_MIN = 0.3;
const ZOOM_MAX = 1.2;
// La barre KPI flotte en haut du canevas, la légende en bas : l'arbre se cadre entre les deux.
const HAUT_LIBRE = 64;
const BAS_LIBRE = 40;

type Point = { x: number; y: number };
type DonneesArete = { points?: Point[] };

// Une courbe qui passe par les points intermédiaires de dagre : les extrémités restent
// accrochées aux poignées, le milieu suit le couloir réservé entre les nœuds.
function cheminLisse(points: Point[]): string {
  const [premier, ...reste] = points;
  if (!premier) return "";
  let d = `M${premier.x},${premier.y}`;
  for (let i = 0; i < reste.length - 1; i += 1) {
    const p = reste[i]!;
    const suivant = reste[i + 1]!;
    d += ` Q${p.x},${p.y} ${(p.x + suivant.x) / 2},${(p.y + suivant.y) / 2}`;
  }
  const dernier = reste[reste.length - 1];
  return dernier ? `${d} L${dernier.x},${dernier.y}` : d;
}

function AreteChemin({ id, data, style, sourceX, sourceY, targetX, targetY }: EdgeProps<Edge<DonneesArete>>) {
  const interieurs = (data?.points ?? []).slice(1, -1);
  const chemin = cheminLisse([{ x: sourceX, y: sourceY }, ...interieurs, { x: targetX, y: targetY }]);
  return <BaseEdge id={id} path={chemin} style={style} />;
}

const TYPES_ARETES = { chemin: AreteChemin };

interface Menu {
  x: number;
  y: number;
  noeud: NoeudDispose;
}

function Arbre({
  topologie,
  selection,
  onSelection,
}: {
  topologie: DonneesTopologie;
  selection: Selection | null;
  onSelection: (s: Selection | null) => void;
}) {
  const maintenant = useHorloge(5000);
  const { setViewport } = useReactFlow();
  const [plis, setPlis] = useState<Set<string>>(() => {
    const lus = lirePlis();
    if (lus) return lus;
    // Sur mobile, l'arbre s'ouvre plié au rang 2 (§11.8) : les catégories seulement.
    if (window.innerWidth < 640) return new Set(disposer(topologie, new Set()).noeuds.filter((n) => n.type === "categorie").map((n) => n.id));
    return new Set();
  });
  const [menu, setMenu] = useState<Menu | null>(null);

  const disposition = useMemo(() => disposer(topologie, plis), [topologie, plis]);

  const noeuds: Node<DonneesNoeud>[] = disposition.noeuds.map((n) => ({
    id: n.id,
    type: "cockpit",
    position: { x: n.x, y: n.y },
    // Les dimensions sont connues d'avance (c'est la disposition qui les fixe) : les donner
    // à React Flow lui évite de cacher chaque nœud jusqu'à l'avoir mesuré. Un nœud recréé à
    // chaque événement du flux restait sinon invisible entre deux mesures.
    width: n.largeur,
    height: n.hauteur,
    // Même raison pour les poignées : sans leur position, React Flow ne trace aucune arête
    // tant qu'il ne les a pas mesurées dans le DOM.
    handles: [
      { type: "target", position: Position.Top, x: n.largeur / 2, y: 0, width: 1, height: 1 },
      { type: "source", position: Position.Bottom, x: n.largeur / 2, y: n.hauteur, width: 1, height: 1 },
    ],
    style: { width: n.largeur, height: n.hauteur },
    draggable: false,
    connectable: false,
    data: {
      ...n,
      maintenant,
      selectionne:
        (selection?.type === "projet" && n.projet?.id === selection.id) || (selection?.type === "machine" && n.machine?.machine === selection.id),
    },
  }));
  // La grammaire des arêtes (AgenticOS) : jaune en tirets animés quand un run circule, rose
  // en pointillé fin quand le projet attend une décision, pointillé gris vers l'autre machine
  // d'un projet multi-machine, trait plein au repos. Couleur ET motif diffèrent à chaque fois.
  const parId = new Map(disposition.noeuds.map((n) => [n.id, n]));
  const aretes: Edge<DonneesArete>[] = disposition.aretes.map((a) => {
    const cible = parId.get(a.cible)?.projet;
    const attente = !a.animee && !!cible && (cible.etat === "attente" || cible.approbationsEnAttente > 0);
    const style = a.animee
      ? { stroke: "var(--color-accent)", strokeWidth: 1.75, strokeDasharray: "6 6" }
      : attente
        ? { stroke: "var(--color-givre)", strokeWidth: 1.75, strokeDasharray: "2 5" }
        : a.pointillee
          ? { stroke: "var(--color-trait-fort)", strokeWidth: 1.25, strokeDasharray: "2 4", opacity: 0.7 }
          : { stroke: "var(--color-trait-fort)", strokeWidth: 1.25 };
    return {
      id: a.id,
      source: a.source,
      target: a.cible,
      ...(a.points ? { type: "chemin", data: { points: a.points } } : {}),
      className: a.animee ? "arete-active" : attente ? "arete-attente" : undefined,
      style,
    };
  });

  // Le cadrage est calculé ici, pas confié au `fitView` de React Flow : celui-ci dépend de
  // mesures du DOM qui n'arrivaient pas toujours, et le téléphone gardait un zoom qui coupait
  // la moitié droite de l'arbre. La disposition connaît la taille exacte du graphe ; il ne
  // manque que celle de la zone, que donne un observateur. Recadré quand l'une ou l'autre
  // change (pli, panneau latéral ouvert, rotation), jamais à chaque événement du flux : un
  // déplacement fait à la main n'est pas repris sous le doigt.
  const [conteneur, setConteneur] = useState<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<{ largeur: number; hauteur: number } | null>(null);
  useEffect(() => {
    if (!conteneur) return undefined;
    const observateur = new ResizeObserver(([entree]) => {
      if (entree) setZone({ largeur: entree.contentRect.width, hauteur: entree.contentRect.height });
    });
    observateur.observe(conteneur);
    return () => observateur.disconnect();
  }, [conteneur]);

  useEffect(() => {
    if (!zone || zone.largeur === 0 || disposition.largeur === 0) return;
    const marge = 16;
    const zoom = Math.min(
      (zone.largeur - 2 * marge) / disposition.largeur,
      (zone.hauteur - HAUT_LIBRE - BAS_LIBRE) / disposition.hauteur,
      ZOOM_MAX
    );
    const echelle = Math.max(zoom, ZOOM_MIN);
    void setViewport({
      x: Math.max(marge, (zone.largeur - disposition.largeur * echelle) / 2),
      // Collé en haut plutôt que centré : sur un téléphone en hauteur, un arbre centré laisse
      // la moitié de l'écran vide au-dessus de lui.
      y: HAUT_LIBRE,
      zoom: echelle,
    });
  }, [zone, disposition.largeur, disposition.hauteur, setViewport]);

  const basculer = (id: string) =>
    setPlis((avant) => {
      const apres = new Set(avant);
      if (apres.has(id)) apres.delete(id);
      else apres.add(id);
      ecrirePlis(apres);
      return apres;
    });

  return (
    <div ref={setConteneur} className="relative h-full w-full" onClick={() => setMenu(null)}>
      <ReactFlow
        nodes={noeuds}
        edges={aretes}
        nodeTypes={TYPES_NOEUDS}
        edgeTypes={TYPES_ARETES}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, noeud) => {
          const n = noeud.data;
          if (n.projet) onSelection({ type: "projet", id: n.projet.id });
          else if (n.machine) onSelection({ type: "machine", id: n.machine.machine });
          else onSelection(null);
        }}
        onNodeDoubleClick={(_, noeud) => {
          if (pliable(noeud.data.type)) basculer(noeud.id);
        }}
        onNodeContextMenu={(evenement, noeud) => {
          evenement.preventDefault();
          setMenu({ x: evenement.clientX, y: evenement.clientY, noeud: noeud.data });
        }}
        onPaneClick={() => onSelection(null)}
      >
        <Background gap={24} size={1} color="var(--color-trait-fort)" />
      </ReactFlow>

      {menu && (
        <MenuContextuel
          menu={menu}
          onFermer={() => setMenu(null)}
          onPlier={basculer}
          onSelection={onSelection}
        />
      )}
    </div>
  );
}

// Le menu contextuel ne propose que ce qui marche aujourd'hui. Lancer, mettre en pause ou
// arrêter arrivent avec la phase 5 : des entrées qui ne font rien apprendraient à se méfier
// des autres.
function MenuContextuel({
  menu,
  onFermer,
  onPlier,
  onSelection,
}: {
  menu: Menu;
  onFermer: () => void;
  onPlier: (id: string) => void;
  onSelection: (s: Selection) => void;
}) {
  const { noeud } = menu;
  const entrees: Array<{ libelle: string; action: () => void }> = [];
  if (noeud.projet?.dernierRun) {
    const run = noeud.projet.dernierRun;
    entrees.push({ libelle: "Ouvrir le dernier run", action: () => onSelection({ type: "run", id: run.id }) });
  }
  if (noeud.projet) entrees.push({ libelle: "Voir le projet", action: () => onSelection({ type: "projet", id: noeud.projet!.id }) });
  if (noeud.machine) entrees.push({ libelle: "Voir la machine", action: () => onSelection({ type: "machine", id: noeud.machine!.machine }) });
  if (pliable(noeud.type)) entrees.push({ libelle: noeud.plie ? "Déplier" : "Plier", action: () => onPlier(noeud.id) });
  if (!entrees.length) return null;

  return (
    <ul
      className="fixed z-20 min-w-44 overflow-hidden rounded-lg border border-trait bg-surface py-1 text-sm shadow-lg"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {entrees.map((e) => (
        <li key={e.libelle}>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left hover:bg-carte"
            onClick={() => {
              e.action();
              onFermer();
            }}
          >
            {e.libelle}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Topologie({ selection, onSelection }: { selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { donnees, erreur } = useCharge((source) => source.topologie(), []);
  if (erreur) return <Erreur>Topologie illisible : {erreur}</Erreur>;
  if (!donnees) return <p className="p-4 text-sm text-douce">Lecture de la topologie…</p>;
  return (
    <div className="flex h-full flex-col">
      {donnees.anomalies.length > 0 && (
        <div className="mb-2">
          {donnees.anomalies.map((a) => (
            <Erreur key={a}>{a}</Erreur>
          ))}
        </div>
      )}
      <div className="ao-canevas min-h-0 flex-1">
        <Kpis flottant />
        <ReactFlowProvider>
          <Arbre topologie={donnees} selection={selection} onSelection={onSelection} />
        </ReactFlowProvider>
        <div className="ao-legende-graphe" aria-hidden="true">
          <span><i className="run" />en cours</span>
          <span><i className="wait" />à valider</span>
          <span><i className="multi" />autre machine</span>
        </div>
      </div>
    </div>
  );
}
