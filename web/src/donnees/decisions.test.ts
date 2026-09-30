// Ce que la page des approbations montre d'une action. Ces garanties étaient testées sur
// l'ancienne page HTML ; la page est passée dans le front, elles l'ont suivie.
import { describe, expect, it } from "vitest";
import { attente, ecartDePrix, lireAction, type ActionApprobation } from "./decisions";

const action = (partiel: Partial<ActionApprobation>): ActionApprobation => ({
  id: "act-001",
  type: "prix",
  decision: null,
  note: null,
  ...partiel,
});

describe("lecture d'une action", () => {
  it("un changement de prix se lit en écart, sans « Infinity % » depuis un prix nul", () => {
    expect(ecartDePrix({ de: 12, vers: 9.9, devise: "CHF" })).toBe("12 → 9.9 CHF (-17.5 %)");
    expect(ecartDePrix({ de: 0, vers: 12, devise: "USD" })).toBe("0 → 12 USD");
    expect(lireAction(action({ valeur: { de: 0, vers: 12 }, justification: "l'agent l'a dit" }))).toEqual({
      forme: "prix",
      ecart: "0 → 12",
      lignes: ["l'agent l'a dit"],
    });
  });

  it("un arbitrage d'avant question/rapport se relit en phrases, pas en JSON", () => {
    const lu = lireAction(
      action({
        type: "arbitrage",
        cible: "Vendre sous un nom de boutique identifiable ?",
        valeur: { options: ["Nom de boutique", "Vendeur générique"], recommandation: "Nom de boutique", pourquoi: "promesse visible" },
      })
    );
    expect(lu).toEqual({
      forme: "question",
      question: "Vendre sous un nom de boutique identifiable ?",
      lignes: ["Option 1 : Nom de boutique", "Option 2 : Vendeur générique", "Recommandation : Nom de boutique", "Pourquoi : promesse visible"],
    });
  });

  it("une question récente garde son rapport, ligne par ligne", () => {
    expect(lireAction(action({ type: "arbitrage", question: "Baisser le prix ?", rapport: "Marge suffisante.\n\nConcurrent à 9.90." }))).toEqual({
      forme: "question",
      question: "Baisser le prix ?",
      lignes: ["Marge suffisante.", "Concurrent à 9.90."],
    });
  });

  it("un objet plat se lit en « clé : valeur », une valeur imbriquée en JSON en dernier recours", () => {
    expect(lireAction(action({ type: "budget", valeur: { montant_eur: 180, duree_jours: 7 } }))).toEqual({
      forme: "question",
      question: "budget",
      lignes: ["montant eur : 180", "duree jours : 7"],
    });
    expect(lireAction(action({ type: "autre", valeur: { liste: [1, 2] } })).forme).toBe("brut");
  });
});

describe("attente d'un dossier", () => {
  const maintenant = Date.parse("2026-09-30T12:00:00Z");
  it("se lit en durée", () => {
    expect(attente("2026-09-30T09:00:00Z", maintenant)).toBe("3.0 h");
    expect(attente("2026-09-13T18:01:21Z", maintenant)).toBe("17 j");
  });
  it("une date illisible s'affiche telle quelle plutôt que « NaN h »", () => {
    expect(attente("pas une date", maintenant)).toBe("pas une date");
  });
});
