// Ce que le cockpit sait des runs, en lecture seule.
//
// Tout vient de l'event store (§9) : le cockpit ne recalcule rien, ne devine rien, et
// n'affiche que ce qui y est écrit (principe 4 de la spec). Si une information manque à
// l'écran, c'est qu'elle manque en base, et c'est le moteur qu'il faut corriger, pas la
// page.
//
// Ces fonctions sont pures au sens qui compte ici : elles prennent un store et rendent des
// objets JSON. Aucune n'ouvre de socket, donc ce qui décide de ce que voit l'écran se
// teste sans serveur — même raison que pour `src/cockpit.js`.
const ETATS_VIVANTS = new Set(["queued", "running", "paused", "waiting_approval", "waiting_quota", "waiting_machine"]);

function ligneRun(store, run) {
  const etapes = store.etapes(run.id);
  const parStatut = {};
  for (const e of etapes) parStatut[e.status] = (parStatut[e.status] || 0) + 1;
  return {
    id: run.id,
    projet: run.project_id,
    pipeline: run.pipeline_ref,
    statut: run.status,
    vivant: ETATS_VIVANTS.has(String(run.status)),
    debut: run.started_at,
    fin: run.finished_at,
    // Sur abonnement, ce coût est un équivalent API, pas une dépense (§8). Le nom le dit,
    // pour qu'aucune page n'affiche « dépensé » ce qui ne l'a pas été.
    coutEquivalentUsd: Number(run.est_cost_usd || 0),
    coutReelUsd: Number(run.real_cost_usd || 0),
    declencheur: run.trigger,
    etapes: { total: etapes.length, parStatut },
  };
}

/**
 * La liste des runs, les plus récents d'abord.
 * @param {any} store
 * @param {{ limite?: number, projet?: string|null }} [filtre]
 */
function runs(store, { limite = 20, projet = null } = {}) {
  return store.runs({ limite, projectId: projet }).map((run) => ligneRun(store, run));
}

/**
 * Un run et tout ce qu'on en sait : ses étapes, ses approbations, son dernier événement.
 * @param {any} store
 * @param {string} runId
 */
function run(store, runId) {
  const brut = store.run(runId);
  if (!brut) return null;
  const etapes = store.etapes(runId).map((e) => ({
    id: e.id,
    noeud: e.node_id,
    type: e.type,
    machine: e.machine_id,
    statut: e.status,
    llm: e.llm_via ? { via: e.llm_via, model: e.llm_model } : null,
    session: e.session_id,
    tour: e.loop_index,
    checkpoint: e.checkpoint_sha,
    debut: e.started_at,
    fin: e.finished_at,
    coutEquivalentUsd: Number(e.est_cost_usd || 0),
    tokens: { entree: e.tokens_in, sortie: e.tokens_out },
    outcome: e.outcome,
  }));
  const derniers = store.evenements({ runId });
  return {
    ...ligneRun(store, brut),
    etapes,
    approbations: store.approbationsEnAttente(runId).map(resumerApprobation),
    dernierEvenementId: derniers.length ? derniers[derniers.length - 1].id : 0,
  };
}

// Une approbation telle que l'écran la montre : la question, pas le dossier complet. Le
// détail se lit sur la page de décision.
function resumerApprobation(a) {
  return {
    id: a.id,
    noeud: a.node_id,
    motif: a.reason,
    statut: a.status,
    ouverteLe: a.opened_at,
    question: (a.rapport && a.rapport.question) || null,
    actions: (a.actions || []).length,
  };
}

/**
 * Les machines et leur état (§7.1), avec l'âge du dernier heartbeat : un état « online »
 * vieux de deux heures ne veut rien dire, et la page doit pouvoir le montrer.
 * @param {any} store
 * @param {{ maintenant?: number }} [options]
 */
function machines(store, { maintenant = Date.now() } = {}) {
  return store.machines().map((m) => {
    const vu = m.last_heartbeat_at ? Date.parse(m.last_heartbeat_at) : null;
    return {
      machine: m.id,
      nom: m.name,
      etat: m.state,
      dernierHeartbeat: m.last_heartbeat_at,
      depuisSecondes: vu ? Math.max(0, Math.round((maintenant - vu) / 1000)) : null,
      meta: m.meta || null,
    };
  });
}

/**
 * Les événements postérieurs à un identifiant : c'est la brique du flux temps réel. Le
 * client garde le dernier id reçu et redemande la suite, donc une reconnexion ne perd ni
 * ne rejoue rien (même principe que les `seq` du protocole des workers).
 * @param {any} store
 * @param {{ runId?: string|null, apresId?: number, limite?: number }} [filtre]
 */
function evenements(store, { runId = null, apresId = 0, limite = 200 } = {}) {
  const lignes = runId ? store.evenements({ runId, apresId }) : store.evenements({ apresId });
  const coupe = lignes.slice(0, limite);
  return coupe.map((e) => ({
    id: e.id,
    at: e.ts,
    type: e.type,
    run: e.run_id,
    etape: e.step_id,
    machine: e.machine_id,
    payload: e.payload,
  }));
}

/**
 * Le tableau de bord : ce qu'on veut voir en ouvrant la page. Les runs vivants d'abord,
 * les machines, les décisions qui attendent.
 * @param {any} store
 * @param {{ limite?: number, maintenant?: number }} [options]
 */
function tableauDeBord(store, { limite = 10, maintenant = Date.now() } = {}) {
  const liste = runs(store, { limite });
  const vivants = liste.filter((r) => r.vivant);
  const attentes = [];
  for (const r of vivants) {
    for (const a of store.approbationsEnAttente(r.id)) {
      attentes.push({ run: r.id, projet: r.projet, ...resumerApprobation(a) });
    }
  }
  return {
    runs: liste,
    vivants: vivants.length,
    machines: machines(store, { maintenant }),
    approbations: attentes,
    // Le coût du jour, en équivalent API : c'est la jauge qui dit si un run part en vrille,
    // pas une facture.
    coutDuJourUsd: Number(
      liste
        .filter((r) => r.debut && Date.parse(r.debut) >= maintenant - 24 * 3600 * 1000)
        .reduce((total, r) => total + r.coutEquivalentUsd, 0)
        .toFixed(4)
    ),
  };
}

module.exports = { runs, run, machines, evenements, tableauDeBord, resumerApprobation, ETATS_VIVANTS };
