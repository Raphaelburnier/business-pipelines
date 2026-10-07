// Ce que le cockpit sait des runs, en lecture seule.
//
// Tout vient de l'event store (§9) et des fiches `projects/<id>/project.json` : le cockpit
// ne recalcule rien, ne devine rien, et n'affiche que ce qui y est écrit (principe 4 de la
// spec). Si une information manque à l'écran, c'est qu'elle manque en base ou dans une
// fiche, et c'est là qu'il faut corriger, pas dans la page.
//
// Chaque forme rendue ici est décrite par un schéma zod de `packages/schemas/cockpit.js`
// (agent-orchestrator). Un test valide les réponses contre eux : le front et ses fixtures
// en tirent leurs types, donc une dérive se voit au test, pas à l'écran.
//
// Ces fonctions prennent un store et rendent des objets JSON. Aucune n'ouvre de socket, donc
// ce qui décide de ce que voit l'écran se teste sans serveur.
const fs = require("fs");
const path = require("path");
const { validerProjet } = require("agent-orchestrator/packages/schemas");
const { revues } = require("agent-orchestrator");
const { vueLivraison } = require("./suivi-livraisons");

const ETATS_VIVANTS = new Set(["queued", "running", "paused", "waiting_approval", "waiting_quota", "waiting_auth", "waiting_machine"]);

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
    // Exécution terminée n'est pas fusion : la livraison dit ce que GitHub a fait du run.
    livraison: vueLivraison(store.livraison(run.id)),
  };
}

/**
 * La liste des runs, les plus récents d'abord (`GET /api/runs?project=&status=`).
 * @param {any} store
 * @param {{ limite?: number, projet?: string|null, statut?: string|null }} [filtre]
 */
function runs(store, { limite = 20, projet = null, statut = null } = {}) {
  return store.runs({ limite, projectId: projet, status: statut }).map((run) => ligneRun(store, run));
}

function ligneEtape(e) {
  return {
    id: e.id,
    noeud: e.node_id,
    type: e.type,
    agent: e.agent_ref || null,
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
  };
}

/**
 * Un run et tout ce qu'on en sait : ses étapes, ses approbations, son dernier événement.
 * @param {any} store
 * @param {string} runId
 */
function run(store, runId) {
  const brut = store.run(runId);
  if (!brut) return null;
  const derniers = store.evenements({ runId });
  const contratMission = store.commandeLancementRun(runId)?.payload.mission;
  const outilsParEtape = new Map();
  for (const evenement of derniers) {
    const outils = evenement.payload && evenement.payload.outils;
    if (!evenement.step_id || !Array.isArray(outils)) continue;
    const connus = outilsParEtape.get(evenement.step_id) || new Set();
    for (const outil of outils) if (typeof outil === "string" && outil) connus.add(outil);
    outilsParEtape.set(evenement.step_id, connus);
  }
  return {
    ...ligneRun(store, brut),
    ...(contratMission ? { mission: require("agent-orchestrator/src/mission").vue(contratMission) } : {}),
    etapes: store.etapes(runId).map((etape) => ({
      ...ligneEtape(etape),
      outils: [...(outilsParEtape.get(etape.id) || [])].sort(),
    })),
    approbations: store.approbationsEnAttente(runId).map(resumerApprobation),
    revues: revues.vueRevues(derniers, arbreCourant(store, runId, derniers)),
    dernierEvenementId: derniers.length ? derniers[derniers.length - 1].id : 0,
  };
}

// Le dernier arbre jugé du run : celui de sa livraison attestée, sinon celui de son dernier
// juge (tests ou revue). Une revue sur un autre arbre est périmée.
function arbreCourant(store, runId, evenements) {
  const livraison = store.livraison(runId);
  if (livraison && livraison.attestation) return livraison.attestation.treeSha;
  const juge = [...evenements].reverse().find((e) => ["verification.finished", "review.finished", "review.invalid"].includes(e.type) && e.payload && e.payload.treeSha);
  return juge ? juge.payload.treeSha : null;
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
//
// Chaque processus qui ouvre l'event store inscrit sa machine « online » une fois, sans
// battement ensuite : seul le maître tient l'état des workers à jour. La machine locale est
// donc en ligne puisqu'elle répond ; une autre qui ne bat plus depuis SILENCE_S est hors
// ligne, quoi que dise la base ; et une machine muette depuis OUBLI_S (un ancien conteneur
// inscrit sous son id Docker) sort de la liste.
const SILENCE_S = 180;
const OUBLI_S = 7 * 24 * 3600;
const ETATS_ACTIFS = new Set(["online", "busy"]);

function machines(store, { maintenant = Date.now() } = {}) {
  return store
    .machines()
    .map((m) => {
      const vu = m.last_heartbeat_at ? Date.parse(m.last_heartbeat_at) : null;
      const depuisSecondes = vu ? Math.max(0, Math.round((maintenant - vu) / 1000)) : null;
      const locale = m.id === store.machineId;
      const muette = !locale && ETATS_ACTIFS.has(String(m.state)) && (depuisSecondes === null || depuisSecondes > SILENCE_S);
      return {
        machine: m.id,
        nom: m.name,
        etat: muette ? "offline" : m.state,
        dernierHeartbeat: m.last_heartbeat_at,
        depuisSecondes,
        meta: m.meta || null,
        locale,
      };
    })
    .filter((m) => m.locale || m.depuisSecondes === null || m.depuisSecondes <= OUBLI_S)
    .map(({ locale: _l, ...m }) => m);
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
  return lignes.slice(0, limite).map((e) => ({
    id: e.id,
    at: e.ts,
    type: e.type,
    run: e.run_id,
    etape: e.step_id,
    machine: e.machine_id,
    payload: e.payload,
  }));
}

// ---------- topologie (§11.1) ----------

/**
 * Les fiches projet (`projects/<id>/project.json`, décision §15 option A). Une fiche
 * illisible ne fait pas tomber la vue : elle est nommée dans `anomalies`, et le reste
 * s'affiche. Se taire serait pire, on croirait le projet absent.
 * @param {string|null} projetsDir
 */
function lireFiches(projetsDir) {
  const fiches = [];
  const anomalies = [];
  if (!projetsDir || !fs.existsSync(projetsDir)) return { fiches, anomalies };
  for (const entree of fs.readdirSync(projetsDir, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const fichier = path.join(projetsDir, entree.name, "project.json");
    if (!fs.existsSync(fichier)) continue;
    try {
      fiches.push(validerProjet(JSON.parse(fs.readFileSync(fichier, "utf-8"))));
    } catch (err) {
      anomalies.push(`projects/${entree.name}/project.json : ${String(err.message).split("\n")[0]}`);
    }
  }
  return { fiches, anomalies };
}

// La couleur d'un projet dans l'arbre vient de son dernier run.
function etatDuProjet(dernier) {
  if (!dernier) return "inactif";
  if (dernier.status === "running" || dernier.status === "queued") return "actif";
  if (dernier.status === "paused") return "pause";
  if (String(dernier.status).startsWith("waiting_")) return "attente";
  if (dernier.status === "failed") return "erreur";
  return "inactif";
}

/**
 * L'arbre maître → machines → catégories → projets (`GET /api/topology`).
 *
 * Un projet sans fiche mais avec des runs (lancé à la main avant la création de sa fiche)
 * apparaît quand même, marqué `aFiche: false`, dans la catégorie « sans fiche » : un run
 * réel qui n'apparaîtrait nulle part serait le pire des trous d'observabilité.
 *
 * Les machines d'un projet sont sa `homeMachine` plus celles où ses étapes ont réellement
 * tourné. C'est ce qui trace l'arête en pointillés d'un projet multi-machine.
 * @param {any} store
 * @param {{ projetsDir?: string|null, maintenant?: number, limiteRuns?: number }} [options]
 */
function topologie(store, { projetsDir = null, maintenant = Date.now(), limiteRuns = 500 } = {}) {
  const { fiches, anomalies } = lireFiches(projetsDir);
  const tousLesRuns = store.runs({ limite: limiteRuns });

  const parProjet = new Map();
  for (const r of tousLesRuns) {
    if (!r.project_id) continue;
    if (!parProjet.has(r.project_id)) parProjet.set(r.project_id, []);
    parProjet.get(r.project_id).push(r);
  }

  // Les cinq derniers runs suffisent : une machine qui n'a pas servi depuis ne doit pas
  // garder son arête pour toujours.
  const machinesVues = (runsDuProjet) => {
    const vues = new Set();
    for (const r of runsDuProjet.slice(0, 5)) for (const e of store.etapes(r.id)) if (e.machine_id) vues.add(String(e.machine_id));
    return vues;
  };

  const projet = ({ id, nom, categorie, homeMachine, pipelines, aFiche, url = null }) => {
    const runsDuProjet = parProjet.get(id) || [];
    const dernier = runsDuProjet[0] || null;
    const approbations = runsDuProjet
      .filter((r) => ETATS_VIVANTS.has(String(r.status)))
      .reduce((n, r) => n + store.approbationsEnAttente(r.id).length, 0);
    return {
      id,
      nom,
      categorie,
      homeMachine,
      machines: [...new Set([homeMachine, ...machinesVues(runsDuProjet)])],
      pipelines,
      etat: etatDuProjet(dernier),
      aFiche,
      url,
      dernierRun: dernier ? { id: dernier.id, statut: dernier.status, debut: dernier.started_at } : null,
      approbationsEnAttente: approbations,
    };
  };

  const projets = fiches.map((f) =>
    projet({
      id: f.id,
      nom: f.name,
      categorie: f.business,
      homeMachine: f.homeMachine,
      pipelines: f.pipelines.map((p) => p.extends),
      aFiche: true,
      url: f.url ?? null,
    })
  );
  const connus = new Set(projets.map((p) => p.id));
  for (const [id, runsDuProjet] of parProjet) {
    if (connus.has(id)) continue;
    projets.push(
      projet({
        id,
        nom: id,
        categorie: "sans fiche",
        homeMachine: "pc",
        pipelines: [...new Set(runsDuProjet.map((r) => r.pipeline_ref))],
        aFiche: false,
      })
    );
  }

  const categories = [...new Set(projets.map((p) => p.categorie))].sort().map((c) => ({ id: c, nom: c }));
  return {
    // Le maître n'est pas encore un service (décision 8 : phase 5). Ce qui sert cette
    // réponse est le cockpit du NAS, donc c'est lui qui est « en ligne ».
    maitre: { nom: "maître", etat: "online" },
    machines: machines(store, { maintenant }),
    categories,
    projets,
    anomalies,
  };
}

// ---------- usage (§8, barre du haut) ----------

/**
 * Runs actifs et coût équivalent sur 24 h et sur le mois (`GET /api/usage`). La jauge de
 * quota reste nulle tant que le maître ne lit pas `getUsage()` du SDK (phase 5) : mieux
 * vaut une jauge absente qu'une jauge inventée.
 * @param {any} store
 * @param {{ maintenant?: number, limiteRuns?: number }} [options]
 */
function usage(store, { maintenant = Date.now(), limiteRuns = 1000 } = {}) {
  const liste = store.runs({ limite: limiteRuns });
  const debutJour = maintenant - 24 * 3600 * 1000;
  const date = new Date(maintenant);
  const debutMois = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const somme = (depuis) =>
    Number(
      liste
        .filter((r) => r.started_at && Date.parse(r.started_at) >= depuis)
        .reduce((total, r) => total + Number(r.est_cost_usd || 0), 0)
        .toFixed(4)
    );
  return {
    runsActifs: liste.filter((r) => ETATS_VIVANTS.has(String(r.status))).length,
    coutEquivalentJourUsd: somme(debutJour),
    coutEquivalentMoisUsd: somme(debutMois),
    quota: null,
  };
}

module.exports = { runs, run, machines, evenements, topologie, usage, resumerApprobation, lireFiches, ETATS_VIVANTS };
