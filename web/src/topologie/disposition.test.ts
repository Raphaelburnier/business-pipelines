// Le graphe montre les machines, l'orchestrateur, les projets réels et quelques étapes utiles.
import { describe, expect, test } from "vitest";
import { etatA } from "../mock/scenario";
import type { RunDetailleAvecOutils, Topologie } from "../types";
import { disposer, idProjet } from "./disposition";

const topo = (): Topologie => etatA(Date.parse("2026-09-18T10:00:00.000Z"), 5000).topologie;

describe("disposition du graphe du cockpit", () => {
  test("montre le PC, le NAS, l'orchestrateur et les projets enregistrés", () => {
    const { noeuds, largeur, hauteur } = disposer(topo());
    expect(noeuds.filter((n) => n.type === "machine").map((n) => n.roleMachine).sort()).toEqual(["nas", "pc"]);
    expect(noeuds.filter((n) => n.type === "orchestrateur")).toHaveLength(1);
    expect(noeuds.filter((n) => n.type === "projet").map((n) => n.projet?.id)).toEqual(["marketing", "steam-tierlist"]);
    expect(largeur).toBeGreaterThan(0);
    expect(hauteur).toBeGreaterThan(0);
  });

  test("ajoute des étapes compactes issues du dernier run, sans cellules d'outils", () => {
    const run = etatA(Date.parse("2026-09-18T10:00:00.000Z"), 5000).runs.find((entree) => entree.projet === "marketing")!;
    const execution: RunDetailleAvecOutils = { ...run, etapes: run.etapes.map((etape) => ({ ...etape, outils: [] })) };
    const { noeuds } = disposer(topo(), [{ projetId: "marketing", run: execution }]);
    const etapes = noeuds.filter((noeud) => noeud.type === "etape");
    expect(etapes.length).toBeGreaterThan(0);
    expect(etapes.length).toBeLessThanOrEqual(4);
    expect(etapes.every((etape) => etape.largeur < 200)).toBe(true);
    expect(etapes.map((etape) => etape.etape?.nom)).not.toContain("Read");
  });

  test("ignore un projet sans fiche même si ses runs existent", () => {
    const t = topo();
    t.projets.push({ ...t.projets[0]!, id: "run-orphelin", nom: "run-orphelin", aFiche: false });
    const { noeuds } = disposer(t);
    expect(noeuds.map((n) => n.id)).not.toContain(idProjet("run-orphelin"));
  });

  test("même topologie : mêmes positions", () => {
    expect(disposer(topo())).toEqual(disposer(topo()));
  });
});
