// Feuille de route et défauts issus de l'audit du 17 octobre 2026 (rapport « Boucle agentique
// business pipelines »). Préfixes : AO = agent-orchestrator, BP = business-pipelines,
// REG = agent-registry, AS = agent-secrets. Mettre `statut` à jour à chaque PR qui avance un point.
import objectifsAttribuables from "./objectifs.json";
import donnees from "./feuille.json";

export type Statut = "a-faire" | "en-cours" | "fait";
export type Severite = "critique" | "haute" | "moyenne" | "basse";

export interface Etape {
  id: string;
  titre: string;
  detail: string;
  fichiers: string[];
  statut: Statut;
  // Un risque motivé peut renforcer la revue, en plus du classement des chemins.
  raisonSensibilite?: string;
}

export interface Lot {
  id: string;
  titre: string;
  but: string;
  prerequis?: string;
  etapes: Etape[];
}

export interface Defaut {
  id: string;
  severite: Severite;
  titre: string;
  fichiers: string;
  correctif: string;
  statut: Statut;
}

const IDS_ATTRIBUABLES = new Set(objectifsAttribuables.map((objectif) => objectif.id));
const REVISION_OBJECTIFS = new Map(objectifsAttribuables.map((objectif) => [objectif.id, objectif.revision]));
const PROJET_OBJECTIFS = new Map(objectifsAttribuables.map((objectif) => [objectif.id, objectif.projet]));

export function estAttribuable(etape: Pick<Etape, "id" | "statut">): boolean {
  return etape.statut === "a-faire" && IDS_ATTRIBUABLES.has(etape.id);
}

export function revisionObjectif(id: string): number | null {
  return REVISION_OBJECTIFS.get(id) ?? null;
}

// Le dépôt système où l'objectif se traite. null : plusieurs dépôts, à faire hors du cockpit.
export function projetObjectif(id: string): string | null {
  return PROJET_OBJECTIFS.get(id) ?? null;
}

export const DATE_AUDIT = "2026-10-17";

// Classement éditorial validé le 22 octobre : il ne change pas la priorité des runs.
export const PRIORITES = [
  {
    titre: "Confiner le PC et réduire le travail en cours",
    detail: "Revue du 16 novembre : les agents du PC tournent sans isolation, une vingtaine d'étapes sont ouvertes en même temps et rien n'est jamais retiré. Bac à sable du PC (18.4) d'abord, plafond de trois étapes en cours (18.11) ; 17.6, 17.7 et le lot 15 attendent un premier résultat métier.",
    lots: ["18"],
  },
  {
    titre: "Fiabiliser les runs",
    detail: "Avant de relancer 0.7 : préparer les dépendances, borner la planification et conserver la cause d'arrêt ainsi que l'usage partiel. Puis traiter les délais de la file et la reprise au retour du worker (2.6, 2.7).",
    lots: ["2"],
  },
  {
    titre: "Sécuriser les fusions et les livraisons",
    detail: "Reprendre 0.7 une fois la préparation fiable, puis terminer les protections d'autorité. Ces protections restent un prérequis à toute autonomie supplémentaire.",
    lots: ["0"],
  },
  {
    titre: "Installer les garde-fous d'exploitation",
    detail: "Ordre conseillé : arrêt d'urgence (4.1), sauvegardes (4.5), santé (4.3), puis alertes externes (4.2). Raccorder l'arrêt au pilotage des runs (10.4). Le budget des runs n'est plus suivi depuis le 24 octobre (4.4).",
    lots: ["4"],
  },
  {
    titre: "Consolider les contrats et le pilotage",
    detail: "Stabiliser la CI entre moteur et cockpit, les versions des workers et les revues, puis améliorer le suivi des runs, le catalogue, l'attribution et le calendrier.",
    lots: ["1", "7", "6", "10", "9", "11", "12"],
  },
  {
    titre: "Étendre les métiers et simplifier l'interface",
    detail: "Compléter les branches métier pluggables après la fiabilisation, puis traiter les ajustements Finance et la lisibilité du graphe d'accueil. La refonte UX du cockpit (17) avance lot par lot, une PR chacun ; après 17.5, elle attend un premier résultat métier (18.11).",
    lots: ["3", "8", "13", "17"],
  },
  {
    titre: "Activer l'autonomie supplémentaire",
    detail: "Livrer le superviseur et les missions automatiques après mise en service et vérification des lots sécurité, fiabilité et exploitation.",
    lots: ["5"],
  },
];

export const LOTS: Lot[] = donnees.lots as unknown as Lot[];

const ordreLots = PRIORITES.flatMap((priorite) => priorite.lots);
// Un futur lot absent du classement reste visible à la fin de la feuille.
const rangLot = (id: string) => ordreLots.includes(id) ? ordreLots.indexOf(id) : ordreLots.length;
const ordreExploitation = ["4.1", "4.4", "4.5", "4.3", "4.2"];
export const LOTS_PRIORISES = [...LOTS]
  .sort((a, b) => rangLot(a.id) - rangLot(b.id))
  .map((lot) => ({
    ...lot,
    etapes: [...lot.etapes].sort((a, b) =>
      Number(a.statut === "fait") - Number(b.statut === "fait") ||
      (lot.id === "4" ? ordreExploitation.indexOf(a.id) - ordreExploitation.indexOf(b.id) : 0)
    ),
  }));

export const DEFAUTS: Defaut[] = donnees.defauts as unknown as Defaut[];

export const SUGGESTIONS: string[] = [
  "Écrire la politique d'escalade (profondeur de missions dérivées, modèles de secours, tours cumulés) avant de coder le superviseur.",
  "Garder deux clics humains : fusion d'un fichier sensible et mise en production.",
  "Afficher dans la carte de livraison les commits auto-fusionnés depuis la dernière release.",
  "Ventiler le verdict des reviewers par critère d'acceptation.",
  "Faire des findings P2 et P3 une file de dette consultable avant d'en faire des missions automatiques.",
  "Séparer l'abonnement Claude de la CI de celui du poste local.",
  "Ouvrir une concurrence par projet quand le superviseur tournera.",
  "Retirer le chemin legacy marketing (orchestrator.js, pipelines/marketing.json) et le code eBay.",
];
