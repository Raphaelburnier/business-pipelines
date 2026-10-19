import type { z } from "zod";
import type * as equipe from "@schemas/equipes";
export type OptionsDiscussion = z.infer<typeof equipe.options>;
export type OuvrirDiscussion = z.infer<typeof equipe.ouverture>;
export type MessageEquipe = z.infer<typeof equipe.message>;
export type FilEquipe = z.infer<typeof equipe.fil>;
export type ResumeFilEquipe = z.infer<typeof equipe.resume>;
export type BrouillonEquipe = z.infer<typeof equipe.brouillon>;
export type DemandeBrouillon = z.infer<typeof equipe.demandeBrouillon>;
export type SelectionEquipe = z.infer<typeof equipe.selection>;
export const enAttente = (statut: string) => ["pending", "taken", "running", "waiting_auth", "waiting_quota", "waiting_machine", "waiting_freshness", "waiting_approval", "cancelled"].includes(statut);
export function messageStatut(statut: string): string {
  return ({ pending: "En file", taken: "Préparation", running: "L'équipe travaille", waiting_auth: "Connexion requise", waiting_quota: "Quota atteint", waiting_machine: "Worker indisponible", waiting_freshness: "Base du dépôt à synchroniser", waiting_approval: "Décision attendue", cancelled: "Interrompu — reprise nécessaire", failed: "Échec", refused: "Demande refusée", succeeded: "Terminé", done: "Terminé" } as Record<string, string>)[statut] ?? statut;
}
