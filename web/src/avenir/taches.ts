// Toutes les tâches de la page À venir dans une seule liste : fonctionnalités système de la
// feuille de route, défauts à corriger et tâches des projets (objectifs de l'atelier).
import type { Objectif } from "../calendrier/api";
import type { AttributionAvenir } from "../donnees/source";
import type { Defaut, Lot, Severite, Statut } from "./feuille";

export type TypeTache = "fonctionnalite" | "fix" | "projet";
export const SYSTEME = "systeme";

export interface Tache {
  cle: string;
  type: TypeTache;
  /** `systeme` pour la feuille de route et les défauts, sinon l'identifiant du projet. */
  projet: string;
  ref: string;
  titre: string;
  detail: string;
  statut: Statut;
  lot?: string;
  severite?: Severite;
  objectif?: Objectif;
}

const VIVANTS = new Set(["queued", "running", "paused", "waiting_quota", "waiting_machine", "waiting_auth", "waiting_approval", "waiting_freshness"]);
const REUSSIS = new Set(["succeeded", "completed"]);

/** Un objectif de l'atelier est fait quand son dernier départ a réussi et qu'aucun autre n'est prévu. */
export function statutObjectif(o: Objectif): Statut {
  const dernier = o.occurrences[0];
  if (dernier && VIVANTS.has(dernier.statut)) return "en-cours";
  if (dernier && REUSSIS.has(dernier.statut) && !o.nextAt) return "fait";
  return "a-faire";
}

export function construireTaches(lots: Lot[], defauts: Defaut[], objectifs: Objectif[], attributions: AttributionAvenir[] = []): Tache[] {
  // Le suivi natif vaut pour tous les agents : une exécution commencée ou réussie reste
  // en cours jusqu'à la clôture vérifiée dans la feuille (fusion et recette si requises).
  // Une simple programmation future et un ancien run ne rouvrent pas un lot fait.
  const maintenant = Date.now();
  const estSuivi = (statut: string) => VIVANTS.has(statut) || statut === "review" || REUSSIS.has(statut);
  const estProgramme = (statut: string, runId: string | null, prevuLe?: string | null) =>
    statut === "queued" && !runId && Boolean(prevuLe && Date.parse(prevuLe) > maintenant);
  const suivis = new Set([
    ...attributions.filter(a => !estProgramme(a.statut, a.runId, a.prevuLe) && estSuivi(a.statut)).map(a => a.objectif.id),
    ...objectifs.filter(o => {
      const dernier = o.occurrences[0];
      return o.taskBoard && dernier && !estProgramme(dernier.statut, dernier.runId, dernier.scheduledAt) && estSuivi(dernier.statut);
    }).map(o => o.taskBoard!.id),
  ]);
  const etapes = lots.flatMap(l => l.etapes).map(e => ({ ...e,
    statut: e.statut !== "fait" && suivis.has(e.id) ? "en-cours" as const : e.statut }));
  const statuts = new Map(etapes.map(e => [e.id, e.statut]));
  const statutDefaut = (d: Defaut): Statut => {
    // Le lien exact « Lot N.N » existe déjà dans la feuille. Les correctifs multiples ou
    // décrits en prose gardent leur statut explicite : une référence partielle ne clôt rien.
    const lot = /^Lot (\d+\.\d+)$/.exec(d.correctif)?.[1];
    const statut = (lot ? statuts.get(lot) : undefined) ?? d.statut;
    return statut !== "fait" && suivis.has(d.id) ? "en-cours" : statut;
  };
  return [
    ...objectifs.filter(o => !o.taskBoard).map((o): Tache => ({ cle: `projet:${o.id}`, type: "projet", projet: o.projectId, ref: o.brouillon.graph.title || o.brouillon.graph.name,
      titre: o.titre, detail: o.criteres.join(" · "), statut: statutObjectif(o), objectif: o })),
    ...defauts.map((d): Tache => ({ cle: `fix:${d.id}`, type: "fix", projet: SYSTEME, ref: d.id, titre: d.titre, detail: `Correctif : ${d.correctif}`, statut: statutDefaut(d), severite: d.severite })),
    ...lots.flatMap((l) => l.etapes.map((e): Tache => ({ cle: `etape:${e.id}`, type: "fonctionnalite", projet: SYSTEME, ref: e.id, titre: e.titre, detail: e.detail, statut: statuts.get(e.id)!, lot: l.id }))),
  ];
}

export interface Filtre {
  projet: string;
  type: TypeTache | "tous";
  statut: "ouvertes" | "toutes" | "faites";
  recherche: string;
}

export const FILTRE_DEFAUT: Filtre = { projet: "tous", type: "tous", statut: "ouvertes", recherche: "" };

const sansAccents = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function filtrer(taches: Tache[], f: Filtre): Tache[] {
  const mots = sansAccents(f.recherche).split(/\s+/).filter(Boolean);
  return taches.filter((t) =>
    (f.projet === "tous" || t.projet === f.projet) &&
    (f.type === "tous" || t.type === f.type) &&
    (f.statut === "toutes" || (f.statut === "faites" ? t.statut === "fait" : t.statut !== "fait")) &&
    mots.every((m) => sansAccents(`${t.ref} ${t.titre} ${t.detail} ${t.projet}`).includes(m)));
}

/** Les projets proposés au filtre : le système d'abord, puis ceux qui ont des tâches ou une fiche. */
export function projetsDisponibles(taches: Tache[], connus: Array<{ id: string; nom: string }>): Array<{ id: string; nom: string }> {
  const noms = new Map(connus.map((p) => [p.id, p.nom]));
  const ids = [...new Set([...taches.map((t) => t.projet), ...connus.map((p) => p.id)])].filter((id) => id !== SYSTEME).sort();
  return [{ id: SYSTEME, nom: "Système" }, ...ids.map((id) => ({ id, nom: noms.get(id) ?? id }))];
}

export function compter(taches: Tache[], type: TypeTache): number {
  return taches.filter((t) => t.type === type && t.statut !== "fait").length;
}

const ORDRE_SEVERITE: Record<Severite, number> = { critique: 0, haute: 1, moyenne: 2, basse: 3 };
export const parSeverite = (a: Tache, b: Tache) => ORDRE_SEVERITE[a.severite ?? "basse"] - ORDRE_SEVERITE[b.severite ?? "basse"] || a.ref.localeCompare(b.ref, "fr", { numeric: true });
