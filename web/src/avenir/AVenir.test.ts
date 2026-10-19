import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AVenir, construireSpecAttribution, expliquerConflitAttribution } from "./AVenir";
import { LOTS, estAttribuable, projetObjectif } from "./feuille";
import type { AttributionAvenir } from "../donnees/source";
import type { Topologie } from "../types";

vi.mock("../donnees/contexte", () => ({
  useSource: () => ({ source: { proposerPlan: vi.fn(), lancerPlan: vi.fn() } }),
  useCharge: vi.fn(),
}));
import { useCharge } from "../donnees/contexte";

const toutesLesEtapes = LOTS.flatMap((lot) => lot.etapes);
const topo = { projets: [{ id: "demo", nom: "Projet démo", aFiche: true, pipelines: ["dev@1"] }] } as unknown as Topologie;
const attribution: AttributionAvenir = {
  objectif: { id: "0.7", revision: 1 }, commandeId: "cmd-12345678", runId: "run-12345678", projetId: "demo",
  agent: { id: "sacha", nom: "Sacha", llm: { via: "codex", model: "gpt-5.6" } }, statut: "running",
  creeLe: "2026-10-19T00:00:00.000Z", raison: null, livraison: null,
};

describe("attribution depuis À venir", () => {
  beforeEach(() => {
    vi.mocked(useCharge).mockReset();
    vi.mocked(useCharge)
      .mockReturnValueOnce({ donnees: [attribution], erreur: null } as never)
      .mockReturnValueOnce({ donnees: topo, erreur: null } as never);
  });

  it("n'affiche l'action que pour les objectifs attribuables et montre l'assignation active", () => {
    const html = renderToStaticMarkup(createElement(AVenir));
    const actions = (html.match(/>Attribuer<\/button>/g) ?? []).length;
    expect(actions).toBe(toutesLesEtapes.filter((e) => estAttribuable(e) && projetObjectif(e.id)).length - 1);
    expect(html).toContain("Sacha");
    expect(html).toContain("Projet démo");
    expect(html).toContain("Run run-1234");
    expect(html).toContain("en cours");
  });

  it("prépare la référence, le projet et les critères sans exclure Claude ni Codex", () => {
    const etape = toutesLesEtapes.find((e) => e.id === "0.7")!;
    const spec = construireSpecAttribution(etape, "business-pipelines", ["Revue faite"]);
    expect(spec.projectId).toBe("business-pipelines");
    expect(spec.contexte).toEqual({ _roadmapObjective: { id: "0.7", revision: 1 } });
    expect(spec.runtimesExclus).toEqual(["omniroute"]);
    expect(spec.criteres).toEqual(["Revue faite"]);
  });

  it("explique un conflit de réservation concurrente", () => {
    expect(expliquerConflitAttribution("OBJECTIF_OCCUPE")).toMatch(/pris par un autre run/);
    expect(expliquerConflitAttribution("réseau hors ligne")).toBe("réseau hors ligne");
  });
});
