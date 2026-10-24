import type { z } from "zod";
import type * as mission from "@schemas/mission";
import type * as plan from "@schemas/plan";
export type OptionsMission = z.infer<typeof mission.options>;
export type DemandeMission = z.infer<typeof mission.lancement>;
export type ChoixAgentMission = z.infer<typeof mission.choix>;
export type SpecMission = z.input<typeof plan.spec>;
export type PropositionPlan = z.infer<typeof plan.proposition>;
export type PlanMission = z.infer<typeof plan.plan>;
export type LancementPlan = z.input<typeof plan.lancementPlan>;
export const lignes = (texte: string) => texte.split("\n").map((s) => s.trim()).filter(Boolean);
export function specStructuree(texte: string): Record<string, unknown> {
  const spec: unknown = JSON.parse(texte);
  if (!spec || Array.isArray(spec) || typeof spec !== "object") throw new Error("Le contexte structuré doit être un objet JSON.");
  return spec as Record<string, unknown>;
}

export type GroupePlan = z.input<typeof plan.groupePlan>;
