// Mise en calendrier des plans validés : tout le groupe est réservé dans une transaction.
const schemas = require('agent-orchestrator/packages/schemas/plan');
const contrats = require('agent-orchestrator/src/mission');
const plans = require('./planificateur');
const missions = require('./missions');
const atelier = require('./atelier');
const dates = require('./atelier-dates');
const { validerReference } = require('./objectifs-avenirs');
const demande = schemas.groupePlan;

function planifier({ store, qui, params, corps, etat, verifierBackend, maintenant = Date.now() }) {
  const d = demande.parse(corps);
  if (new Set(d.missions.map(m => m.spec.projectId)).size !== d.missions.length || new Set(d.missions.map(m => m.requestId)).size !== d.missions.length) throw new Error('Un seul plan par dépôt est autorisé.');
  const references = d.missions.map(m => validerReference(m.spec.contexte._taskBoardObjective, m.spec.projectId, { taskBoard: true }));
  if (references.some(r => r.id !== references[0].id || r.revision !== references[0].revision)) throw new Error('Les plans doivent concerner la même tâche.');
  const jours = d.missions.map(m => dates.civil(Date.parse(m.scheduling.notBefore)).slice(0,10));
  const date = jours[0];
  if (jours.some(j => j !== date) || date < dates.civil(maintenant).slice(0,10) || Date.parse(dates.instantLocal(date)) > maintenant + 366*86400_000) throw new Error('Choisis une journée entre aujourd’hui et dans un an.');
  const hash = contrats.empreinte(d);
  atelier.initialiser(store);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const anciens = d.missions.map(m => store.db.prepare('SELECT * FROM atelier_goals WHERE id=?').get(m.requestId));
    if (anciens.some(Boolean)) {
      if (anciens.some(g => !g || g.request_hash !== hash || g.owner !== qui.par || g.channel !== (qui.canal || null))) throw new Error('Ce groupe a déjà été utilisé avec un autre contenu ou auteur.');
      const retour = anciens.map(g => atelier.lire(store,g.id));
      store.db.exec('COMMIT'); return retour;
    }
    if (missions.objectifActif(store, references[0].id)) throw new Error('Cette tâche est déjà attribuée ou planifiée.');
    const prepares = d.missions.map(m => {
      const p = plans.planifier({ spec: m.spec, params, etat });
      if (p.proposition.statut === 'bloque' || !p.lancement) throw new Error(`Plan bloqué pour ${m.spec.projectId}.`);
      if (p.proposition.empreinte !== m.empreinte) throw new Error('Le plan a changé : relire les propositions.');
      if (p.proposition.statut === 'degrade' && !m.accepterDegrade) throw new Error('Confirmer les plans dégradés avant de planifier.');
      const lancement = { ...p.lancement, requestId: m.requestId };
      lancement.demande.spec._taskBoardObjective = { ...m.spec.contexte._taskBoardObjective, groupeId: d.groupeId };
      const { mission } = missions.construire(params, lancement, { plan: p.proposition.plan, verifierBackend });
      return { id: m.requestId, hash, mission, date, priority: m.scheduling.priority, qui, maintenant };
    });
    const retour = prepares.map(p => atelier.enregistrerPlan(store,p));
    store.db.exec('COMMIT'); return retour;
  } catch (err) { store.db.exec('ROLLBACK'); throw err; }
}
module.exports = { planifier };

function deplacer({ store, corps, maintenant = Date.now() }) {
  const d=schemas.deplacementPlan.parse(corps);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const c=store.commande(d.commandeId);
    if (!c || c.kind!=='run.start' || c.status!=='pending' || c.run_id || c.payload.scheduling?.notBefore!==d.prevuLe) throw new Error('Ce départ a changé ou a déjà commencé : recharge le tableau.');
    if (!c.payload.mission?.resolution?.spec?._mission?.objectifFeuille) throw new Error('Déplace cet objectif depuis sa fiche du calendrier.');
    const ancien=dates.civil(Date.parse(d.prevuLe));
    const at=dates.instantLocal(d.date,ancien.slice(11,16));
    if (d.date < dates.civil(maintenant).slice(0,10) || Date.parse(at)>maintenant+366*86400_000) throw new Error('Choisis une journée entre aujourd’hui et dans un an.');
    const payload={...c.payload,scheduling:{...c.payload.scheduling,notBefore:at,source:'calendar'}};
    store.db.prepare('UPDATE commands SET payload_json=? WHERE id=?').run(JSON.stringify(payload),c.id);
    store.db.exec('COMMIT');return {id:c.id,prevuLe:at};
  }catch(err){store.db.exec('ROLLBACK');throw err;}
}
module.exports.deplacer=deplacer;
