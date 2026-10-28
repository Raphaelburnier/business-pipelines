import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AVenir, construireSpecAttribution, expliquerConflitAttribution } from "./AVenir";
import { LOTS, estAttribuable, projetObjectif } from "./feuille";
import type { AttributionAvenir } from "../donnees/source";
import type { Topologie } from "../types";
import type { Objectif } from "../calendrier/api";

vi.mock("../donnees/contexte", () => ({
  useSource: () => ({ source: { proposerPlan: vi.fn(), lancerPlan: vi.fn() } }),
  useCharge: vi.fn(),
}));
import { useCharge } from "../donnees/contexte";

const toutesLesEtapes = LOTS.flatMap((lot) => lot.etapes);
const topo = { projets: [{ id: "demo", nom: "Projet démo", aFiche: true, pipelines: ["dev@1"] }] } as unknown as Topologie;
const attribution: AttributionAvenir = {
  objectif: { id: "5.2", revision: 1 }, commandeId: "cmd-12345678", runId: "run-12345678", projetId: "demo",
  agent: { id: "sacha", nom: "Sacha", llm: { via: "codex", model: "gpt-5.6" } }, statut: "running",
  creeLe: "2026-10-19T00:00:00.000Z", raison: null, livraison: null,
};

const tacheFinance: Objectif = {
  id: "00000000-0000-4000-8000-000000000009", revision: 2, projectId: "finance", titre: "Revue hebdomadaire du portefeuille", priority: "haute", source: "calendar",
  date: "2026-10-26", heure: "07:30", repetition: "weekly", active: true, nextAt: "2026-10-26T06:30:00.000Z", criteres: ["Note de synthèse produite"], occurrences: [],
  brouillon: { projectId: "finance", graph: { name: "finance-research", title: "Recherche Finance", nodes: [] }, assignments: {}, baseRef: "finance-research@2" },
};

describe("attribution depuis À venir", () => {
  beforeEach(() => {
    vi.mocked(useCharge).mockReset();
    vi.mocked(useCharge)
      .mockReturnValueOnce({ donnees: [attribution], erreur: null } as never)
      .mockReturnValueOnce({ donnees: topo, erreur: null } as never)
      .mockReturnValueOnce({ donnees: [tacheFinance], erreur: null } as never);
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
    const etape = toutesLesEtapes.find((e) => e.id === "4.3")!;
    const spec = construireSpecAttribution(etape, "business-pipelines", ["Revue faite"]);
    expect(spec.projectId).toBe("business-pipelines");
    expect(spec.contexte).toEqual({ _roadmapObjective: { id: "4.3", revision: 1 } });
    expect(spec.runtimesExclus).toEqual(["omniroute"]);
    expect(spec.criteres).toEqual(["Revue faite"]);
    expect(spec.exigences).toEqual(["revue-securite"]);
    expect(spec.document).toContain("Fichier protégé annoncé : BP bin/cockpit.js:590-592.");
  });

  it("transmet la revue de sécurité pour un chemin protégé ou un risque motivé", () => {
    for (const id of ["2.6", "4.3", "11.5"]) {
      const etape = toutesLesEtapes.find((e) => e.id === id)!;
      expect(construireSpecAttribution(etape, "business-pipelines", ["Vérifié"]).exigences, id).toEqual(["revue-securite"]);
    }
    const presentation = toutesLesEtapes.find((e) => e.id === "13.1")!;
    expect(construireSpecAttribution(presentation, "business-pipelines", ["Vérifié"]).exigences).toEqual([]);
    const planification = toutesLesEtapes.find((e) => e.id === "11.5")!;
    expect(construireSpecAttribution(planification, "business-pipelines", ["Vérifié"]).document).toContain("Planifier une tâche autorise un lancement différé.");
  });

  it("affiche la provenance du badge et le contrôle séparé de la fusion", () => {
    const html = renderToStaticMarkup(createElement(AVenir));
    expect(html).toContain("Fichier protégé annoncé : BP bin/cockpit.js:590-592.");
    expect(html).toContain("Risque signalé dans le cadrage : Publier un pipeline modifie les actions que le moteur peut exécuter.");
    expect(html).toContain("La fusion explicite dépend des fichiers réellement modifiés.");
  });

  it("réunit tâches projet, fix et fonctionnalités système avec leurs filtres", () => {
    const html = renderToStaticMarkup(createElement(AVenir));
    expect(html).toContain("Revue hebdomadaire du portefeuille");
    expect(html).toContain("Prochain départ le 26 oct. 2026, 07:30");
    expect(html).toContain("chaque semaine");
    for (const libelle of ["Tâches projet", "Fonctionnalités système", "Fix", "Nouvelle tâche projet"]) expect(html).toContain(libelle);
    expect(html).toContain('aria-label="Filtrer par projet"');
    expect(html).toContain('option value="systeme"');
    expect(html).toContain('value="croissant" selected=""');
    const lots = [...html.matchAll(/id="av-lot-(\d+)"/g)].map(m => Number(m[1]));
    expect(lots).toEqual([...lots].sort((a,b) => a-b));
  });

  it("explique un conflit de réservation concurrente", () => {
    expect(expliquerConflitAttribution("OBJECTIF_OCCUPE")).toMatch(/pris par un autre run/);
    expect(expliquerConflitAttribution("réseau hors ligne")).toBe("réseau hors ligne");
  });
});

it("permet de renforcer manuellement une tâche non sensible et retire le renommage 11.1", () => {
  const presentation = toutesLesEtapes.find((e) => e.id === "13.1")!;
  expect(construireSpecAttribution(presentation, "business-pipelines", ["Vérifié"], true).exigences).toEqual(["revue-securite"]);
  expect(toutesLesEtapes.some((e) => e.id === "11.1")).toBe(false);
  expect(LOTS.find((l) => l.id === "11")?.titre).toContain("TaskBoard");
});
