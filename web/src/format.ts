// Mise en forme partagée : durées, montants, jetons, et le vocabulaire des états.
//
// Une valeur qu'on n'a pas s'écrit « n/d », jamais une case vide : une cellule vide se
// lit comme un zéro, et un zéro sur un coût ou une durée est une information fausse.
import type { EtatMachine, EtatProjet, StatutEtape, StatutRun } from "./types";

export const VIDE = "n/d";

/** Une durée lisible : « 12 s », « 4 min 20 », « 3.4 h ». */
export function duree(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return VIDE;
  // « 0 s » sur une étape qui a bien tourné se lit comme une donnée manquante.
  if (ms < 1000) return "< 1 s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  // « 12 min », pas « 12 min 00 » : des secondes nulles n'apportent rien.
  if (m < 60) return s % 60 ? `${m} min ${String(s % 60).padStart(2, "0")}` : `${m} min`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} j`;
}

/** Le temps écoulé depuis un instant ISO. */
export function depuis(iso: string | null, maintenant: number = Date.now()): string {
  if (!iso) return VIDE;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? duree(maintenant - t) : VIDE;
}

export const usd = (n: number): string => `${n.toFixed(2)} $`;

export const jetons = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n));

type Etat = StatutRun | StatutEtape | EtatMachine | EtatProjet;

// Les statuts de la base sont en anglais (§9) ; l'écran parle français.
const MOTS: Record<Etat, string> = {
  queued: "en file",
  running: "en cours",
  paused: "en pause",
  waiting_approval: "décision attendue",
  waiting_quota: "quota atteint",
  waiting_machine: "machine attendue",
  succeeded: "terminé",
  failed: "échoué",
  cancelled: "arrêté",
  online: "en ligne",
  busy: "occupée",
  sleeping: "en veille",
  waking: "réveil",
  offline: "hors ligne",
  error: "en erreur",
  actif: "actif",
  pause: "en pause",
  attente: "en attente",
  erreur: "erreur",
  inactif: "inactif",
};

export const mot = (etat: Etat): string => MOTS[etat];

// Une seule grammaire de couleurs pour toute l'interface : vert ce qui a abouti ou tourne
// bien, accent ce qui travaille, ambre ce qui attend quelqu'un, rouge ce qui a échoué, bleu
// ce qui dort. La couleur n'est jamais seule : le mot l'accompagne toujours.
export type Ton = "ok" | "accent" | "alerte" | "danger" | "bleu" | "doux";

const TONS: Record<Etat, Ton> = {
  queued: "doux",
  running: "accent",
  paused: "doux",
  waiting_approval: "alerte",
  waiting_quota: "alerte",
  waiting_machine: "alerte",
  succeeded: "ok",
  failed: "danger",
  cancelled: "doux",
  online: "ok",
  busy: "accent",
  sleeping: "bleu",
  waking: "alerte",
  offline: "danger",
  error: "danger",
  actif: "accent",
  pause: "doux",
  attente: "alerte",
  erreur: "danger",
  inactif: "doux",
};

export const ton = (etat: Etat): Ton => TONS[etat];

/** Les classes Tailwind d'un ton, pour une pastille ou une bordure. */
export const CLASSES_TON: Record<Ton, { texte: string; fond: string; bordure: string; plein: string }> = {
  ok: { texte: "text-ok", fond: "bg-ok-fond", bordure: "border-ok", plein: "bg-ok" },
  accent: { texte: "text-accent", fond: "bg-carte", bordure: "border-accent", plein: "bg-accent" },
  alerte: { texte: "text-alerte", fond: "bg-alerte-fond", bordure: "border-alerte", plein: "bg-alerte" },
  danger: { texte: "text-danger", fond: "bg-danger-fond", bordure: "border-danger", plein: "bg-danger" },
  bleu: { texte: "text-bleu", fond: "bg-fond", bordure: "border-bleu", plein: "bg-bleu" },
  doux: { texte: "text-douce", fond: "bg-fond", bordure: "border-trait", plein: "bg-douce" },
};

/** Ce qui bouge : une pastille qui respire, une arête animée. */
export const vivant = (etat: Etat): boolean => etat === "running" || etat === "busy" || etat === "waking" || etat === "actif";
