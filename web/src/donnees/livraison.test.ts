import { describe, expect, it } from "vitest";
import { confirmationLivraisonCourante, intervalleLivraison } from "./livraison";

const cible = { cockpit: "a".repeat(40), moteur: "b".repeat(40), registre: "c".repeat(40) };

describe("confirmation de livraison", () => {
  it("accepte la même cible après une nouvelle lecture API", () => {
    expect(confirmationLivraisonCourante(cible, { ...cible })).toBe(true);
  });
  it.each(["cockpit", "moteur", "registre"] as const)("invalide une confirmation si %s change", (depot) => {
    expect(confirmationLivraisonCourante(cible, { ...cible, [depot]: "d".repeat(40) })).toBe(false);
  });
  it("refuse une confirmation ou une proposition absente", () => {
    expect(confirmationLivraisonCourante(null, cible)).toBe(false);
    expect(confirmationLivraisonCourante(cible, null)).toBe(false);
    expect(confirmationLivraisonCourante(cible, undefined)).toBe(false);
  });
  it("relit aussi la proposition au repos et accélère le suivi d'une livraison", () => {
    expect(intervalleLivraison(false)).toBe(10000);
    expect(intervalleLivraison(true)).toBe(2500);
  });
});
