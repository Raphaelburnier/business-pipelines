// La seule frontière entre l'écran et les données.
//
// Annexe A : le front se construit d'abord sur une maquette alimentée par des fixtures, puis
// on remplace LA SEULE couche de données par l'API réelle. Les deux implémentations
// respectent cette interface ; aucune vue ne sait laquelle elle lit.
//
// Le flux ne porte pas l'état, il dit qu'il a changé : une vue recharge ce qu'elle affiche à
// l'arrivée d'un événement. Reconstruire l'état à partir des événements finirait par
// diverger de la base le jour où un événement manque.
import type { Evenement, Llm, ReponseModeles, Run, RunDetaille, StatutRun, Topologie, Usage } from "../types";

export interface FiltreRuns {
  project?: string;
  status?: StatutRun;
  limite?: number;
}

export interface Source {
  readonly nom: "maquette" | "api";
  topologie(): Promise<Topologie>;
  runs(filtre?: FiltreRuns): Promise<Run[]>;
  run(id: string): Promise<RunDetaille | null>;
  usage(): Promise<Usage>;
  /** Le dernier relevé des modèles poussé par le PC. */
  modeles(): Promise<ReponseModeles>;
  /** `llm` s'applique à tous les nœuds agents du run ; absent, chaque nœud garde le sien. */
  lancerRun(projectId: string, pipelineIndex?: number, llm?: Llm | null): Promise<{ id: string; statut: string }>;
  /** Écoute le flux ; rend la fonction qui arrête l'écoute. */
  ecouter(surEvenement: (e: Evenement) => void, surConnexion: (connecte: boolean) => void, runId?: string): () => void;
}
