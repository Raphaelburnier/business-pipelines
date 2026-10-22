// Le calendrier raisonne en dates civiles de Zurich, comme le programmateur du cockpit
// (src/atelier-dates.js) : une semaine va du lundi au dimanche, une heure est celle du mur.
import type { Objectif, Occurrence, Repetition } from "./api";

export const FUSEAU = "Europe/Zurich";

const civil = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** « 2026-10-22T14:05 » à Zurich pour un instant donné. */
export function dateCivile(instant: number | string): { date: string; heure: string } {
  const [date = "", heure = ""] = civil.format(new Date(instant)).split(" ");
  return { date, heure };
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

export function semaine(objectifs: Objectif[], debut: string): Map<string, Entree[]> {
  const parJour = new Map(joursDeLaSemaine(debut).map((j) => [j, [] as Entree[]]));
  for (const objectif of objectifs) for (const e of entreesDe(objectif, debut)) parJour.get(e.date)?.push(e);
  for (const liste of parJour.values()) liste.sort((a, b) => a.heure.localeCompare(b.heure) || a.objectif.titre.localeCompare(b.objectif.titre));
  return parJour;
}

/** Un départ actif dont l'heure est passée sans que le programmateur l'ait créé : il attend quelque chose. */
export function enRetard(objectif: Objectif, maintenant: number): boolean {
  return objectif.active && objectif.nextAt !== null && Date.parse(objectif.nextAt) <= maintenant;
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
