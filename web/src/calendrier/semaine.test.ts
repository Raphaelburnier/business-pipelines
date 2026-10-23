import { describe, expect, it } from "vitest";
import type { Objectif } from "./api";
import { dateCivile, departEnRetard, departsFeuille, etatDepartFeuille, instantZurich, departModifiable, enRetard, entreesDe, etatEntree, joursDeLaSemaine, lundi, semaine, suivante } from "./semaine";

function objectif(partiel: Partial<Objectif>): Objectif {
  return {
    id: "o1", revision: 1, projectId: "finance", titre: "Revue", priority: "normale", source: "calendar", date: "2026-10-22", heure: "07:30",
    repetition: "none", active: true, nextAt: null, criteres: ["fait"], occurrences: [],
    brouillon: { projectId: "finance", graph: { name: "demo", nodes: [] }, assignments: {}, baseRef: null },
    ...partiel,
  };
}

describe("semaine du calendrier", () => {
  it("part du lundi, même autour du passage à l'heure d'hiver", () => {
    expect(lundi("2026-10-25")).toBe("2026-10-19");
    expect(joursDeLaSemaine("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    // 25 octobre 2026 : 03:00 CEST redevient 02:00 CET.
    expect(dateCivile("2026-10-25T00:30:00Z")).toEqual({ date: "2026-10-25", heure: "02:30" });
    expect(dateCivile("2026-10-25T01:30:00Z")).toEqual({ date: "2026-10-25", heure: "02:30" });
  });

  it("répète en sautant le week-end pour les jours ouvrés", () => {
    expect(suivante("2026-10-23", "weekdays")).toBe("2026-10-26");
    expect(suivante("2026-10-23", "daily")).toBe("2026-10-24");
    expect(suivante("2026-10-23", "weekly")).toBe("2026-10-30");
    expect(suivante("2026-10-23", "none")).toBeNull();
  });

  it("affiche les départs lancés, le prochain et les suivants prévus", () => {
    const o = objectif({
      repetition: "weekdays", nextAt: "2026-10-22T05:30:00.000Z",
      occurrences: [{ id: "a", date: "2026-10-21", scheduledAt: "2026-10-21T05:30:00.000Z", commandId: "c", runId: "r", statut: "waiting_quota", raison: null, attente: null, livraison: null }],
    });
    const entrees = entreesDe(o, "2026-10-19");
    expect(entrees.map((e) => [e.date, e.heure, e.genre])).toEqual([
      ["2026-10-21", "07:30", "lance"], ["2026-10-22", "07:30", "prochain"], ["2026-10-23", "07:30", "prevu"],
    ]);
    expect(etatEntree(entrees[0]!).mot).toBe("attente quota");
    expect(etatEntree(entrees[1]!).mot).toBe("prochain départ");
    expect(etatEntree({ ...entrees[2]!, objectif: { ...o, active: false } }).mot).toBe("en pause");
  });

  it("range chaque jour par heure et signale un départ en retard", () => {
    const tot = objectif({ id: "tot", titre: "Tôt", nextAt: "2026-10-22T04:00:00.000Z" });
    const tard = objectif({ id: "tard", titre: "Tard", nextAt: "2026-10-22T16:00:00.000Z" });
    expect(semaine([tard, tot], "2026-10-19").get("2026-10-22")!.map((e) => e.objectif.id)).toEqual(["tot", "tard"]);
    const maintenant = Date.parse("2026-10-22T10:00:00Z");
    expect(enRetard(tot, maintenant)).toBe(true);
    expect(enRetard(tard, maintenant)).toBe(false);
    expect(enRetard({ ...tot, active: false }, maintenant)).toBe(false);
  });
  it("garde les anciennes occurrences inachevées visibles et permet le report d'un ponctuel en file", () => {
    const o = objectif({ occurrences: [{ id: 'a', date: '2026-10-12', scheduledAt: '2026-10-12T05:30:00.000Z', commandId: 'c', runId: null, statut: 'queued', raison: 'worker absent', attente: null, livraison: null }] });
    const maintenant = Date.parse('2026-10-22T10:00Z');
    expect(entreesDe(o, '2026-10-19')).toEqual([]);
    expect(departEnRetard(o, maintenant)).toBe('2026-10-12T05:30:00.000Z');
    expect(departModifiable(o)).toBe('2026-10-12T05:30:00.000Z');
    for (const statut of ['running', 'waiting_quota', 'failed']) {
      const enCours = { ...o, occurrences: [{ ...o.occurrences[0]!, statut, runId: 'r' }] };
      expect(enRetard(enCours, maintenant)).toBe(true);
      expect(departModifiable(enCours)).toBeNull();
    }
    for (const statut of ['succeeded', 'cancelled']) expect(enRetard({ ...o, occurrences: [{ ...o.occurrences[0]!, statut }] }, maintenant)).toBe(false);
    const recurrent = { ...o, repetition: 'daily' as const, nextAt: '2026-10-23T05:30:00.000Z' };
    expect(departModifiable(recurrent)).toBe(recurrent.nextAt);
  });
  it("convertit une heure de Zurich en instant, y compris autour des changements d'heure", () => {
    expect(instantZurich("2026-10-24", "07:30")).toBe("2026-10-24T05:30:00.000Z");
    expect(instantZurich("2026-10-26", "07:30")).toBe("2026-10-26T06:30:00.000Z");
    // 25 octobre 2026 : 02:30 existe deux fois, la première est retenue.
    expect(instantZurich("2026-10-25", "02:30")).toBe("2026-10-25T00:30:00.000Z");
    // 29 mars 2026 : 02:30 n'existe pas.
    expect(() => instantZurich("2026-03-29", "02:30")).toThrow(/n'existe pas/);
  });

  it("place les objectifs planifiés depuis À venir à leur jour", () => {
    const base = { objectif: { id: "11.3", revision: 1 }, runId: null, projetId: "business-pipelines", agent: null, creeLe: "", raison: null, livraison: null };
    const parJour = departsFeuille([
      { ...base, commandeId: "c1", statut: "queued", prevuLe: "2026-10-24T05:30:00.000Z" },
      { ...base, commandeId: "c2", statut: "queued", prevuLe: null },
      { ...base, commandeId: "c3", statut: "queued", prevuLe: "2026-11-02T05:30:00.000Z" },
    ], "2026-10-19");
    expect([...parJour.keys()]).toEqual(["2026-10-24"]);
    const [d] = parJour.get("2026-10-24")!;
    expect(d).toMatchObject({ objectifId: "11.3", heure: "07:30" });
    expect(etatDepartFeuille(d!).mot).toBe("planifié");
    expect(etatDepartFeuille({ ...d!, statut: "running", runId: "r" }).mot).toBe("en cours");
  });
});
