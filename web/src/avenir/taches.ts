// Toutes les tâches de la page À venir dans une seule liste : fonctionnalités système de la
// feuille de route, défauts à corriger et tâches des projets (objectifs de l'atelier).
import type { Objectif } from "../calendrier/api";
import type { Defaut, Lot, Severite, Statut } from "./feuille";

export type TypeTache = "fonctionnalite" | "fix" | "projet";
export const SYSTEME = "systeme";

export interface Tache {
  cle: string;
  type: TypeTache;
  /** `systeme` pour la feuille de route et les défauts, sinon l'identifiant du projet. */
  projet: string;
  ref: string;
  titre: string;
  detail: string;
  statut: Statut;
  lot?: string;
  severite?: Severite;
  objectif?: Objectif;
}

const VIVANTS = new Set(["queued", "running", "paused", "waiting_quota", "waiting_machine", "waiting_auth", "waiting_approval", "waiting_freshness"]);
const REUSSIS = new Set(["succeeded", "completed"]);

/** Un objectif de l'atelier est fait quand son dernier départ a réussi et qu'aucun autre n'est prévu. */
export function statutObjectif(o: Objectif): Statut {
  const dernier = o.occurrences[0];
  if (dernier && VIVANTS.has(dernier.statut)) return "en-cours";
  if (dernier && REUSSIS.has(dernier.statut) && !o.nextAt) return "fait";
  return "a-faire";
}

export function construireTaches(lots: Lot[], defauts: Defaut[], objectifs: Objectif[]): Tache[] {
  return [
    ...objectifs.filter(o => !o.taskBoard).map((o): Tache => ({ cle: `projet:${o.id}`, type: "projet", projet: o.projectId, ref: o.brouillon.graph.title || o.brouillon.graph.name,
      titre: o.titre, detail: o.criteres.join(" · "), statut: statutObjectif(o), objectif: o })),
    ...defauts.map((d): Tache => ({ cle: `fix:${d.id}`, type: "fix", projet: SYSTEME, ref: d.id, titre: d.titre, detail: `Correctif : ${d.correctif}`, statut: d.statut, severite: d.severite })),
    ...lots.flatMap((l) => l.etapes.map((e): Tache => ({ cle: `etape:${e.id}`, type: "fonctionnalite", projet: SYSTEME, ref: e.id, titre: e.titre, detail: e.detail, statut: e.statut, lot: l.id }))),
  ];
}

export interface Filtre {
  projet: string;
  type: TypeTache | "tous";
  statut: "ouvertes" | "toutes" | "faites";
  recherche: string;
}

export const FILTRE_DEFAUT: Filtre = { projet: "tous", type: "tous", statut: "ouvertes", recherche: "" };

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrer(taches: Tache[], f: Filtre): Tache[] {
  const mots = sansAccents(f.recherche).split(/\s+/).filter(Boolean);
  return taches.filter((t) =>
    (f.projet === "tous" || t.projet === f.projet) &&
    (f.type === "tous" || t.type === f.type) &&
    (f.statut === "toutes" || (f.statut === "faites" ? t.statut === "fait" : t.statut !== "fait")) &&
    mots.every((m) => sansAccents(`${t.ref} ${t.titre} ${t.detail} ${t.projet}`).includes(m)));
}

/** Les projets proposés au filtre : le système d'abord, puis ceux qui ont des tâches ou une fiche. */
export function projetsDisponibles(taches: Tache[], connus: Array<{ id: string; nom: string }>): Array<{ id: string; nom: string }> {
  const noms = new Map(connus.map((p) => [p.id, p.nom]));
  const ids = [...new Set([...taches.map((t) => t.projet), ...connus.map((p) => p.id)])].filter((id) => id !== SYSTEME).sort();
  return [{ id: SYSTEME, nom: "Système" }, ...ids.map((id) => ({ id, nom: noms.get(id) ?? id }))];
}

export function compter(taches: Tache[], type: TypeTache): number {
  return taches.filter((t) => t.type === type && t.statut !== "fait").length;
}

const ORDRE_SEVERITE: Record<Severite, number> = { critique: 0, haute: 1, moyenne: 2, basse: 3 };
export const parSeverite = (a: Tache, b: Tache) => ORDRE_SEVERITE[a.severite ?? "basse"] - ORDRE_SEVERITE[b.severite ?? "basse"] || a.ref.localeCompare(b.ref, "fr", { numeric: true });
