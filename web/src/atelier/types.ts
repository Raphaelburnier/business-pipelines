import type { z } from 'zod';
import type { brouillon, tache, changement, graph } from '@schemas/travaux';
export type Brouillon = z.infer<typeof brouillon>;
export type Graphe = z.infer<typeof graph>;
export type DemandeTache = z.infer<typeof tache>;
export type Changement = z.infer<typeof changement>;
export type Modele = Brouillon & { id: string; version: number; origine: 'registre' | 'personnel' };
export interface AgentCatalogue { ref: string; nom: string; description: string; llm: { via: string; model: string }; membres: { id: string; nom: string; llm: { via: string; model: string } }[] }
export interface Catalogue { agents: AgentCatalogue[]; projets: { id: string; nom: string }[]; modeles: Modele[]; erreurs: string[] }
export interface Occurrence { id: string; date: string; scheduledAt: string; commandId: string; runId: string | null; statut: string; raison: string | null; attente: { prochaineReprise?: string | null; raisonManuelle?: string | null } | null; livraison: { statut: string; terminee: boolean } | null }
export interface Objectif { id: string; revision: number; projectId: string; titre: string; priority: 'haute' | 'normale' | 'basse'; source: 'calendar' | 'manual'; date: string; heure: string; repetition: 'none' | 'daily' | 'weekdays' | 'weekly'; active: boolean; nextAt: string | null; brouillon: Brouillon; criteres: string[]; occurrences: Occurrence[] }
export interface AtelierSource {
  catalogue(): Promise<Catalogue>;
  sauvegarder(d: Brouillon & { id?: string; expectedVersion?: number }): Promise<Modele>;
  valider(d: Brouillon): Promise<{ participants: { nom: string; noeud: string }[] }>;
  objectifs(): Promise<Objectif[]>;
  creer(d: DemandeTache): Promise<Objectif>;
  modifier(id: string, d: Changement): Promise<Objectif>;
}
export function nouveau(projectId: string): Brouillon {
  return { projectId, baseRef: null, assignments: {}, graph: { name: `atelier-${crypto.randomUUID().slice(0, 8)}`, version: 1, title: 'Nouveau pipeline', workspace: 'documents', tags: [], budget: {}, nodes: [], edges: [], cycles: [], layout: {} } };
}
