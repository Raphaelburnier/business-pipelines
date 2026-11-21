import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pipelines } from "./Pipelines";
import { FournisseurToasts } from "../composants/Toasts";
import type { ReponsePipelines } from "../donnees/pipelines";

vi.mock("../donnees/contexte", () => ({
  useSource: () => ({ source: { renommerPipeline: vi.fn(), rattacherPipeline: vi.fn() } }),
  useCharge: vi.fn(),
}));
import { useCharge } from "../donnees/contexte";

const catalogue: ReponsePipelines = {
  pipelines: [
    { id: "saas-build", nom: "Construire un SaaS", perso: false, titreRegistre: "Construire un SaaS", versions: [2, 3], projets: ["demo"], runs: 2, dernierRun: "2026-10-20T00:00:00.000Z" },
    { id: "sauvegarde", nom: "Sauvegarde du NAS", perso: false, titreRegistre: "Sauvegarde du NAS", versions: [1], projets: [], runs: 0, dernierRun: null },
    { id: "adhoc:content-writer", nom: null, perso: false, titreRegistre: null, versions: [], projets: ["demo"], runs: 1, dernierRun: null },
  ], projets: [{ id: "demo", nom: "Démo" }], peutRattacher: true, rattachements: [],
};

// Renommer et rattacher confirment par un toast : la fiche se rend sous le fournisseur des toasts.
const rendre = (pipelineId: string | null) => renderToStaticMarkup(createElement(FournisseurToasts, null, createElement(Pipelines, { pipelineId, aller: vi.fn() })));

describe("Pipelines", () => {
  // Le catalogue et les résultats par version passent tous deux par useCharge : la maquette
  // rend à chacun sa forme selon la méthode de source appelée.
  beforeEach(() => {
    vi.mocked(useCharge).mockImplementation(((charger: (s: Record<string, () => string>) => string) =>
      charger({ pipelines: () => "catalogue", resultatsPipelines: () => "resultats" }) === "resultats"
        ? { donnees: { depuis: "2026-08-21T00:00:00.000Z", jours: 90, versions: [] }, erreur: null }
        : { donnees: catalogue, erreur: null }) as never);
  });
  it("rend seulement le catalogue du registre", () => {
    const html = rendre("saas-build");
    expect(html).toContain("Construire un SaaS"); expect(html).toContain("Sauvegarde du NAS");
    expect(html).not.toContain("adhoc:content-writer"); expect(html).not.toContain("content-writer");
    expect(html).toContain("v3"); expect(html).not.toContain("pl-graphe"); expect(html).not.toContain("pl-noeud");
    expect(html).toContain('aria-label="Pipelines enregistrés"');
  });
  it("nomme le registre quand il ne contient aucune version", () => {
    vi.mocked(useCharge).mockReturnValue({ donnees: { ...catalogue, pipelines: [catalogue.pipelines[2]!] }, erreur: null } as never);
    const html = rendre(null);
    expect(html).toContain("Aucun pipeline enregistré");
    expect(html).toContain("Le registre ne publie encore aucune version.");
  });
  it("retombe sur le premier pipeline pour un identifiant inconnu", () => {
    const html = rendre("inconnu");
    expect(html).toContain("Construire un SaaS");
  });
});
