// L'accueil relie l'infrastructure, les projets et quelques jalons du dernier run.
import "@xyflow/react/dist/style.css";
import "./accueil.css";
import { Background, BaseEdge, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useReactFlow, getNodesBounds, getViewportForBounds, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { useCharge, useSource } from "../donnees/contexte";
import { CLASSES_TON, mot, ton, vivant } from "../format";
import type { ProjetTopologie as Projet, Topologie as DonneesTopologie } from "../types";
import { Erreur } from "../ui";
import { Kpis } from "../vues/Kpis";
import { Icone } from "../icones";
import { disposer, idMachine, idOrchestrateur, idProjet, roleDeMachine, type ExecutionProjet, type NoeudDispose, OUVERTS_INITIAUX } from "./disposition";

import { clePositions, lirePositions, ecrirePositions, type Positions } from "./positions";

export type Selection = { type: "projet"; id: string } | { type: "machine"; id: string } | { type: "run"; id: string; etapeId?: string } | { type: "orchestrateur"; id: "maitre" };

type DonneesNoeud = NoeudDispose & { selectionne: boolean; attenue: boolean; ouvert: boolean; depliable: boolean; activer: () => void };
type AreteFluide = Edge & { pathOptions: { borderRadius: number; offset: number } };

function nomEtape(nom: string): string {
  const connus: Record<string, string> = {
    consigne: "Briefing",
    economie: "Analyse économique",
    marque: "Analyse de marque",
    synthese: "Synthèse",
    couverture: "Vérification",
    approbation: "Approbation",
  };
  return connus[nom] ?? nom.replace(/[-_]+/g, " ").replace(/^./, (lettre) => lettre.toLocaleUpperCase("fr"));
}

function NoeudProjet({ data }: NodeProps<Node<DonneesNoeud>>) {
  const projet: Projet = data.projet!;
  const nom = projet.id === "agent-orchestrator" ? "Moteur (agent-orchestrator)" : projet.nom;
  const classe = CLASSES_TON[ton(projet.etat)];
  const attente = projet.approbationsEnAttente > 0;
  const machine = /nas|synology/i.test(projet.homeMachine) ? "NAS" : /pc|destrobimobile|windows/i.test(projet.homeMachine) ? "PC" : projet.homeMachine;

  return (
    <button
      type="button"
      className={`ao-noeud projet ${classe.texte} ${attente ? "attente" : ""} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`}
      aria-label={`${data.depliable ? data.ouvert ? "Replier" : "Déplier" : "Inspecter"} ${nom}`}
      aria-pressed={data.selectionne} aria-expanded={data.depliable ? data.ouvert : undefined} onClick={data.activer}
    >
      <span className="ao-noeud-kicker"><Icone nom="mission" taille={12} />{projet.categorie}<span>{mot(projet.etat)}</span></span>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${vivant(projet.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{nom}</span>
        {attente && <span className="badge alerte" title={`${projet.approbationsEnAttente} décision(s) en attente`}>{projet.approbationsEnAttente}</span>}
      </span>
      <span className="sous">
        <span>{machine}</span>
        <span className="truncate">{projet.pipelines[0] ?? "sans pipeline"}</span>
        <span className="ml-auto shrink-0 text-accent">{data.depliable ? data.ouvert ? "replier −" : "déplier +" : "inspecter ↗"}</span>
      </span>
    </button>
  );
}

function NoeudMachine({ data }: NodeProps<Node<DonneesNoeud>>) {
  const role = data.roleMachine!;
  const nom = role === "pc" ? "PC" : "NAS";
  const classe = data.etat ? CLASSES_TON[ton(data.etat)] : CLASSES_TON.doux;
  const contenu = (
    <>
      <span className="ao-noeud-kicker"><Icone nom="systeme" taille={12} />{role === "pc" ? "Calcul" : "Hébergement"}</span>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2.5 w-2.5 shrink-0 rounded-full ${classe.plein} ${data.etat && vivant(data.etat) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{nom}</span>
        {data.etat && <span className={`ml-auto text-[10px] ${classe.texte}`}>{mot(data.etat)}</span>}
      </span>
      <span className="sous"><span>{data.sousTitre}</span>{data.machine?.nom && <span className="truncate">{data.machine.nom}</span>}</span>
    </>
  );

  return (
    <button type="button" className={`ao-noeud infrastructure clickable ${role} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label={`Ouvrir la machine ${nom}`} aria-pressed={data.selectionne} aria-expanded={data.depliable ? data.ouvert : undefined} onClick={data.activer}>
      {contenu}
    </button>
  );
}

function NoeudOrchestrateur({ data }: NodeProps<Node<DonneesNoeud>>) {
  const etat = data.maitre!.etat;
  const classe = CLASSES_TON[ton(etat)];
  return (
    <button type="button" className={`ao-noeud orchestrateur infrastructure ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label="Maître (répartiteur)" aria-pressed={data.selectionne} aria-expanded={data.depliable ? data.ouvert : undefined} onClick={data.activer}>
      <span className="ao-noeud-kicker"><Icone nom="graphe" taille={12} />Pilotage</span>
      <span className="flex min-w-0 items-center gap-2"><i className={`h-2 w-2 rounded-full ${classe.plein} ${vivant(etat) ? "pulse-douce" : ""}`} /><span className="nom">Maître (répartiteur)</span></span>
      <span className="sous"><span>{data.sousTitre}</span><span className="ml-auto">{mot(etat)}</span></span>
    </button>
  );
}

function NoeudEtape({ data }: NodeProps<Node<DonneesNoeud>>) {
  const etape = data.etape!;
  const classe = CLASSES_TON[ton(etape.statut)];
  return (
    <button type="button" className={`ao-noeud etape ${classe.texte} ${data.selectionne ? "selectionne" : ""} ${data.attenue ? "estompe" : ""}`} aria-label={`Ouvrir le run ${etape.runId}, étape ${etape.nom}`} aria-pressed={data.selectionne} aria-expanded={data.depliable ? data.ouvert : undefined} onClick={data.activer}>
      <span className="flex min-w-0 items-center gap-2">
        <i className={`h-2 w-2 shrink-0 rounded-full ${classe.plein} ${vivant(etape.statut) ? "pulse-douce" : ""}`} aria-hidden="true" />
        <span className="nom">{nomEtape(etape.nom)}</span>
        {etape.tour > 0 && <span className="text-[10px] text-douce">t{etape.tour + 1}</span>}
      </span>
      <span className="sous"><span className="truncate">{etape.detail}</span><span className="ml-auto shrink-0">{mot(etape.statut)}</span></span>
    </button>
  );
}

function NoeudGraphe(props: NodeProps<Node<DonneesNoeud>>) {
  const type = props.data.type;
  return (
    <>
      {type !== "orchestrateur" && <Handle id="entree" type="target" position={type === "machine" ? Position.Top : Position.Left} className="ao-port" />}
      {type === "projet" && <NoeudProjet {...props} />}
      {type === "machine" && <NoeudMachine {...props} />}
      {type === "orchestrateur" && <NoeudOrchestrateur {...props} />}
      {type === "etape" && <NoeudEtape {...props} />}
      {type !== "etape" && <Handle id="sortie" type="source" position={Position.Bottom} className="ao-port" />}
    </>
  );
}

const TYPES_NOEUDS = { cockpit: NoeudGraphe };

// Sortir sous les machines avant de rejoindre le couloir latéral. En vue compacte,
// une sortie sur le côté du NAS traverserait la cellule PC placée juste à sa gauche.
function FluxMachine({ id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps) {
  const y = sourceY + (data?.famille === "nas" ? 40 : 24);
  const x = targetX - (data?.famille === "nas" ? 34 : 20);
  const r = 10;
  const path = `M${sourceX},${sourceY} L${sourceX},${y - r} Q${sourceX},${y} ${sourceX - r},${y} L${x + r},${y} Q${x},${y} ${x},${y + r} L${x},${targetY - r} Q${x},${targetY} ${x + r},${targetY} L${targetX},${targetY}`;
  return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />;
}

const TYPES_ARETES = { machine: FluxMachine };
const ZOOM_MAX = 1.2;

function Arbre({ topologie, selection, onSelection }: { topologie: DonneesTopologie; selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { setViewport } = useReactFlow();
  const { source } = useSource();
  const [ouverts, setOuverts] = useState(() => new Set(OUVERTS_INITIAUX));
  const [positionsParCle, setPositionsParCle] = useState<Record<string, Positions>>({});
  const [conteneur, setConteneur] = useState<HTMLDivElement | null>(null);
  const [zone, setZone] = useState<{ largeur: number; hauteur: number } | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const suivre = () => setCompact(media.matches);
    media.addEventListener("change", suivre);
    return () => media.removeEventListener("change", suivre);
  }, []);
  const cleStockage = clePositions(compact, source.nom === "maquette");
  useEffect(() => {
    setPositionsParCle((precedentes) => ({ ...precedentes, [cleStockage]: lirePositions(cleStockage) }));
  }, [cleStockage]);
  const positions = positionsParCle[cleStockage] ?? {};
  const cleRuns = topologie.projets.map((projet) => `${projet.id}:${projet.dernierRun?.id ?? ""}`).join("|");
  const executions = useCharge(async (source) => {
    const projets = topologie.projets.filter((projet) => projet.aFiche && projet.dernierRun && ouverts.has(idOrchestrateur) && ouverts.has(idMachine(/nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc")) && ouverts.has(idProjet(projet.id)));
    const chargees = await Promise.all(projets.map(async (projet) => {
      try {
        const run = await source.run(projet.dernierRun!.id);
        return run ? { projetId: projet.id, run } : null;
      } catch {
        return null;
      }
    }));
    return chargees.filter((execution): execution is ExecutionProjet => execution !== null);
  }, [cleRuns, [...ouverts].sort().join("|")]);
  const disposition = useMemo(() => disposer(topologie, executions.donnees ?? [], compact, ouverts), [topologie, executions.donnees, compact, ouverts]);
  const executionParRun = new Map((executions.donnees ?? []).map((execution) => [execution.run.id, execution.projetId]));
  const projetFocal = selection?.type === "projet"
    ? selection.id
    : selection?.type === "run"
      ? executionParRun.get(selection.id) ?? null
      : null;
  const machineFocale = selection?.type === "machine"
    ? roleDeMachine(topologie.machines.find((machine) => machine.machine === selection.id) ?? {
        machine: selection.id, nom: null, etat: "offline", dernierHeartbeat: null, depuisSecondes: null, meta: null,
      })
    : null;
  const projetsFocaux = new Set(topologie.projets
    .filter((projet) => projet.aFiche && (projet.id === projetFocal || (machineFocale !== null && (/nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc") === machineFocale)))
    .map((projet) => projet.id));
  const aFocal = projetFocal !== null || machineFocale !== null;
  const noeuds: Node<DonneesNoeud>[] = disposition.noeuds.map((n) => ({
    id: n.id,
    type: "cockpit",
    position: positions[n.id] ?? { x: n.x, y: n.y },
    width: n.largeur,
    height: n.hauteur,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    // Les ancrages sont connus : les flux ne disparaissent pas pendant une mesure DOM
    // ou un rafraîchissement SSE. Ils correspondent aux Handle du composant ci-dessus.
    handles: [
      ...(n.type === "orchestrateur" ? [] : [{ id: "entree", type: "target" as const, position: n.type === "machine" ? Position.Top : Position.Left, x: n.type === "machine" ? n.largeur / 2 : 0, y: n.type === "machine" ? 0 : n.hauteur / 2, width: 6, height: 6 }]),
      ...(n.type === "etape" ? [] : [{ id: "sortie", type: "source" as const, position: Position.Bottom, x: n.largeur / 2, y: n.hauteur, width: 6, height: 6 }]),
    ],
    style: { width: n.largeur, height: n.hauteur },
    draggable: true,
    connectable: false,
    data: {
      ...n,
      ouvert: ouverts.has(n.id),
      depliable: n.type !== "etape" && (n.type !== "projet" || Boolean(n.projet?.dernierRun)),
      activer: () => {
        if (n.type !== "etape" && (n.type !== "projet" || n.projet?.dernierRun)) setOuverts((precedents) => {
          const suivants = new Set(precedents);
          if (suivants.has(n.id)) suivants.delete(n.id); else suivants.add(n.id);
          return suivants;
        });
        if (n.type === "projet" && n.projet) onSelection({ type: "projet", id: n.projet.id });
        if (n.type === "machine") onSelection({ type: "machine", id: n.machine?.machine ?? n.roleMachine! });
        if (n.type === "orchestrateur") onSelection({ type: "orchestrateur", id: "maitre" });
        if (n.type === "etape" && n.etape) onSelection({ type: "run", id: n.etape.runId, etapeId: n.etape.id });
      },
      selectionne: (selection?.type === "projet" && n.projet?.id === selection.id)
        || (selection?.type === "machine" && (n.machine?.machine ?? n.roleMachine) === selection.id)
        || (selection?.type === "orchestrateur" && n.type === "orchestrateur")
        || (selection?.type === "run" && n.etape?.runId === selection.id && (!selection.etapeId || n.etape.id === selection.etapeId)),
      attenue: aFocal && (
        (n.type === "projet" && !projetsFocaux.has(n.projet?.id ?? "")) ||
        (n.type === "etape" && !projetsFocaux.has(executionParRun.get(n.etape?.runId ?? "") ?? "")) ||
        (n.type === "machine" && machineFocale !== null && n.roleMachine !== machineFocale)
      ),
    },
  }));
  const aretes: AreteFluide[] = [];
  const relier = (source: string, target: string, famille: "pc" | "nas" | "commande" | "etape", libelle: string, active: boolean, attenuee: boolean, attente = false) => {
    if (!noeuds.some((n) => n.id === source) || !noeuds.some((n) => n.id === target)) return;
    const couleur = attente ? "var(--color-givre)" : famille === "pc" ? "var(--color-pc)" : famille === "nas" ? "var(--color-nas)" : famille === "commande" ? "var(--color-accent)" : "var(--color-ok)";
    aretes.push({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: "sortie",
      targetHandle: "entree",
      type: source.startsWith("machine:") ? "machine" : "smoothstep",
      data: { famille },
      pathOptions: { borderRadius: 16, offset: famille === "etape" ? 20 : 34 },
      label: source === idOrchestrateur ? libelle : attente ? libelle : undefined,
      labelShowBg: true,
      labelBgPadding: [5, 3],
      className: `ao-flux ${famille} ${active ? "actif" : ""} ${aFocal && !attenuee ? "focal" : ""} ${attenuee ? "estompe" : ""} ${attente ? "attente" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: active ? 18 : 14, height: active ? 18 : 14, color: couleur },
      zIndex: active ? 1 : 0,
      style: { stroke: couleur, strokeWidth: active || aFocal && !attenuee ? 2.75 : 1.75, strokeDasharray: attente ? "2 5" : active ? "7 5" : undefined, opacity: attenuee ? 0.12 : 0.85 },
    });
  };
  const projetsParRole = (role: "pc" | "nas") => topologie.projets.filter((projet) => projet.aFiche && (/nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc") === role);
  const roleEnFocus = (role: "pc" | "nas") => !aFocal || machineFocale === role || projetsFocaux.size > 0 && projetsParRole(role).some((projet) => projetsFocaux.has(projet.id));
  for (const role of ["pc", "nas"] as const) {
    const projetsMachine = projetsParRole(role);
    const enCours = projetsMachine.some((projet) => projet.etat === "actif");
    relier(idOrchestrateur, idMachine(role), role, role === "pc" ? "worker" : "hôte NAS", enCours || (role === "pc" && topologie.machines.find((machine) => roleDeMachine(machine) === "pc" && (machine.etat === "busy" || machine.etat === "waking")) !== undefined), aFocal && !roleEnFocus(role));
  }
  for (const projet of topologie.projets.filter((entree) => entree.aFiche)) {
    const role = /nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc";
    const estFocal = !aFocal || projetsFocaux.has(projet.id);
    relier(idMachine(role), idProjet(projet.id), role, projet.pipelines[0] ?? "pipeline", projet.etat === "actif", aFocal && !estFocal);
    const execution = executions.donnees?.find((entree) => entree.projetId === projet.id);
    if (!execution) continue;
    const etapes = disposition.noeuds.filter((noeud) => noeud.type === "etape" && noeud.etape?.runId === execution.run.id);
    for (const etape of etapes) {
      const statut = etape.etape?.statut;
      const attente = statut === "waiting_approval" || statut === "waiting_quota" || statut === "waiting_auth" || statut === "waiting_freshness";
      const actif = statut === "running";
      const libelle = statut === "waiting_approval" ? "à valider" : statut === "waiting_quota" ? "quota" : statut === "waiting_auth" ? "connexion requise" : statut === "waiting_freshness" ? "base à synchroniser" : "étape clé";
      relier(idProjet(projet.id), etape.id, "etape", libelle, actif, aFocal && !estFocal, attente);
    }
  }

  useEffect(() => {
    if (!conteneur) return undefined;
    const observateur = new ResizeObserver(([entree]) => {
      if (entree) setZone({ largeur: entree.contentRect.width, hauteur: entree.contentRect.height });
    });
    observateur.observe(conteneur);
    return () => observateur.disconnect();
  }, [conteneur]);

  const bornes = getNodesBounds(noeuds);
  const bornesRef = useRef(bornes);
  bornesRef.current = bornes;
  const recadrer = useCallback(() => {
    if (!zone || !positionsParCle[cleStockage]) return;
    const bornes = bornesRef.current;
    if (compact) {
      // Sur téléphone, garder les libellés lisibles : cadrer la largeur et parcourir
      // le reste au doigt, au lieu de réduire tout l'arbre à la hauteur de l'écran.
      const zoom = Math.max(0.3, Math.min((zone.largeur - 32) / Math.max(1, bornes.width), ZOOM_MAX));
      void setViewport({ x: (zone.largeur - bornes.width * zoom) / 2 - bornes.x * zoom, y: 24 - bornes.y * zoom, zoom });
    } else {
      void setViewport(getViewportForBounds(bornes, zone.largeur, zone.hauteur, 0.3, ZOOM_MAX, 0.16));
    }
  }, [zone, setViewport, cleStockage, compact, Boolean(positionsParCle[cleStockage])]);
  // Ne pas perdre le déplacement ni le zoom de l'utilisateur à chaque événement SSE.
  const structure = disposition.noeuds.map((n) => n.id).join("|");
  useEffect(recadrer, [recadrer, structure, cleStockage]);
  const deplacer = (id: string, position: { x: number; y: number }, sauver: boolean) => {
    setPositionsParCle((precedentes) => {
      const suivantes = { ...(precedentes[cleStockage] ?? {}), [id]: position };
      if (sauver) ecrirePositions(cleStockage, suivantes);
      return { ...precedentes, [cleStockage]: suivantes };
    });
  };
  const reinitialiser = () => {
    ecrirePositions(cleStockage, {});
    setPositionsParCle((precedentes) => ({ ...precedentes, [cleStockage]: {} }));
    // Laisser React appliquer les coordonnées par défaut avant de mesurer le cadrage.
    requestAnimationFrame(recadrer);
  };

  return (
    <div ref={setConteneur} className="relative h-full w-full">
      <ReactFlow
        nodes={noeuds}
        edges={aretes}
        nodeTypes={TYPES_NOEUDS}
        edgeTypes={TYPES_ARETES}
        nodesDraggable
        onNodesChange={(changements) => {
          for (const changement of changements) if (changement.type === "position" && changement.position) deplacer(changement.id, changement.position, changement.dragging === false);
        }}
        onNodeDragStop={(_, noeud) => deplacer(noeud.id, noeud.position, true)}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.3}
        maxZoom={ZOOM_MAX}
        proOptions={{ hideAttribution: true }}
        onPaneClick={() => onSelection(null)}
      >
        <Background gap={24} size={1} color="var(--color-trait-fort)" />
      </ReactFlow>
      <div className="ao-graphe-outils"><button type="button" onClick={reinitialiser} aria-label="Réinitialiser la disposition"><span>Disposition initiale</span><b aria-hidden="true">↺</b></button><button type="button" onClick={recadrer} aria-label="Recentrer les flux"><Icone nom="graphe" taille={16} /><span>Recentrer</span></button></div>
    </div>
  );
}

export function Topologie({ selection, onSelection }: { selection: Selection | null; onSelection: (s: Selection | null) => void }) {
  const { donnees, erreur } = useCharge((source) => source.topologie(), []);
  if (erreur) return <Erreur>Liste des projets illisible : {erreur}</Erreur>;
  if (!donnees) return <p className="p-4 text-sm text-douce">Lecture des projets…</p>;
  const projets = donnees.projets.filter((projet) => projet.aFiche);

  return (
    <section className="ao-accueil">
      <header className="ao-accueil-tete">
        <div><span className="ao-accueil-kicker">Vue d’ensemble</span><h2>Chaque projet, son flux.</h2><p>Explore les machines, les projets et les étapes de leur dernier run.</p></div>
        <div className="ao-accueil-parcours" aria-label="Lecture des flux"><span>Pilotage</span><b aria-hidden="true">→</b><span>Machines</span><b aria-hidden="true">→</b><span>Projets</span><b aria-hidden="true">→</b><span>Étapes</span></div>
      </header>
      <Kpis />
      {donnees.anomalies.length > 0 && <div className="mb-2">{donnees.anomalies.map((anomalie) => <Erreur key={anomalie}>{anomalie}</Erreur>)}</div>}
      <div className="ao-canevas min-h-0 flex-1">
        <ReactFlowProvider>
          <Arbre topologie={donnees} selection={selection} onSelection={onSelection} />
        </ReactFlowProvider>
        <div className="ao-legende-graphe">
          <span>{projets.length} projet{projets.length === 1 ? "" : "s"}</span>
          <span><i className="pc" />PC</span>
          <span><i className="nas" />NAS</span>
          <span><i className="etape" />étapes</span>
          <span><i className="wait" />décision en attente</span>
          <span><i className="run" />étape en cours</span>
        </div>
      </div>
      <footer className="ao-accueil-note"><Icone nom="ouvrir" taille={13} /><span><span className="ao-accueil-mobile-note">Glisse pour explorer. </span>Déplace les cellules pour les espacer. Clique pour déplier ou replier ; une étape ouvre son détail.</span></footer>
    </section>
  );
}
