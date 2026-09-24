// Ce que le sélecteur montre, décidé hors de l'écran : quels modèles un run peut prendre,
// lesquels il ne peut pas prendre, et pourquoi.
import type { Modele, ReponseModeles } from "../types";

export interface Indisponible {
  modele: Modele;
  raison: string;
}

export interface Classement {
  /** Par fournisseur de routage, dans l'ordre alphabétique ; les combos en tête. */
  utilisables: Array<[string, Modele[]]>;
  indisponibles: Indisponible[];
  total: number;
}

/** Pourquoi un run ne peut pas prendre ce modèle, ou `null` s'il le peut. */
export function raisonIndisponible(m: Modele, viaRunner: readonly string[]): string | null {
  if (!viaRunner.includes(m.llm.via)) return `non joignable depuis le runner (${m.llm.via})`;
  if (!m.capacites.outils) return "sans appel d'outils : un agent en a besoin";
  if (m.etat === "epuise") return m.raison ?? "quota épuisé";
  return null;
}

/** Tous les mots doivent se retrouver dans le nom, l'identifiant ou le fournisseur. */
export function correspond(m: Modele, recherche: string): boolean {
  const cible = `${m.nom} ${m.llm.model} ${m.fournisseur}`.toLowerCase();
  return recherche
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((mot) => cible.includes(mot));
}

export function classer(reponse: ReponseModeles, recherche = ""): Classement {
  const modeles = (reponse.catalogue?.modeles ?? []).filter((m) => correspond(m, recherche));
  const groupes = new Map<string, Modele[]>();
  const indisponibles: Indisponible[] = [];
  for (const m of modeles) {
    const raison = raisonIndisponible(m, reponse.viaRunner);
    if (raison) indisponibles.push({ modele: m, raison });
    else groupes.set(m.fournisseur, [...(groupes.get(m.fournisseur) ?? []), m]);
  }
  const utilisables = [...groupes.entries()].sort(([a], [b]) => (a === "combo" ? -1 : b === "combo" ? 1 : a.localeCompare(b)));
  return { utilisables, indisponibles, total: modeles.length };
}
