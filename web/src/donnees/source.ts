// La seule frontière entre l'écran et les données.
//
// Annexe A : le front se construit d'abord sur une maquette alimentée par des fixtures, puis
// on remplace LA SEULE couche de données par l'API réelle. Les deux implémentations
// respectent cette interface ; aucune vue ne sait laquelle elle lit.
//
// Le flux ne porte pas l'état, il dit qu'il a changé : une vue recharge ce qu'elle affiche à
// l'arrivée d'un événement. Reconstruire l'état à partir des événements finirait par
// diverger de la base le jour où un événement manque.
import type { AgentChat, Evenement, FilDetaille, ListeFils, Llm, ReponseLivraison, ReponseModeles, Run, RunDetailleAvecOutils, StatutRun, Topologie, Usage, VersionsLivraison } from "../types";
import type { DemandeDecision, DemandeDecisionRun, FilConseil, ReponseApprobations, ReponseDecision } from "./decisions";
import type { ChangementProfil, ReponseEquipe } from "./equipe";
import type { ReponsePipelines } from "./pipelines";
import type { DemandeFusion, DemandeRelanceCI, EtatPullRequests } from "./pullRequests";
import type { OptionsMission, DemandeMission, SpecMission, PropositionPlan, LancementPlan } from "./missions";
import type { ReponseNatures } from "./natures";
import type { OptionsDiscussion, OuvrirDiscussion, MessageEquipe, FilEquipe, ResumeFilEquipe, BrouillonEquipe, DemandeBrouillon } from "./discussions";

export interface FiltreRuns {
  project?: string;
  status?: StatutRun;
  limite?: number;
}

export interface Commande {
  id: string;
  type: string;
  statut: "pending" | "taken" | "done" | "refused";
  run: string | null;
  projet?: string;
  resultat: { ok: boolean; raison?: string; detail?: Record<string, unknown> } | null;
}

export interface AttributionAvenir {
  objectif: { id: string; revision: number };
  commandeId: string;
  runId: string | null;
  projetId: string;
  agent: { id: string | null; nom: string; llm: import("../types").Llm } | null;
  statut: string;
  priorite?: "haute" | "normale" | "basse";
  positionFile?: number | null;
  reclassable?: boolean;
  attente?: { runtime: string | null; prochaineReprise: string | null; raisonManuelle: string | null; commandeStatut?: string | null; commandeAutomatique?: boolean; tentatives?: number; maximum?: number } | null;
  creeLe: string;
  raison: string | null;
  livraison: { statut: string | null; termineeLe: string | null } | null;
}

export interface Source {
  readonly nom: "maquette" | "api";
  topologie(): Promise<Topologie>;
  runs(filtre?: FiltreRuns): Promise<Run[]>;
  run(id: string): Promise<RunDetailleAvecOutils | null>;
  usage(): Promise<Usage>;
  /** Le dernier relevé des modèles poussé par le PC. */
  modeles(): Promise<ReponseModeles>;
  /** Dernière attribution connue par objectif de la feuille de route. */
  attributionsAvenir(): Promise<AttributionAvenir[]>;
  /** `llm` s'applique à tous les nœuds agents du run ; absent, chaque nœud garde le sien. */
  lancerRun(projectId: string, pipelineIndex?: number, llm?: Llm | null): Promise<{ id: string; statut: string }>;
  /** Les branches métier déclarées, avec leurs pipelines et leurs projets. */
  natures(): Promise<ReponseNatures>;
  preparerMission(projectId: string, pipelineIndex: number): Promise<OptionsMission>;
  lancerMission(demande: DemandeMission): Promise<{ id: string; statut: string }>;
  /** Le planificateur choisit pipeline et agents pour une spec ; rien n'est mis en file. */
  proposerPlan(spec: SpecMission): Promise<PropositionPlan>;
  /** Met en file le plan présenté ; refusé s'il a changé depuis sa présentation. */
  lancerPlan(demande: LancementPlan): Promise<{ id: string; statut: string }>;
  reclasserObjectif(objectifId: string, priorite: "haute" | "normale" | "basse"): Promise<void>;
  optionsDiscussion(projectId: string): Promise<OptionsDiscussion>;
  filsEquipe(projectId?: string): Promise<ResumeFilEquipe[]>;
  filEquipe(id: string): Promise<FilEquipe>;
  ouvrirDiscussion(demande: OuvrirDiscussion): Promise<FilEquipe>;
  envoyerEquipe(id: string, demande: MessageEquipe): Promise<FilEquipe>;
  preparerBrouillonEquipe(id: string, demande: DemandeBrouillon): Promise<BrouillonEquipe>;
  brouillonEquipe(id: string): Promise<BrouillonEquipe>;
  /** Le run associé est visible dès son admission, avant la fin du processus. */
  commande(id: string): Promise<Commande>;
  reprendreRun(id: string, waitId: string, reconnexionConfirmee?: boolean): Promise<{ id: string; statut: string }>;
  /** « Demander au cockpit » : les fils, un fil, et poser une question (nouveau fil sans `filId`). */
  fils(): Promise<ListeFils>;
  fil(id: string): Promise<FilDetaille | null>;
  /** `agent` : qui répond (l'assistant du cockpit, ou un conseiller Claude ou Codex). */
  poser(contenu: string, filId?: string | null, agent?: AgentChat): Promise<FilDetaille>;
  /** Suit un fil pendant qu'une réponse s'écrit ; `surFin` quand plus rien n'est en cours. Rend l'arrêt. */
  ecouterFil(id: string, surFil: (fil: FilDetaille) => void, surFin: () => void): () => void;
  /** La livraison du cockpit : proposition du livreur, livraison en cours, historique. */
  livraison(): Promise<ReponseLivraison>;
  /** Dépose une commande de livraison des trois SHA proposés ; le livreur l'exécute. */
  livrer(cible: VersionsLivraison): Promise<{ id: string; statut: string }>;
  /** Les PR GitHub relevées par le publieur, et une fusion demandée (CI verte seulement). */
  pullRequests(): Promise<EtatPullRequests>;
  fusionnerPR(demande: DemandeFusion): Promise<{ id: string; statut: string }>;
  relancerCIPR(demande: DemandeRelanceCI): Promise<{ id: string; statut: string }>;
  /** Plans métier en attente d'un arbitrage opérateur. */
  approbations(): Promise<ReponseApprobations>;
  /** Enregistre les arbitrages liés à l'empreinte du plan lu. */
  decider(demande: DemandeDecision): Promise<ReponseDecision>;
  /** Tranche l'approbation d'un run : le runner écrit la décision puis reprend le run. */
  deciderRun(approbationId: string, demande: DemandeDecisionRun): Promise<{ id: string; statut: string }>;
  /** Le fil du conseiller sur un dossier, et y poser une question (refusée si le PC dort). */
  filConseil(dossier: string): Promise<FilConseil>;
  poserConseil(dossier: string, texte: string): Promise<FilConseil>;
  /** L'équipe d'agents : qui est libre, sur quel projet, et le budget du mois qui reste. */
  equipe(): Promise<ReponseEquipe>;
  /** Associe ces agents à un projet (existant ou nouveau), ou les libère avec `null`. */
  affecter(agents: string[], projet: string | null): Promise<void>;
  /** Renomme un membre ou change sa photo ; `null` rend le nom du roster ou retire la photo. */
  profil(agent: string, changement: ChangementProfil): Promise<void>;
  /** Les pipelines connus, leur nom affiché et les projets qui s'en servent. */
  pipelines(): Promise<ReponsePipelines>;
  /** Nomme un pipeline pour toutes ses versions ; `null` rend le titre du registre. */
  renommerPipeline(pipeline: string, nom: string | null): Promise<void>;
  /** Demande au publieur la PR qui ajoute ce pipeline à la fiche du projet. */
  rattacherPipeline(pipeline: string, projet: string): Promise<{ id: string; statut: string }>;
  /** Écoute le flux ; rend la fonction qui arrête l'écoute. */
  ecouter(surEvenement: (e: Evenement) => void, surConnexion: (connecte: boolean) => void, runId?: string): () => void;
}
