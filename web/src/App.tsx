// La coquille du cockpit : barre latérale groupée, barre du haut (fil d'Ariane, santé,
// activité), bandeau de pause et, sur téléphone, onglets du bas. Les cellules du graphe
// s'inspectent sans quitter la page ; les URL de détail restent accessibles directement,
// pour les liens partagés et les favoris existants.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BoutonActivite, FilAriane } from "./coquille/BarreHaute";
import { BarreLaterale, MenuComplet, OngletsBas } from "./coquille/Navigation";
import { evaluerSante, Sante } from "./coquille/Sante";
import { Onglets } from "./composants/Onglets";
import { Tiroir } from "./composants/Tiroir";
import { FournisseurToasts } from "./composants/Toasts";
import { useADecider } from "./donnees/aDecider";
import { FournisseurSource, useCharge, useSource } from "./donnees/contexte";
import { adresseCanonique, cleActive, lireRoute, miettes, type Route } from "./routes";
import { useTheme } from "./theme";
import type { Selection } from "./topologie/Topologie";
import { Agents } from "./vues/Agents";
import { Branches } from "./vues/Branches";
import { BandeauPause, ControleDemarrages, useControleFile } from "./vues/ControleExecution";
import { Decisions } from "./vues/Decisions";
import { Demander } from "./vues/Demander";
import { ListeActivite, useActivite } from "./vues/EnCours";
import { Kpis } from "./vues/Kpis";
import { Missions } from "./vues/Missions";
import { Panneau } from "./vues/Panneau";
import { Pipelines } from "./vues/Pipelines";
import { RunPipeline } from "./vues/RunPipeline";
import { VueEnsemble } from "./vues/VueEnsemble";

export { lireRoute } from "./routes";

const Systeme = lazy(() => import("./systeme/Systeme").then((module) => ({ default: module.Systeme })));
const Marketing = lazy(() => import("./vues/Marketing").then((module) => ({ default: module.Marketing })));
const AIStudio = lazy(() => import("./ai-studio/AIStudio").then((module) => ({ default: module.AIStudio })));
const TaskBoard = lazy(() => import("./TaskBoard").then((module) => ({ default: module.TaskBoard })));
// Le graphe (React Flow) ne sert plus qu'à Système : il quitte le premier chargement.
const Topologie = lazy(() => import("./topologie/Topologie").then((module) => ({ default: module.Topologie })));
const Finance = lazy(() => import("./finance/Finance").then((module) => ({ default: module.Finance })));

/** Lit la route après avoir remplacé une ancienne adresse par la nouvelle, sans entrée d'historique. */
function lireEtCorriger(): Route {
  const canonique = adresseCanonique(window.location.pathname);
  if (canonique) window.history.replaceState(null, "", canonique + window.location.search);
  return lireRoute();
}

function useNavigation() {
  const [route, setRoute] = useState(lireEtCorriger);
  useEffect(() => {
    const suivre = () => setRoute(lireEtCorriger());
    window.addEventListener("popstate", suivre);
    return () => window.removeEventListener("popstate", suivre);
  }, []);
  const aller = useCallback((destination: string) => {
    if (window.location.pathname + window.location.search !== destination) window.history.pushState(null, "", destination);
    setRoute(lireEtCorriger());
  }, []);
  return { route, aller };
}

/** Une boîte de dialogue modale est ouverte (tiroir) : Échap lui appartient. */
const dialogueOuvert = (): boolean => document.querySelector('[aria-modal="true"]') !== null;

function Chargement({ quoi }: { quoi: string }) {
  return (
    <section className="page-vide" role="status">
      <p>Chargement {quoi}…</p>
    </section>
  );
}

function Coquille() {
  const { route, aller } = useNavigation();
  const { source, connecte } = useSource();
  const { theme, basculer } = useTheme();
  const [menu, setMenu] = useState(false);
  const [activiteOuverte, setActiviteOuverte] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const declencheur = useRef<HTMLElement | null>(null);
  const { donnees: topo } = useCharge((s) => s.topologie(), []);
  const { donnees: usage } = useCharge((s) => s.usage(), []);
  const activite = useActivite();
  const aDecider = useADecider(activite.runs);
  const file = useControleFile();
  // Ce qui attend Raphaël, compté une fois : le badge et la vue d'ensemble lisent la même liste.
  const decisions = aDecider.elements.length;
  const sante = evaluerSante({ machines: topo?.machines ?? null, connecte, usage, file: source.etatExecution ? file : null });
  const active = cleActive(route);
  const chemin = miettes(route);
  const titre = chemin[chemin.length - 1]?.libelle ?? "AgenticOS";

  useEffect(() => {
    document.title = `${titre} · AgenticOS`;
  }, [titre]);

  // Choisir une destination referme ce qui la couvrait : menu, tiroir, inspection.
  const naviguer = useCallback(
    (href: string) => {
      setSelection(null);
      setMenu(false);
      setActiviteOuverte(false);
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
      if (event.key === "Escape" && !event.defaultPrevented && !dialogueOuvert()) {
        event.preventDefault();
        fermer();
      }
    };
    window.addEventListener("keydown", echapper);
    return () => window.removeEventListener("keydown", echapper);
  }, [selection, fermer]);

  return (
    <div className={`ao-shell ${selection ? "avec-inspection" : ""}`}>
      <a href="#contenu" className="ao-evitement">
        Aller au contenu
      </a>
      <BarreLaterale active={active} aller={naviguer} decisions={decisions} theme={theme} basculer={basculer} />

      <div className="ao-centre">
        <header className="ao-haut">
          <FilAriane chemin={chemin} aller={naviguer} />
          <div className="ao-sys">
            {source.nom === "maquette" && <span className="ao-maquette">Maquette</span>}
            <Sante evaluation={sante} aller={naviguer} />
            <BoutonActivite
              total={activite.total}
              aValider={activite.aValider}
              ouvert={activiteOuverte}
              onOuvrir={() => {
                // Déposer une commande n'émet aucun événement : sans relecture, un arrêt encore en
                // file n'apparaîtrait qu'au prochain événement du flux.
                activite.recharger();
                setActiviteOuverte(true);
              }}
            />
          </div>
        </header>
        <BandeauPause controle={file} />
        {(route.type === "missions" || route.type === "branches") && (
          <div className="ao-sous-onglets">
            <Onglets
              libelle="Missions"
              actif={route.type === "branches" ? "branches" : "missions"}
              onChoisir={(cle) => naviguer(cle === "branches" ? "/missions/branches" : "/missions")}
              onglets={[
                { cle: "missions", libelle: "Missions" },
                { cle: "branches", libelle: "Branches" },
              ]}
            />
          </div>
        )}

        <main id="contenu" tabIndex={-1} className={`ao-contenu${route.type === "systeme" && route.page === "topologie" ? " ao-contenu-graphe" : ""}`}>
          {route.type === "accueil" && <VueEnsemble decisions={aDecider} activite={activite} sante={sante} aller={naviguer} />}
          {(route.type === "agents" || route.type === "detail") && (
            <div className="mb-4">
              <Kpis />
            </div>
          )}
          {route.type === "agents" && <Agents onSelection={ouvrir} />}
          {route.type === "pipelines" && <Pipelines pipelineId={route.pipelineId} aller={naviguer} />}
          {route.type === "run" && <RunPipeline runId={route.runId} aller={naviguer} />}
          {route.type === "missions" && <Missions key={`${route.projetId}:${route.brouillonId}`} projetInitial={route.projetId} brouillonId={route.brouillonId} aller={naviguer} />}
          {route.type === "branches" && <Branches aller={naviguer} />}
          {route.type === "finance" && (
            <Suspense fallback={<Chargement quoi="de Finance" />}>
              <Finance />
            </Suspense>
          )}
          {route.type === "marketing" && (
            <Suspense fallback={<Chargement quoi="de l'équipe marketing" />}>
              <Marketing key={`${route.projetId}:${route.filId}`} projetInitial={route.projetId} filId={route.filId} aller={naviguer} />
            </Suspense>
          )}
          {route.type === "demander" && <Demander filId={route.filId} aller={naviguer} />}
          {(route.type === "decisions" || route.type === "approbations") && <Decisions aDecider={aDecider} element={route.type === "decisions" ? route.element : null} aller={naviguer} />}
          {route.type === "systeme" && (
            <Suspense fallback={<Chargement quoi="du système" />}>
              <Systeme page={route.page} aller={naviguer} topologie={<Topologie selection={selection} onSelection={(choix) => (choix ? ouvrir(choix) : fermer())} />} />
            </Suspense>
          )}
          {route.type === "taskboard" && (
            <Suspense fallback={<Chargement quoi="du planning" />}>
              <TaskBoard onglet={route.onglet} aller={naviguer} />
            </Suspense>
          )}
          {route.type === "ai-studio" && (
            <Suspense fallback={<Chargement quoi="de l'AI Studio" />}>
              <AIStudio route={route.studio} aller={naviguer} />
            </Suspense>
          )}
          {route.type === "detail" && <Panneau modePage key={`${route.selection.type}:${route.selection.id}`} selection={route.selection} onSelection={ouvrir} onFermer={() => naviguer("/systeme/topologie")} />}
          {route.type === "inconnue" && (
            <section className="page-vide">
              <div className="font-mono text-[11px] uppercase tracking-widest text-douce">404</div>
              <h2>Introuvable</h2>
              <p className="text-douce">Cette page n’existe pas, ou son adresse a changé.</p>
              <button type="button" className="mt-2 cursor-pointer bg-accent px-4 py-2 text-sm font-semibold text-sur-accent" onClick={() => naviguer("/")}>
                Revenir à la vue d'ensemble
              </button>
            </section>
          )}
        </main>
      </div>

      {selection && (
        <aside className="ao-inspection" aria-label="Détails de la cellule">
          <Panneau key={`${selection.type}:${selection.id}:${selection.type === "run" ? selection.etapeId ?? "" : ""}`} selection={selection} onSelection={ouvrir} onFermer={fermer} />
        </aside>
      )}

      <OngletsBas active={active} aller={naviguer} decisions={decisions} plusOuvert={menu} onPlus={() => setMenu(true)} />
      <MenuComplet ouvert={menu} onFermer={() => setMenu(false)} active={active} aller={naviguer} decisions={decisions} theme={theme} basculer={basculer} />
      <Tiroir ouvert={activiteOuverte} onFermer={() => setActiviteOuverte(false)} titre={`Activité · ${activite.total}`}>
        <div className="flex flex-col gap-5">
          <ListeActivite activite={activite} aller={naviguer} autoriseArret={file.etat?.autorise ?? false} />
          <ControleDemarrages controle={file} />
        </div>
      </Tiroir>
    </div>
  );
}

export default function App() {
  return (
    <FournisseurSource>
      <FournisseurToasts>
        <Coquille />
      </FournisseurToasts>
    </FournisseurSource>
  );
}
