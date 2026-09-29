// La seule frontière entre l'écran et les données.
//
// Annexe A : le front se construit d'abord sur une maquette alimentée par des fixtures, puis
// on remplace LA SEULE couche de données par l'API réelle. Les deux implémentations
// respectent cette interface ; aucune vue ne sait laquelle elle lit.
//
// Le flux ne porte pas l'état, il dit qu'il a changé : une vue recharge ce qu'elle affiche à
// l'arrivée d'un événement. Reconstruire l'état à partir des événements finirait par
// diverger de la base le jour où un événement manque.
import type { Evenement, FilDetaille, ListeFils, Llm, ReponseLivraison, ReponseModeles, Run, RunDetaille, StatutRun, Topologie, Usage, VersionsLivraison } from "../types";

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
  /** « Demander au cockpit » : les fils, un fil, et poser une question (nouveau fil sans `filId`). */
  fils(): Promise<ListeFils>;
  fil(id: string): Promise<FilDetaille | null>;
  poser(contenu: string, filId?: string | null): Promise<FilDetaille>;
  /** Suit un fil pendant qu'une réponse s'écrit ; `surFin` quand plus rien n'est en cours. Rend l'arrêt. */
  ecouterFil(id: string, surFil: (fil: FilDetaille) => void, surFin: () => void): () => void;
  /** La livraison du cockpit : proposition du livreur, livraison en cours, historique. */
  livraison(): Promise<ReponseLivraison>;
  /** Dépose une commande de livraison des trois SHA proposés ; le livreur l'exécute. */
  livrer(cible: VersionsLivraison): Promise<{ id: string; statut: string }>;
  /** Écoute le flux ; rend la fonction qui arrête l'écoute. */
  ecouter(surEvenement: (e: Evenement) => void, surConnexion: (connecte: boolean) => void, runId?: string): () => void;
}
