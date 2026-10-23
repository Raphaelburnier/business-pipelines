import { describe, expect, it } from "vitest";
import type { Objectif, Occurrence } from "../calendrier/api";
import type { Defaut, Lot } from "./feuille";
import { compter, construireTaches, filtrer, FILTRE_DEFAUT, projetsDisponibles, statutObjectif, SYSTEME } from "./taches";

const lots: Lot[] = [{ id: "12", titre: "Calendrier", but: "", etapes: [
  { id: "12.1", titre: "Page Calendrier", detail: "Les runs prévus", fichiers: [], statut: "fait" },
  { id: "12.2", titre: "Vue mois", detail: "Afficher un mois entier", fichiers: [], statut: "a-faire" },
] }];
const defauts: Defaut[] = [{ id: "F9", severite: "critique", titre: "Jeton exposé", fichiers: "", correctif: "Lot 0.7", statut: "en-cours" }];
const occurrence = (statut: string): Occurrence => ({ id: statut, date: "2026-10-22", scheduledAt: "2026-10-22T05:30:00.000Z", commandId: "c", runId: "r", statut, raison: null, attente: null, livraison: null });
function objectif(partiel: Partial<Objectif>): Objectif {
  return { id: "o1", revision: 1, projectId: "finance", titre: "Revue des marchés", priority: "normale", source: "calendar", date: "2026-10-22", heure: "07:30",
    repetition: "none", active: true, nextAt: null, criteres: ["Note produite"], occurrences: [],
    brouillon: { projectId: "finance", graph: { name: "finance-research", title: "Recherche Finance", nodes: [] }, assignments: {}, baseRef: null }, ...partiel };
}

describe("tâches de la page À venir", () => {
  it("déduit le statut d'une tâche projet de son dernier départ", () => {
    expect(statutObjectif(objectif({ active: false }))).toBe("a-faire");
    expect(statutObjectif(objectif({ occurrences: [occurrence("waiting_quota")] }))).toBe("en-cours");
    expect(statutObjectif(objectif({ occurrences: [occurrence("succeeded")] }))).toBe("fait");
    expect(statutObjectif(objectif({ repetition: "daily", nextAt: "2026-10-23T05:30:00.000Z", occurrences: [occurrence("succeeded")] }))).toBe("a-faire");
    expect(statutObjectif(objectif({ occurrences: [occurrence("failed")] }))).toBe("a-faire");
  });

  it("réunit fonctionnalités, fix et tâches projet et les filtre", () => {
    const taches = construireTaches(lots, defauts, [objectif({}), objectif({ id: "o2", projectId: "marketing", titre: "Script vidéo" })]);
    expect(taches.map((t) => [t.type, t.projet, t.ref])).toEqual([
      ["projet", "finance", "Recherche Finance"], ["projet", "marketing", "Recherche Finance"],
      ["fix", SYSTEME, "F9"], ["fonctionnalite", SYSTEME, "12.1"], ["fonctionnalite", SYSTEME, "12.2"],
    ]);
    expect(filtrer(taches, FILTRE_DEFAUT).map((t) => t.cle)).not.toContain("etape:12.1");
    expect(filtrer(taches, { ...FILTRE_DEFAUT, statut: "faites" }).map((t) => t.cle)).toEqual(["etape:12.1"]);
    expect(filtrer(taches, { ...FILTRE_DEFAUT, projet: "marketing" }).map((t) => t.titre)).toEqual(["Script vidéo"]);
    expect(filtrer(taches, { ...FILTRE_DEFAUT, type: "fix" }).map((t) => t.ref)).toEqual(["F9"]);
    expect(filtrer(taches, { ...FILTRE_DEFAUT, recherche: "jeton EXPOSE" }).map((t) => t.ref)).toEqual(["F9"]);
    expect(compter(taches, "fonctionnalite")).toBe(1);
  });

  it("propose le système puis chaque projet connu ou porteur de tâches", () => {
    const taches = construireTaches(lots, defauts, [objectif({ projectId: "steam-tierlist" })]);
    expect(projetsDisponibles(taches, [{ id: "finance", nom: "Finance" }])).toEqual([
      { id: SYSTEME, nom: "Système" }, { id: "finance", nom: "Finance" }, { id: "steam-tierlist", nom: "steam-tierlist" },
    ]);
  });
});
