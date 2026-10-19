// Routes du planificateur de missions et état réel qu'il consulte : machines, runtimes en
// attente de quota ou de connexion, dépenses du mois. Le planificateur ne lit rien d'autre.
const equipe = require("./equipe");
const runtimeMission = require("./runtime-mission");
const planificateur = require("./planificateur");
const { branches } = require("./branches");

/**
 * Le contrôle de lancement d'un nœud de mission : backend joignable, worker à jour pour les
 * missions (et la discussion d'équipe pour un nœud de dialogue) et annonçant ce runtime.
 * Partagé par le lancement manuel, le planificateur et les tours de conversation.
 */
const verifierBackend = runtimeMission.verifier;

/** Runtimes qu'un run vivant attend : quota atteint ou connexion expirée. */
function runtimesBloques(store, limite = 300) {
  const bloques = {};
  for (const run of store.runs({ limite })) {
    if (!["waiting_quota", "waiting_auth"].includes(run.status)) continue;
    const attente = store.attentes?.vue(run.id);
    if (!attente?.runtime || bloques[attente.runtime]) continue;
    bloques[attente.runtime] = attente.statut === "waiting_quota"
      ? `quota ${attente.runtime} atteint${attente.resetAt ? ` jusqu'à ${attente.resetAt}` : ", échéance inconnue"} (run ${run.id.slice(0, 8)})`
      : `connexion ${attente.runtime} absente ou expirée (run ${run.id.slice(0, 8)})`;
  }
  return bloques;
}

/** Coût équivalent API des runs de chaque projet depuis le début du mois (UTC). */
function depensesProjets(store, maintenant = Date.now()) {
  const d = new Date(maintenant);
  const debut = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  const lignes = store.db.prepare("SELECT project_id AS projet, COALESCE(SUM(est_cost_usd), 0) AS cout FROM runs WHERE project_id IS NOT NULL AND started_at >= ? GROUP BY project_id").all(debut);
  return Object.fromEntries(lignes.map((l) => [l.projet, Number(l.cout)]));
}

/**
 * L'état que le planificateur consulte. Une machine en veille reste indisponible : planifier
 * ne réveille pas le PC.
 */
function etatPlanification({ store, machines, viaParMachine, roster, affectations, maintenant = Date.now() }) {
  const verifier = verifierBackend({ viaParMachine, machines });
  const usage = equipe.etat({ roster, affectations, store, maintenant }).agents;
  return {
    disponibilite: (llm, noeud, contexte) => {
      try { verifier(llm, noeud, contexte); return { utilisable: true, raison: null }; } catch (err) { return { utilisable: false, raison: err.message }; }
    },
    machine: (machine, noeud = { id: "script" }, contexte) => {
      try { runtimeMission.verifierMachine(machines, machine, noeud, contexte); return { utilisable: true, raison: null }; }
      catch (err) { return { utilisable: false, raison: err.message }; }
    },
    runtimesBloques: runtimesBloques(store),
    depensesMembres: Object.fromEntries(usage.map((a) => [a.id, a.usage.consommeMoisUsd])),
    depensesProjets: depensesProjets(store, maintenant),
  };
}

/**
 * `GET /api/natures` rend les branches métier ; `POST /api/missions/plan` rend la proposition ;
 * `POST /api/missions/lancer` met le plan
 * présenté en file. Rend false si la route n'est pas la sienne.
 * @param {{ req: any, res: any, chemin: string, json: Function, corps: () => Promise<any>, store: () => any,
 *   qui: { par: string, canal: string }, params: () => any, machines: (store: any) => any[], viaParMachine: Record<string, string[]>,
 *   origineAutorisee: (req: any) => boolean }} ctx
 */
async function traiter({ req, res, chemin, json, corps, store, qui, params, machines, viaParMachine, origineAutorisee }) {
  if (req.method === "GET" && chemin === "/api/natures") {
    try { json(res, 200, branches({ projetsDir: params().projetsDir })); }
    catch (err) { json(res, 500, { erreur: `natures illisibles : ${err.message}` }); }
    return true;
  }
  if (req.method !== "POST" || !["/api/missions/plan", "/api/missions/lancer"].includes(chemin)) return false;
  if (!origineAutorisee(req)) { json(res, 403, { erreur: "origine refusée : cette écriture ne vient pas du cockpit" }); return true; }
  const magasin = store();
  if (!magasin) { json(res, 503, { erreur: "event store indisponible" }); return true; }
  const demande = await corps();
  if (demande === null) return true;
  try {
    const p = params();
    const etatMachines = machines(magasin);
    const etat = etatPlanification({ store: magasin, machines: etatMachines, viaParMachine, roster: p.roster, affectations: p.affectations });
    if (chemin === "/api/missions/plan") {
      json(res, 200, planificateur.proposer({ spec: demande.spec, params: p, etat }));
    } else {
      const commande = planificateur.lancer({ store: magasin, qui, params: p, corps: demande, etat,
        verifierBackend: verifierBackend({ viaParMachine, machines: etatMachines }) });
      json(res, 202, { commande: { id: commande.id, statut: commande.status } });
    }
  } catch (err) {
    json(res, err instanceof planificateur.RefusPlan ? 409 : 400, { erreur: err.message });
  }
  return true;
}

module.exports = { traiter, verifierBackend, etatPlanification, runtimesBloques, depensesProjets };
