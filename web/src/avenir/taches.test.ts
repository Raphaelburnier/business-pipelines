import { afterEach, describe, expect, it, vi } from "vitest";
import type { Objectif, Occurrence } from "../calendrier/api";
import type { Defaut, Lot } from "./feuille";
import { DEFAUTS, LOTS } from "./feuille";
import type { AttributionAvenir } from "../donnees/source";
import { compter, construireTaches, filtrer, FILTRE_DEFAUT, projetsDisponibles, statutObjectif, SYSTEME } from "./taches";

const lots: Lot[] = [{ id: "12", titre: "Calendrier", but: "", etapes: [
  { id: "12.1", titre: "Page Calendrier", detail: "Les runs prévus", fichiers: [], statut: "fait" },
  { id: "12.2", titre: "Vue mois", detail: "Afficher un mois entier", fichiers: [], statut: "a-faire" },
] }];
const defauts: Defaut[] = [{ id: "F9", severite: "critique", titre: "Jeton exposé", fichiers: "", correctif: "Lot 0.7", statut: "en-cours" }];
const occurrence = (statut: string): Occurrence => ({ id: statut, date: "2026-10-22", scheduledAt: "2026-10-22T05:30:00.000Z", commandId: "c", runId: "r", statut, raison: null, attente: null, livraison: null });
const attribution = (id: string, statut: string, partiel: Partial<AttributionAvenir> = {}): AttributionAvenir => ({ objectif: { id, revision: 1 }, commandeId: "c", runId: "r", projetId: "demo", agent: null, statut, creeLe: "2026-10-22T05:30:00.000Z", raison: null, livraison: null, ...partiel });
function objectif(partiel: Partial<Objectif>): Objectif {
  return { id: "o1", revision: 1, projectId: "finance", titre: "Revue des marchés", priority: "normale", source: "calendar", date: "2026-10-22", heure: "07:30",
    repetition: "none", active: true, nextAt: null, criteres: ["Note produite"], occurrences: [],
    brouillon: { projectId: "finance", graph: { name: "finance-research", title: "Recherche Finance", nodes: [] }, assignments: {}, baseRef: null }, ...partiel };
}

describe("tâches de la page À venir", () => {
  afterEach(() => vi.useRealTimers());
  it("retire O2 / lot 7.3 des fix ouverts et le conserve dans l'historique fait", () => {
    const taches = construireTaches(LOTS, DEFAUTS, []);
    expect(filtrer(taches, { ...FILTRE_DEFAUT, type: "fix" }).map(t => t.ref)).not.toContain("O2");
    expect(filtrer(taches, { ...FILTRE_DEFAUT, type: "fix", statut: "faites" }).find(t => t.ref === "O2")?.statut).toBe("fait");
  });

  it("synchronise un fix lié à un lot, même si son ancien statut a été oublié", () => {
    const fix = { ...defauts[0]!, correctif: "Lot 12.1", statut: "a-faire" as const };
    expect(construireTaches(lots, [fix], [])[0]!.statut).toBe("fait");
    const enCours = [{ ...lots[0]!, etapes: [{ ...lots[0]!.etapes[0]!, statut: "en-cours" as const }] }];
    expect(construireTaches(enCours, [fix], [])[0]!.statut).toBe("en-cours");
    for (const correctif of ["Lot 99.1", "Lots 12.1 et 12.2", "Lot 12.1 et recette indépendante", "Sans objet"]) {
      expect(construireTaches(lots, [{ ...fix, correctif }], [])[0]!.statut, correctif).toBe("a-faire");
    }
  });

  it("suit les runs de tous les agents sans confondre réussite et clôture", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
    for (const statut of ["queued", "running", "paused", "waiting_quota", "waiting_machine", "waiting_auth", "waiting_approval", "waiting_freshness", "review", "succeeded", "completed"]) {
      const taches = construireTaches(lots, [{ ...defauts[0]!, correctif: "Lot 12.2" }], [], [attribution("12.2", statut)]);
      expect(taches.find(t => t.ref === "12.2")?.statut, statut).toBe("en-cours");
      expect(taches.find(t => t.ref === "F9")?.statut, statut).toBe("en-cours");
    }
    for (const statut of ["failed", "cancelled", "non_attribue"]) {
      expect(construireTaches(lots, [], [], [attribution("12.2", statut)]).find(t => t.ref === "12.2")?.statut).toBe("a-faire");
    }
    expect(construireTaches(lots, [], [], [attribution("12.1", "running")]).find(t => t.ref === "12.1")?.statut).toBe("fait");
    expect(construireTaches(lots, [], [], [attribution("12.2", "queued", { prevuLe: "2026-12-01T00:00:00.000Z", runId: null })]).find(t => t.ref === "12.2")?.statut).toBe("a-faire");
  });

  it("suit les objectifs réservés du calendrier et les fix exécutés directement", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T12:00:00.000Z"));
    const suivi = objectif({ taskBoard: { id: "12.2", revision: 1, groupeId: "g1" }, occurrences: [occurrence("running")] });
    expect(construireTaches(lots, [], [suivi]).find(t => t.ref === "12.2")?.statut).toBe("en-cours");
    expect(construireTaches(lots, [], [{ ...suivi, occurrences: [], nextAt: "2026-12-01T00:00:00.000Z" }]).find(t => t.ref === "12.2")?.statut).toBe("a-faire");
    const programme = { ...occurrence("queued"), runId: null, scheduledAt: "2026-12-01T00:00:00.000Z" };
    expect(construireTaches(lots, [], [{ ...suivi, occurrences: [programme] }]).find(t => t.ref === "12.2")?.statut).toBe("a-faire");
    expect(construireTaches(lots, [{ ...defauts[0]!, statut: "a-faire" }], [], [attribution("F9", "running")])[0]!.statut).toBe("en-cours");
  });

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
