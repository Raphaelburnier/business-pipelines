// Les revues indépendantes d'un run, telles que l'écran les montre : le reviewer réellement
// employé, son modèle, ce qu'il a trouvé, et ce qui bloque la livraison.
import type { Ton } from "../format";
import type { LivraisonRun, RunDetaille } from "../types";

export type Revue = RunDetaille["revues"][number];

export function motRevue(r: Revue): string {
  if (r.invalide) return "rapport invalide";
  if (r.perimee) return r.verdict === "PASS" ? "PASS périmé" : "FAIL périmé";
  return r.verdict ?? "inconnu";
}

export function tonRevue(r: Revue): Ton {
  if (r.invalide) return "danger";
  if (r.perimee) return "doux";
  return r.verdict === "PASS" ? "ok" : "alerte";
}

export const localisation = (f: Revue["findings"][number]): string | null =>
  f.fichier ? `${f.fichier}${f.ligne ? `:${f.ligne}` : ""}` : null;

/**
 * Ce qui empêche la livraison ou la fusion, dans l'ordre où il faut le lever : rapport invalide,
 * findings bloquants des revues à jour, puis la raison relevée par le publieur.
 */
export function motifsBlocage(revues: Revue[], livraison: LivraisonRun | null): string[] {
  const motifs: string[] = [];
  for (const r of revues.filter((x) => !x.perimee)) {
    if (r.invalide) motifs.push(`${r.noeud} : ${r.invalide}`);
    const bloquants = r.findings.filter((f) => f.bloquant);
    if (bloquants.length) motifs.push(`${r.noeud} : ${bloquants.length} finding${bloquants.length > 1 ? "s" : ""} bloquant${bloquants.length > 1 ? "s" : ""} (${bloquants.map((f) => f.gravite).join(", ")})`);
  }
  if (livraison && ["merge_blocked", "failed"].includes(livraison.statut) && livraison.raison) motifs.push(livraison.raison);
  return motifs;
}

/** Une ligne courte pour l'attestation d'une livraison : arbre, tests, reviewers. */
export function resumeAttestation(a: NonNullable<LivraisonRun["attestation"]>): string {
  const revues = a.revues.map((r) => `${r.noeud} ${r.llm.via}:${r.llm.model}`).join(", ");
  return `arbre ${a.arbre.slice(0, 7)} · ${a.tests ? "tests attestés" : "sans tests"} · ${revues || (a.revueRequise ? "revue manquante" : "sans revue")}`;
}
