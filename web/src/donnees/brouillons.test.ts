import { describe, expect, test } from "vitest";
import { DUREE_MS, ecrireBrouillon, effacerBrouillon, lireBrouillon } from "./brouillons";

function memoire() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
}
const vide = (v: string) => !v.trim();

describe("brouillons de saisie", () => {
  test("un message tapé est relu après un rafraîchissement", () => {
    const s = memoire();
    ecrireBrouillon("marketing:steam:message", "Bonjour Margaux", vide, s, 1000);
    expect(lireBrouillon("marketing:steam:message", s, 2000)).toBe("Bonjour Margaux");
    expect(lireBrouillon("marketing:autre:message", s, 2000)).toBeNull();
  });

  test("un champ vidé ou un envoi réussi supprime le brouillon", () => {
    const s = memoire();
    ecrireBrouillon("cle", "texte", vide, s);
    ecrireBrouillon("cle", "   ", vide, s);
    expect(s.m.size).toBe(0);
    ecrireBrouillon("cle", "texte", vide, s);
    effacerBrouillon("cle", s);
    expect(lireBrouillon("cle", s)).toBeNull();
  });

  test("un brouillon trop ancien ou illisible est ignoré", () => {
    const s = memoire();
    ecrireBrouillon("cle", "vieux", vide, s, 0);
    expect(lireBrouillon("cle", s, DUREE_MS + 1)).toBeNull();
    expect(s.m.size).toBe(0);
    s.setItem("cockpit:brouillon:casse", "{pas du json");
    expect(lireBrouillon("casse", s)).toBeNull();
  });

  test("sans stockage disponible, rien ne casse", () => {
    expect(lireBrouillon("cle", null)).toBeNull();
    expect(() => ecrireBrouillon("cle", "x", vide, null)).not.toThrow();
  });
});
