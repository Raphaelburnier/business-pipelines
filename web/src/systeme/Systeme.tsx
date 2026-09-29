// La carte du système agentique : ce qui tourne où, comment une décision devient un run, et
// comment un run réussi arrive en production. Tout vient de carte.ts ; les nœuds ne bougent
// pas, un clic ouvre la fiche et éclaire les liens de la brique.
import "@xyflow/react/dist/style.css";
import "./systeme.css";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BRIQUES,
  ETAPES,
  FAMILLES,
  GARDE_FOUS,
  HAUTEUR_BRIQUE,
  JALONS,
  LARGEUR_BRIQUE,
  LIENS,
  OUVERTS,
  TRANSITIONS,
  ZONES,
  type Brique,
  type Etape,
  type Famille,
  type Statut,
  type ZoneCarte,
} from "./carte";

type Onglet = "architecture" | "boucle" | "garde-fous" | "chronologie";

const ONGLETS: Array<{ id: Onglet; nom: string }> = [
  { id: "architecture", nom: "Architecture" },
  { id: "boucle", nom: "Boucle d'un run" },
  { id: "garde-fous", nom: "Garde-fous" },
  { id: "chronologie", nom: "Chronologie" },
];

const MOT_STATUT: Record<Statut, string> = { actif: "en service", partiel: "partiel", arrete: "arrêté" };
const NOM_ZONE: Record<ZoneCarte["id"], string> = { interfaces: "Interfaces", nas: "NAS", pc: "PC", cloud: "Cloud" };

// ---------- Poignées : quatre côtés, source et cible sur chacun ----------

type Cote = "haut" | "droite" | "bas" | "gauche";
const POSITIONS: Record<Cote, Position> = { haut: Position.Top, droite: Position.Right, bas: Position.Bottom, gauche: Position.Left };

function poignees(largeur: number, hauteur: number) {
  const points: Record<Cote, { x: number; y: number }> = {
    haut: { x: largeur / 2, y: 0 },
    droite: { x: largeur, y: hauteur / 2 },
    bas: { x: largeur / 2, y: hauteur },
    gauche: { x: 0, y: hauteur / 2 },
  };
  return (Object.keys(points) as Cote[]).flatMap((cote) => [
    { id: `s-${cote}`, type: "source" as const, position: POSITIONS[cote], ...points[cote], width: 1, height: 1 },
    { id: `t-${cote}`, type: "target" as const, position: POSITIONS[cote], ...points[cote], width: 1, height: 1 },
  ]);
}

function Poignees() {
  return (
    <>
      {(Object.keys(POSITIONS) as Cote[]).map((cote) => (
        <span key={cote}>
          <Handle id={`s-${cote}`} type="source" position={POSITIONS[cote]} className="sy-poignee" />
          <Handle id={`t-${cote}`} type="target" position={POSITIONS[cote]} className="sy-poignee" />
        </span>
      ))}
    </>
  );
}

/** Le côté de sortie et d'entrée d'un lien, d'après la position relative des deux nœuds. */
function cotes(de: { x: number; y: number }, vers: { x: number; y: number }): [Cote, Cote] {
  const dx = vers.x - de.x;
  const dy = vers.y - de.y;
  if (Math.abs(dx) > Math.abs(dy) * 1.2) return dx > 0 ? ["droite", "gauche"] : ["gauche", "droite"];
  return dy > 0 ? ["bas", "haut"] : ["haut", "bas"];
}

// ---------- Cadrage : même méthode que la topologie, sans dépendre des mesures du DOM ----------

function Cadre({ largeur, hauteur, zoomMin, children }: { largeur: number; hauteur: number; zoomMin: number; children: ReactNode }) {
  const { setViewport } = useReactFlow();
  const [conteneur, setConteneur] = useState<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<{ l: number; h: number } | null>(null);

  useEffect(() => {
    if (!conteneur) return undefined;
    const observateur = new ResizeObserver(([entree]) => {
      if (entree) setZone({ l: entree.contentRect.width, h: entree.contentRect.height });
    });
    observateur.observe(conteneur);
    return () => observateur.disconnect();
  }, [conteneur]);

  useEffect(() => {
    if (!zone || zone.l === 0) return;
    const marge = 24;
    const zoom = Math.max(Math.min((zone.l - 2 * marge) / largeur, (zone.h - 2 * marge) / hauteur, 1), zoomMin);
    void setViewport({ x: Math.max(marge, (zone.l - largeur * zoom) / 2), y: Math.max(marge, (zone.h - hauteur * zoom) / 2), zoom });
  }, [zone, largeur, hauteur, zoomMin, setViewport]);

  return (
    <div ref={setConteneur} className="relative h-full w-full">
      {children}
    </div>
  );
}

// ---------- Architecture ----------

type DonneesZone = { zone: ZoneCarte };
type DonneesBrique = { brique: Brique; selectionnee: boolean; eteinte: boolean };

function NoeudZone({ data }: NodeProps<Node<DonneesZone>>) {
  return (
    <div className={`sy-zone ${data.zone.id}`}>
      <span className="titre">{data.zone.titre}</span>
      <span className="sous">{data.zone.sous}</span>
    </div>
  );
}

function NoeudBrique({ data }: NodeProps<Node<DonneesBrique>>) {
  const b = data.brique;
  return (
    <div className={`sy-brique ${b.genre} ${b.zone} ${data.selectionnee ? "selectionnee" : ""} ${data.eteinte ? "eteinte" : ""}`} title={b.resume}>
      <Poignees />
      <div className="ligne">
        <span className={`point ${b.statut}`} aria-hidden="true" />
        <span className="nom">{b.titre}</span>
        {b.statut !== "actif" && <span className={`etiquette ${b.statut}`}>{MOT_STATUT[b.statut]}</span>}
      </div>
      <div className="sous">{b.sous}</div>
    </div>
  );
}

const TYPES_ARCHI = { zone: NoeudZone, brique: NoeudBrique };

const PAR_ID = new Map(BRIQUES.map((b) => [b.id, b]));

function centre(b: Brique) {
  return { x: b.x + LARGEUR_BRIQUE / 2, y: b.y + HAUTEUR_BRIQUE / 2 };
}

const LARGEUR_CARTE = Math.max(...ZONES.map((z) => z.x + z.largeur));
const HAUTEUR_CARTE = Math.max(...ZONES.map((z) => z.y + z.hauteur));

function CarteArchitecture({ actives, selection, onSelection }: { actives: ReadonlySet<Famille>; selection: string | null; onSelection: (id: string | null) => void }) {
  const liensVisibles = useMemo(() => LIENS.filter((l) => actives.has(l.famille)), [actives]);

  const voisins = useMemo(() => {
    const v = new Set<string>();
    if (!selection) return v;
    for (const l of liensVisibles) {
      if (l.de === selection) v.add(l.vers);
      if (l.vers === selection) v.add(l.de);
    }
    return v;
  }, [liensVisibles, selection]);

  const relies = useMemo(() => new Set(liensVisibles.flatMap((l) => [l.de, l.vers])), [liensVisibles]);

  const noeuds: Node[] = [
    ...ZONES.map<Node<DonneesZone>>((zone) => ({
      id: `zone-${zone.id}`,
      type: "zone",
      position: { x: zone.x, y: zone.y },
      width: zone.largeur,
      height: zone.hauteur,
      style: { width: zone.largeur, height: zone.hauteur },
      selectable: false,
      draggable: false,
      connectable: false,
      zIndex: -1,
      data: { zone },
    })),
    ...BRIQUES.map<Node<DonneesBrique>>((brique) => ({
      id: brique.id,
      type: "brique",
      position: { x: brique.x, y: brique.y },
      width: LARGEUR_BRIQUE,
      height: HAUTEUR_BRIQUE,
      style: { width: LARGEUR_BRIQUE, height: HAUTEUR_BRIQUE },
      handles: poignees(LARGEUR_BRIQUE, HAUTEUR_BRIQUE),
      draggable: false,
      connectable: false,
      data: {
        brique,
        selectionnee: brique.id === selection,
        eteinte: selection ? brique.id !== selection && !voisins.has(brique.id) : !relies.has(brique.id),
      },
    })),
  ];

  const aretes: Edge[] = liensVisibles.flatMap((l) => {
    const de = PAR_ID.get(l.de);
    const vers = PAR_ID.get(l.vers);
    if (!de || !vers) return [];
    const [sortie, entree] = cotes(centre(de), centre(vers));
    const touche = selection !== null && (l.de === selection || l.vers === selection);
    const efface = selection !== null && !touche;
    return [
      {
        id: `${l.de}>${l.vers}`,
        source: l.de,
        target: l.vers,
        sourceHandle: `s-${sortie}`,
        targetHandle: `t-${entree}`,
        type: "smoothstep",
        pathOptions: { borderRadius: 10 },
        label: efface ? undefined : l.libelle,
        labelShowBg: true,
        labelBgPadding: [4, 2] as [number, number],
        className: `sy-lien ${l.famille} ${touche ? "vif" : ""} ${efface ? "efface" : ""} ${l.bloque ? "bloque" : ""}`,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: `var(--sy-${l.famille})` },
        zIndex: touche ? 2 : 1,
      },
    ];
  });

  return (
    <ReactFlowProvider>
      <Cadre largeur={LARGEUR_CARTE} hauteur={HAUTEUR_CARTE} zoomMin={0.18}>
        <ReactFlow
          nodes={noeuds}
          edges={aretes}
          nodeTypes={TYPES_ARCHI}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable={false}
          minZoom={0.18}
          maxZoom={1.6}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, noeud) => {
            if (noeud.type === "brique") onSelection(noeud.id === selection ? null : noeud.id);
          }}
          onPaneClick={() => onSelection(null)}
        >
          <Background gap={24} size={1} color="var(--color-trait)" />
          <Controls showInteractive={false} position="bottom-left" className="sy-zoom" />
        </ReactFlow>
      </Cadre>
    </ReactFlowProvider>
  );
}

function Fiche({ id, onSelection }: { id: string | null; onSelection: (id: string | null) => void }) {
  const b = id ? PAR_ID.get(id) : undefined;
  if (!b) {
    return (
      <aside className="sy-fiche vide">
        <span className="kicker">Fiche</span>
        <p>Clique une brique pour lire son rôle, ses règles et ses liens. Les filtres isolent un flux.</p>
        <p className="text-douce">Lecture conseillée : suis le flux Commande depuis Raphaël jusqu'à Anthropic, puis Livraison depuis les workspaces jusqu'aux apps.</p>
      </aside>
    );
  }
  const sortants = LIENS.filter((l) => l.de === b.id);
  const entrants = LIENS.filter((l) => l.vers === b.id);
  return (
    <aside className="sy-fiche" aria-live="polite">
      <div className="flex items-start justify-between gap-2">
        <span className="kicker">
          {NOM_ZONE[b.zone]} · {b.genre}
        </span>
        <button type="button" className="ao-bouton-icone" onClick={() => onSelection(null)} aria-label="Fermer la fiche" title="Fermer la fiche">
          ×
        </button>
      </div>
      <h3>{b.titre}</h3>
      <div className="meta">
        <span className={`statut ${b.statut}`}>{MOT_STATUT[b.statut]}</span>
        <span>{b.sous}</span>
        {b.depuis && <span>depuis le {b.depuis}</span>}
        {b.depot && <span>dépôt {b.depot}</span>}
      </div>
      <p>{b.resume}</p>
      <ul className="faits">
        {b.faits.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {(entrants.length > 0 || sortants.length > 0) && (
        <div className="liens">
          {entrants.map((l) => (
            <button type="button" key={`e-${l.de}`} onClick={() => onSelection(l.de)} className={`sy-puce ${l.famille}`}>
              ← {PAR_ID.get(l.de)?.titre}
              {l.libelle && <em>{l.libelle}</em>}
            </button>
          ))}
          {sortants.map((l) => (
            <button type="button" key={`s-${l.vers}`} onClick={() => onSelection(l.vers)} className={`sy-puce ${l.famille}`}>
              → {PAR_ID.get(l.vers)?.titre}
              {l.libelle && <em>{l.libelle}</em>}
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function Architecture() {
  const [actives, setActives] = useState<Set<Famille>>(() => new Set(Object.keys(FAMILLES) as Famille[]));
  const [selection, setSelection] = useState<string | null>(null);
  const toutes = Object.keys(FAMILLES) as Famille[];
  // Isoler un flux efface la sélection : une brique hors du flux éteindrait tout le graphe.
  const seule = (f: Famille) => {
    setSelection(null);
    setActives((avant) => (avant.size === 1 && avant.has(f) ? new Set(toutes) : new Set([f])));
  };

  return (
    <div className="sy-archi">
      <div className="sy-filtres" role="group" aria-label="Flux affichés">
        <span className="kicker">Flux</span>
        {toutes.map((f) => (
          <button key={f} type="button" className={`sy-filtre ${f}`} aria-pressed={actives.has(f)} onClick={() => seule(f)} title={FAMILLES[f].detail}>
            <i aria-hidden="true" />
            {FAMILLES[f].nom}
          </button>
        ))}
        {actives.size < toutes.length && (
          <button type="button" className="sy-filtre tout" onClick={() => setActives(new Set(toutes))}>
            Tout afficher
          </button>
        )}
      </div>
      <div className="sy-archi-corps">
        <div className="ao-canevas sy-canevas">
          <CarteArchitecture actives={actives} selection={selection} onSelection={setSelection} />
          <div className="ao-legende-graphe" aria-hidden="true">
            <span><i className="sy-l-actif" />en service</span>
            <span><i className="sy-l-partiel" />partiel</span>
            <span><i className="sy-l-bloque" />bloqué</span>
          </div>
        </div>
        <div className="sy-cote">
          <Fiche id={selection} onSelection={setSelection} />
          <details className="sy-liste">
            <summary>Toutes les briques ({BRIQUES.length})</summary>
            {ZONES.map((z) => (
              <div key={z.id}>
                <span className="kicker">{z.titre}</span>
                <ul>
                  {BRIQUES.filter((b) => b.zone === z.id).map((b) => (
                    <li key={b.id}>
                      <button type="button" aria-pressed={selection === b.id} onClick={() => setSelection(b.id)}>
                        <span className={`point ${b.statut}`} aria-hidden="true" />
                        {b.titre}
                        <span className="text-douce">{b.sous}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </div>
      </div>
    </div>
  );
}

// ---------- Boucle d'un run ----------

type DonneesEtape = { etape: Etape; selectionnee: boolean };

const LARGEUR_ETAPE = 220;
const HAUTEUR_ETAPE = 64;

function NoeudEtape({ data }: NodeProps<Node<DonneesEtape>>) {
  const e = data.etape;
  return (
    <div className={`sy-etape ${e.genre} ${data.selectionnee ? "selectionnee" : ""}`}>
      <Poignees />
      <span className="genre">{COURT_GENRE[e.genre]}</span>
      <span className="nom">{e.titre}</span>
      <span className="sous">{e.sous}</span>
    </div>
  );
}

const COURT_GENRE: Record<Etape["genre"], string> = { humain: "humain", deterministe: "déterministe", agent: "agent", script: "script", externe: "externe" };

const TYPES_BOUCLE = { etape: NoeudEtape };
const ETAPE_PAR_ID = new Map(ETAPES.map((e) => [e.id, e]));
const LARGEUR_BOUCLE = Math.max(...ETAPES.map((e) => e.x)) + LARGEUR_ETAPE;
const HAUTEUR_BOUCLE = Math.max(...ETAPES.map((e) => e.y)) + HAUTEUR_ETAPE;

const MOT_GENRE: Record<Etape["genre"], string> = {
  humain: "décision humaine",
  deterministe: "code déterministe, zéro token",
  agent: "agent, tours comptés",
  script: "script du pipeline",
  externe: "système externe",
};

function Boucle() {
  const [selection, setSelection] = useState<string | null>("b-verdict");
  const choisie = selection ? ETAPE_PAR_ID.get(selection) : undefined;

  const noeuds: Node<DonneesEtape>[] = ETAPES.map((etape) => ({
    id: etape.id,
    type: "etape",
    position: { x: etape.x, y: etape.y },
    width: LARGEUR_ETAPE,
    height: HAUTEUR_ETAPE,
    style: { width: LARGEUR_ETAPE, height: HAUTEUR_ETAPE },
    handles: poignees(LARGEUR_ETAPE, HAUTEUR_ETAPE),
    draggable: false,
    connectable: false,
    data: { etape, selectionnee: etape.id === selection },
  }));

  const aretes: Edge[] = TRANSITIONS.flatMap((t) => {
    const de = ETAPE_PAR_ID.get(t.de);
    const vers = ETAPE_PAR_ID.get(t.vers);
    if (!de || !vers) return [];
    const [sortie, entree] = t.boucle ? (["bas", "bas"] as const) : cotes(de, vers);
    const classe = t.issue ?? "suite";
    return [
      {
        id: `${t.de}>${t.vers}`,
        source: t.de,
        target: t.vers,
        sourceHandle: `s-${sortie}`,
        targetHandle: `t-${entree}`,
        type: "smoothstep",
        pathOptions: { borderRadius: 10, offset: t.boucle ? 36 : 20 },
        label: t.libelle,
        labelShowBg: true,
        labelBgPadding: [4, 2] as [number, number],
        className: `sy-transition ${classe}`,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: `var(--sy-issue-${classe})` },
      },
    ];
  });

  return (
    <div className="sy-boucle">
      <p className="sy-intro">
        Le trajet réel d'un run <b>improve-app@4</b> sur Steam TierList, de la décision jusqu'au retour de <code>main</code> sur le NAS. Budget : 3 $ par run,
        80 tours au total, 35 par agent. Le seul cycle, <code>correction</code>, couvre implement, verify et verdict avec <code>maxLoops: 1</code>.
      </p>
      <div className="sy-archi-corps">
        <div className="ao-canevas sy-canevas boucle">
          <ReactFlowProvider>
            <Cadre largeur={LARGEUR_BOUCLE} hauteur={HAUTEUR_BOUCLE + 40} zoomMin={0.25}>
              <ReactFlow
                nodes={noeuds}
                edges={aretes}
                nodeTypes={TYPES_BOUCLE}
                nodesDraggable={false}
                nodesConnectable={false}
                edgesFocusable={false}
                minZoom={0.25}
                maxZoom={1.6}
                proOptions={{ hideAttribution: true }}
                onNodeClick={(_, n) => setSelection(n.id)}
              >
                <Background gap={24} size={1} color="var(--color-trait)" />
          <Controls showInteractive={false} position="bottom-left" className="sy-zoom" />
              </ReactFlow>
            </Cadre>
          </ReactFlowProvider>
          <div className="ao-legende-graphe" aria-hidden="true">
            <span><i className="sy-i-pass" />PASS</span>
            <span><i className="sy-i-fail" />FAIL</span>
            <span><i className="sy-i-attente" />attente</span>
          </div>
        </div>
        <aside className="sy-fiche" aria-live="polite">
          {choisie ? (
            <>
              <span className="kicker">{MOT_GENRE[choisie.genre]}</span>
              <h3>{choisie.titre}</h3>
              <div className="meta">
                <span>{choisie.sous}</span>
              </div>
              <p>{choisie.detail}</p>
            </>
          ) : (
            <p>Clique une étape.</p>
          )}
          <div className="sy-genres">
            {(Object.keys(MOT_GENRE) as Etape["genre"][]).map((g) => (
              <span key={g} className={`sy-etape-mini ${g}`}>
                {MOT_GENRE[g]}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------- Garde-fous, chronologie, points ouverts ----------

function GardeFous() {
  return (
    <div className="sy-grille">
      {GARDE_FOUS.map((g, i) => (
        <article key={g.titre} className="sy-regle">
          <span className="num">{String(i + 1).padStart(2, "0")}</span>
          <h3>{g.titre}</h3>
          <p>{g.texte}</p>
          <span className="origine">{g.origine}</span>
        </article>
      ))}
    </div>
  );
}

const NOM_PROJET: Record<(typeof JALONS)[number]["projet"], string> = {
  saas: "Saas-generator",
  moteur: "agent-orchestrator",
  cockpit: "business-pipelines",
  registre: "agent-registry",
  modeles: "OmniRoute",
  runs: "runs",
};

function Chronologie() {
  return (
    <div className="sy-chrono-corps">
      <ol className="sy-chrono">
        {JALONS.map((j) => (
          <li key={`${j.date}-${j.titre}`} className={j.projet}>
            <time dateTime={j.date}>{j.date}</time>
            <div>
              <span className="projet">{NOM_PROJET[j.projet]}</span>
              <h3>{j.titre}</h3>
              <p>{j.texte}</p>
            </div>
          </li>
        ))}
      </ol>
      <aside className="sy-fiche sy-ouverts">
        <span className="kicker">Encore ouvert</span>
        <ul className="faits">
          {OUVERTS.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

// ---------- Page ----------

const CHIFFRES: Array<{ valeur: string; libelle: string }> = [
  { valeur: String(BRIQUES.filter((b) => b.genre === "service").length), libelle: "services" },
  { valeur: "26", libelle: "agents versionnés" },
  { valeur: "6", libelle: "versions de pipeline" },
  { valeur: String(GARDE_FOUS.length), libelle: "garde-fous" },
  { valeur: String(JALONS.length), libelle: "jalons depuis juillet" },
];

export function Systeme() {
  const [onglet, setOnglet] = useState<Onglet>("architecture");
  return (
    <section className="sy-page">
      <header className="sy-hero">
        <div>
          <span className="kicker">SYS//MAP · relevé du 2026-09-29</span>
          <h2>Les boucles agentiques, de bout en bout</h2>
          <p>
            Trois dépôts système (cockpit, moteur, registre), deux machines et un humain. Le NAS décide et stocke, le PC calcule, les agents travaillent
            dans des pipelines à gates de code, et un run réussi rejoint la production sans clé exposée.
          </p>
        </div>
        <dl className="sy-chiffres">
          {CHIFFRES.map((c) => (
            <div key={c.libelle}>
              <dt>{c.libelle}</dt>
              <dd>{c.valeur}</dd>
            </div>
          ))}
        </dl>
      </header>

      <div className="sy-onglets" role="tablist" aria-label="Vues de la carte">
        {ONGLETS.map((o) => (
          <button key={o.id} type="button" role="tab" aria-selected={onglet === o.id} onClick={() => setOnglet(o.id)}>
            {o.nom}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {onglet === "architecture" && <Architecture />}
        {onglet === "boucle" && <Boucle />}
        {onglet === "garde-fous" && <GardeFous />}
        {onglet === "chronologie" && <Chronologie />}
      </div>
    </section>
  );
}
