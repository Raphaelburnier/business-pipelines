// La livraison d'un run jusqu'à GitHub, telle que l'écran la montre. Distincte de l'exécution :
// un run « terminé » peut avoir sa PR ouverte, sa CI rouge ou sa fusion bloquée.
import type { Ton } from "../format";
import type { LivraisonRun, StatutLivraison } from "../types";

const MOTS: Record<StatutLivraison, string> = {
  pending: "publication attendue",
  pr_open: "PR ouverte",
  ci_running: "CI en cours",
  merge_blocked: "fusion bloquée",
  merged: "fusionnée",
  failed: "livraison échouée",
};

const TONS: Record<StatutLivraison, Ton> = {
  pending: "doux",
  pr_open: "accent",
  ci_running: "accent",
  merge_blocked: "alerte",
  merged: "ok",
  failed: "danger",
};

export const motLivraison = (s: StatutLivraison): string => MOTS[s];
export const tonLivraison = (s: StatutLivraison): Ton => TONS[s];

const CORRECTIONS = {
  transmise: "correction automatique transmise à l'agent",
  poussee: "correction automatique poussée",
  escaladee: "correction automatique sans succès : reprise à la main",
} as const;

export const motCorrection = (c: NonNullable<LivraisonRun["correction"]>): string => CORRECTIONS[c.etat];

/** Les liens d'une livraison, dans l'ordre du parcours : PR, CI, correction, commit de fusion. */
export function liensLivraison(l: LivraisonRun): { libelle: string; url: string }[] {
  const liens: { libelle: string; url: string }[] = [];
  if (l.prUrl && l.pr) liens.push({ libelle: `PR #${l.pr}`, url: l.prUrl });
  if (l.ciUrl) liens.push({ libelle: "run CI", url: l.ciUrl });
  if (l.correction?.url) liens.push({ libelle: "correction", url: l.correction.url });
  if (l.mergeSha && l.depot) liens.push({ libelle: `fusion ${l.mergeSha.slice(0, 7)}`, url: `https://github.com/${l.depot}/commit/${l.mergeSha}` });
  return liens;
}
