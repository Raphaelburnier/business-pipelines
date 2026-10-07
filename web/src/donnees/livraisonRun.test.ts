import { describe, expect, it } from "vitest";
import type { LivraisonRun, StatutLivraison } from "../types";
import { liensLivraison, motLivraison, tonLivraison } from "./livraisonRun";

const STATUTS: StatutLivraison[] = ["pending", "pr_open", "ci_running", "merge_blocked", "merged", "failed"];

const base: LivraisonRun = {
  statut: "merged",
  raison: null,
  branche: "agent/steam-12345678",
  deliverySha: "a".repeat(40),
  depot: "moi/steam",
  pr: 7,
  prUrl: "https://github.com/moi/steam/pull/7",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  ci: "verte",
  ciUrl: "https://github.com/moi/steam/actions/runs/1",
  correction: { etat: "escaladee", echecSha: null, correctionSha: null, url: "https://github.com/moi/steam/pull/7#c" },
  mergeSha: "f".repeat(40),
  attestation: null,
  finale: true,
  majLe: "2026-10-06T18:00:00Z",
  relueLe: "2026-10-06T18:00:00Z",
};

describe("livraison d'un run", () => {
  it("relie PR, CI, correction et commit de fusion", () => {
    expect(liensLivraison(base).map((x) => x.libelle)).toEqual(["PR #7", "run CI", "correction", "fusion fffffff"]);
    expect(liensLivraison(base).at(-1)?.url).toBe(`https://github.com/moi/steam/commit/${"f".repeat(40)}`);
  });

  it("une livraison sans PR n'a aucun lien", () => {
    const l: LivraisonRun = { ...base, statut: "pending", pr: null, prUrl: null, ciUrl: null, correction: null, mergeSha: null };
    expect(liensLivraison(l)).toEqual([]);
  });

  it("chaque état a son mot et sa couleur, l'échec en rouge", () => {
    for (const s of STATUTS) expect(motLivraison(s)).toBeTruthy();
    expect(tonLivraison("failed")).toBe("danger");
    expect(tonLivraison("merge_blocked")).toBe("alerte");
    expect(motLivraison("merged")).toBe("fusionnée");
  });
});
