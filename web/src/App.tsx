// Les cellules s'inspectent sans quitter le graphe. Les URL de détail restent accessibles
// directement, pour les liens partagés et les favoris existants.
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { FournisseurSource, useCharge, useSource } from "./donnees/contexte";
import { mot } from "./format";
import { Icone, type NomIcone } from "./icones";
import { useTheme } from "./theme";
import type { EtatMachine, Machine } from "./types";
import { Topologie, type Selection } from "./topologie/Topologie";
import { Agents } from "./vues/Agents";
import { Decisions } from "./vues/Decisions";
import { Demander } from "./vues/Demander";
import { lienDemander } from "./navigation";
import { EnCours } from "./vues/EnCours";
import { Kpis } from "./vues/Kpis";
import { Panneau } from "./vues/Panneau";
import { Missions } from "./vues/Missions";
import { Branches } from "./vues/Branches";
import { Pipelines } from "./vues/Pipelines";
import { ControleFile } from "./vues/ControleExecution";
import type { AIStudioPage } from "./ai-studio/AIStudio";

const Systeme = lazy(() => import("./systeme/Systeme").then((module) => ({ default: module.Systeme })));
const Marketing = lazy(() => import("./vues/Marketing").then((module) => ({ default: module.Marketing })));
const AIStudio = lazy(() => import("./ai-studio/AIStudio").then((module) => ({ default: module.AIStudio })));
const TaskBoard = lazy(() => import("./TaskBoard").then((module) => ({ default: module.TaskBoard })));
const Finance = lazy(() => import("./finance/Finance").then((module) => ({ default: module.Finance })));

type Route =
  | { type: "graph" }
  | { type: "agents" }
  | { type: "pipelines"; pipelineId: string | null }
  | { type: "missions"; projetId: string | null; brouillonId: string | null }
  | { type: "branches" }
  | { type: "marketing"; projetId: string | null; filId: string | null }
  | { type: "demander"; filId: string | null }
  | { type: "decisions" }
  | { type: "systeme"; page: "carte" | "fonctionnement" }
  | { type: "finance" }
  | { type: "taskboard" }
  | { type: "approbations" }
  | { type: "ai-studio"; studio: AIStudioPage }
  | { type: "detail"; selection: Selection }
  | { type: "inconnue" };

function lireRoute(): Route {
  const morceaux = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!morceaux.length || morceaux[0] === "graph" || morceaux[0] === "app") return { type: "graph" };
  if (morceaux[0] === "agents" && morceaux.length === 1) return { type: "agents" };
  if (morceaux[0] === "pipelines" && morceaux.length <= 2) return { type: "pipelines", pipelineId: morceaux[1] ? decodeURIComponent(morceaux[1]) : null };
  if (morceaux[0] === "finance" && morceaux.length === 1) return { type: "finance" };
  if (morceaux[0] === "missions" && morceaux[1] === "branches" && morceaux.length === 2) return { type: "branches" };
  if (morceaux[0] === "missions" && morceaux.length <= 2) return { type: "missions", projetId: morceaux[1] ? decodeURIComponent(morceaux[1]) : null, brouillonId: new URLSearchParams(window.location.search).get("brouillon") };
  if (morceaux[0] === "marketing" && morceaux.length <= 3) return { type: "marketing", projetId: morceaux[1] ? decodeURIComponent(morceaux[1]) : null, filId: morceaux[2] ? decodeURIComponent(morceaux[2]) : null };
  if (morceaux[0] === "decisions" && morceaux[1] === "pipelines" && morceaux.length === 2) return { type: "approbations" };
  if (morceaux[0] === "decisions" && morceaux.length === 1) return { type: "decisions" };
  if (morceaux[0] === "systeme" && morceaux.length === 1) return { type: "systeme", page: "carte" };
  if (morceaux[0] === "systeme" && morceaux[1] === "fonctionnement" && morceaux.length === 2) return { type: "systeme", page: "fonctionnement" };
  if (["taskboard", "a-venir", "calendrier"].includes(morceaux[0] ?? "") && morceaux.length === 1) return { type: "taskboard" };
  if (morceaux[0] === "demander" && morceaux.length <= 2) return { type: "demander", filId: morceaux[1] ? decodeURIComponent(morceaux[1]) : null };
  if (morceaux[0] === "ai-studio") {
    if (morceaux.length === 1) return { type: "ai-studio", studio: { page: "home" } };
    if (morceaux[1] === "profiles" && morceaux[2]) {
      const tab = morceaux[3] || "gallery";
      if (["gallery", "generate", "references", "settings"].includes(tab)) {
        return { type: "ai-studio", studio: { page: "profile", id: decodeURIComponent(morceaux[2]), tab: tab as "gallery" | "generate" | "references" | "settings" } };
      }
    }
    if (morceaux[1] === "generations" && morceaux[2] && morceaux.length === 3) {
      return { type: "ai-studio", studio: { page: "generation", id: decodeURIComponent(morceaux[2]) } };
    }
    return { type: "inconnue" };
  }
  const correspondances: Record<string, Selection["type"]> = { projects: "projet", runs: "run", machines: "machine" };
  const type = correspondances[morceaux[0] ?? ""];
  if (type && morceaux[1]) return { type: "detail", selection: { type, id: decodeURIComponent(morceaux[1]) } as Selection };
  return { type: "inconnue" };
}

function useNavigation() {
  const [route, setRoute] = useState(lireRoute);
  useEffect(() => {
    const suivre = () => setRoute(lireRoute());
    window.addEventListener("popstate", suivre);
    return () => window.removeEventListener("popstate", suivre);
  }, []);
  const aller = useCallback((destination: string) => {
    if (window.location.pathname !== destination) window.history.pushState(null, "", destination);
    setRoute(lireRoute());
  }, []);
  return { route, aller };
}

function Lien({ href, actif, aller, icone, compte, alerte = false, children }: { href: string; actif: boolean; aller: (href: string) => void; icone: NomIcone; compte?: number; alerte?: boolean; children: string }) {
  const ouvrir = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    aller(href);
  };
  return (
    <a href={href} onClick={ouvrir} aria-current={actif ? "page" : undefined} title={children}>
      <Icone nom={icone} />
      <span className="ao-txt">{children}</span>
      {compte !== undefined && compte > 0 && <span className={`ao-compte ao-txt ${alerte ? "alerte" : ""}`}>{compte}</span>}
    </a>
  );
}

const CLASSE_MACHINE: Record<EtatMachine, string> = { online: "ok", busy: "run", waking: "run", sleeping: "veille", offline: "hs", error: "hs" };

/** L'état des machines dans la barre du haut : un point (rond PC, carré NAS) et son mot. */
function Machines({ machines }: { machines: Machine[] }) {
  return (
    <>
      {machines.map((m) => (
        <span key={m.machine} className={`ao-machine ${/nas/i.test(m.machine) ? "nas" : ""} ${CLASSE_MACHINE[m.etat]}`} title={`${m.nom ?? m.machine} : ${mot(m.etat)}`}>
          <i aria-hidden="true" />
          {m.machine}
          <span>{mot(m.etat)}</span>
        </span>
      ))}
    </>
  );
}

// Cyberpunk n'a que A–Z a–z : les titres de vue s'écrivent sans accents ni chiffres.
function titreDe(route: Route): string {
  if (route.type === "graph") return "Accueil";
  if (route.type === "agents") return "Agents";
  if (route.type === "missions") return "Missions";
  if (route.type === "branches") return "Branches";
  if (route.type === "pipelines") return "Pipelines";
  if (route.type === "marketing") return "Équipe marketing";
  if (route.type === "demander") return "Demander";
  if (route.type === "decisions" || route.type === "approbations") return "Decisions";
  if (route.type === "ai-studio") return "AI Studio";
  if (route.type === "systeme") return "Systeme";
  if (route.type === "finance") return "Finance";
  if (route.type === "taskboard") return "TaskBoard";
  if (route.type === "detail") return { projet: "Projet", run: "Run", machine: "Machine", orchestrateur: "Orchestrateur" }[route.selection.type];
  return "Introuvable";
}

function Coquille() {
  const { route, aller } = useNavigation();
  const { source, connecte } = useSource();
  const { theme, basculer } = useTheme();
  const [ouvert, setOuvert] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const declencheur = useRef<HTMLElement | null>(null);
  const { donnees: topo } = useCharge((s) => s.topologie(), []);
  const { donnees: usage } = useCharge((s) => s.usage(), []);
  const { donnees: livraison } = useCharge((s) => s.livraison(), []);
  // Ce qui attend Raphaël : les approbations des pipelines, et une livraison possible.
  const { donnees: boite } = useCharge((s) => s.approbations(), []);
  // Ce qui attend Raphaël : les approbations des runs, les plans métier de la boîte, et une
  // livraison possible.
  const decisions =
    (topo?.projets.reduce((n, p) => n + p.approbationsEnAttente, 0) ?? 0) +
    (boite?.etat.decidables ?? 0) +
    (livraison?.proposition?.disponible && !livraison.enCours ? 1 : 0);

  // Sur téléphone, le tiroir se referme dès qu'on a choisi une destination.
  const naviguer = useCallback(
    (href: string) => {
      setSelection(null);
      if (window.matchMedia("(max-width: 720px)").matches) setOuvert(false);
      aller(href);
    },
    [aller]
  );
  const ouvrir = useCallback((choix: Selection) => {
    // Les clics à l'intérieur du panneau gardent le déclencheur du graphe pour le retour.
    const actif = document.activeElement;
    if (actif instanceof HTMLElement && !actif.closest(".ao-inspection")) declencheur.current = actif;
    setSelection(choix);
  }, []);
  const fermer = useCallback(() => {
    setSelection(null);
    if (declencheur.current?.isConnected) declencheur.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const suivre = () => setSelection(null);
    window.addEventListener("popstate", suivre);
    return () => window.removeEventListener("popstate", suivre);
  }, []);
  useEffect(() => {
    if (!selection) return;
    const echapper = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        fermer();
      }
    };
    window.addEventListener("keydown", echapper);
    return () => window.removeEventListener("keydown", echapper);
  }, [selection, fermer]);

  return (
    <div className={`ao-shell ${ouvert ? "ouvert" : ""} ${selection ? "avec-inspection" : ""} ${route.type === "pipelines" || route.type === "ai-studio" || route.type === "systeme" || route.type === "taskboard" || route.type === "decisions" || route.type === "approbations" ? "sans-encours" : ""}`}>
      <aside className="ao-rail" id="menu-principal">
        <div className="ao-marque">
          <button
            type="button"
            className="ao-bouton-icone"
            onClick={() => setOuvert((o) => !o)}
            aria-expanded={ouvert}
            aria-controls="menu-principal"
            aria-label={ouvert ? "Replier le menu" : "Ouvrir le menu"}
            title={ouvert ? "Replier le menu" : "Ouvrir le menu"}
          >
            <Icone nom={ouvert ? "fermer" : "menu"} />
          </button>
          <b>AgenticOS</b>
        </div>
        <nav className="ao-nav" aria-label="Navigation principale">
          <Lien href="/" actif={route.type === "graph"} aller={naviguer} icone="graphe">
            Accueil
          </Lien>
          <Lien href="/agents" actif={route.type === "agents"} aller={naviguer} icone="agent" compte={usage?.runsActifs}>
            Agents
          </Lien>
          <Lien href="/missions" actif={route.type === "missions"} aller={naviguer} icone="mission">Missions</Lien>
          <Lien href="/missions/branches" actif={route.type === "branches"} aller={naviguer} icone="branche">Branches</Lien>
          <Lien href="/pipelines" actif={route.type === "pipelines"} aller={naviguer} icone="pipeline">Pipelines</Lien>
          <Lien href="/taskboard" actif={route.type === "taskboard"} aller={naviguer} icone="calendrier">TaskBoard</Lien>
          <Lien href="/finance" actif={route.type === "finance"} aller={naviguer} icone="finance">Finance</Lien>
          <Lien href="/marketing" actif={route.type === "marketing"} aller={naviguer} icone="marketing">Marketing</Lien>
          <Lien href={lienDemander()} actif={route.type === "demander"} aller={naviguer} icone="demander">
            Demander
          </Lien>
          <Lien href="/ai-studio" actif={route.type === "ai-studio"} aller={naviguer} icone="studio">
            AI Studio
          </Lien>
          <Lien href="/systeme" actif={route.type === "systeme"} aller={naviguer} icone="systeme">
            Système
          </Lien>
          <Lien href="/decisions" actif={route.type === "decisions" || route.type === "approbations"} aller={naviguer} icone="decision" compte={decisions} alerte>
            Décisions
          </Lien>
        </nav>
        <span className="ao-danger" aria-hidden="true" />
        <div className="ao-pied">
          <div className="ao-nav">
            <button
              type="button"
              className="ao-theme"
              aria-pressed={theme === "jour"}
              onClick={basculer}
              title={theme === "jour" ? "Passer en Night City" : "Passer en Night City · Jour"}
            >
              <Icone nom={theme === "jour" ? "lune" : "soleil"} />
              <span className="ao-txt">{theme === "jour" ? "Nuit" : "Jour"}</span>
            </button>
          </div>
          <span className="ao-legende ao-txt">NAS · tailnet</span>
        </div>
      </aside>

      <div className="ao-centre">
        <header className="ao-haut">
          <button type="button" className="ao-bouton-icone ao-burger" onClick={() => setOuvert(true)} aria-controls="menu-principal" aria-expanded={ouvert} aria-label="Ouvrir le menu">
            <Icone nom="menu" />
          </button>
          <h1>{titreDe(route)}</h1>
          <span className="ao-code" aria-hidden="true">
            SYS//AOS
          </span>
          <div className="ao-sys">
            {source.nom === "maquette" && <span className="bg-alerte-fond px-2 py-0.5 font-mono text-[11px] uppercase text-alerte">maquette</span>}
            <Machines machines={topo?.machines ?? []} />
            <span className={`ao-machine ${connecte ? "ok" : "hs"}`} title={connecte ? "Flux d'événements connecté" : "Flux d'événements interrompu"}>
              <i className={connecte ? "pulse-douce" : ""} aria-hidden="true" />
              <span>{connecte ? "en direct" : "flux coupé"}</span>
            </span>
          </div>
        </header>
        <ControleFile />

        <main className={`ao-contenu${route.type === "finance" ? " ao-contenu-finance" : ""}`}>
          {route.type === "graph" && <Topologie selection={selection} onSelection={(choix) => choix ? ouvrir(choix) : fermer()} />}
          {(route.type === "agents" || route.type === "detail") && (
            <div className="mb-4">
              <Kpis />
            </div>
          )}
          {route.type === "agents" && <Agents onSelection={ouvrir} />}
          {route.type === "pipelines" && <Pipelines pipelineId={route.pipelineId} aller={naviguer} />}
          {route.type === "missions" && <Missions key={`${route.projetId}:${route.brouillonId}`} projetInitial={route.projetId} brouillonId={route.brouillonId} aller={naviguer} />}
          {route.type === "branches" && <Branches aller={naviguer} />}
          {route.type === "finance" && <Suspense fallback={<section className="page-vide"><p>Chargement de Finance…</p></section>}><Finance /></Suspense>}
          {route.type === "marketing" && <Suspense fallback={<p>Chargement de l'équipe marketing…</p>}><Marketing key={`${route.projetId}:${route.filId}`} projetInitial={route.projetId} filId={route.filId} aller={naviguer} /></Suspense>}
          {route.type === "demander" && <Demander filId={route.filId} aller={naviguer} />}
          {(route.type === "decisions" || route.type === "approbations") && <Decisions />}
          {route.type === "systeme" && <Suspense fallback={<section className="page-vide"><p>Chargement du système…</p></section>}><Systeme page={route.page} aller={naviguer} /></Suspense>}
          {route.type === "taskboard" && <Suspense fallback={<section className="page-vide"><p>Chargement du TaskBoard…</p></section>}><TaskBoard /></Suspense>}
          {route.type === "ai-studio" && <Suspense fallback={<section className="page-vide"><p>Chargement de l’AI Studio…</p></section>}><AIStudio route={route.studio} aller={naviguer} /></Suspense>}
          {route.type === "detail" && (
            <Panneau modePage key={`${route.selection.type}:${route.selection.id}`} selection={route.selection} onSelection={ouvrir} onFermer={() => naviguer("/")} />
          )}
          {route.type === "inconnue" && (
            <section className="page-vide">
              <div className="font-mono text-[11px] uppercase tracking-widest text-douce">404</div>
              <h2>Introuvable</h2>
              <p className="text-douce">Cette page n’existe pas.</p>
              <button type="button" className="mt-2 bg-accent px-4 py-2 text-sm font-semibold text-sur-accent" onClick={() => naviguer("/")}>
                Revenir au graphe
              </button>
            </section>
          )}
        </main>
      </div>

      {selection ? (
        <aside className="ao-inspection" aria-label="Détails de la cellule">
          <Panneau key={`${selection.type}:${selection.id}:${selection.type === "run" ? selection.etapeId ?? "" : ""}`} selection={selection} onSelection={ouvrir} onFermer={fermer} />
        </aside>
      ) : route.type !== "pipelines" && route.type !== "ai-studio" && route.type !== "systeme" && route.type !== "taskboard" && route.type !== "decisions" && route.type !== "approbations" && <EnCours onSelection={ouvrir} />}
    </div>
  );
}

export default function App() {
  return <FournisseurSource><Coquille /></FournisseurSource>;
}
