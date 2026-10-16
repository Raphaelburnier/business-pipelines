// Une spec écrite par un conseiller de « Demander », confiée au planificateur. Elle passe par
// le stockage de session de l'onglet : rien n'est envoyé au serveur avant que Raphaël ait vu
// le plan et cliqué sur « Lancer ».
import type { SpecMission } from "./missions";

const CLE = "missions:spec-chat";

function stockage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
}

export function deposerSpecChat(spec: SpecMission): void {
  try { stockage()?.setItem(CLE, JSON.stringify(spec)); } catch { /* stockage plein ou refusé : le planificateur s'ouvre vide */ }
}

/** La spec déposée, sans la retirer : le planificateur l'oublie une fois monté. */
export function lireSpecChat(): SpecMission | null {
  try {
    const brut = stockage()?.getItem(CLE);
    return brut ? (JSON.parse(brut) as SpecMission) : null;
  } catch {
    return null;
  }
}

export function oublierSpecChat(): void {
  try { stockage()?.removeItem(CLE); } catch { /* rien à oublier */ }
}
