import { describe, expect, it } from "vitest";
import type { LivraisonRun } from "../types";
import { motifsBlocage, motRevue, resumeAttestation, tonRevue, type Revue } from "./revues";

const revue = (champs: Partial<Revue>): Revue => ({
  noeud: "review",
  agent: "code-reviewer@1",
  llm: { via: "codex", model: "gpt-5.6-terra:high" },
  session: "thread-1",
  arbre: "c".repeat(40),
  verdict: "PASS",
  invalide: null,
  resume: "relu",
  comptes: { P0: 0, P1: 0, P2: 0, P3: 0 },
  findings: [],
  nonVerifies: [],
  perimee: false,
  fin: "2026-10-07T12:00:00Z",
  ...champs,
});

describe("revues indépendantes à l'écran", () => {
  it("distingue PASS, FAIL, périmée et rapport invalide", () => {
    expect([motRevue(revue({})), tonRevue(revue({}))]).toEqual(["PASS", "ok"]);
    expect([motRevue(revue({ verdict: "FAIL" })), tonRevue(revue({ verdict: "FAIL" }))]).toEqual(["FAIL", "alerte"]);
    expect([motRevue(revue({ perimee: true })), tonRevue(revue({ perimee: true }))]).toEqual(["PASS périmé", "doux"]);
    expect([motRevue(revue({ invalide: "hors schéma", verdict: null })), tonRevue(revue({ invalide: "x" }))]).toEqual(["rapport invalide", "danger"]);
  });

  it("liste les motifs de blocage, sans les revues périmées", () => {
    const bloquant = { gravite: "P1" as const, titre: "bug", detail: "d", fichier: "a.js", ligne: 3, bloquant: true };
    const livraison = { statut: "merge_blocked", raison: "preuves périmées : revérification nécessaire" } as LivraisonRun;
    expect(motifsBlocage([revue({ verdict: "FAIL", findings: [bloquant] }), revue({ perimee: true, verdict: "FAIL", findings: [bloquant] }), revue({ invalide: "rapport hors schéma", noeud: "review-security" })], livraison)).toEqual([
      "review : 1 finding bloquant (P1)",
      "review-security : rapport hors schéma",
      "preuves périmées : revérification nécessaire",
    ]);
    expect(motifsBlocage([revue({})], null)).toEqual([]);
  });

  it("résume l'attestation avec les reviewers réellement employés", () => {
    expect(resumeAttestation({ arbre: "d".repeat(40), tests: true, revueRequise: true, revues: [{ noeud: "review", agent: "code-reviewer@1", llm: { via: "claude", model: "opus" }, session: "s", verdict: "PASS" }] }))
      .toBe("arbre ddddddd · tests attestés · review claude:opus");
  });
});
