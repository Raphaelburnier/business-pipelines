// Les PR GitHub vues depuis le cockpit (src/api-pull-requests.js) : le contrat reste local au
// cockpit, comme celui des approbations. Le relevé vient du publieur, qui seul parle à GitHub.
import type { CommitLivraison } from "../types";

export interface EtatCI {
  etat: "verte" | "en_cours" | "rouge" | "absente";
  details: Array<{ nom: string; statut: string; conclusion: string | null }>;
  raison?: string | null;
  preuve?: { runId: number; tentative: number; headSha: string; baseSha: string; mergeSha: string } | null;
  runId?: number | null;
  tentative?: number | null;
}

export interface PullRequestOuverte {
  numero: number;
  titre: string;
  url: string;
  auteur: string | null;
  branche: string;
  base: string;
  versDefaut: boolean;
  sha: string;
  baseSha: string;
  brouillon: boolean;
  fusionnable: boolean | null;
  etatFusion: string | null;
  ci: EtatCI;
  /** Les fichiers sensibles touchés (workflows, compose, secrets…) : fusion explicite. */
  sensibles: string[];
  fichiers: number;
  pourquoi: string | null;
  creeeLe: string;
  /** Pourquoi elle ne peut pas être fusionnée d'ici, ou null. */
  raison: string | null;
  fusionEnCours: boolean;
  ciRelanceEnCours: boolean;
}

export interface PullRequestFusionnee {
  numero: number;
  titre: string;
  url: string;
  shas: string[];
  pourquoi: string | null;
  fusionneeLe: string;
}

export interface DepotPullRequests {
  depot: string;
  parDefaut?: string;
  erreur?: string;
  ouvertes: PullRequestOuverte[];
  fusionnees: PullRequestFusionnee[];
}

export interface EtatPullRequests {
  releveLe: string | null;
  perime: boolean;
  erreur: string | null;
  peutFusionner: boolean;
  depots: DepotPullRequests[];
  recentes: Array<{ depot: string; numero: number; par: string; ok: boolean; raison: string | null; le: string }>;
}

export interface DemandeFusion {
  depot: string;
  numero: number;
  sha: string;
  baseSha: string;
}

export interface DemandeRelanceCI {
  depot: string;
  numero: number;
  sha: string;
  runId: number;
  tentative: number;
}

export interface PrLivree extends PullRequestFusionnee {
  depot: string;
}

/**
 * Les PR qu'une livraison apporte : celles dont le commit de fusion, ou la tête, figure parmi
 * les commits proposés. Une PR fusionnée en squash se retrouve par son commit de fusion, une
 * PR fusionnée par merge par sa tête. Les plus récentes d'abord, sans doublon.
 */
export function prsDeLaLivraison(etat: EtatPullRequests | null, commits: CommitLivraison[]): PrLivree[] {
  if (!etat) return [];
  const shas = new Set(commits.map((c) => c.sha));
  const vues = new Set<string>();
  const out: PrLivree[] = [];
  for (const d of etat.depots) {
    for (const pr of d.fusionnees) {
      const cle = `${d.depot}#${pr.numero}`;
      if (vues.has(cle) || !pr.shas.some((s) => shas.has(s))) continue;
      vues.add(cle);
      out.push({ ...pr, depot: d.depot });
    }
  }
  return out.sort((a, b) => Date.parse(b.fusionneeLe) - Date.parse(a.fusionneeLe));
}

/** « business-pipelines #63 » : le dépôt sans son propriétaire. */
export const nomCourt = (depot: string, numero: number): string => `${depot.split("/").pop()} #${numero}`;
