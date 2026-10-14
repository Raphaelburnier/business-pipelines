// Graphe d'accueil : infrastructure réelle, projets enregistrés et quelques étapes-clés
// du dernier run. Les outils restent dans la fiche du projet, jamais en cellules du graphe.
import type { EtapeAvecOutils, Machine, ProjetTopologie, RunDetailleAvecOutils, StatutEtape, Topologie } from "../types";

export type TypeNoeud = "machine" | "orchestrateur" | "projet" | "etape";

export interface EtapeImportante {
  id: string;
  nom: string;
  detail: string;
  statut: StatutEtape;
  tour: number;
  runId: string;
}

export interface ExecutionProjet {
  projetId: string;
  run: RunDetailleAvecOutils;
}

export type NoeudDispose = {
  id: string;
  type: TypeNoeud;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
  projet?: ProjetTopologie;
  machine?: Machine | null;
  roleMachine?: "pc" | "nas";
  etat?: Machine["etat"];
  sousTitre?: string;
  maitre?: Topologie["maitre"];
  etape?: EtapeImportante;
  selectionne?: boolean;
}

export interface Disposition {
  noeuds: NoeudDispose[];
  largeur: number;
  hauteur: number;
}

const MARGE = 40;
const LARGEUR_GROUPE = 344;
const ECART_GROUPE = 80;
const LARGEUR_PROJET = 344;
const HAUTEUR_PROJET = 96;
const LARGEUR_ETAPE = 192;
const HAUTEUR_ETAPE = 64;
const ECART_ETAPE_Y = 12;

export const idMachine = (role: string) => `machine:${role}`;
export const idOrchestrateur = "orchestrateur:nas";
export const idProjet = (id: string) => `projet:${id}`;
export const idEtape = (runId: string, etapeId: string) => `etape:${runId}:${etapeId}`;

/** Reconnaît les noms de machine utilisés par le worker et le Synology. */
export function roleDeMachine(machine: Machine): "pc" | "nas" | null {
  const meta = Object.values(machine.meta ?? {}).filter((valeur): valeur is string => typeof valeur === "string").join(" ");
  const nom = `${machine.machine} ${machine.nom ?? ""} ${meta}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bnas\b|synology|\bdsm\b/.test(nom)) return "nas";
  if (/\bpc\b|destrobimobile|windows|workerpc/.test(nom)) return "pc";
  return null;
}

function etapesImportantes(run: RunDetailleAvecOutils): EtapeImportante[] {
  const parNom = new Map<string, EtapeAvecOutils>();
  for (const etape of run.etapes) {
    const precedente = parNom.get(etape.noeud);
    if (!precedente || Date.parse(etape.debut ?? "") >= Date.parse(precedente.debut ?? "")) parNom.set(etape.noeud, etape);
  }

  const etapes = [...parNom.values()].sort((a, b) => Date.parse(a.debut ?? "") - Date.parse(b.debut ?? "")).map((etape) => ({
    id: etape.id,
    nom: etape.noeud,
    detail: etape.agent ? `agent · ${etape.agent}` : etape.type,
    statut: etape.statut,
    tour: etape.tour,
    runId: run.id,
  } satisfies EtapeImportante));
  const validations = run.approbations.map((approbation) => ({
    id: `approbation-${approbation.id}`,
    nom: approbation.noeud,
    detail: "décision humaine",
    statut: "waiting_approval" as const,
    tour: 0,
    runId: run.id,
  }));
  const candidats = [...etapes, ...validations];
  if (!candidats.length) return [];

  const debut = etapes[0];
  const fin = etapes.at(-1);
  const score = (etape: EtapeImportante) => {
    if (etape.detail === "décision humaine") return 120;
    if (etape.statut === "running" || etape.statut === "failed" || etape.statut.startsWith("waiting")) return 110;
    const originale = parNom.get(etape.nom);
    if (originale?.outcome || /approb|gate|couverture|validation|review|test/i.test(etape.nom)) return 90;
    if (etape.id === fin?.id) return 80;
    if (etape.id === debut?.id) return 70;
    if (originale?.agent) return 60;
    return 10;
  };
  return candidats
    .sort((a, b) => score(b) - score(a) || Date.parse(a.detail === "décision humaine" ? run.debut ?? "" : parNom.get(a.nom)?.debut ?? "") - Date.parse(b.detail === "décision humaine" ? run.debut ?? "" : parNom.get(b.nom)?.debut ?? ""))
    .slice(0, 4)
    .sort((a, b) => Date.parse(parNom.get(a.nom)?.debut ?? "") - Date.parse(parNom.get(b.nom)?.debut ?? ""));
}

/** Arbre vertical : orchestrateur → machines → projets → étapes du dernier run. */
export function disposer(topologie: Topologie, executions: ExecutionProjet[] = [], compact = false): Disposition {
  const projets = topologie.projets.filter((projet) => projet.aFiche).slice().sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const executionParProjet = new Map(executions.map((execution) => [execution.projetId, execution.run]));
  const machinesParRole = new Map<"pc" | "nas", Machine>();
  for (const machine of topologie.machines) {
    const role = roleDeMachine(machine);
    if (role) machinesParRole.set(role, machine);
  }

  const noeuds: NoeudDispose[] = [];
  const noeudMachine = (role: "pc" | "nas", x: number, y: number) => {
    const machine = machinesParRole.get(role) ?? null;
    const etat = machine?.etat ?? (role === "nas" ? topologie.maitre.etat : undefined);
    noeuds.push({
      id: idMachine(role), type: "machine", x, y, largeur: compact ? 156 : 192, hauteur: 78,
      machine, roleMachine: role, etat,
      sousTitre: machine ? (role === "pc" ? "worker" : "Synology") : role === "nas" ? "hôte du cockpit" : "non observé",
    });
  };

  const xPc = MARGE;
  const xNas = MARGE + LARGEUR_GROUPE + ECART_GROUPE;
  const yMachine = 156;
  const yProjet = 302;
  const centrePc = compact ? MARGE + 78 : xPc + LARGEUR_GROUPE / 2;
  const centreNas = compact ? MARGE + LARGEUR_GROUPE - 78 : xNas + LARGEUR_GROUPE / 2;
  const centreOrchestrateur = (centrePc + centreNas) / 2;

  noeuds.push({
    id: idOrchestrateur, type: "orchestrateur", x: centreOrchestrateur - 96, y: 24, largeur: 192, hauteur: 78,
    maitre: topologie.maitre, sousTitre: topologie.maitre.nom,
  });
  noeudMachine("pc", centrePc - (compact ? 78 : 96), yMachine);
  noeudMachine("nas", centreNas - (compact ? 78 : 96), yMachine);

  const prochainY = new Map<"pc" | "nas", number>([["pc", yProjet], ["nas", yProjet]]);
  let hauteurProjets = 0;
  for (const projet of projets) {
    const role = /nas|synology|dsm/i.test(projet.homeMachine) ? "nas" : "pc";
    const colonne = role === "pc" ? 0 : 1;
    const execution = executionParProjet.get(projet.id);
    const jalons = execution ? etapesImportantes(execution) : [];
    const x = compact ? MARGE : colonne === 0 ? xPc : xNas;
    const y = compact ? Math.max(yProjet, hauteurProjets + 64) : prochainY.get(role)!;
    noeuds.push({ id: idProjet(projet.id), type: "projet", x, y, largeur: LARGEUR_PROJET, hauteur: HAUTEUR_PROJET, projet });
    jalons.forEach((etape, i) => {
      noeuds.push({
        id: idEtape(etape.runId, etape.id), type: "etape",
        x: x + LARGEUR_PROJET - LARGEUR_ETAPE,
        y: y + HAUTEUR_PROJET + 28 + i * (HAUTEUR_ETAPE + ECART_ETAPE_Y),
        largeur: LARGEUR_ETAPE, hauteur: HAUTEUR_ETAPE, etape,
      });
    });
    const bas = y + HAUTEUR_PROJET + (jalons.length ? jalons.length * (HAUTEUR_ETAPE + ECART_ETAPE_Y) + 28 : 0);
    prochainY.set(role, bas + 64);
    hauteurProjets = Math.max(hauteurProjets, bas);
  }

  const largeurProjets = compact ? LARGEUR_GROUPE : 2 * LARGEUR_GROUPE + ECART_GROUPE;
  return {
    noeuds,
    largeur: MARGE * 2 + largeurProjets,
    hauteur: Math.max(220, projets.length ? hauteurProjets + MARGE : yMachine + 78 + MARGE),
  };
}
