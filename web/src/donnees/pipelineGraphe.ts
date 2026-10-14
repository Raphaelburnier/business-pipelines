// Le graphe d'un run pour la page Pipelines : qui a passé quoi à qui.
//
// Rien n'est inventé : la chaîne de travail suit l'ordre réel des étapes (deux étapes qui se
// chevauchent partagent un rang), un nœud qui repasse dessine un retour, les approbations sont
// les points de validation, les participants de mission pas encore lancés sont « à venir », et
// la sortie est la livraison du run. La colonne contexte liste les outils de lecture (vault,
// MCP, web) réellement vus dans les événements des étapes.
import type { EtapeAvecOutils, RunDetailleAvecOutils, StatutEtape, StatutRun } from "../types";

export type EtatNoeud = "done" | "run" | "wait" | "err" | "pending";
export type GenreNoeud = "input" | "agent" | "script" | "gate" | "output" | "ctx";
export type GenreLien = "work" | "ctx" | "loop";

export interface NoeudPipeline {
  id: string;
  genre: GenreNoeud;
  titre: string;
  sousTitre: string;
  etat: EtatNoeud;
  /** Rang dans la chaîne de travail ; la colonne contexte reprend le rang de sa première cible. */
  rang: number;
  /** Membre de l'équipe qui tient l'étape, pour son portrait. */
  membre: string | null;
  modele: string | null;
  tentatives: EtapeAvecOutils[];
  approbation: { id: string; question: string | null; motif: string; statut: string } | null;
}

export interface LienPipeline {
  de: string;
  vers: string;
  genre: GenreLien;
  etat: EtatNoeud;
  quoi: string;
  jetons: number | null;
  le: string | null;
}

export interface GraphePipeline {
  noeuds: NoeudPipeline[];
  liens: LienPipeline[];
  rangs: number;
}

const OUTIL_CONTEXTE = /vault|mcp__|web|search|fetch|recherche/i;
const MAX_CONTEXTE = 6;

export function etatEtape(statut: StatutEtape): EtatNoeud {
  if (statut === "succeeded") return "done";
  if (statut === "running") return "run";
  if (statut === "failed" || statut === "cancelled") return "err";
  return "wait";
}

const debutDe = (e: EtapeAvecOutils) => (e.debut ? Date.parse(e.debut) : Number.POSITIVE_INFINITY);
const finDe = (e: EtapeAvecOutils) => (e.fin ? Date.parse(e.fin) : Number.POSITIVE_INFINITY);

function etatSortie(run: RunDetailleAvecOutils): EtatNoeud {
  const livraison = run.livraison;
  if (livraison) {
    if (livraison.statut === "merged") return "done";
    if (livraison.statut === "failed") return "err";
    return livraison.statut === "merge_blocked" ? "wait" : "run";
  }
  if (run.statut === "succeeded") return "done";
  if (run.statut === "failed" || run.statut === "cancelled") return "err";
  return "pending";
}

function sousTitreSortie(run: RunDetailleAvecOutils): string {
  const l = run.livraison;
  if (!l) return { succeeded: "run terminé", failed: "run échoué", cancelled: "run arrêté" }[run.statut as string] ?? "à venir";
  const pr = l.pr ? `PR #${l.pr}` : l.branche;
  const mots: Record<typeof l.statut, string> = {
    pending: "en préparation",
    pr_open: "PR ouverte",
    ci_running: "CI en cours",
    merge_blocked: "fusion bloquée",
    merged: "fusionnée",
    failed: "échouée",
  };
  return `${pr} · ${mots[l.statut]}`;
}

/** Ce que transmet une étape : son verdict s'il existe, sinon ses jetons de sortie. */
function quoiDe(e: EtapeAvecOutils | undefined): string {
  if (!e) return "";
  if (e.outcome) return e.outcome;
  if (e.statut === "running") return "en cours";
  return e.tokens.sortie > 0 ? "sortie" : "résultat";
}

export function construireGraphe(run: RunDetailleAvecOutils): GraphePipeline {
  const participants = new Map((run.mission?.participants ?? []).map((p) => [p.noeud, p]));
  const etapes = [...run.etapes].sort((a, b) => debutDe(a) - debutDe(b));

  // Une entrée par nœud, dans l'ordre de première apparition ; ses tentatives à la suite.
  const parNoeud = new Map<string, EtapeAvecOutils[]>();
  for (const e of etapes) parNoeud.set(e.noeud, [...(parNoeud.get(e.noeud) ?? []), e]);

  // Deux étapes qui démarrent avant la fin du rang courant tournent en parallèle.
  const rangDe = new Map<string, number>();
  let rang = 1;
  let finRang = Number.NEGATIVE_INFINITY;
  let premierDuRang = true;
  for (const [noeud, tentatives] of parNoeud) {
    const premiere = tentatives[0]!;
    if (!premierDuRang && debutDe(premiere) >= finRang) {
      rang += 1;
      finRang = Number.NEGATIVE_INFINITY;
    }
    rangDe.set(noeud, rang);
    finRang = Math.max(finRang, finDe(premiere));
    premierDuRang = false;
  }

  const noeuds: NoeudPipeline[] = [];
  const objectif = run.mission?.objectif;
  noeuds.push({
    id: "entree",
    genre: "input",
    titre: run.mission ? "Mission" : "Déclencheur",
    sousTitre: objectif ? (objectif.length > 48 ? `${objectif.slice(0, 47)}…` : objectif) : run.declencheur ?? "manuel",
    etat: "done",
    rang: 0,
    membre: null,
    modele: null,
    tentatives: [],
    approbation: null,
  });

  const approbations = new Map(run.approbations.map((a) => [a.noeud, a]));
  for (const [noeud, tentatives] of parNoeud) {
    const derniere = tentatives[tentatives.length - 1]!;
    const approbation = approbations.get(noeud);
    const participant = participants.get(noeud);
    const genre: GenreNoeud = approbation || derniere.type === "approval" ? "gate" : derniere.agent || derniere.llm ? "agent" : "script";
    noeuds.push({
      id: noeud,
      genre,
      titre: participant?.nom ?? noeud,
      sousTitre: genre === "gate" ? approbation?.motif ?? "validation" : derniere.agent ?? `${derniere.type} · ${derniere.machine ?? "machine n/d"}`,
      etat: etatEtape(derniere.statut),
      rang: rangDe.get(noeud)!,
      membre: participant?.membre ?? null,
      modele: derniere.llm?.model ?? null,
      tentatives,
      approbation: approbation ? { id: approbation.id, question: approbation.question, motif: approbation.motif, statut: approbation.statut } : null,
    });
  }

  // Les approbations ouvertes sur un nœud sans étape, puis les participants pas encore lancés.
  for (const a of run.approbations) {
    if (parNoeud.has(a.noeud)) continue;
    rang += 1;
    noeuds.push({
      id: a.noeud,
      genre: "gate",
      titre: "Validation",
      sousTitre: a.motif,
      etat: a.statut === "pending" ? "wait" : "done",
      rang,
      membre: null,
      modele: null,
      tentatives: [],
      approbation: { id: a.id, question: a.question, motif: a.motif, statut: a.statut },
    });
  }
  const fini = ["succeeded", "failed", "cancelled"].includes(run.statut);
  if (!fini) {
    for (const p of run.mission?.participants ?? []) {
      if (parNoeud.has(p.noeud) || approbations.has(p.noeud)) continue;
      rang += 1;
      noeuds.push({
        id: p.noeud,
        genre: "agent",
        titre: p.nom,
        sousTitre: p.agent,
        etat: "pending",
        rang,
        membre: p.membre,
        modele: p.llm.model,
        tentatives: [],
        approbation: null,
      });
    }
  }

  const derniersRang = rang + 1;
  noeuds.push({
    id: "sortie",
    genre: "output",
    titre: run.livraison?.depot ?? run.projet ?? run.pipeline,
    sousTitre: sousTitreSortie(run),
    etat: etatSortie(run),
    rang: derniersRang,
    membre: null,
    modele: null,
    tentatives: [],
    approbation: null,
  });

  const liens: LienPipeline[] = [];
  const parRang = new Map<number, NoeudPipeline[]>();
  for (const n of noeuds) parRang.set(n.rang, [...(parRang.get(n.rang) ?? []), n]);
  for (let r = 0; r < derniersRang; r += 1) {
    const sources = parRang.get(r) ?? [];
    const cibles = parRang.get(r + 1) ?? [];
    for (const a of sources) {
      for (const b of cibles) {
        const derniere = a.tentatives[a.tentatives.length - 1];
        liens.push({
          de: a.id,
          vers: b.id,
          genre: "work",
          etat: etatLien(a, b),
          quoi: a.genre === "input" ? (run.mission ? "objectif et critères" : "déclenchement") : a.genre === "gate" ? (a.etat === "done" ? "feu vert" : "attend ta décision") : quoiDe(derniere),
          jetons: derniere ? derniere.tokens.sortie : null,
          le: derniere?.fin ?? (a.genre === "input" ? run.debut : null),
        });
      }
    }
  }

  // Un nœud qui repasse : le retour part de l'étape qui l'a précédé dans le temps.
  const vus = new Set<string>();
  for (let i = 1; i < etapes.length; i += 1) {
    const e = etapes[i]!;
    const avant = etapes[i - 1]!;
    if (e.tour === 0 || avant.noeud === e.noeud || rangDe.get(e.noeud)! > rangDe.get(avant.noeud)!) continue;
    const cle = `${avant.noeud}>${e.noeud}`;
    if (vus.has(cle)) continue;
    vus.add(cle);
    liens.push({ de: avant.noeud, vers: e.noeud, genre: "loop", etat: "done", quoi: quoiDe(avant), jetons: avant.tokens.sortie, le: avant.fin });
  }

  // La colonne contexte : chaque outil de lecture relié aux étapes qui l'ont appelé.
  const contexte = new Map<string, NoeudPipeline[]>();
  for (const n of noeuds) {
    for (const outil of new Set(n.tentatives.flatMap((t) => t.outils))) {
      if (OUTIL_CONTEXTE.test(outil)) contexte.set(outil, [...(contexte.get(outil) ?? []), n]);
    }
  }
  for (const [outil, cibles] of [...contexte].slice(0, MAX_CONTEXTE)) {
    const id = `ctx:${outil}`;
    noeuds.push({
      id,
      genre: "ctx",
      titre: outil.replace(/^mcp__/, "").replace(/__/g, " · "),
      sousTitre: `${cibles.length} étape${cibles.length > 1 ? "s" : ""}`,
      etat: cibles.some((c) => c.etat === "run") ? "run" : "done",
      rang: cibles[0]!.rang,
      membre: null,
      modele: null,
      tentatives: [],
      approbation: null,
    });
    for (const c of cibles) liens.push({ de: id, vers: c.id, genre: "ctx", etat: c.etat === "run" ? "run" : "done", quoi: "lecture", jetons: null, le: null });
  }

  return { noeuds, liens, rangs: derniersRang + 1 };
}

function etatLien(a: NoeudPipeline, b: NoeudPipeline): EtatNoeud {
  if (b.etat === "run") return "run";
  if (b.etat === "wait" || (a.genre === "gate" && a.etat === "wait")) return "wait";
  if (b.etat === "done" || b.etat === "err") return "done";
  return "pending";
}

/** Les runs à montrer d'abord : ceux qui tournent ou attendent, puis les plus récents. */
export function trierRuns<T extends { statut: StatutRun; debut: string | null }>(runs: T[]): T[] {
  const poids = (s: StatutRun) => (s === "running" || s === "queued" ? 0 : s.startsWith("waiting") || s === "paused" ? 1 : 2);
  return [...runs].sort((a, b) => poids(a.statut) - poids(b.statut) || (b.debut ?? "").localeCompare(a.debut ?? ""));
}

/** Le pipeline sous forme JSON : la base d'un futur éditeur visuel et JSON synchronisés. */
export function grapheJson(run: RunDetailleAvecOutils, graphe: GraphePipeline): string {
  return JSON.stringify(
    {
      run: run.id,
      projet: run.projet,
      pipeline: run.pipeline,
      etapes: graphe.noeuds
        .filter((n) => n.genre !== "ctx")
        .map((n) => ({ rang: n.rang, noeud: n.id, genre: n.genre, ...(n.modele ? { modele: n.modele } : {}), etat: n.etat })),
      contexte: graphe.liens.filter((l) => l.genre === "ctx").map((l) => ({ de: l.de.replace(/^ctx:/, ""), vers: l.vers })),
      retours: graphe.liens.filter((l) => l.genre === "loop").map((l) => ({ de: l.de, vers: l.vers, quoi: l.quoi })),
    },
    null,
    2
  );
}
