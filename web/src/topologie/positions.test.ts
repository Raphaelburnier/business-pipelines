import { describe, expect, test } from "vitest";
import { clePositions, lirePositions, ecrirePositions } from "./positions";
function stockage() {
  const donnees = new Map<string, string>();
  return { getItem: (c: string) => donnees.get(c) ?? null, setItem: (c: string, v: string) => { donnees.set(c, v); }, removeItem: (c: string) => { donnees.delete(c); } };
}
describe("positions locales du graphe", () => {
  test("restaure les positions, y compris négatives, sans expiration de brouillon", () => {
    const s = stockage();
    const positions = { "projet:a": { x: -40, y: 750 } };
    ecrirePositions("vue", positions, s);
    expect(lirePositions("vue", s)).toEqual(positions);
    ecrirePositions("vue", {}, s);
    expect(lirePositions("vue", s)).toEqual({});
  });
  test("isole téléphone, bureau, maquette et données réelles", () => {
    expect(new Set([clePositions(true, true), clePositions(true, false), clePositions(false, true), clePositions(false, false)]).size).toBe(4);
  });
  test("écarte les valeurs corrompues et continue sans stockage autorisé", () => {
    const s = stockage();
    s.setItem("vue", '{"a":{"x":null,"y":3},"b":{"x":2,"y":4},"c":"non"}');
    expect(lirePositions("vue", s)).toEqual({ b: { x: 2, y: 4 } });
    s.setItem("vue", "cassé");
    expect(lirePositions("vue", s)).toEqual({});
    const interdit = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); }, removeItem: () => { throw Error(); } };
    expect(lirePositions("vue", interdit)).toEqual({});
    expect(() => ecrirePositions("vue", { a: { x: 1, y: 2 } }, interdit)).not.toThrow();
  });
});
