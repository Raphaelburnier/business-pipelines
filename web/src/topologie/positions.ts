// Préférence durable, distincte des brouillons qui expirent après quatorze jours.
export type Positions = Record<string, { x: number; y: number }>;
type Stockage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function stockage(): Stockage | null {
  try { return window.localStorage; } catch { return null; }
}
export function clePositions(compact: boolean, maquette: boolean): string {
  return `cockpit:accueil:positions:v1:${maquette ? "maquette" : "api"}:${compact ? "mobile" : "bureau"}`;
}
export function lirePositions(cle: string, s: Stockage | null = stockage()): Positions {
  try {
    const valeur: unknown = JSON.parse(s?.getItem(cle) ?? "null");
    if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return {};
    return Object.fromEntries(Object.entries(valeur).filter(([, p]) => p && typeof p === "object"
      && typeof p.x === "number" && Number.isFinite(p.x) && typeof p.y === "number" && Number.isFinite(p.y)));
  } catch { return {}; }
}
export function ecrirePositions(cle: string, positions: Positions, s: Stockage | null = stockage()): void {
  try {
    if (Object.keys(positions).length) s?.setItem(cle, JSON.stringify(positions));
    else s?.removeItem(cle);
  } catch { /* Le graphe reste déplaçable si le navigateur interdit le stockage. */ }
}
