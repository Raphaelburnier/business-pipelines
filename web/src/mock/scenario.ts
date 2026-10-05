// Les fixtures de la maquette (annexe A), et le run rejoué en une trentaine de secondes.
//
// Elles sont volontairement tordues : ce sont les cas où une implémentation naïve casse.
// - Deux machines, dont le PC en veille au départ : il faut le voir se réveiller.
// - Deux projets enregistrés sur des machines différentes, dont un sans run rejoué.
// - Un projet sans aucun run, un run ad hoc terminé, un run en `waiting_quota`, un run en
//   échec, un run en pause.
// - Le run rejoué fait tout ce que fait un vrai run marketing : deux agents en parallèle,
//   une boucle de correction (tour 2), puis une approbation qui l'arrête.
//
// L'état est une FONCTION du temps écoulé : `etatA(t)` rend toujours la même chose pour le
// même t. La maquette s'anime en faisant avancer t, et les tests interrogent n'importe quel
// instant sans minuteur.
import type { Approbation, Etape, Evenement, Machine, ProjetTopologie, Run, RunDetaille, Topologie, Usage } from "../types";

/** Durée d'un cycle de la maquette : le run rejoué, puis une pause avant de recommencer. */
export const DUREE_CYCLE_S = 42;
const FIN_RUN_S = 29;

interface EtapeScenario {
  id: string;
  noeud: string;
  type: "agent" | "script" | "approval";
  agent: string | null;
  machine: "pc" | "nas";
  llm: { via: string; model: string } | null;
  debut: number;
  fin: number;
  tour: number;
  cout: number;
  tokens: [number, number];
  outcome: string | null;
}

// Le run marketing rejoué. `economie` et `marque` se chevauchent : c'est le parallélisme que
// la timeline doit montrer. `synthese` repasse au tour 2 après une couverture incomplète.
const RUN_REJOUE: EtapeScenario[] = [
  { id: "consigne", noeud: "consigne", type: "script", agent: null, machine: "nas", llm: null, debut: 0, fin: 3, tour: 0, cout: 0, tokens: [0, 0], outcome: null },
  { id: "economie", noeud: "economie", type: "agent", agent: "economy-analyst@1", machine: "pc", llm: { via: "claude", model: "sonnet" }, debut: 3, fin: 12, tour: 0, cout: 0.37, tokens: [5100, 1200], outcome: null },
  { id: "marque", noeud: "marque", type: "agent", agent: "brand-analyst@1", machine: "pc", llm: { via: "claude", model: "sonnet" }, debut: 3, fin: 13, tour: 0, cout: 0.33, tokens: [4800, 1100], outcome: null },
  { id: "synthese", noeud: "synthese", type: "agent", agent: "plan-synthesist@1", machine: "pc", llm: { via: "claude", model: "opus" }, debut: 13, fin: 20, tour: 0, cout: 0.51, tokens: [7300, 2100], outcome: null },
  { id: "couverture", noeud: "couverture", type: "script", agent: null, machine: "nas", llm: null, debut: 20, fin: 22, tour: 0, cout: 0, tokens: [0, 0], outcome: "INCOMPLETE" },
  { id: "synthese-t2", noeud: "synthese", type: "agent", agent: "plan-synthesist@1", machine: "pc", llm: { via: "claude", model: "opus" }, debut: 22, fin: 27, tour: 1, cout: 0.29, tokens: [6100, 1400], outcome: null },
  { id: "couverture-t2", noeud: "couverture", type: "script", agent: null, machine: "nas", llm: null, debut: 27, fin: 29, tour: 1, cout: 0, tokens: [0, 0], outcome: "COMPLETE" },
];

const iso = (ms: number): string => new Date(ms).toISOString();

// ---------- runs figés ----------

function etapeFigee(partiel: Partial<Etape> & Pick<Etape, "id" | "noeud" | "statut">, debutMs: number, dureeMs: number): Etape {
  return {
    type: "agent",
    agent: null,
    machine: "pc",
    llm: null,
    session: null,
    tour: 0,
    checkpoint: null,
    debut: iso(debutMs),
    fin: partiel.statut === "running" || partiel.statut.startsWith("waiting") ? null : iso(debutMs + dureeMs),
    coutEquivalentUsd: 0,
    tokens: { entree: 0, sortie: 0 },
    outcome: null,
    ...partiel,
  };
}

function runFige(t0: number): RunDetaille[] {
  const h = 3600 * 1000;
  return [
    {
      id: "run-adhoc",
      projet: "storia",
      pipeline: "adhoc:content-writer@1",
      statut: "succeeded",
      vivant: false,
      debut: iso(t0 - 5 * h),
      fin: iso(t0 - 5 * h + 4 * 60 * 1000),
      coutEquivalentUsd: 0.18,
      coutReelUsd: 0,
      declencheur: "adhoc",
      etapes: [
        etapeFigee(
          { id: "adhoc-1", noeud: "consigne", statut: "succeeded", agent: "content-writer@1", llm: { via: "claude", model: "sonnet" }, coutEquivalentUsd: 0.18, tokens: { entree: 3200, sortie: 900 } },
          t0 - 5 * h,
          4 * 60 * 1000
        ),
      ],
      approbations: [],
      dernierEvenementId: 0,
    },
    {
      id: "run-quota",
      projet: "otp-relay",
      pipeline: "saas-build@3",
      statut: "waiting_quota",
      vivant: true,
      debut: iso(t0 - 2 * h),
      fin: null,
      coutEquivalentUsd: 1.12,
      coutReelUsd: 0,
      declencheur: "cockpit",
      etapes: [
        etapeFigee({ id: "quota-1", noeud: "collect", statut: "succeeded", type: "script" }, t0 - 2 * h, 40 * 1000),
        etapeFigee(
          { id: "quota-2", noeud: "code", statut: "waiting_quota", agent: "coder@2", llm: { via: "claude", model: "sonnet" }, session: "s-quota", coutEquivalentUsd: 1.12, tokens: { entree: 41000, sortie: 9800 } },
          t0 - 2 * h + 60 * 1000,
          0
        ),
      ],
      approbations: [],
      dernierEvenementId: 0,
    },
    {
      id: "run-echec",
      projet: "tcg-generator",
      pipeline: "saas-build@2",
      statut: "failed",
      vivant: false,
      debut: iso(t0 - 26 * h),
      fin: iso(t0 - 25 * h),
      coutEquivalentUsd: 2.4,
      coutReelUsd: 0,
      declencheur: "cli",
      etapes: [
        etapeFigee({ id: "echec-1", noeud: "code", statut: "succeeded", agent: "coder@2", llm: { via: "claude", model: "sonnet" }, coutEquivalentUsd: 1.9, tokens: { entree: 52000, sortie: 14000 } }, t0 - 26 * h, 40 * 60 * 1000),
        etapeFigee({ id: "echec-2", noeud: "review", statut: "failed", agent: "code-reviewer@2", llm: { via: "omniroute", model: "gemini-flash-lite-latest" }, coutEquivalentUsd: 0.5, tokens: { entree: 18000, sortie: 2100 } }, t0 - 25.3 * h, 12 * 60 * 1000),
      ],
      approbations: [],
      dernierEvenementId: 0,
    },
    {
      id: "run-pause",
      projet: "backups",
      pipeline: "sauvegarde@1",
      statut: "paused",
      vivant: true,
      debut: iso(t0 - 1 * h),
      fin: null,
      coutEquivalentUsd: 0,
      coutReelUsd: 0,
      declencheur: "cron",
      etapes: [etapeFigee({ id: "pause-1", noeud: "collecte", statut: "succeeded", type: "script", machine: "nas" }, t0 - 1 * h, 2 * 60 * 1000)],
      approbations: [],
      dernierEvenementId: 0,
    },
  ];
}

// ---------- le run rejoué ----------

function etapesAt(t: number, debutRunMs: number): Etape[] {
  return RUN_REJOUE.filter((e) => t >= e.debut).map((e) => {
    const fini = t >= e.fin;
    return {
      id: e.id,
      noeud: e.noeud,
      type: e.type,
      agent: e.agent,
      machine: e.machine,
      statut: fini ? "succeeded" : "running",
      llm: e.llm,
      session: e.type === "agent" ? `s-${e.id}` : null,
      tour: e.tour,
      checkpoint: fini ? `c0ffee${e.id.length}${e.tour}a1b2c3d4` : null,
      debut: iso(debutRunMs + e.debut * 1000),
      fin: fini ? iso(debutRunMs + e.fin * 1000) : null,
      // Un agent en cours a déjà consommé une part : le coût monte pendant qu'il tourne.
      coutEquivalentUsd: fini ? e.cout : Number(((e.cout * (t - e.debut)) / (e.fin - e.debut)).toFixed(2)),
      tokens: fini ? { entree: e.tokens[0], sortie: e.tokens[1] } : { entree: Math.round((e.tokens[0] * (t - e.debut)) / (e.fin - e.debut)), sortie: 0 },
      outcome: fini ? e.outcome : null,
    };
  });
}

function approbationAt(t: number, debutRunMs: number): Approbation[] {
  if (t < FIN_RUN_S) return [];
  return [
    {
      id: "approbation-vitrine",
      noeud: "approbation",
      motif: "decision",
      statut: "pending",
      ouverteLe: iso(debutRunMs + FIN_RUN_S * 1000),
      question: "Publier la vitrine « decks de démarrage » ?",
      actions: 3,
    },
  ];
}

function etatPc(t: number): Machine["etat"] {
  if (t < 1) return "sleeping";
  if (t < 3) return "waking";
  if (t < 27) return "busy";
  if (t < 36) return "online";
  return "sleeping";
}

export interface EtatMaquette {
  runs: RunDetaille[];
  topologie: Topologie;
  usage: Usage;
  evenements: Evenement[];
}

/**
 * L'état complet de la maquette au temps `ms` écoulé depuis `t0`.
 * @param t0 instant de départ de la maquette (ms)
 * @param ecoule temps écoulé depuis t0 (ms)
 */
export function etatA(t0: number, ecoule: number): EtatMaquette {
  const cycle = Math.floor(ecoule / (DUREE_CYCLE_S * 1000));
  const t = (ecoule % (DUREE_CYCLE_S * 1000)) / 1000;
  const debutRunMs = t0 + cycle * DUREE_CYCLE_S * 1000;
  const maintenant = t0 + ecoule;

  const etapes = etapesAt(t, debutRunMs);
  const approbations = approbationAt(t, debutRunMs);
  const statutRejoue = t < FIN_RUN_S ? "running" : "waiting_approval";
  const rejoue: RunDetaille = {
    id: `run-rejoue-${cycle + 1}`,
    projet: "marketing",
    pipeline: "marketing@1",
    statut: statutRejoue,
    vivant: true,
    debut: iso(debutRunMs),
    fin: null,
    coutEquivalentUsd: Number(etapes.reduce((n, e) => n + e.coutEquivalentUsd, 0).toFixed(2)),
    coutReelUsd: 0,
    declencheur: "cockpit",
    etapes,
    approbations,
    dernierEvenementId: 0,
  };
  const runs = [rejoue, ...runFige(t0)];

  const machines: Machine[] = [
    { machine: "nas", nom: "NAS", etat: "online", dernierHeartbeat: iso(maintenant - 4000), depuisSecondes: 4, meta: null },
    {
      machine: "pc",
      nom: "PC homelab",
      etat: etatPc(t),
      dernierHeartbeat: etatPc(t) === "sleeping" ? iso(debutRunMs - 60 * 60 * 1000) : iso(maintenant - 2000),
      depuisSecondes: etatPc(t) === "sleeping" ? 3600 : 2,
      meta: { mac: "aa:bb:cc:dd:ee:ff" },
    },
  ];

  const dernier = (id: string) => {
    const r = runs.find((x) => x.id === id);
    return r ? { id: r.id, statut: r.statut, debut: r.debut } : null;
  };
  const projets: ProjetTopologie[] = [
    { id: "marketing", nom: "Plan marketing", categorie: "marketing", homeMachine: "pc", machines: ["pc"], pipelines: ["marketing@1"], etat: statutRejoue === "running" ? "actif" : "attente", aFiche: true, url: null, dernierRun: dernier(rejoue.id), approbationsEnAttente: approbations.length },
    { id: "steam-tierlist", nom: "Steam TierList", categorie: "outils-perso", homeMachine: "nas", machines: ["nas"], pipelines: ["improve-app@4"], etat: "inactif", aFiche: true, url: "/steam/", dernierRun: null, approbationsEnAttente: 0 },
  ];

  const topologie: Topologie = {
    maitre: { nom: "maître", etat: "online" },
    machines,
    categories: ["marketing", "outils-perso"].map((c) => ({ id: c, nom: c })),
    projets,
    anomalies: [],
  };

  const vivants = runs.filter((r) => r.vivant);
  const usage: Usage = {
    runsActifs: vivants.length,
    coutEquivalentJourUsd: Number((rejoue.coutEquivalentUsd + 0.18 + 1.12).toFixed(2)),
    coutEquivalentMoisUsd: Number((rejoue.coutEquivalentUsd + 0.18 + 1.12 + 2.4 + 31.7).toFixed(2)),
    quota: {
      cinqHeures: { utilisation: Math.min(100, 58 + Math.round(t / 3)), reinitialisation: iso(t0 + 2 * 3600 * 1000) },
      septJours: { utilisation: 31, reinitialisation: iso(t0 + 4 * 24 * 3600 * 1000) },
    },
  };

  return { runs, topologie, usage, evenements: evenementsJusqua(t0, ecoule) };
}

// ---------- le flux ----------

interface Jalon {
  t: number;
  type: string;
  etape: string | null;
  machine: string | null;
  payload: Record<string, unknown>;
}

// Les jalons d'un cycle, dans l'ordre du temps : ce que le flux raconte.
function jalons(): Jalon[] {
  const liste: Jalon[] = [
    { t: 0, type: "run.started", etape: null, machine: null, payload: { projet: "marketing", pipeline: "marketing@1" } },
    { t: 1, type: "machine.state_changed", etape: null, machine: "pc", payload: { machine: "pc", de: "sleeping", vers: "waking", raison: "réveil pour une étape" } },
    { t: 3, type: "machine.state_changed", etape: null, machine: "pc", payload: { machine: "pc", de: "waking", vers: "busy" } },
    { t: 21.5, type: "cycle.loop", etape: null, machine: null, payload: { cycle: "correction", from: "couverture", to: "synthese", tour: 1, maxLoops: 1 } },
    { t: FIN_RUN_S, type: "approval.opened", etape: null, machine: null, payload: { node: "approbation", reason: "decision" } },
    { t: 36, type: "machine.state_changed", etape: null, machine: "pc", payload: { machine: "pc", de: "online", vers: "sleeping", raison: "veille accordée" } },
  ];
  for (const e of RUN_REJOUE) {
    liste.push({ t: e.debut, type: "step.started", etape: e.id, machine: e.machine, payload: { node: e.noeud, agent: e.agent } });
    if (e.type === "agent") {
      for (let s = e.debut + 2; s < e.fin; s += 2) {
        liste.push({ t: s, type: "step.progress", etape: e.id, machine: e.machine, payload: { outils: ["Read", "Write"], texte: `${e.noeud} : lot ${Math.round((s - e.debut) / 2)} traité` } });
      }
    }
    liste.push({ t: e.fin, type: "step.finished", etape: e.id, machine: e.machine, payload: { node: e.noeud, costUsd: e.cout, outcome: e.outcome } });
  }
  return liste.sort((a, b) => a.t - b.t);
}

const JALONS = jalons();

/**
 * Tous les événements émis entre t0 et t0 + ecoule, identifiants croissants d'un cycle à
 * l'autre (comme la base) : une reconnexion qui repart d'un id reprend au bon endroit.
 */
export function evenementsJusqua(t0: number, ecoule: number): Evenement[] {
  const evenements: Evenement[] = [];
  const cycles = Math.floor(ecoule / (DUREE_CYCLE_S * 1000));
  let id = 0;
  for (let c = 0; c <= cycles; c += 1) {
    const debut = t0 + c * DUREE_CYCLE_S * 1000;
    for (const j of JALONS) {
      id += 1;
      const at = debut + j.t * 1000;
      if (at > t0 + ecoule) continue;
      evenements.push({ id, at: iso(at), type: j.type, run: j.type.startsWith("machine.") ? null : `run-rejoue-${c + 1}`, etape: j.etape, machine: j.machine, payload: j.payload });
    }
  }
  return evenements;
}
