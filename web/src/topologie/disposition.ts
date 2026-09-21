// La disposition de l'arbre de topologie (§11.1), sans React.
//
// Quatre rangs, de haut en bas : maître, machines, catégories, projets. Les positions sont
// CALCULÉES à chaque changement (dagre, `rankdir: TB`) et jamais persistées : dans cette
// vue, personne ne déplace un nœud à la main (annexe A).
//
// Ce n'est pas un arbre strict. Un projet dont des étapes tournent sur une autre machine que
// sa `homeMachine` reçoit, en plus de son trait plein, une arête en pointillés vers cette
// autre machine. dagre la route lui-même : elle suit un couloir libre au lieu de passer
// derrière une case voisine, et le projet partagé se place entre ses deux machines.
//
// Fonction pure : même topologie et mêmes plis, même dessin. C'est ce qui la rend testable.
import dagre from "@dagrejs/dagre";
import type { EtatMachine, Machine, ProjetTopologie, Topologie } from "../types";

export type TypeNoeud = "maitre" | "machine" | "categorie" | "projet";

export type NoeudDispose = {
  id: string;
  type: TypeNoeud;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  /** Nombre de projets masqués sous ce nœud quand il est plié. */
  masques: number;
  plie: boolean;
  machine?: Machine;
  categorie?: { nom: string; machine: string; projets: number };
  projet?: ProjetTopologie;
  maitre?: { nom: string; etat: EtatMachine };
};

export interface AreteDisposee {
  id: string;
  source: string;
  cible: string;
  pointillee: boolean;
  animee: boolean;
  /** Le tracé calculé par dagre, pour les arêtes qui doivent contourner des nœuds. */
  points?: Array<{ x: number; y: number }>;
}

export interface Disposition {
  noeuds: NoeudDispose[];
  aretes: AreteDisposee[];
  largeur: number;
  hauteur: number;
}

const TAILLES: Record<TypeNoeud, [number, number]> = {
  maitre: [180, 56],
  machine: [200, 64],
  categorie: [170, 48],
  projet: [210, 76],
};

export const idMachine = (m: string) => `machine:${m}`;
export const idCategorie = (m: string, c: string) => `categorie:${m}:${c}`;
export const idProjet = (p: string) => `projet:${p}`;

// Une machine qu'un projet déclare mais qu'aucun worker n'a jamais annoncée : elle apparaît
// quand même, hors ligne et marquée comme jamais vue. La cacher ferait disparaître ses
// projets de l'arbre.
function machineFantome(id: string): Machine {
  return { machine: id, nom: `${id} (jamais vue)`, etat: "offline", dernierHeartbeat: null, depuisSecondes: null, meta: null };
}

const OCCUPEE: ReadonlySet<EtatMachine> = new Set(["busy", "waking"]);

/**
 * @param topologie ce que rend `GET /api/topology`
 * @param plies identifiants des nœuds pliés (machines et catégories)
 */
export function disposer(topologie: Topologie, plies: ReadonlySet<string>): Disposition {
  const machines = new Map(topologie.machines.map((m) => [m.machine, m]));
  for (const p of topologie.projets) {
    for (const m of [p.homeMachine, ...p.machines]) if (!machines.has(m)) machines.set(m, machineFantome(m));
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 24, ranksep: 64, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));

  const noeuds = new Map<string, Omit<NoeudDispose, "x" | "y">>();
  const aretes: AreteDisposee[] = [];
  const ajouter = (n: Omit<NoeudDispose, "x" | "y" | "largeur" | "hauteur">) => {
    const [largeur, hauteur] = TAILLES[n.type];
    noeuds.set(n.id, { ...n, largeur, hauteur });
    g.setNode(n.id, { width: largeur, height: hauteur });
  };
  const relier = (source: string, cible: string, animee: boolean) => {
    aretes.push({ id: `${source}->${cible}`, source, cible, pointillee: false, animee });
    g.setEdge(source, cible);
  };

  ajouter({ id: "maitre", type: "maitre", masques: 0, plie: false, maitre: topologie.maitre });

  const projetsVisibles: ProjetTopologie[] = [];
  for (const machine of [...machines.values()].sort((a, b) => a.machine.localeCompare(b.machine))) {
    const idM = idMachine(machine.machine);
    const siens = topologie.projets.filter((p) => p.homeMachine === machine.machine);
    const plieM = plies.has(idM);
    ajouter({ id: idM, type: "machine", masques: plieM ? siens.length : 0, plie: plieM, machine });
    relier("maitre", idM, OCCUPEE.has(machine.etat));
    if (plieM) continue;

    const categories = [...new Set(siens.map((p) => p.categorie))].sort();
    for (const categorie of categories) {
      const idC = idCategorie(machine.machine, categorie);
      const projets = siens.filter((p) => p.categorie === categorie);
      const plieC = plies.has(idC);
      ajouter({
        id: idC,
        type: "categorie",
        masques: plieC ? projets.length : 0,
        plie: plieC,
        categorie: { nom: categorie, machine: machine.machine, projets: projets.length },
      });
      relier(idM, idC, projets.some((p) => p.etat === "actif"));
      if (plieC) continue;
      for (const projet of projets) {
        ajouter({ id: idProjet(projet.id), type: "projet", masques: 0, plie: false, projet });
        relier(idC, idProjet(projet.id), projet.etat === "actif");
        projetsVisibles.push(projet);
      }
    }
  }

  // Les pointillés : un projet visible vers chaque autre machine qu'il utilise. Ils entrent
  // dans le calcul, et dagre leur réserve un couloir entre les nœuds. Tracés en courbe
  // directe, ils passaient derrière une catégorie voisine et semblaient la traverser ; avec
  // un poids nul, dagre les renvoyait faire le tour du graphe par la droite. `minlen: 2`
  // garde les rangs : le projet reste deux rangs sous la machine.
  const pointillees: AreteDisposee[] = [];
  for (const projet of projetsVisibles) {
    for (const autre of projet.machines) {
      if (autre === projet.homeMachine || !noeuds.has(idMachine(autre))) continue;
      pointillees.push({
        id: `${idMachine(autre)}..>${idProjet(projet.id)}`,
        source: idMachine(autre),
        cible: idProjet(projet.id),
        pointillee: true,
        animee: projet.etat === "actif",
      });
      g.setEdge(idMachine(autre), idProjet(projet.id), { weight: 1, minlen: 2 });
    }
  }

  dagre.layout(g);

  for (const a of pointillees) {
    const trace = g.edge(a.source, a.cible) as { points?: Array<{ x: number; y: number }> } | undefined;
    aretes.push({ ...a, points: trace?.points });
  }

  const disposes: NoeudDispose[] = [...noeuds.values()].map((n) => {
    const { x, y } = g.node(n.id);
    // dagre donne le centre ; React Flow attend le coin haut gauche.
    return { ...n, x: x - n.largeur / 2, y: y - n.hauteur / 2 };
  });
  const graphe = g.graph();
  return { noeuds: disposes, aretes, largeur: graphe.width ?? 0, hauteur: graphe.height ?? 0 };
}

/** Un nœud qui se plie : les machines et les catégories (rangs 1 et 2). */
export const pliable = (type: TypeNoeud) => type === "machine" || type === "categorie";
