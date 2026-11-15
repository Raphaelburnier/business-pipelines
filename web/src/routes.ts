// Les adresses du cockpit, lues depuis `window.location`. Les anciennes adresses (/graph,
// /app, /a-venir, /calendrier, /decisions/pipelines) restent valides : des liens partagés et
// des favoris y mènent encore. /graph, l'ancien accueil, mène au graphe devenu Système ›
// Topologie ; l'application l'y redirige (`adresseCanonique`).
import type { AIStudioPage } from "./ai-studio/AIStudio";
import type { Selection } from "./topologie/Topologie";

export type PageSysteme = "carte" | "topologie" | "fonctionnement";

export type Route =
  | { type: "accueil" }
  | { type: "agents" }
  | { type: "pipelines"; pipelineId: string | null }
  | { type: "run"; runId: string | null }
  | { type: "missions"; projetId: string | null; brouillonId: string | null }
  | { type: "branches" }
  | { type: "marketing"; projetId: string | null; filId: string | null }
  | { type: "demander"; filId: string | null }
  | { type: "decisions"; element: string | null }
  | { type: "systeme"; page: PageSysteme }
  | { type: "finance" }
  | { type: "taskboard" }
  | { type: "approbations" }
  | { type: "ai-studio"; studio: AIStudioPage }
  | { type: "detail"; selection: Selection }
  | { type: "inconnue" };

function segment(valeur: string): string {
  try {
    return decodeURIComponent(valeur);
  } catch {
    return valeur;
  }
}

export function lireRoute(): Route {
  const morceaux = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!morceaux.length || (morceaux[0] === "app" && morceaux.length === 1)) return { type: "accueil" };
  if (morceaux[0] === "graph" && morceaux.length === 1) return { type: "systeme", page: "topologie" };
  if (morceaux[0] === "agents" && morceaux.length === 1) return { type: "agents" };
  if (morceaux[0] === "pipelines" && morceaux.length <= 2) return { type: "pipelines", pipelineId: morceaux[1] ? segment(morceaux[1]) : null };
  if (morceaux[0] === "run" && morceaux.length <= 2) return { type: "run", runId: morceaux[1] ? segment(morceaux[1]) : null };
  if (morceaux[0] === "finance" && morceaux.length === 1) return { type: "finance" };
  if (morceaux[0] === "missions" && morceaux[1] === "branches" && morceaux.length === 2) return { type: "branches" };
  if (morceaux[0] === "missions" && morceaux.length <= 2) return { type: "missions", projetId: morceaux[1] ? segment(morceaux[1]) : null, brouillonId: new URLSearchParams(window.location.search).get("brouillon") };
  if (morceaux[0] === "marketing" && morceaux.length <= 3) return { type: "marketing", projetId: morceaux[1] ? segment(morceaux[1]) : null, filId: morceaux[2] ? segment(morceaux[2]) : null };
  if (morceaux[0] === "decisions" && morceaux[1] === "pipelines" && morceaux.length === 2) return { type: "approbations" };
  if (morceaux[0] === "decisions" && morceaux.length === 1) return { type: "decisions", element: new URLSearchParams(window.location.search).get("d") };
  if (morceaux[0] === "systeme" && morceaux.length === 1) return { type: "systeme", page: "carte" };
  if (morceaux[0] === "systeme" && (morceaux[1] === "fonctionnement" || morceaux[1] === "topologie") && morceaux.length === 2) return { type: "systeme", page: morceaux[1] };
  if (["taskboard", "a-venir", "calendrier"].includes(morceaux[0] ?? "") && morceaux.length === 1) return { type: "taskboard" };
  if (morceaux[0] === "demander" && morceaux.length <= 2) return { type: "demander", filId: morceaux[1] ? segment(morceaux[1]) : null };
  if (morceaux[0] === "ai-studio") {
    if (morceaux.length === 1) return { type: "ai-studio", studio: { page: "home" } };
    if (morceaux[1] === "profiles" && morceaux[2]) {
      const tab = morceaux[3] || "gallery";
      if (["gallery", "generate", "references", "settings"].includes(tab)) {
        return { type: "ai-studio", studio: { page: "profile", id: segment(morceaux[2]), tab: tab as "gallery" | "generate" | "references" | "settings" } };
      }
    }
    if (morceaux[1] === "generations" && morceaux[2] && morceaux.length === 3) {
      return { type: "ai-studio", studio: { page: "generation", id: segment(morceaux[2]) } };
    }
    return { type: "inconnue" };
  }
  const correspondances: Record<string, Selection["type"]> = { projects: "projet", runs: "run", machines: "machine" };
  const type = correspondances[morceaux[0] ?? ""];
  if (type && morceaux[1]) return { type: "detail", selection: { type, id: segment(morceaux[1]) } as Selection };
  return { type: "inconnue" };
}

/** L'adresse à afficher pour une ancienne : /graph devient /systeme/topologie. Null si elle est déjà la bonne. */
export function adresseCanonique(chemin: string): string | null {
  return /^\/graph\/?$/.test(chemin) ? "/systeme/topologie" : null;
}

/** Les entrées du menu ; une route en allume au plus une. */
export type CleNav = "accueil" | "decisions" | "runs" | "planning" | "missions" | "pipelines" | "agents" | "finance" | "marketing" | "ai-studio" | "demander" | "systeme";

export function cleActive(route: Route): CleNav | null {
  switch (route.type) {
    case "accueil":
      return "accueil";
    case "detail":
      return "systeme";
    case "decisions":
    case "approbations":
      return "decisions";
    case "run":
      return "runs";
    case "taskboard":
      return "planning";
    case "missions":
    case "branches":
      return "missions";
    case "pipelines":
      return "pipelines";
    case "agents":
      return "agents";
    case "finance":
      return "finance";
    case "marketing":
      return "marketing";
    case "ai-studio":
      return "ai-studio";
    case "demander":
      return "demander";
    case "systeme":
      return "systeme";
    case "inconnue":
      return null;
  }
}

/** Un niveau du fil d'Ariane : un groupe du menu (sans lien), une page, ou l'objet affiché. */
export interface Miette {
  libelle: string;
  href?: string;
  /** Un identifiant (run, pipeline) : affiché en mono. */
  code?: boolean;
}

const NOM_DETAIL: Record<Selection["type"], string> = { projet: "Projet", run: "Run", machine: "Machine", orchestrateur: "Orchestrateur" };

/** Le chemin jusqu'à la page affichée ; le dernier niveau est son titre. */
export function miettes(route: Route): Miette[] {
  switch (route.type) {
    case "accueil":
      return [{ libelle: "Vue d'ensemble" }];
    case "detail":
      return [{ libelle: "Système", href: "/systeme" }, { libelle: "Topologie", href: "/systeme/topologie" }, { libelle: `${NOM_DETAIL[route.selection.type]} ${route.selection.id}` }];
    case "decisions":
    case "approbations":
      return [{ libelle: "Décisions" }];
    case "run":
      return route.runId ? [{ libelle: "Pilotage" }, { libelle: "Runs", href: "/run" }, { libelle: route.runId, code: true }] : [{ libelle: "Pilotage" }, { libelle: "Runs" }];
    case "taskboard":
      return [{ libelle: "Pilotage" }, { libelle: "Planning" }];
    case "missions":
      return route.projetId ? [{ libelle: "Pilotage" }, { libelle: "Missions", href: "/missions" }, { libelle: route.projetId, code: true }] : [{ libelle: "Pilotage" }, { libelle: "Missions" }];
    case "branches":
      return [{ libelle: "Pilotage" }, { libelle: "Missions", href: "/missions" }, { libelle: "Branches" }];
    case "pipelines":
      return route.pipelineId
        ? [{ libelle: "Configuration" }, { libelle: "Pipelines", href: "/pipelines" }, { libelle: route.pipelineId, code: true }]
        : [{ libelle: "Configuration" }, { libelle: "Pipelines" }];
    case "agents":
      return [{ libelle: "Configuration" }, { libelle: "Agents" }];
    case "finance":
      return [{ libelle: "Métiers" }, { libelle: "Finance" }];
    case "marketing":
      if (!route.projetId) return [{ libelle: "Métiers" }, { libelle: "Marketing" }];
      if (!route.filId) return [{ libelle: "Métiers" }, { libelle: "Marketing", href: "/marketing" }, { libelle: route.projetId, code: true }];
      return [{ libelle: "Métiers" }, { libelle: "Marketing", href: "/marketing" }, { libelle: route.projetId, href: `/marketing/${encodeURIComponent(route.projetId)}`, code: true }, { libelle: "Discussion" }];
    case "ai-studio":
      if (route.studio.page === "home") return [{ libelle: "Métiers" }, { libelle: "AI Studio" }];
      return [{ libelle: "Métiers" }, { libelle: "AI Studio", href: "/ai-studio" }, { libelle: route.studio.page === "profile" ? "Profil" : "Génération" }];
    case "demander":
      return route.filId ? [{ libelle: "Demander", href: "/demander" }, { libelle: "Conversation" }] : [{ libelle: "Demander" }];
    case "systeme":
      if (route.page === "topologie") return [{ libelle: "Système", href: "/systeme" }, { libelle: "Topologie" }];
      return route.page === "fonctionnement" ? [{ libelle: "Système", href: "/systeme" }, { libelle: "Fonctionnement" }] : [{ libelle: "Système" }];
    case "inconnue":
      return [{ libelle: "Introuvable" }];
  }
}

/** Le niveau parent le plus proche qui a une page : la flèche « retour » du téléphone y mène. */
export function parent(chemin: ReadonlyArray<Miette>): Miette | null {
  for (let i = chemin.length - 2; i >= 0; i -= 1) {
    const miette = chemin[i];
    if (miette?.href) return miette;
  }
  return null;
}
