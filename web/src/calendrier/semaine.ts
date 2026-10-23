// Le calendrier raisonne en dates civiles de Zurich, comme le programmateur du cockpit
// (src/atelier-dates.js) : une semaine va du lundi au dimanche, une heure est celle du mur.
import type { AttributionAvenir } from "../donnees/source";
import type { Objectif, Occurrence, Repetition } from "./api";

export const FUSEAU = "Europe/Zurich";

const civil = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** « 2026-10-22T14:05 » à Zurich pour un instant donné. */
export function dateCivile(instant: number | string): { date: string; heure: string } {
  const [date = "", heure = ""] = civil.format(new Date(instant)).split(" ");
  return { date, heure };
}

/**
 * L'instant UTC d'une heure de mur à Zurich. Une heure qui n'existe pas (passage à l'heure
 * d'été) est refusée ; une heure répétée (retour à l'heure d'hiver) prend sa première apparition.
 */
export function instantZurich(date: string, heure: string): string {
  const brut = Date.parse(`${date}T${heure}:00Z`);
  if (!Number.isFinite(brut)) throw new Error("Date ou heure invalide.");
  const candidats = [-2, -1, 0].map((h) => brut + h * 3_600_000)
    .filter((t) => { const c = dateCivile(t); return c.date === date && c.heure === heure; })
    .sort((a, b) => a - b);
  if (!candidats.length) throw new Error("Cette heure n'existe pas à Zurich ce jour-là (passage à l'heure d'été).");
  return new Date(candidats[0]!).toISOString();
}

// Midi UTC évite qu'un changement d'heure fasse sauter ou répéter un jour.
const midi = (date: string) => new Date(`${date}T12:00:00Z`);

export function decaler(date: string, jours: number): string {
  const d = midi(date);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** 0 = lundi … 6 = dimanche. */
export const jourSemaine = (date: string): number => (midi(date).getUTCDay() + 6) % 7;

export function lundi(date: string): string {
  return decaler(date, -jourSemaine(date));
}

export function joursDeLaSemaine(debut: string): string[] {
  return Array.from({ length: 7 }, (_, i) => decaler(debut, i));
}

export function suivante(date: string, repetition: Repetition): string | null {
  if (repetition === "none") return null;
  let prochain = decaler(date, repetition === "weekly" ? 7 : 1);
  while (repetition === "weekdays" && jourSemaine(prochain) >= 5) prochain = decaler(prochain, 1);
  return prochain;
}

export type Genre = "lance" | "prochain" | "prevu";

export interface Entree {
  cle: string;
  objectif: Objectif;
  date: string;
  heure: string;
  genre: Genre;
  occurrence: Occurrence | null;
}

/**
 * Ce que la semaine affiche pour un objectif : ses départs déjà créés, son prochain départ et,
 * pour une répétition, les départs suivants que le programmateur créera si rien ne le bloque.
 */
export function entreesDe(objectif: Objectif, debut: string): Entree[] {
  const fin = decaler(debut, 6);
  const dansSemaine = (date: string) => date >= debut && date <= fin;
  const entrees: Entree[] = [];
  for (const o of objectif.occurrences) {
    const { date, heure } = dateCivile(o.scheduledAt);
    if (dansSemaine(date)) entrees.push({ cle: o.id, objectif, date, heure, genre: "lance", occurrence: o });
  }
  if (!objectif.nextAt) return entrees;
  const { date: premier, heure } = dateCivile(objectif.nextAt);
  let date: string | null = premier;
  let genre: Genre = "prochain";
  while (date && date <= fin) {
    if (dansSemaine(date)) entrees.push({ cle: `${objectif.id}:${date}`, objectif, date, heure: genre === "prochain" ? heure : objectif.heure, genre, occurrence: null });
    date = suivante(date, objectif.repetition);
    genre = "prevu";
  }
  return entrees;
}

/** Un objectif de la feuille de route planifié depuis À venir. */
export interface DepartFeuille {
  cle: string;
  objectifId: string;
  projetId: string;
  date: string;
  heure: string;
  statut: string;
  runId: string | null;
}

export function departsFeuille(attributions: AttributionAvenir[], debut: string): Map<string, DepartFeuille[]> {
  const fin = decaler(debut, 6);
  const parJour = new Map<string, DepartFeuille[]>();
  for (const a of attributions) {
    if (!a.prevuLe) continue;
    const { date, heure } = dateCivile(a.prevuLe);
    if (date < debut || date > fin) continue;
    parJour.set(date, [...(parJour.get(date) ?? []), { cle: a.commandeId, objectifId: a.objectif.id, projetId: a.projetId, date, heure, statut: a.statut, runId: a.runId }]);
  }
  return parJour;
}

export function etatDepartFeuille(d: DepartFeuille): { mot: string; ton: Ton } {
  if (d.statut === "queued" && !d.runId) return { mot: "planifié", ton: "attente" };
  return ETATS[d.statut] ?? { mot: d.statut, ton: "neutre" };
}

export function semaine(objectifs: Objectif[], debut: string): Map<string, Entree[]> {
  const parJour = new Map(joursDeLaSemaine(debut).map((j) => [j, [] as Entree[]]));
  for (const objectif of objectifs) for (const e of entreesDe(objectif, debut)) parJour.get(e.date)?.push(e);
  for (const liste of parJour.values()) liste.sort((a, b) => a.heure.localeCompare(b.heure) || a.objectif.titre.localeCompare(b.objectif.titre));
  return parJour;
}

/** Un départ actif dont l'heure est passée sans que le programmateur l'ait créé : il attend quelque chose. */
export function departEnRetard(objectif: Objectif, maintenant: number): string | null {
  const dates = objectif.occurrences
    .filter((o) => !['succeeded', 'completed', 'cancelled'].includes(o.statut))
    .map((o) => o.scheduledAt);
  if (objectif.active && objectif.nextAt) dates.push(objectif.nextAt);
  return dates.filter((d) => Date.parse(d) <= maintenant).sort()[0] ?? null;
}

export function enRetard(objectif: Objectif, maintenant: number): boolean {
  return departEnRetard(objectif, maintenant) !== null;
}

export function departModifiable(objectif: Objectif): string | null {
  if (objectif.nextAt) return objectif.nextAt;
  const derniere = objectif.occurrences[0];
  return objectif.repetition === 'none' && derniere?.statut === 'queued' && !derniere.runId ? derniere.scheduledAt : null;
}

export type Ton = "attente" | "actif" | "ok" | "echec" | "neutre";

const ETATS: Record<string, { mot: string; ton: Ton }> = {
  queued: { mot: "en file", ton: "attente" },
  running: { mot: "en cours", ton: "actif" },
  paused: { mot: "en pause", ton: "attente" },
  waiting_quota: { mot: "attente quota", ton: "attente" },
  waiting_machine: { mot: "attente worker", ton: "attente" },
  waiting_auth: { mot: "attente connexion", ton: "attente" },
  waiting_approval: { mot: "attente arbitrage", ton: "attente" },
  waiting_freshness: { mot: "base à synchroniser", ton: "attente" },
  succeeded: { mot: "réussi", ton: "ok" },
  completed: { mot: "réussi", ton: "ok" },
  failed: { mot: "échoué", ton: "echec" },
  cancelled: { mot: "annulé", ton: "neutre" },
};

export function etatEntree(e: Entree): { mot: string; ton: Ton } {
  if (e.occurrence) return ETATS[e.occurrence.statut] ?? { mot: e.occurrence.statut, ton: "neutre" };
  if (!e.objectif.active) return { mot: "en pause", ton: "neutre" };
  return e.genre === "prochain" ? { mot: "prochain départ", ton: "attente" } : { mot: "prévu", ton: "neutre" };
}

export const MOT_REPETITION: Record<Repetition, string> = { none: "une fois", daily: "chaque jour", weekdays: "jours ouvrés", weekly: "chaque semaine" };
