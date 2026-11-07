// Missions depuis le cockpit : seul le serveur construit le contrat résolu.
const path = require("node:path");
const registre = require("agent-orchestrator/src/registre");
const schemas = require("agent-orchestrator/packages/schemas/mission");
const contrat = require("agent-orchestrator/src/mission");
const finance = require("agent-orchestrator/packages/schemas/finance");
const { roleEffectif } = require("agent-orchestrator/src/dispatch");
const natures = require("./natures");
const equipe = require("./equipe");
const { validerReference } = require("./objectifs-avenirs");

const lancement = schemas.lancement;

function fichier(projetsDir, id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("identifiant de projet invalide");
  return path.join(projetsDir, id, "project.json");
}
const actifs = (r) => r.pipeline.nodes.filter((n) => ["agent", "review"].includes(n.type) && !n.disabled);
const incarne = (m, n) => m.registre.includes(n.agent.split("@")[0]);
const relit = (n) => n.type === "review" || finance.roleFinance(n) === "revue";
const memeLlm = (a, b) => Boolean(a && b && a.via === b.via && a.model === b.model);

/**
 * Le modèle d'escalade d'un rôle (`equipe.escalade`, lot 5.4) : jamais celui, exact, d'un
 * relecteur pour un auteur du travail relu, ni d'un de ces auteurs pour un relecteur. La
 * planification, que personne ne relit, n'a pas de vis-à-vis. Les auteurs passent d'abord
 * (`posees` reçoit leurs escalades) : un relecteur évite aussi le modèle d'escalade de ses
 * auteurs, au cas où les deux bloqueraient. Le contrat (`construire`) et le plan
 * (src/planificateur.js) suivent cet ordre avec les mêmes choix : ils annoncent la même escalade.
 * @param {{ roster: any[], noeud: any, roles: any[], auteurs: string[], llmDe: (n: any) => any, posees: Map<string, any>, admis: (llm: any) => boolean }} options
 */
function escaladeDe({ roster, noeud, roles, auteurs, llmDe, posees, admis }) {
  const visAVis = relit(noeud) ? roles.filter((r) => auteurs.includes(r.id))
    : auteurs.includes(noeud.id) ? roles.filter(relit) : [];
  const e = equipe.escalade(roster, llmDe(noeud),
    (llm) => !visAVis.some((r) => memeLlm(llmDe(r), llm) || memeLlm(posees.get(r.id), llm)) && admis(llm));
  if (e) posees.set(noeud.id, e.llm);
  return e;
}

/** Les rôles dans l'ordre où leurs escalades se décident : auteurs d'abord, relecteurs ensuite. */
const ordreEscalade = (roles) => [...roles.filter((r) => !relit(r)), ...roles.filter(relit)];
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

function construire(params, brut, { verifierBackend = () => {}, verifierBrouillon, plan, relaisExclus = [] } = {}) {
  const d = lancement.parse(brut);
  const objectifTaskBoard = d.demande.spec._taskBoardObjective
    ? validerReference(d.demande.spec._taskBoardObjective, d.projectId, { taskBoard: true }) : null;
  const objectifFeuille = Object.hasOwn(d.demande.spec, "_roadmapObjective")
    ? validerReference(d.demande.spec._roadmapObjective, d.projectId)
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
  if (objectifFeuille || objectifTaskBoard) {
    const cadre = require("./objectifs-avenirs").cadrerSensibilite({ ...d.demande, projectId: d.projectId, contexte: d.demande.spec, exigences: [] });
    if (cadre.exigences.includes("revue-securite") && !roles.some((n) => n.type === "review" && n.agent.split("@")[0] === "security-reviewer")) {
      throw new Error("Cet objectif sensible exige une revue de sécurité active dans le pipeline.");
    }
    d.demande.criteres = cadre.criteres;
    d.demande.document = cadre.document;
  }
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
  // Le relais suit le nœud : le moteur lui passe l'étape si le quota du titulaire tombe. C'est le
  // remplaçant du membre (page Agents), sinon l'autre abonnement (`equipe.repli`), celui que le
  // plan annonce. Un relais que le planificateur écarte (`relaisExclus` : runtime exclu par la
  // spec ou abonnement sans quota, absents du contrat de lancement) ou qu'aucune machine ne
  // peut servir n'est pas posé : la mission attend comme avant.
  const secoursDe = (n) => {
    const c = parNoeud.get(n.id);
    const m = c.membre ? params.roster.find((x) => x.id === c.membre) : null;
    const relais = equipe.repli(params.roster, { membre: m, via: c.llm.via });
    if (!relais || relaisExclus.includes(relais.llm.via)) return {};
    try {
      verifierBackend(relais.llm, n, { pipeline: resolution.pipeline, agent: resolution.agents[n.agent] });
    } catch {
      return {};
    }
    return { secours: { ...relais.llm } };
  };
  // L'escalade suit aussi le nœud : le moteur passe l'étape à ce modèle plus fort si elle bloque
  // (limite de tours, travail vide, cycle à sa limite). Mêmes exclusions que le relais.
  // Chargé ici : le planificateur dépend lui-même de ce module.
  const auteurs = require("./planificateur").auteurs(resolution.pipeline, options.nature);
  const escalades = new Map();
  for (const n of ordreEscalade(roles)) {
    escaladeDe({ roster: params.roster, noeud: n, roles, auteurs, llmDe: (r) => parNoeud.get(r.id)?.llm, posees: escalades, admis: (llm) => {
      if (relaisExclus.includes(llm.via)) return false;
      try {
        verifierBackend(llm, n, { pipeline: resolution.pipeline, agent: resolution.agents[n.agent] });
        return true;
      } catch {
        return false;
      }
    } });
  }
  const escaladeNoeud = (n) => (escalades.has(n.id) ? { escalade: { ...escalades.get(n.id) } } : {});
  resolution.pipeline.nodes = resolution.pipeline.nodes.map((n) => parNoeud.has(n.id) ? { ...n, llm: parNoeud.get(n.id).llm, ...secoursDe(n), ...escaladeNoeud(n) } : n);
  // La tranche métier reste structurée (questions marketing, etc.). L'objectif de cette
  // mission est aussi envoyé hors slicing à tous les développeurs et reviewers.
  const specContexte = { ...d.demande.spec };
  delete specContexte._roadmapObjective;
  resolution.spec = { ...specContexte, project_name: d.projectId, task: d.demande.objectif,
    acceptance_criteria: d.demande.criteres,
    _mission: { projectId: d.projectId, objectif: d.demande.objectif, criteres: d.demande.criteres,
      directives: d.demande.directives, exclusions: d.demande.exclusions, document: d.demande.document,
      ...(objectifFeuille ? { objectifFeuille: { id: objectifFeuille.id, revision: objectifFeuille.revision } } : {}),
      ...(objectifTaskBoard ? { taskBoardObjective: { id: objectifTaskBoard.id, revision: objectifTaskBoard.revision, groupeId: d.demande.spec._taskBoardObjective.groupeId } } : {}),
      ...(origine ? { origine, contexteEquipe: brouillon.contexte } : {}) } };
  for (const n of roles) {
    if (Array.isArray(n.slice)) for (const key of n.slice) {
      if (!Object.hasOwn(resolution.spec, key)) throw new Error(`La spec du rôle ${n.id} doit contenir le champ « ${key} ».`);
    }
  }
  return { mission: contrat.figer({ id: d.requestId, resolution, demande: d.demande, participants, origine, plan }),
    llmOverrides: Object.fromEntries(participants.map((p) => [p.noeud, p.llm])), demande: d };
}

function demander({ store, qui, params, demande, verifierBackend, verifierBrouillon, plan, scheduling = { priority: "normale" }, planSpecHash, relaisExclus = [] }) {
  const d = lancement.parse(demande);
  const requestHash = contrat.empreinte(d);
  const objectifFeuille = Object.hasOwn(d.demande.spec, "_roadmapObjective")
    ? validerReference(d.demande.spec._roadmapObjective, d.projectId)
    : null;
  const reserve = d.demande.spec._taskBoardObjective
    ? validerReference(d.demande.spec._taskBoardObjective, d.projectId, { taskBoard: true }) : objectifFeuille;
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
      if (reserve && objectifActif(store, reserve.id)) {
        const occupe = new Error(`L'objectif ${reserve.id} est déjà attribué à un run actif.`);
        occupe.code = "OBJECTIF_OCCUPE";
        throw occupe;
      }
      const { mission, llmOverrides } = construire(params, d, { verifierBackend, verifierBrouillon, plan, relaisExclus });
      commande = store.creerCommande({ kind: "run.start", payload: { projectId: d.projectId,
        pipelineIndex: d.pipelineIndex, llmOverrides, mission, requestId: d.requestId, requestHash, scheduling,
        ...(planSpecHash ? { planSpecHash } : {}) }, par: qui.par, canal: qui.canal });
    }
    store.db.exec("COMMIT");
    return commande;
  } catch (err) { store.db.exec("ROLLBACK"); throw err; }
}

const RUNS_VIVANTS = new Set(["queued", "running", "paused", "waiting_approval", "waiting_quota", "waiting_auth", "waiting_machine", "waiting_freshness"]);

function objectifActif(store, objectifId) {
  if (store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='atelier_goals'").get()) {
    const prevu = store.db.prepare("SELECT id FROM atelier_goals WHERE next_at IS NOT NULL AND json_extract(mission_json,'$.resolution.spec._mission.taskBoardObjective.id')=? LIMIT 1").get(objectifId);
    if (prevu) return prevu;
  }
  const lignes = store.db.prepare(`
    SELECT c.status AS commande_statut, c.run_id AS run_id,
      r.status AS run_statut, d.status AS livraison_statut, d.finished_at AS livraison_fin,
      json_extract(c.payload_json, '$.mission.resolution.projet.publier') AS publication
    FROM commands c
    LEFT JOIN runs r ON r.id = c.run_id
    LEFT JOIN deliveries d ON d.run_id = r.id
    WHERE c.kind = 'run.start'
      AND COALESCE(json_extract(c.payload_json, '$.mission.resolution.spec._mission.objectifFeuille.id'),json_extract(c.payload_json, '$.mission.resolution.spec._mission.taskBoardObjective.id')) = ?
    ORDER BY c.created_at DESC, c.rowid DESC`).all(objectifId);
  return lignes.find((ligne) => {
    if (!ligne.run_id) return ["pending", "taken"].includes(ligne.commande_statut);
    if (RUNS_VIVANTS.has(ligne.run_statut)) return true;
    if (ligne.run_statut === "succeeded" && (ligne.publication === 1 || (ligne.livraison_statut && !ligne.livraison_fin))) return true;
    return false;
  }) || null;
}
module.exports = { lire, construire, demander, objectifActif, escaladeDe, ordreEscalade };
