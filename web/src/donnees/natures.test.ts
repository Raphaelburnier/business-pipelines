import { describe, expect, it } from "vitest";
import { libelleNature } from "./natures";
import { sourceMaquette } from "../mock/source";

describe("libellé de nature", () => {
  const natures = [{ id: "developpement", libelle: "Développement" }, { id: "seo", libelle: "SEO" }];

  it("vient des natures servies, y compris une branche ajoutée au registre", () => {
    expect(libelleNature(natures, "developpement")).toBe("Développement");
    expect(libelleNature(natures, "seo")).toBe("SEO");
  });

  it("reste lisible tant que les natures ne sont pas chargées ou pour « autre »", () => {
    expect(libelleNature(null, "autre")).toBe("Mission");
    expect(libelleNature(undefined, null)).toBe("Mission");
    expect(libelleNature(null, "seo")).toBe("seo");
  });

  it("la maquette sert les trois natures avec leurs projets", async () => {
    const { natures: lues } = await sourceMaquette().natures();
    expect(lues.map((n) => n.id)).toEqual(["finance", "developpement", "marketing"]);
    expect(lues.every((n) => n.libelle && n.description)).toBe(true);
  });
});
