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

// ---- Lire une action comme on la tranche ----
//
// Un plan gelé porte trois formes d'actions, écrites à des époques différentes du pipeline.
// La page les rend en phrases ; le JSON brut n'est que le dernier recours, pour une forme
// qu'elle ne connaît pas encore.

export type LectureAction =
  | { forme: "question"; question: string; lignes: string[] }
  | { forme: "prix"; ecart: string; lignes: string[] }
  | { forme: "brut"; lignes: string[] };

const enregistrement = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Un changement de prix : « 12 → 9.9 CHF (-17.5 %) ». Sans pourcentage quand le prix de
 * départ est nul : une remise « Infinity % » s'affichait là où on lit un chiffre pour décider.
 */
export function ecartDePrix(valeur: unknown): string | null {
  const v = enregistrement(valeur);
  if (typeof v.de !== "number" || typeof v.vers !== "number") return null;
  const devise = typeof v.devise === "string" && v.devise ? ` ${v.devise}` : "";
  const base = `${v.de} → ${v.vers}${devise}`;
  if (v.de === 0) return base;
  return `${base} (${(((v.vers - v.de) / v.de) * 100).toFixed(1)} %)`;
}

export function lireAction(action: ActionApprobation): LectureAction {
  if (typeof action.question === "string" && action.question.trim()) {
    return { forme: "question", question: action.question, lignes: String(action.rapport ?? "").split(/\n+/).filter((l) => l.trim()) };
  }
  // Les arbitrages écrits avant que la synthèse produise `question` et `rapport` : la question
  // est la cible, le rapport se relit dans la valeur structurée (options, recommandation,
  // pourquoi). C'est la forme du dossier marketing en attente depuis le 2026-09-13.
  if (action.type === "arbitrage") {
    const v = enregistrement(action.valeur);
    const lignes: string[] = [];
    if (Array.isArray(v.options)) v.options.forEach((o, i) => lignes.push(`Option ${i + 1} : ${String(o)}`));
    if (typeof v.recommandation === "string") lignes.push(`Recommandation : ${v.recommandation}`);
    if (typeof v.pourquoi === "string") lignes.push(`Pourquoi : ${v.pourquoi}`);
    return { forme: "question", question: action.cible || action.id, lignes };
  }
  const ecart = ecartDePrix(action.valeur);
  if (ecart) return { forme: "prix", ecart, lignes: action.justification ? [action.justification] : [] };
  // Un objet plat (canal, contenu, montant…) se lit en « clé : valeur ». Le JSON brut ne reste
  // que pour une valeur imbriquée, que la page ne sait pas encore mettre en phrases.
  const v = action.valeur;
  const plat =
    v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x === null || ["string", "number", "boolean"].includes(typeof x));
  if (plat) {
    const lignes = Object.entries(v as Record<string, unknown>).map(([cle, x]) => `${cle.replace(/_/g, " ")} : ${String(x)}`);
    // La justification, la page l'affiche déjà sous le rapport : pas de doublon ici.
    return { forme: "question", question: action.type, lignes };
  }
  const brut = v === undefined ? [] : [typeof v === "string" ? v : JSON.stringify(v, null, 2)];
  return { forme: "brut", lignes: brut };
}

/** L'attente d'un dossier : « 3.0 h », ou la valeur reçue telle quelle si ce n'est pas une date. */
export function attente(depuisIso: string, maintenant: number = Date.now()): string {
  const t = Date.parse(depuisIso);
  if (!Number.isFinite(t)) return depuisIso;
  const minutes = Math.max(0, Math.round((maintenant - t) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) {
    const h = minutes / 60;
    return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  }
  return `${Math.round(minutes / 1440)} j`;
}
