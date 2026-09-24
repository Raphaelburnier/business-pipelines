// Le cockpit principal. Les vues ont de vraies URL : un nœud du graphe ouvre une page
// partageable, et le bouton Retour du navigateur ramène exactement où l'opérateur était.
import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { FournisseurSource } from "./donnees/contexte";
import { Topologie, type Selection } from "./topologie/Topologie";
import { Agents } from "./vues/Agents";
import { Barre } from "./vues/Barre";
import { Panneau } from "./vues/Panneau";

type Route =
  | { type: "graph" }
  | { type: "agents" }
  | { type: "detail"; selection: Selection }
  | { type: "inconnue" };

function lireRoute(): Route {
  const morceaux = window.location.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (!morceaux.length || morceaux[0] === "graph" || morceaux[0] === "app") return { type: "graph" };
  if (morceaux[0] === "agents" && morceaux.length === 1) return { type: "agents" };
  const correspondances: Record<string, Selection["type"]> = { projects: "projet", runs: "run", machines: "machine" };
  const type = correspondances[morceaux[0] ?? ""];
  if (type && morceaux[1]) return { type: "detail", selection: { type, id: decodeURIComponent(morceaux[1]) } as Selection };
  return { type: "inconnue" };
}

function chemin(selection: Selection): string {
  const dossiers = { projet: "projects", run: "runs", machine: "machines" } as const;
  return `/${dossiers[selection.type]}/${encodeURIComponent(selection.id)}`;
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

function Lien({ href, actif, aller, children }: { href: string; actif: boolean; aller: (href: string) => void; children: ReactNode }) {
  const ouvrir = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    aller(href);
  };
  return (
    <a href={href} onClick={ouvrir} aria-current={actif ? "page" : undefined} className="nav-lien">
      <span className="nav-point" aria-hidden="true" />
      {children}
    </a>
  );
}

function Coquille() {
  const { route, aller } = useNavigation();
  const ouvrir = useCallback((selection: Selection) => aller(chemin(selection)), [aller]);
  const titre = route.type === "graph" ? "Carte des opérations" : route.type === "agents" ? "Agents et étapes" : route.type === "detail" ? "Détail opérationnel" : "Page inconnue";

  return (
    <div className="cockpit-shell">
      <aside className="cockpit-nav">
        <a href="/" onClick={(e) => { e.preventDefault(); aller("/"); }} className="marque-cockpit" aria-label="Cockpit, accueil">
          <span className="marque-signal" aria-hidden="true" />
          <span><b>ORCH</b><small>control</small></span>
        </a>
        <nav className="nav-bus" aria-label="Navigation principale">
          <Lien href="/" actif={route.type === "graph"} aller={aller}>Graphe</Lien>
          <Lien href="/agents" actif={route.type === "agents"} aller={aller}>Agents</Lien>
          <a href="/decisions" className="nav-lien"><span className="nav-point" aria-hidden="true" />Décisions</a>
        </nav>
        <div className="nav-legende">NAS · tailnet</div>
      </aside>

      <div className="cockpit-corps">
        <header className="cockpit-entete">
          <div>
            <div className="sur-titre">Agent orchestrateur</div>
            <h1>{titre}</h1>
          </div>
          <div className="cockpit-mesures"><Barre /></div>
        </header>

        <main className="cockpit-contenu">
          {route.type === "graph" && <Topologie selection={null} onSelection={(selection) => selection && ouvrir(selection)} />}
          {route.type === "agents" && <Agents onSelection={ouvrir} />}
          {route.type === "detail" && (
            <Panneau modePage key={`${route.selection.type}:${route.selection.id}`} selection={route.selection} onSelection={ouvrir} onFermer={() => aller("/")} />
          )}
          {route.type === "inconnue" && (
            <section className="page-vide">
              <div className="sur-titre">404</div>
              <h2>Cette page n’existe pas.</h2>
              <button type="button" onClick={() => aller("/")}>Revenir au graphe</button>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <FournisseurSource><Coquille /></FournisseurSource>;
}
