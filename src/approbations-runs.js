// Les approbations des runs du moteur (nœud `approval`, rallonge de budget), montrées dans
// la page Décisions à côté des dossiers de la boîte métier (phase 5, décision du 2026-10-05).
//
// Le cockpit les lit dans l'event store et ne les tranche jamais lui-même : une décision
// dépose une commande signée `approval.decide`, que le runner exécute avec
// `deciderApprobation` (qui revérifie tout), avant de reprendre le run.
//
// Chaque approbation prend la forme d'un dossier de la boîte (src/cockpit.js, `etat`) : la
// page, le conseiller et la note du vault les traitent pareil. `source: "run"` les distingue.

class RefusApprobationRun extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const PREFIXE = "run:";
const ENVOYEES = ["pending", "taken"];

// Les approbations dont la décision est déjà partie vers le runner, pas encore exécutée.
function decisionsEnvoyees(store) {
  const ids = new Set();
  for (const statut of ENVOYEES) {
    for (const c of store.commandes({ statut, limite: 200 })) {
      if (c.kind === "approval.decide") ids.add(c.payload.approbationId);
    }
  }
  return ids;
}

/**
 * Les approbations en attente, en dossiers de la page Décisions.
 * @param {any} store l'event store
 */
function dossiers(store) {
  const envoyees = decisionsEnvoyees(store);
  return store.approbationsOuvertes().filter(a => !store.controle?.annulationDemandee(a.run_id)).map((a) => {
    const run = store.run(a.run_id) || {};
    return {
      dossier: `${PREFIXE}${a.id}`,
      source: "run",
      runId: a.run_id,
      approbationId: a.id,
      nodeId: a.node_id,
      reason: a.reason,
      projet: run.project_id || null,
      rapport: a.rapport || null,
      reponse_posee: null,
      empreinte: a.empreinte,
      depuis: a.opened_at,
      appliquer_avec: run.pipeline_ref || null,
      plan_absent: false,
      fraicheur: { reference: null, age_heures: null, max_heures: null, verdict: "inconnue" },
      actions: (a.actions || []).map((x) => ({ ...x, decision: null, note: null })),
      // Tranché pour l'écran dès que la décision est partie : le run reprend dans la minute,
      // et la page ne doit pas inviter à décider deux fois.
      tranche: envoyees.has(a.id),
      decision_envoyee: envoyees.has(a.id),
    };
  });
}

/**
 * Dépose la décision de Raphaël pour le runner. Les règles du moteur sont revérifiées par
 * `deciderApprobation` au moment d'écrire ; celles-ci évitent seulement une commande
 * vouée à l'échec.
 * @param {any} store
 * @param {{ approbationId: string, demande: any, qui: { par: string, canal: string } }} opts
 */
function demander(store, { approbationId, demande, qui }) {
  const a = store.approbation(String(approbationId || ""));
  if (!a) throw new RefusApprobationRun(404, "approbation inconnue");
  if (a.status !== "pending") throw new RefusApprobationRun(409, `approbation déjà tranchée (${a.status})`);
  if (decisionsEnvoyees(store).has(a.id)) throw new RefusApprobationRun(409, "une décision est déjà partie pour cette approbation");

  const decision = demande && demande.decision;
  const note = typeof (demande && demande.note) === "string" && demande.note.trim() ? demande.note.trim() : undefined;
  const actions = Array.isArray(demande && demande.actions)
    ? demande.actions.map((d) => ({ action_id: String(d.action_id), decision: d.decision, ...(d.note ? { note: String(d.note) } : {}) }))
    : [];
  if (decision === "oriented" && !note) throw new RefusApprobationRun(400, "une consigne ne peut pas être vide");
  if (decision === "approved" && (a.actions || []).length) {
    const tranchees = new Set(actions.map((d) => d.action_id));
    const manquantes = a.actions.map((x) => x.id).filter((id) => !tranchees.has(id));
    if (manquantes.length) throw new RefusApprobationRun(400, `trancher chaque action avant d'approuver, manquantes : ${manquantes.join(", ")}`);
  }

  let commande;
  try {
    commande = store.creerCommande({
      kind: "approval.decide",
      payload: { approbationId: a.id, decision, ...(note ? { note } : {}), ...(actions.length ? { actions } : {}) },
      par: qui.par,
      canal: qui.canal,
    });
  } catch (err) {
    throw new RefusApprobationRun(400, err.message);
  }
  return { commande, approbation: a, decision, note: note || null, actions };
}

/**
 * Le dossier tel qu'il sera une fois tranché, pour la note du vault : chaque action porte la
 * décision demandée et qui l'a prise.
 */
function dossierTranche(store, { approbation, decision, note, actions, qui }) {
  const base = dossiers(store).find((d) => d.approbationId === approbation.id) || null;
  if (!base) return null;
  const parAction = new Map(actions.map((d) => [d.action_id, d]));
  const le = new Date().toISOString();
  const verdict = decision === "rejected" ? "refuse" : "approuve";
  return {
    ...base,
    tranche: true,
    actions: base.actions.length
      ? base.actions.map((x) => {
          const d = parAction.get(x.id);
          return { ...x, decision: d ? d.decision : verdict, note: (d && d.note) || null, decision_par: qui.par, decision_le: le };
        })
      : [{ id: base.nodeId, type: base.reason, cible: base.rapport && base.rapport.question, decision: verdict, note, decision_par: qui.par, decision_le: le }],
  };
}

module.exports = { dossiers, demander, dossierTranche, RefusApprobationRun, PREFIXE };
