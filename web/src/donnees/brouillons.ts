// Brouillons de saisie conservés dans le navigateur : un rafraîchissement ou une demande
// refusée ne doit pas faire perdre un message en cours d'écriture. Ils restent locaux à
// l'appareil et sont effacés après un envoi réussi.
import { useCallback, useEffect, useState } from "react";

const PREFIXE = "cockpit:brouillon:";
// Un brouillon abandonné ne doit pas réapparaître des semaines plus tard.
export const DUREE_MS = 14 * 24 * 3600_000;

type Stockage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function stockage(): Stockage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function lireBrouillon<T>(cle: string, s: Stockage | null = stockage(), maintenant = Date.now()): T | null {
  if (!s) return null;
  try {
    const brut = s.getItem(PREFIXE + cle);
    if (!brut) return null;
    const lu = JSON.parse(brut) as { valeur: T; le: number };
    if (typeof lu?.le !== "number" || maintenant - lu.le > DUREE_MS) { s.removeItem(PREFIXE + cle); return null; }
    return lu.valeur;
  } catch { return null; }
}

export function ecrireBrouillon<T>(cle: string, valeur: T, vide: (v: T) => boolean, s: Stockage | null = stockage(), maintenant = Date.now()): void {
  if (!s) return;
  try {
    if (vide(valeur)) s.removeItem(PREFIXE + cle);
    else s.setItem(PREFIXE + cle, JSON.stringify({ valeur, le: maintenant }));
  } catch { /* stockage plein ou interdit : la saisie continue sans sauvegarde */ }
}

export function effacerBrouillon(cle: string, s: Stockage | null = stockage()): void {
  try { s?.removeItem(PREFIXE + cle); } catch { /* rien à faire */ }
}

const texteVide = (v: string) => !v.trim();

/** Un champ texte dont la valeur survit au rafraîchissement ; `effacer` après un envoi réussi. */
export function useTexteBrouillon(cle: string) {
  const [valeur, setValeur] = useState(() => lireBrouillon<string>(cle) ?? "");
  useEffect(() => { ecrireBrouillon(cle, valeur, texteVide); }, [cle, valeur]);
  const effacer = useCallback(() => { effacerBrouillon(cle); setValeur(""); }, [cle]);
  return [valeur, setValeur, effacer] as const;
}
