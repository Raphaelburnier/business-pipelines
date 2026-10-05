// Le graphe d'accueil montre les projets enregistrés, jamais les détails d'infrastructure.
// Les pipelines et leur exécution se consultent dans la fiche ouverte au clic.
import type { ProjetTopologie, Topologie } from "../types";

export type TypeNoeud = "projet";

export type NoeudDispose = {
  id: string;
  type: TypeNoeud;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  projet: ProjetTopologie;
};

export interface Disposition {
  noeuds: NoeudDispose[];
  largeur: number;
  hauteur: number;
}

const LARGEUR = 260;
const HAUTEUR = 92;
const ECART_X = 32;
const ECART_Y = 28;
const MARGE = 24;
const COLONNES = 3;

export const idProjet = (id: string) => `projet:${id}`;

/** Place une carte par projet connu. Les runs sans fiche ne créent pas de fausses cartes. */
export function disposer(topologie: Topologie, colonnesSouhaitees = COLONNES): Disposition {
  const projets = topologie.projets
    .filter((projet) => projet.aFiche)
    .slice()
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const colonnesMax = Math.max(1, Math.min(COLONNES, Math.floor(colonnesSouhaitees)));

  const noeuds = projets.map((projet, index) => {
    const colonne = index % colonnesMax;
    const rangee = Math.floor(index / colonnesMax);
    return {
      id: idProjet(projet.id),
      type: "projet" as const,
      x: MARGE + colonne * (LARGEUR + ECART_X),
      y: MARGE + rangee * (HAUTEUR + ECART_Y),
      largeur: LARGEUR,
      hauteur: HAUTEUR,
      projet,
    };
  });

  const colonnes = Math.min(projets.length, colonnesMax);
  const rangees = Math.ceil(projets.length / colonnesMax);
  return {
    noeuds,
    largeur: colonnes ? MARGE * 2 + colonnes * LARGEUR + (colonnes - 1) * ECART_X : 0,
    hauteur: rangees ? MARGE * 2 + rangees * HAUTEUR + (rangees - 1) * ECART_Y : 0,
  };
}
