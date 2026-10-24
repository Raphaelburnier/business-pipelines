import { describe, expect, it } from "vitest";
import { sourceMaquette } from "../mock/source";
import { derniereVersion, estEnregistre, pipelinesEnregistres, refPipeline, type PipelineConnu } from "./pipelines";

const registre: PipelineConnu = { id: "registre", nom: "Alpha", perso: false, titreRegistre: "Alpha", versions: [1, 3, 2], projets: ["demo"], runs: 2, dernierRun: null };
const jamaisLance: PipelineConnu = { id: "publie", nom: "Bravo", perso: false, titreRegistre: "Bravo", versions: [1], projets: [], runs: 0, dernierRun: null };
const adhoc: PipelineConnu = { id: "adhoc:content-writer", nom: null, perso: false, titreRegistre: null, versions: [], projets: ["demo"], runs: 1, dernierRun: null };
const fiche: PipelineConnu = { id: "projet-seul", nom: null, perso: false, titreRegistre: null, versions: [], projets: ["demo"], runs: 0, dernierRun: null };

describe("catalogue des pipelines enregistrés", () => {
  it("ne retient que les versions publiées et les trie par nom", () => {
    expect(pipelinesEnregistres([registre, adhoc, fiche, jamaisLance]).map((p) => p.id)).toEqual(["registre", "publie"]);
    expect(estEnregistre(adhoc)).toBe(false);
    expect(estEnregistre(fiche)).toBe(false);
  });

  it("donne la version publiée et sa référence", () => {
    expect(derniereVersion(registre)).toBe(3);
    expect(derniereVersion(adhoc)).toBeNull();
    expect(refPipeline(registre)).toBe("registre@3");
    expect(refPipeline(adhoc)).toBe("adhoc:content-writer");
  });

  it("aligne la maquette sur le registre, pas sur les runs", async () => {
    const catalogue = pipelinesEnregistres((await sourceMaquette().pipelines()).pipelines).map((p) => p.id);
    expect(catalogue).toEqual(expect.arrayContaining(["marketing", "saas-build", "sauvegarde"]));
    expect(catalogue).not.toContain("adhoc:content-writer");
  });
});
