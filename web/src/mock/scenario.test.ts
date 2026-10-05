// Les fixtures de la maquette ne sont utiles que si elles disent vrai : même forme que
// l'API (validée par les schémas zod partagés), et les cas tordus de l'annexe A bien là.
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { DUREE_CYCLE_S, etatA, evenementsJusqua } from "./scenario";

const require = createRequire(import.meta.url);
// Les schémas à l'exécution, depuis agent-orchestrator : ceux-là mêmes que valide l'API.
const { cockpit } = require(path.resolve(import.meta.dirname, "../../../node_modules/agent-orchestrator/packages/schemas/cockpit.js"));

const T0 = Date.parse("2026-09-18T10:00:00.000Z");
const a = (secondes: number) => etatA(T0, secondes * 1000);

describe("fixtures de la maquette", () => {
  test("à tout instant, chaque réponse respecte le schéma de l'API", () => {
    for (const s of [0, 2, 5, 15, 21, 24, 29, 35, 41, 45, 90]) {
      const etat = a(s);
      cockpit.topologie.parse(etat.topologie);
      cockpit.usage.parse(etat.usage);
      for (const run of etat.runs) cockpit.runDetaille.parse(run);
      cockpit.evenement.array().parse(etat.evenements);
    }
  });

  test("les cas tordus de l'annexe A sont là", () => {
    const { topologie, runs } = a(0);
    expect(topologie.machines).toHaveLength(2);
    expect(topologie.machines.find((m) => m.machine === "pc")?.etat).toBe("sleeping");
    expect(topologie.projets.map((p) => p.id)).toEqual(["marketing", "steam-tierlist"]);
    expect(topologie.projets.filter((p) => p.aFiche)).toHaveLength(2);
    expect(topologie.projets.find((p) => p.id === "marketing")?.nom).toBe("Plan marketing");
    expect(runs.find((r) => r.declencheur === "adhoc")?.statut).toBe("succeeded");
    expect(runs.some((r) => r.statut === "waiting_quota")).toBe(true);
  });

  test("le run rejoué montre le parallélisme, la boucle et l'approbation", () => {
    const rejoue = (s: number) => a(s).runs[0]!;

    const pendant = rejoue(8).etapes;
    expect(pendant.filter((e) => e.statut === "running").map((e) => e.noeud).sort()).toEqual(["economie", "marque"]);

    const boucle = rejoue(24).etapes.find((e) => e.statut === "running");
    expect(boucle).toMatchObject({ noeud: "synthese", tour: 1 });

    const fin = rejoue(30);
    expect(fin.statut).toBe("waiting_approval");
    expect(fin.approbations).toHaveLength(1);
    expect(a(30).topologie.projets[0]).toMatchObject({ etat: "attente", approbationsEnAttente: 1 });
  });

  test("le PC se réveille, travaille, puis se rendort", () => {
    const pc = (s: number) => a(s).topologie.machines.find((m) => m.machine === "pc")?.etat;
    expect([pc(0), pc(2), pc(10), pc(30), pc(38)]).toEqual(["sleeping", "waking", "busy", "online", "sleeping"]);
  });

  test("les identifiants d'événements croissent d'un cycle à l'autre, sans doublon", () => {
    const ids = evenementsJusqua(T0, 3 * DUREE_CYCLE_S * 1000).map((e) => e.id);
    expect(ids.length).toBeGreaterThan(40);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id, i) => i === 0 || id > ids[i - 1]!)).toBe(true);
    // Un nouveau cycle est un nouveau run : ses événements ne se mélangent pas au précédent.
    const runsVus = new Set(evenementsJusqua(T0, 2 * DUREE_CYCLE_S * 1000).map((e) => e.run).filter(Boolean));
    expect([...runsVus].sort()).toEqual(["run-rejoue-1", "run-rejoue-2", "run-rejoue-3"]);
  });
});
