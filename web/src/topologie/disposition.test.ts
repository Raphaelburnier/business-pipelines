// L'arbre de topologie : rangs, plis, arêtes en pointillés. Critère transverse de l'annexe A :
// « l'arbre reste lisible avec 6 projets et se replie correctement ».
import { describe, expect, test } from "vitest";
import { etatA } from "../mock/scenario";
import type { Topologie } from "../types";
import { disposer, idCategorie, idMachine, idProjet } from "./disposition";

const topo = (): Topologie => etatA(Date.parse("2026-09-18T10:00:00.000Z"), 5000).topologie;
const aucunPli = new Set<string>();

describe("disposition de la topologie", () => {
  test("quatre rangs, du maître aux projets, de haut en bas", () => {
    const { noeuds } = disposer(topo(), aucunPli);
    const rang = (type: string) => noeuds.filter((n) => n.type === type).map((n) => n.y);
    const [maitre] = rang("maitre");
    expect(Math.min(...rang("machine"))).toBeGreaterThan(maitre!);
    expect(Math.min(...rang("categorie"))).toBeGreaterThan(Math.max(...rang("machine")));
    expect(Math.min(...rang("projet"))).toBeGreaterThan(Math.max(...rang("categorie")));
    expect(noeuds.filter((n) => n.type === "projet")).toHaveLength(6);
  });

  test("le projet multi-machine a une seule arête en pointillés, vers l'autre machine", () => {
    const { aretes } = disposer(topo(), aucunPli);
    const pointillees = aretes.filter((a) => a.pointillee);
    expect(pointillees).toEqual([
      expect.objectContaining({ source: idMachine("nas"), cible: idProjet("marketing-tcg") }),
    ]);
  });

  test("plier une machine masque ses projets et dit combien", () => {
    const { noeuds, aretes } = disposer(topo(), new Set([idMachine("pc")]));
    const pc = noeuds.find((n) => n.id === idMachine("pc"));
    expect(pc).toMatchObject({ plie: true, masques: 5 });
    expect(noeuds.filter((n) => n.type === "projet").map((n) => n.projet?.id)).toEqual(["backups"]);
    // Le projet multi-machine est masqué : son arête en pointillés disparaît avec lui.
    expect(aretes.filter((a) => a.pointillee)).toHaveLength(0);
  });

  test("plier une catégorie ne masque que ses projets", () => {
    const { noeuds } = disposer(topo(), new Set([idCategorie("pc", "saas")]));
    const saas = noeuds.find((n) => n.id === idCategorie("pc", "saas"));
    expect(saas).toMatchObject({ plie: true, masques: 2 });
    expect(noeuds.filter((n) => n.type === "projet")).toHaveLength(4);
  });

  test("une machine qu'aucun worker n'a annoncée apparaît quand même, hors ligne", () => {
    const t = topo();
    t.projets.push({ ...t.projets[0]!, id: "ailleurs", homeMachine: "portable", machines: ["portable"] });
    const { noeuds } = disposer(t, aucunPli);
    expect(noeuds.find((n) => n.id === idMachine("portable"))?.machine).toMatchObject({ etat: "offline", nom: "portable (jamais vue)" });
  });

  test("même topologie, mêmes plis : même dessin", () => {
    expect(disposer(topo(), aucunPli)).toEqual(disposer(topo(), aucunPli));
  });
});
