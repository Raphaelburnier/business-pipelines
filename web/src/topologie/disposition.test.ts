// Le graphe d'accueil ne montre que les projets connus et garde un placement stable.
import { describe, expect, test } from "vitest";
import { etatA } from "../mock/scenario";
import type { Topologie } from "../types";
import { disposer, idProjet } from "./disposition";

const topo = (): Topologie => etatA(Date.parse("2026-09-18T10:00:00.000Z"), 5000).topologie;

describe("disposition du graphe des projets", () => {
  test("ne place que les projets enregistrés, sans nœuds d'infrastructure", () => {
    const { noeuds, largeur, hauteur } = disposer(topo());
    expect(noeuds.map((n) => n.projet.id)).toEqual(["marketing", "steam-tierlist"]);
    expect(noeuds.every((n) => n.type === "projet")).toBe(true);
    expect(largeur).toBeGreaterThan(0);
    expect(hauteur).toBeGreaterThan(0);
  });

  test("ignore un run orphelin sans fiche projet", () => {
    const t = topo();
    t.projets.push({ ...t.projets[0]!, id: "run-orphelin", nom: "run-orphelin", aFiche: false });
    const { noeuds } = disposer(t);
    expect(noeuds.map((n) => n.id)).not.toContain(idProjet("run-orphelin"));
  });

  test("même topologie : mêmes positions", () => {
    expect(disposer(topo())).toEqual(disposer(topo()));
  });
});
