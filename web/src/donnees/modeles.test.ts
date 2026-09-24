import { describe, expect, test } from "vitest";
import { catalogueMaquette } from "../mock/modeles";
import { classer } from "./modeles";

const reponse = catalogueMaquette(Date.parse("2026-09-24T12:00:00Z"));

describe("classement du sélecteur", () => {
  test("écarte l'épuisé et le sans-outils, garde le quota inconnu, combos en tête", () => {
    const c = classer(reponse);
    expect(c.utilisables.map(([f]) => f)).toEqual(["combo", "agy", "gemini"]);
    expect(Object.fromEntries(c.indisponibles.map((i) => [i.modele.llm.model, i.raison]))).toEqual({
      "codex/gpt-5.6-terra": "quota épuisé",
      "ollama-local/qwen3:8b-40k": "sans appel d'outils : un agent en a besoin",
    });
  });

  test("un PC absent empêche de choisir OmniRoute", () => {
    const c = classer({ ...reponse, machines: reponse.machines.filter((m) => m.machine !== "pc") });
    expect(c.utilisables).toEqual([]);
    expect(c.indisponibles.every((i) => i.raison.includes("non enregistrée"))).toBe(true);
  });

  test("un PC endormi mais réveillable garde OmniRoute utilisable et l'annonce", () => {
    const c = classer({
      ...reponse,
      machines: reponse.machines.map((m) => (m.machine === "pc" ? { ...m, etat: "sleeping" as const } : m)),
    });
    expect(c.utilisables.length).toBeGreaterThan(0);
    expect(c.annotations["omniroute:agentic-code"]).toBe("réveillera le PC");
  });

  test("la recherche porte sur le nom, l'identifiant et le fournisseur", () => {
    expect(classer(reponse, "sonnet").total).toBe(1);
    expect(classer(reponse, "codex").indisponibles).toHaveLength(1);
    expect(classer(reponse, "combo vision").utilisables).toEqual([["combo", [expect.objectContaining({ nom: "vision" })]]]);
  });
});
