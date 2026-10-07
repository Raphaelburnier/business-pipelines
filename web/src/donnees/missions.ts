import type { z } from "zod";
import type * as mission from "@schemas/mission";
export type OptionsMission = z.infer<typeof mission.options>;
export type DemandeMission = z.infer<typeof mission.lancement>;
export type ChoixAgentMission = z.infer<typeof mission.choix>;
export const lignes = (texte: string) => texte.split("\n").map((s) => s.trim()).filter(Boolean);
export function specStructuree(texte: string): Record<string, unknown> {
  const spec: unknown = JSON.parse(texte);
  if (!spec || Array.isArray(spec) || typeof spec !== "object") throw new Error("Le contexte structuré doit être un objet JSON.");
  return spec as Record<string, unknown>;
}
