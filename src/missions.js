// Missions depuis le cockpit : seul le serveur construit le contrat résolu.
const path = require("node:path");
const registre = require("agent-orchestrator/src/registre");
const schemas = require("agent-orchestrator/packages/schemas/mission");
const contrat = require("agent-orchestrator/src/mission");
const finance = require("agent-orchestrator/packages/schemas/finance");
const { roleEffectif } = require("agent-orchestrator/src/dispatch");
const natures = require("./natures");
const { validerReference } = require("./objectifs-avenirs");

const lancement = schemas.lancement;

function fichier(projetsDir, id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("identifiant de projet invalide");
  return path.join(projetsDir, id, "project.json");
}
const actifs = (r) => r.pipeline.nodes.filter((n) => ["agent", "review"].includes(n.type) && !n.disabled);
const incarne = (m, n) => m.registre.includes(n.agent.split("@")[0]);
function lire({ projetsDir, projectId, pipelineIndex = 0, roster, affectations, financeDisponible }) {
  const resolution = registre.resoudreProjet(fichier(projetsDir, projectId), { index: pipelineIndex });
  if (resolution.projet.id !== projectId) throw new Error("la fiche ne correspond pas au projet choisi");
  const configuration = contrat.empreinte({ resolution, roster, affectations });
  const roles = actifs(resolution).map((n) => {
    const membres = roster.filter((m) => incarne(m, n)).map((m) => ({ id: m.id, nom: m.nom, role: m.role, llm: m.llm }));
    const associes = membres.filter((m) => affectations[m.id]?.projet === projectId);
    return { noeud: n.id, agent: n.agent, type: n.type, llm: n.llm,
      membre: associes.length === 1 ? associes[0].id : null, membres };
  });
  // Une mission dev repart d'une demande nouvelle, sans les détails d'un ancien run.
  const nature = natures.classer(resolution.pipeline).nature;
  const developpement = nature === "developpement";
  const blocages = [];
  if (finance.estFinance(resolution.pipeline)) {
    if (resolution.projet.publier === true) blocages.push("Le projet Finance doit désactiver la publication GitHub.");
    for (const n of resolution.pipeline.nodes.filter((n) => n.type === "script" && !n.disabled)) {
      if (financeDisponible?.(n.handler, roleEffectif(n)) !== true) blocages.push(`L'étape Finance ${n.id} n'est pas installée sur ${roleEffectif(n)}.`);
    }
  }
  return { resolution, options: schemas.options.parse({ projectId, nom: resolution.projet.name, repo: resolution.projet.repo,
    pipelineIndex, pipeline: `${resolution.pipeline.name}@${resolution.pipeline.version}`,
    titre: resolution.pipeline.title || resolution.pipeline.name,
    nature: nature || "autre",
    configuration, roles, spec: developpement ? { project_name: projectId } : resolution.spec,
    budget: resolution.budget, publication: resolution.projet.publier,
    ...(finance.estFinance(resolution.pipeline) ? { blocages } : {}) }) };
}

function construire(params, brut, { verifierBackend = () => {}, verifierBrouillon, plan } = {}) {
  const d = lancement.parse(brut);
  const objectifFeuille = Object.hasOwn(d.demande.spec, "_roadmapObjective")
    ? validerReference(d.demande.spec._roadmapObjective)
    : null;
  const { resolution, options } = lire({ ...params, projectId: d.projectId, pipelineIndex: d.pipelineIndex });
  if (options.configuration !== d.configuration) throw new Error("La configuration du projet ou de l'équipe a changé : relire la mission.");
  if (options.blocages?.length) throw new Error(options.blocages.join(" "));
  const brouillon = d.brouillonId ? verifierBrouillon?.(d.brouillonId, d.projectId, options.nature) : null;
  const origine = brouillon?.origine;
  if (d.brouillonId && !origine) throw new Error("Origine du brouillon non vérifiée.");
  const parNoeud = new Map();
  for (const c of d.demande.agents) {
    if (parNoeud.has(c.noeud)) throw new Error(`rôle ${c.noeud} choisi deux fois`);
    parNoeud.set(c.noeud, c);
  }
  const roles = actifs(resolution);
  if (parNoeud.size !== roles.length || [...parNoeud.keys()].some((id) => !roles.some((n) => n.id === id))) {
    throw new Error("La sélection doit couvrir exactement les rôles actifs du workflow, y compris les revues.");
  }
  const participants = roles.map((n) => {
    const c = parNoeud.get(n.id);
    const m = c.membre ? params.roster.find((m) => m.id === c.membre) : null;
    if (c.membre && (!m || !incarne(m, n))) throw new Error(`membre incompatible avec le rôle ${n.id}`);
    verifierBackend(c.llm, n, { pipeline: resolution.pipeline, agent: resolution.agents[n.agent] });
    return { ...c, nom: m?.nom || resolution.agents[n.agent].name, agent: n.agent, type: n.type };
  });
  if (resolution.pipeline.workspace === "documents") {
    for (const n of resolution.pipeline.nodes.filter((n) => n.type === "script" && !n.disabled)) {
      verifierBackend(null, n, { pipeline: resolution.pipeline });
    }
  }
  // Le remplaçant du membre choisi (page Agents) suit le nœud : le moteur lui passe l'étape si
  // le quota du titulaire tombe. Un remplaçant du même fournisseur, ou qu'aucune machine ne
  // peut servir, n'aiderait pas : il n'est pas posé, et la mission attend comme avant.
  const secoursDe = (n) => {
    const c = parNoeud.get(n.id);
    const m = c.membre ? params.roster.find((x) => x.id === c.membre) : null;
    const s = m && m.secours ? params.roster.find((x) => x.id === m.secours) : null;
    if (!s || s.llm.via === c.llm.via) return {};
    try {
      verifierBackend(s.llm, n, { pipeline: resolution.pipeline, agent: resolution.agents[n.agent] });
    } catch {
      return {};
    }
    return { secours: { ...s.llm } };
  };
  resolution.pipeline.nodes = resolution.pipeline.nodes.map((n) => parNoeud.has(n.id) ? { ...n, llm: parNoeud.get(n.id).llm, ...secoursDe(n) } : n);
  // La tranche métier reste structurée (questions marketing, etc.). L'objectif de cette
  // mission est aussi envoyé hors slicing à tous les développeurs et reviewers.
  const specContexte = { ...d.demande.spec };
  delete specContexte._roadmapObjective;
  resolution.spec = { ...specContexte, project_name: d.projectId, task: d.demande.objectif,
    acceptance_criteria: d.demande.criteres,
    _mission: { projectId: d.projectId, objectif: d.demande.objectif, criteres: d.demande.criteres,
      directives: d.demande.directives, exclusions: d.demande.exclusions, document: d.demande.document,
      ...(objectifFeuille ? { objectifFeuille } : {}),
      ...(origine ? { origine, contexteEquipe: brouillon.contexte } : {}) } };
  for (const n of roles) {
    if (Array.isArray(n.slice)) for (const key of n.slice) {
      if (!Object.hasOwn(resolution.spec, key)) throw new Error(`La spec du rôle ${n.id} doit contenir le champ « ${key} ».`);
    }
  }
  return { mission: contrat.figer({ id: d.requestId, resolution, demande: d.demande, participants, origine, plan }),
    llmOverrides: Object.fromEntries(participants.map((p) => [p.noeud, p.llm])), demande: d };
}

function demander({ store, qui, params, demande, verifierBackend, verifierBrouillon, plan }) {
  const d = lancement.parse(demande);
  const requestHash = contrat.empreinte(d);
  const objectifFeuille = Object.hasOwn(d.demande.spec, "_roadmapObjective")
    ? validerReference(d.demande.spec._roadmapObjective)
    : null;
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const ancienne = store.db.prepare("SELECT id FROM commands WHERE kind = 'run.start' AND json_extract(payload_json, '$.requestId') = ? LIMIT 1").get(d.requestId);
    let commande;
    if (ancienne) {
      commande = store.commande(ancienne.id);
      if (commande.par !== qui.par || commande.canal !== qui.canal || commande.payload.requestHash !== requestHash) {
        throw new Error("Cette demande a déjà été utilisée avec un autre contenu ou auteur.");
      }
    } else {
      if (objectifFeuille && objectifActif(store, objectifFeuille.id)) {
        const occupe = new Error(`L'objectif ${objectifFeuille.id} est déjà attribué à un run actif.`);
        occupe.code = "OBJECTIF_OCCUPE";
        throw occupe;
      }
      const { mission, llmOverrides } = construire(params, d, { verifierBackend, verifierBrouillon, plan });
      commande = store.creerCommande({ kind: "run.start", payload: { projectId: d.projectId,
        pipelineIndex: d.pipelineIndex, llmOverrides, mission, requestId: d.requestId, requestHash }, par: qui.par, canal: qui.canal });
    }
    store.db.exec("COMMIT");
    return commande;
  } catch (err) { store.db.exec("ROLLBACK"); throw err; }
}

const RUNS_VIVANTS = new Set(["queued", "running", "paused", "waiting_approval", "waiting_quota", "waiting_auth", "waiting_machine"]);

function objectifActif(store, objectifId) {
  const lignes = store.db.prepare(`
    SELECT c.status AS commande_statut, c.run_id AS run_id,
      r.status AS run_statut, d.status AS livraison_statut, d.finished_at AS livraison_fin,
      json_extract(c.payload_json, '$.mission.resolution.projet.publier') AS publication
    FROM commands c
    LEFT JOIN runs r ON r.id = c.run_id
    LEFT JOIN deliveries d ON d.run_id = r.id
    WHERE c.kind = 'run.start'
      AND json_extract(c.payload_json, '$.mission.resolution.spec._mission.objectifFeuille.id') = ?
    ORDER BY c.created_at DESC, c.rowid DESC`).all(objectifId);
  return lignes.find((ligne) => {
    if (!ligne.run_id) return ["pending", "taken"].includes(ligne.commande_statut);
    if (RUNS_VIVANTS.has(ligne.run_statut)) return true;
    if (ligne.run_statut === "succeeded" && (ligne.publication === 1 || (ligne.livraison_statut && !ligne.livraison_fin))) return true;
    return false;
  }) || null;
}
module.exports = { lire, construire, demander };
