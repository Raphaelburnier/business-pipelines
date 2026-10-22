// Les objectifs planifiés de l'atelier (src/api-atelier.js). Le cockpit crée la commande
// run.start à l'heure dite ; le moteur ne la prend pas avant son scheduling.notBefore.
export type Priorite = "haute" | "normale" | "basse";
export type Repetition = "none" | "daily" | "weekdays" | "weekly";

export interface Occurrence {
  id: string;
  date: string;
  scheduledAt: string;
  commandId: string;
  runId: string | null;
  statut: string;
  raison: string | null;
  attente: { prochaineReprise?: string | null; raisonManuelle?: string | null } | null;
  livraison: { statut: string; terminee: boolean } | null;
}

export interface BrouillonPlanifie {
  projectId: string;
  graph: { name: string; title?: string; nodes: unknown[] } & Record<string, unknown>;
  assignments: Record<string, string>;
  baseRef: string | null;
}

export interface Objectif {
  id: string;
  revision: number;
  projectId: string;
  titre: string;
  priority: Priorite;
  source: "calendar" | "manual";
  date: string;
  heure: string;
  repetition: Repetition;
  active: boolean;
  nextAt: string | null;
  brouillon: BrouillonPlanifie;
  criteres: string[];
  occurrences: Occurrence[];
}

export interface Modele extends BrouillonPlanifie {
  id: string;
  version: number;
  origine: "registre" | "personnel";
}

export interface Catalogue {
  projets: Array<{ id: string; nom: string }>;
  modeles: Modele[];
  erreurs: string[];
}

export interface DemandePlanification {
  requestId: string;
  brouillon: BrouillonPlanifie;
  objectif: string;
  criteres: string[];
  priority: Priorite;
  calendrier: { date: string; heure: string; repetition: Repetition; active: boolean };
}

export interface Changement {
  revision: number;
  active?: boolean;
  priority?: Priorite;
  date?: string;
  heure?: string;
}

export interface SourceCalendrier {
  catalogue(): Promise<Catalogue>;
  objectifs(): Promise<Objectif[]>;
  planifier(demande: DemandePlanification): Promise<Objectif>;
  modifier(id: string, changement: Changement): Promise<Objectif>;
}

async function appeler<T>(chemin: string, corps?: unknown): Promise<T> {
  const reponse = await fetch(`/api/atelier/${chemin}`, corps === undefined
    ? { headers: { accept: "application/json" } }
    : { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(corps) });
  const lu: unknown = await reponse.json().catch(() => ({ erreur: "réponse illisible" }));
  if (!reponse.ok) {
    const message = lu && typeof lu === "object" && "erreur" in lu && typeof lu.erreur === "string" ? lu.erreur : `${reponse.status}`;
    throw new Error(message);
  }
  return lu as T;
}

export const sourceCalendrierApi: SourceCalendrier = {
  catalogue: () => appeler<Catalogue>("catalogue"),
  objectifs: async () => (await appeler<{ objectifs: Objectif[] }>("objectifs")).objectifs,
  planifier: (demande) => appeler<Objectif>("objectifs", demande),
  modifier: (id, changement) => appeler<Objectif>(`objectifs/${encodeURIComponent(id)}`, changement),
};

// La maquette garde ses objectifs en mémoire : de quoi parcourir la page sans cockpit.
export function sourceCalendrierMaquette(maintenant = Date.now()): SourceCalendrier {
  const graphe = (name: string, title: string) => ({ name, title, nodes: [{ id: "rediger" }] });
  const modeles: Modele[] = [
    { id: "registre:marketing:youtube-video@3", version: 3, origine: "registre", projectId: "marketing", graph: graphe("youtube-video", "Vidéo YouTube"), assignments: {}, baseRef: "youtube-video@3" },
    { id: "registre:finance:finance-research@2", version: 2, origine: "registre", projectId: "finance", graph: graphe("finance-research", "Recherche Finance"), assignments: {}, baseRef: "finance-research@2" },
  ];
  const jour = (delta: number) => new Date(maintenant + delta * 86_400_000).toISOString().slice(0, 10);
  const instant = (delta: number, heure: string) => `${jour(delta)}T${heure}:00.000Z`;
  let objectifs: Objectif[] = [
    { id: "00000000-0000-4000-8000-000000000001", revision: 3, projectId: "finance", titre: "Revue des marchés du matin", priority: "haute", source: "calendar", date: jour(1), heure: "07:30", repetition: "weekdays", active: true,
      nextAt: instant(1, "05:30"), brouillon: modeles[1]!, criteres: ["Note de synthèse produite"],
      occurrences: [{ id: "occ-1", date: jour(0), scheduledAt: instant(0, "05:30"), commandId: "cmd-1", runId: "run-maquette-1", statut: "succeeded", raison: null, attente: null, livraison: null },
        { id: "occ-0", date: jour(-1), scheduledAt: instant(-1, "05:30"), commandId: "cmd-0", runId: "run-maquette-0", statut: "waiting_quota", raison: null, attente: { prochaineReprise: instant(0, "09:00") }, livraison: null }] },
    { id: "00000000-0000-4000-8000-000000000002", revision: 1, projectId: "marketing", titre: "Script de la vidéo hebdomadaire", priority: "normale", source: "calendar", date: jour(2), heure: "14:00", repetition: "weekly", active: true,
      nextAt: instant(2, "12:00"), brouillon: modeles[0]!, criteres: ["Script relu"], occurrences: [] },
  ];
  return {
    catalogue: async () => ({ projets: [{ id: "finance", nom: "Finance" }, { id: "marketing", nom: "Marketing" }], modeles, erreurs: [] }),
    objectifs: async () => objectifs,
    async planifier(d) {
      const o: Objectif = { id: d.requestId, revision: 1, projectId: d.brouillon.projectId, titre: d.objectif, priority: d.priority, source: "calendar", date: d.calendrier.date, heure: d.calendrier.heure,
        repetition: d.calendrier.repetition, active: d.calendrier.active, nextAt: `${d.calendrier.date}T${d.calendrier.heure}:00.000Z`, brouillon: d.brouillon, criteres: d.criteres, occurrences: [] };
      objectifs = [o, ...objectifs];
      return o;
    },
    async modifier(id, c) {
      const o = objectifs.find((x) => x.id === id);
      if (!o || o.revision !== c.revision) throw new Error("Objectif modifié ailleurs : recharge le calendrier.");
      const date = c.date ?? o.date, heure = c.heure ?? o.heure;
      const maj: Objectif = { ...o, revision: o.revision + 1, active: c.active ?? o.active, priority: c.priority ?? o.priority, date, heure,
        nextAt: c.date || c.heure ? `${date}T${heure}:00.000Z` : o.nextAt };
      objectifs = objectifs.map((x) => (x.id === id ? maj : x));
      return maj;
    },
  };
}
