import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { LOTS } from "./feuille";
import { cheminReference, sensibiliteEtape } from "./sensibilite";

const require = createRequire(import.meta.url);
const { estSensible } = require("../../../src/pull-requests.js") as { estSensible: (chemin: string) => boolean };

describe("sensibilité de la feuille", () => {
  it("suit le filtre du publieur pour chaque chemin annoncé, y compris les anciens oublis", () => {
    for (const etape of LOTS.flatMap((lot) => lot.etapes)) {
      expect(sensibiliteEtape(etape).fichiersProteges).toEqual(etape.fichiers.filter((fichier) => estSensible(cheminReference(fichier))));
    }
    for (const id of ["0.4", "0.5", "0.6", "2.1", "2.5", "2.6", "2.7", "3.7", "4.2", "4.3", "4.4", "5.3", "6.5", "7.2", "9.2", "10.1", "11.3"]) {
      const etape = LOTS.flatMap((lot) => lot.etapes).find((e) => e.id === id)!;
      expect(sensibiliteEtape(etape).sensible, id).toBe(true);
    }
  });

  it("normalise les préfixes, numéros de ligne et noms de workflows de l'audit", () => {
    expect(cheminReference("AO src/codex-runner.js:189-198, 244-245")).toBe("src/codex-runner.js");
    expect(cheminReference("agent-gated-merge.yml:228")).toBe(".github/workflows/agent-gated-merge.yml");
    expect(sensibiliteEtape({ fichiers: ["BP .ENV.production:1"] }).sensible).toBe(true);
  });

  it("un risque motivé demande une revue même sans chemin protégé annoncé", () => {
    expect(sensibiliteEtape({ fichiers: ["BP web/src/vues/Pipelines.tsx"], raisonSensibilite: "Change les actions exécutables." }))
      .toMatchObject({ sensible: true, fichiersProteges: [], raisons: ["Risque signalé dans le cadrage : Change les actions exécutables."] });
    expect(sensibiliteEtape({ fichiers: ["BP bin/cockpit.js"], raisonSensibilite: "" }).sensible).toBe(true);
  });

  it("une simple présentation reste sans badge et la politique reste protégée", () => {
    expect(sensibiliteEtape({ fichiers: ["BP web/src/App.tsx", "BP web/src/style.css"] }).sensible).toBe(false);
    expect(estSensible("deploy/fichiers-sensibles.json")).toBe(true);
  });
});
