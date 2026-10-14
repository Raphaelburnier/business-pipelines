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

  test("les étapes empilées gardent un couloir libre pour les embranchements", () => {
    const etat = etatA(Date.parse("2026-09-18T10:00:00.000Z"), 30000);
    const run = etat.runs.find((r) => r.projet === "marketing")!;
    const execution: RunDetailleAvecOutils = { ...run, etapes: run.etapes.map((e) => ({ ...e, outils: [] })) };
    const { noeuds } = disposer(etat.topologie, [{ projetId: "marketing", run: execution }]);
    const projet = noeuds.find((n) => n.id === idProjet("marketing"))!;
    const etapes = noeuds.filter((n) => n.etape?.runId === run.id);
    expect(etapes).toHaveLength(4);
    for (const [i, etape] of etapes.entries()) {
      expect(etape.x).toBeGreaterThan(projet.x);
      expect(etape.y).toBeGreaterThan(projet.y + projet.hauteur);
      if (i > 0) expect(etape.y).toBeGreaterThan(etapes[i - 1]!.y + etapes[i - 1]!.hauteur);
    }
  });

  test("plusieurs projets et leurs étapes restent dans le canevas sans se chevaucher", () => {
    const etat = etatA(Date.parse("2026-09-18T10:00:00.000Z"), 30000);
    const run = etat.runs.find((r) => r.projet === "marketing")!;
    const execution: RunDetailleAvecOutils = { ...run, etapes: run.etapes.map((e) => ({ ...e, outils: [] })) };
    const topologie = { ...etat.topologie, projets: [...etat.topologie.projets, { ...etat.topologie.projets[0]!, id: "deuxieme", nom: "Deuxième projet" }] };
    const { noeuds, largeur, hauteur } = disposer(topologie, [{ projetId: "marketing", run: execution }]);
    for (const [i, a] of noeuds.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.largeur).toBeLessThanOrEqual(largeur);
      expect(a.y + a.hauteur).toBeLessThanOrEqual(hauteur);
      for (const b of noeuds.slice(i + 1)) {
        const chevauche = a.x < b.x + b.largeur && a.x + a.largeur > b.x && a.y < b.y + b.hauteur && a.y + a.hauteur > b.y;
        expect(chevauche, `${a.id} chevauche ${b.id}`).toBe(false);
      }
    }
  });

  test("sur téléphone les projets restent sur une colonne avec leurs étapes", () => {
    const etat = etatA(Date.parse("2026-09-18T10:00:00.000Z"), 30000);
    const run = etat.runs.find((r) => r.projet === "marketing")!;
    const execution: RunDetailleAvecOutils = { ...run, etapes: run.etapes.map((e) => ({ ...e, outils: [] })) };
    const compact = disposer(etat.topologie, [{ projetId: "marketing", run: execution }], true);
    const projets = compact.noeuds.filter((n) => n.type === "projet");
    expect(new Set(projets.map((n) => n.x)).size).toBe(1);
    expect(compact.largeur).toBeLessThan(disposer(etat.topologie).largeur);
    const etapes = compact.noeuds.filter((n) => n.type === "etape");
    const second = projets[1]!;
    expect(etapes.every((n) => n.y + n.hauteur < second.y)).toBe(true);
    expect(compact.noeuds.every((n) => n.x >= 0 && n.x + n.largeur <= compact.largeur)).toBe(true);
  });
});
