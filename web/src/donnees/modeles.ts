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
  annotations: Record<string, string>;
  total: number;
}

/** Pourquoi un run ne peut pas prendre ce modèle, ou `null` s'il le peut. */
export function disponibiliteBackend(m: Modele, reponse: ReponseModeles): { raison: string | null; annotation: string | null } {
  const cibles = Object.entries(reponse.viaParMachine)
    .filter(([, vias]) => vias.includes(m.llm.via))
    .map(([machine]) => machine);
  if (!cibles.length) return { raison: `backend non configuré (${m.llm.via})`, annotation: null };

  const parId = new Map(reponse.machines.map((machine) => [machine.machine, machine]));
  for (const id of cibles) {
    const machine = parId.get(id);
    if (!machine) continue;
    if (machine.etat === "online" || machine.etat === "busy") return { raison: null, annotation: null };
    if (machine.etat === "waking") return { raison: null, annotation: `${id === "pc" ? "PC" : id} en cours de réveil` };
    const reveillable =
      (machine.etat === "sleeping" || machine.etat === "offline") && typeof machine.meta?.mac === "string" && machine.meta.mac.trim();
    if (reveillable) return { raison: null, annotation: `réveillera le ${id === "pc" ? "PC" : id}` };
  }

  const presentes = cibles.map((id) => parId.get(id)).filter((machine) => machine !== undefined);
  const raison = presentes.length
    ? presentes.map((machine) => `${machine.machine} ${machine.etat}${machine.meta?.mac ? "" : " sans WoL"}`).join(", ")
    : `machine ${cibles.join(" ou ")} non enregistrée`;
  return { raison, annotation: null };
}

export function raisonIndisponible(m: Modele, reponse: ReponseModeles): string | null {
  const backend = disponibiliteBackend(m, reponse);
  if (backend.raison) return backend.raison;
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
  const annotations: Record<string, string> = {};
  for (const m of modeles) {
    const raison = raisonIndisponible(m, reponse);
    if (raison) indisponibles.push({ modele: m, raison });
    else {
      groupes.set(m.fournisseur, [...(groupes.get(m.fournisseur) ?? []), m]);
      const annotation = disponibiliteBackend(m, reponse).annotation;
      if (annotation) annotations[m.id] = annotation;
    }
  }
  const utilisables = [...groupes.entries()].sort(([a], [b]) => (a === "combo" ? -1 : b === "combo" ? 1 : a.localeCompare(b)));
  return { utilisables, indisponibles, annotations, total: modeles.length };
}
