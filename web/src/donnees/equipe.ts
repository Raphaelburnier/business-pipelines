// L'équipe d'agents (`GET /api/equipe`, src/equipe.js). Typée ici, comme les décisions,
// tant que la forme n'est pas promue dans les schémas du moteur.
import type { Llm } from "../types";

export type Famille = "claude" | "codex" | "libre";

/** Une note publique du modèle, avec ce que la source dit qu'elle a coûté à mesurer. */
export interface Benchmark {
  nom: string;
  score: number;
  max: number;
  /** Coût publié par la source pour faire tourner le benchmark, par `unite` ; `null` s'il n'est pas publié. */
  coutUsd: number | null;
  unite: string | null;
  variante: string | null;
  /** Mesure tierce, ou chiffre annoncé par le fournisseur du modèle. */
  mesure: "independant" | "editeur";
  source: string | null;
}

export interface Competences {
  modele: string;
  prix: { entreeUsdParM: number; sortieUsdParM: number } | null;
  releve: string | null;
  benchmarks: Benchmark[];
}

export interface MembreEquipe {
  id: string;
  /** Le nom affiché : celui choisi sur la page, sinon celui du roster. */
  nom: string;
  nomRoster: string;
  /** L'URL de la photo choisie sur la page ; `null` : portrait généré. */
  photo: string | null;
  role: string;
  famille: Famille;
  llm: Llm;
  registre: string[];
  budgetMensuelUsd: number | null;
  /** `null` pour un combo OmniRoute ou un modèle sans note relevée. */
  competences: Competences | null;
  etapesMois: { total: number; reussies: number };
  occupe: boolean;
  projet: string | null;
  depuis: string | null;
  enCours: { run: string; projet: string | null; noeud: string } | null;
  usage: { consommeMoisUsd: number; jetonsMois: number; budgetMensuelUsd: number | null; resteUsd: number | null };
}

/** Un champ absent n'est pas touché ; `null` rend le nom du roster ou retire la photo. */
export interface ChangementProfil {
  nom?: string | null;
  /** Data URL jpeg, png ou webp. */
  photo?: string | null;
}

export interface ReponseEquipe {
  agents: MembreEquipe[];
  /** Les fiches `projects/<id>` connues, proposées à l'affectation. */
  projets: string[];
  /** Faux quand l'event store est indisponible : activité et consommation sont alors inconnues. */
  mesure: boolean;
}
