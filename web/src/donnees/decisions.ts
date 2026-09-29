// Le contrat des approbations reste local au cockpit : ces données ne font pas partie de
// l'event store des runs, qui porte une autre forme et une autre durée de vie.
import { z } from "zod";

const actionDecision = z.object({
  action_id: z.string().min(1),
  decision: z.enum(["approuve", "refuse"]),
  motif: z.string().max(500).optional(),
});

export const demandeDecision = z.object({
  dossier: z.string().min(1),
  empreinte: z.string().min(1),
  decisions: z.array(actionDecision),
  reponse: z.string().optional(),
});

export type Decision = z.infer<typeof actionDecision>;
export type DemandeDecision = z.infer<typeof demandeDecision>;

export interface ActionApprobation {
  id: string;
  type: string;
  cible?: string;
  valeur?: unknown;
  justification?: string;
  sources?: string[];
  question?: string;
  rapport?: string;
  decision: Decision["decision"] | null;
  note: string | null;
}

export interface FraicheurApprobation {
  reference: string | null;
  age_heures: number | null;
  max_heures: number | null;
  verdict: "frais" | "perime" | "inconnue";
}

export interface ReponsePosee {
  consigne: string;
  par: string | null;
  le: string | null;
}

export interface DossierApprobation {
  dossier: string;
  reponse_posee: ReponsePosee | null;
  empreinte: string;
  depuis: string;
  appliquer_avec: string | null;
  plan_absent: boolean;
  fraicheur: FraicheurApprobation;
  actions: ActionApprobation[];
  tranche: boolean;
}

export interface EtatApprobations {
  dossiers: DossierApprobation[];
  decidables: number;
}

export interface ModuleCockpit {
  nom: string;
  url: string | null;
  etat: "en-ligne" | "en-cours" | "idee" | "arrete";
  description: string | null;
  notes: string[];
}

export interface ReponseApprobations {
  qui: { par: string; nom: string | null; canal: "local" | "tailnet" };
  etat: EtatApprobations;
  modules: { apps: ModuleCockpit[]; erreur: string | null };
}

export interface ReponseDecision {
  plan: string;
  decisions: Array<Decision & { par: string; canal?: string; le: string }>;
  reponse?: string;
  reponse_par?: string;
  reponse_le?: string;
  reponse_canal?: string;
}
