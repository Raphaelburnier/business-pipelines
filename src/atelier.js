const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const registre = require('agent-orchestrator/src/registre');
const { schemas, validerProjet } = require('agent-orchestrator/packages/schemas');
const contrats = require('agent-orchestrator/src/mission');
const schema = require('agent-orchestrator/packages/schemas/travaux');
const { fichiersEchange } = require('agent-orchestrator/src/checkpoints');
const dates = require('./atelier-dates');
const initialises = new WeakSet();
const vivant = new Set(['queued', 'running', 'paused', 'waiting_quota', 'waiting_machine', 'waiting_auth', 'waiting_approval', 'waiting_freshness']);
function initialiser(store) {
  if (initialises.has(store)) return;
  store.db.exec(`CREATE TABLE IF NOT EXISTS atelier_templates (
    id TEXT NOT NULL, version INTEGER NOT NULL, project_id TEXT NOT NULL,
    contenu TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS atelier_goals (
      id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
      project_id TEXT NOT NULL, title TEXT NOT NULL, draft_json TEXT NOT NULL, mission_json TEXT NOT NULL,
      priority TEXT NOT NULL, source TEXT NOT NULL, local_date TEXT NOT NULL, local_hour TEXT NOT NULL,
      recurrence TEXT NOT NULL, active INTEGER NOT NULL, next_at TEXT,
      owner TEXT NOT NULL, channel TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS atelier_occurrences (
      id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES atelier_goals(id),
      scheduled_at TEXT NOT NULL, local_date TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE REFERENCES commands(id),
      block_reason TEXT, UNIQUE(goal_id,scheduled_at));
    CREATE INDEX IF NOT EXISTS atelier_goals_due ON atelier_goals(active,next_at);`);
  initialises.add(store);
}
function transaction(store, faire) {
  store.db.exec('BEGIN IMMEDIATE');
  try { const r = faire(); store.db.exec('COMMIT'); return r; }
  catch (err) { store.db.exec('ROLLBACK'); throw err; }
}
function projet(params, id) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error('Projet invalide.');
  const p = validerProjet(JSON.parse(fs.readFileSync(path.join(params.projetsDir, id, 'project.json'), 'utf8')));
  if (p.id !== id) throw new Error('La fiche ne correspond pas au projet.');
  return p;
}
const dossier = (params) => params.registreDir || registre.dossierRegistre();
function catalogue(store, params) {
  initialiser(store);
  const agents = [], projets = [], modeles = [], erreurs = [];
  const racine = dossier(params);
  for (const nom of fs.readdirSync(path.join(racine, 'agents'))) {
    const dir = path.join(racine, 'agents', nom);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const version of fs.readdirSync(dir).filter((v) => /^v[1-9][0-9]*$/.test(v))) {
      try {
        const a = registre.lireAgent(racine, `${nom}@${version.slice(1)}`);
        agents.push({ ref: a.ref, nom: a.name, description: a.description, llm: a.defaultLlm,
          membres: params.roster.filter((m) => m.registre.includes(nom)).map((m) => ({ id: m.id, nom: m.nom, llm: m.llm })) });
      } catch (err) { erreurs.push(err.message); }
    }
  }
  for (const id of fs.readdirSync(params.projetsDir)) {
    if (!fs.existsSync(path.join(params.projetsDir, id, 'project.json'))) continue;
    try {
      const p = projet(params, id);
      projets.push({ id, nom: p.name });
      p.pipelines.forEach((a, index) => {
        const r = registre.resoudreProjet(path.join(params.projetsDir, id, 'project.json'), { index, registre: racine });
        modeles.push({ id: `registre:${id}:${a.extends}`, version: r.pipeline.version, projectId: id,
          graph: schema.graph.parse(r.pipeline), assignments: {}, baseRef: a.extends, origine: 'registre' });
      });
    } catch (err) { erreurs.push(`${id} : ${err.message}`); }
  }
  for (const l of store.db.prepare('SELECT t.* FROM atelier_templates t WHERE version = (SELECT MAX(version) FROM atelier_templates WHERE id=t.id) ORDER BY created_at DESC').all()) {
    modeles.push({ ...JSON.parse(l.contenu), id: l.id, version: l.version, origine: 'personnel' });
  }
  return { agents, projets, modeles, erreurs };
}

function resoudre(params, brut) {
  const d = schema.brouillon.parse(brut);
  const p = projet(params, d.projectId), racine = dossier(params);
  let base = null;
  if (d.baseRef) {
    const index = p.pipelines.findIndex((a) => a.extends === d.baseRef);
    if (index < 0) throw new Error('Le modèle de départ doit être attaché à ce projet.');
    base = registre.resoudreProjet(path.join(params.projetsDir, p.id, 'project.json'), { index, registre: racine });
    const original = schema.graph.parse(base.pipeline);
    // Les contrôles de publication et les branches qui y conduisent restent présents.
    for (const n of original.nodes) {
      const remplace = d.graph.nodes.find((v) => v.id === n.id);
      if (!remplace || remplace.type !== n.type) throw new Error(`L'étape requise ${n.id} doit être conservée.`);
      if (n.type !== 'agent' && contrats.empreinte(remplace) !== contrats.empreinte(n)) throw new Error(`Le contrôle ${n.id} doit être conservé tel quel.`);
    }
    for (const e of original.edges) if (!d.graph.edges.some((x) => contrats.empreinte(x) === contrats.empreinte(e))) throw new Error('Les liens du workflow de départ doivent être conservés.');
    for (const n of d.graph.nodes) if (n.type !== 'agent' && !original.nodes.some((x) => x.id === n.id)) throw new Error('Les nouveaux blocs exécutables sont des agents du registre.');
    if (d.graph.workspace !== original.workspace) throw new Error("Le type d'espace de travail du modèle doit être conservé.");
    d.graph.tags = original.tags;
  } else {
    if (d.graph.workspace !== 'documents' || d.graph.nodes.some((n) => n.type !== 'agent')) throw new Error('Un pipeline libre utilise des agents dans un espace documentaire. Pour développer une application, adapte son workflow de projet.');
    p.publier = false;
    d.graph.tags = ['ponctuel'];
  }
  // Artefacts transférés entre machines : uniquement des chemins relatifs sous le workspace.
  for (const n of d.graph.nodes) for (const f of [...(n.inputs || []), ...(n.outputs || [])]) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(f) || f.startsWith('/') || f.split('/').some((s) => s === '..' || s === '.git' || s === '')) throw new Error(`Chemin de livrable invalide : ${f}`);
  }
  const { pipeline, agents } = registre.chargerPipeline(racine, d.graph);
  const actifs = pipeline.nodes.filter((n) => ['agent', 'review'].includes(n.type));
  for (const cle of Object.keys(d.assignments)) if (!actifs.some((n) => n.id === cle)) throw new Error(`Affectation inconnue : ${cle}`);
  const participants = actifs.map((n) => {
    const id = d.assignments[n.id];
    const m = id && params.roster.find((x) => x.id === id);
    if (id && (!m || !m.registre.includes(n.agent.split('@')[0]))) throw new Error(`Agent incompatible pour ${n.id}.`);
    const llm = m ? m.llm : n.llm || agents[n.agent].defaultLlm;
    n.llm = llm;
    delete n.secours;
    if (n.type === 'review') {
      n.disabled = base?.pipeline.nodes.find((x) => x.id === n.id)?.disabled || false;
      n.params = { exchangeFiles: fichiersEchange(pipeline) };
    }
    return { noeud: n.id, membre: m ? m.id : null, llm, nom: m ? m.nom : agents[n.agent].name, agent: n.agent, type: n.type };
  });
  for (const reviewer of participants.filter((n) => n.type === 'review')) {
    if (reviewer.membre && participants.some((a) => a.type === 'agent' && a.membre === reviewer.membre)) throw new Error('La revue doit être confiée à un autre membre.');
  }
  const plafond = { maxTurnsPerAgent: 30, maxTotalTurns: 150, usdPerRun: 10, ...(base?.budget || {}) };
  const budget = { ...plafond };
  for (const k of ['maxTurnsPerAgent', 'maxTotalTurns', 'usdPerRun']) budget[k] = Math.min(plafond[k], pipeline.budget[k] || plafond[k]);
  for (const n of pipeline.nodes) {
    if (n.type === 'agent') n.maxTurns = Math.min(n.maxTurns || budget.maxTurnsPerAgent, budget.maxTurnsPerAgent);
    if (n.type === 'script' && n.handler === 'verify-project') n.params = { ...n.params, verification: p.verification, exchangeFiles: fichiersEchange(pipeline) };
  }
  return { brouillon: d, resolution: { projet: p, pipeline, agents, spec: base?.spec || {}, budget }, participants: participants.filter((n) => !pipeline.nodes.find((x) => x.id === n.noeud)?.disabled) };
}

function sauvegarder(store, params, brut) {
  initialiser(store);
  const s = schema.sauvegarde.parse(brut);
  const { id = crypto.randomUUID(), expectedVersion, ...d } = s;
  const { brouillon } = resoudre(params, d);
  return transaction(store, () => {
    const precedent = store.db.prepare('SELECT MAX(version) AS version FROM atelier_templates WHERE id=?').get(id).version || 0;
    if (precedent !== expectedVersion) throw new Error('Le modèle a changé : recharge sa dernière version.');
    const version = precedent + 1;
    brouillon.graph.version = version;
    store.db.prepare('INSERT INTO atelier_templates VALUES (?,?,?,?,?)').run(id, version, d.projectId, JSON.stringify(brouillon), new Date().toISOString());
    return { ...brouillon, id, version, origine: 'personnel' };
  });
}
function creer(store, params, brut, qui, maintenant = Date.now()) {
  initialiser(store);
  const d = schema.tache.parse(brut), hash = contrats.empreinte(d);
  return transaction(store, () => {
    const ancien = store.db.prepare('SELECT * FROM atelier_goals WHERE id=?').get(d.requestId);
    if (ancien) {
      if (ancien.request_hash !== hash || ancien.owner !== qui.par || ancien.channel !== (qui.canal || null)) throw new Error('Identifiant de demande déjà utilisé.');
      return lire(store, ancien.id);
    }
    const { resolution, participants } = resoudre(params, d.brouillon);
    const demande = { objectif: d.objectif, criteres: d.criteres, directives: '', exclusions: '', document: '' };
    resolution.spec = { ...resolution.spec, task: d.objectif, acceptance_criteria: d.criteres,
      _mission: { projectId: d.brouillon.projectId, ...demande } };
    const mission = contrats.figer({ resolution, participants, demande, id: d.requestId });
    const date = d.calendrier?.date || dates.civil(maintenant).slice(0, 10);
    const heure = d.calendrier?.heure || '00:00';
    const instant = d.calendrier ? dates.instantLocal(date, heure) : new Date(maintenant).toISOString();
    store.db.prepare(`INSERT INTO atelier_goals(id,request_hash,project_id,title,draft_json,mission_json,priority,source,local_date,local_hour,recurrence,active,next_at,owner,channel,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(d.requestId, hash, d.brouillon.projectId, d.objectif, JSON.stringify(d.brouillon), JSON.stringify(mission), d.priority,
      d.calendrier ? 'calendar' : 'manual', date, heure, d.calendrier?.repetition || 'none', d.calendrier?.active === false ? 0 : 1, instant, qui.par, qui.canal || null, new Date(maintenant).toISOString());
    return lire(store, d.requestId);
  });
}
function occurrences(store, id) {
  return store.db.prepare('SELECT * FROM atelier_occurrences WHERE goal_id=? ORDER BY scheduled_at DESC').all(id).map((o) => {
    const c = store.commande(o.command_id), run = c?.run_id && store.run(c.run_id);
    const livraison = run && store.livraison(run.id);
    return { id: o.id, date: o.local_date, scheduledAt: o.scheduled_at, commandId: o.command_id, runId: c?.run_id || null,
      statut: run?.status || (c?.status === 'refused' ? 'failed' : c?.status === 'taken' ? 'running' : 'queued'),
      raison: o.block_reason || c?.resultat?.raison || null, attente: run ? store.attentes.vue(run.id) : null,
      livraison: livraison ? { statut: livraison.status, terminee: Boolean(livraison.finished_at) } : null };
  });
}
function lire(store, id) {
  const g = store.db.prepare('SELECT * FROM atelier_goals WHERE id=?').get(id);
  if (!g) throw new Error('Objectif inconnu.');
  return { id: g.id, revision: g.revision, projectId: g.project_id, titre: g.title, priority: g.priority, source: g.source,
    date: g.local_date, heure: g.local_hour, repetition: g.recurrence, active: Boolean(g.active), nextAt: g.next_at,
    brouillon: JSON.parse(g.draft_json), criteres: JSON.parse(g.mission_json).criteres, occurrences: occurrences(store, id) };
}
function lister(store) {
  initialiser(store);
  return store.db.prepare('SELECT id FROM atelier_goals ORDER BY created_at DESC').all().map((g) => lire(store, g.id));
}
function bloqueSuccession(store, g) {
  const derniere = occurrences(store, g.id)[0];
  return derniere && (vivant.has(derniere.statut) || derniere.statut === 'failed' || (derniere.livraison && !derniere.livraison.terminee));
}
function programmer(store, maintenant = Date.now()) {
  initialiser(store);
  return transaction(store, () => {
    const commandes = [];
    for (const g of store.db.prepare('SELECT * FROM atelier_goals WHERE active=1 AND next_at<=? ORDER BY next_at,created_at').all(new Date(maintenant).toISOString())) {
      if (bloqueSuccession(store, g)) continue;
      const original = JSON.parse(g.mission_json), { empreinte, ...contenu } = original;
      const id = crypto.randomUUID();
      const mission = { ...contenu, id, creeLe: new Date(maintenant).toISOString() };
      mission.empreinte = contrats.empreinte(mission);
      const c = store.creerCommande({ kind: 'run.start', par: g.owner, canal: g.channel,
        payload: { projectId: g.project_id, pipelineIndex: 0, mission,
          llmOverrides: Object.fromEntries(mission.participants.map((p) => [p.noeud, p.llm])), requestId: id, requestHash: contrats.empreinte({ goal: g.id, date: g.next_at }),
          scheduling: { priority: g.priority, source: g.source, notBefore: g.next_at } } });
      store.db.prepare('INSERT INTO atelier_occurrences(id,goal_id,scheduled_at,local_date,command_id) VALUES (?,?,?,?,?)').run(id, g.id, g.next_at, g.local_date, c.id);
      const prochain = dates.suivante(g.local_date, g.local_hour, g.recurrence);
      store.db.prepare('UPDATE atelier_goals SET next_at=?,local_date=?,revision=revision+1 WHERE id=?').run(prochain?.instant || null, prochain?.date || g.local_date, g.id);
      commandes.push(c);
    }
    return commandes;
  });
}
function modifier(store, id, brut) {
  initialiser(store);
  const d = schema.changement.parse(brut);
  return transaction(store, () => {
    const g = store.db.prepare('SELECT * FROM atelier_goals WHERE id=?').get(id);
    if (!g || g.revision !== d.revision) throw new Error('Objectif modifié ailleurs : recharge le calendrier.');
    const dernier = occurrences(store, id)[0];
    const c = dernier && store.commande(dernier.commandId);
    let at = g.next_at, date = d.date || g.local_date, heure = d.heure || g.local_hour;
    if (d.date || d.heure) {
      if (c?.run_id || c?.status === 'taken') throw new Error('Ce travail a déjà commencé ; sa date ne peut plus être déplacée.');
      at = dates.instantLocal(date, heure);
      if (c?.status === 'pending') {
        const payload = { ...c.payload, scheduling: { ...c.payload.scheduling, notBefore: at } };
        store.db.prepare('UPDATE commands SET payload_json=? WHERE id=?').run(JSON.stringify(payload), c.id);
        store.db.prepare('UPDATE atelier_occurrences SET scheduled_at=?,local_date=? WHERE command_id=?').run(at, date, c.id);
        const suivant = dates.suivante(date, heure, g.recurrence);
        at = suivant?.instant || null; date = suivant?.date || date;
      }
    }
    if (d.priority && c?.status === 'pending') store.db.prepare("UPDATE commands SET payload_json=json_set(payload_json,'$.scheduling.priority',?) WHERE id=?").run(d.priority, c.id);
    store.db.prepare('UPDATE atelier_goals SET active=?,priority=?,next_at=?,local_date=?,local_hour=?,revision=revision+1 WHERE id=?').run(d.active === undefined ? g.active : Number(d.active), d.priority || g.priority, at, date, heure, id);
    return lire(store, id);
  });
}
function exclus(store, verifierBackend, maintenant = Date.now()) {
  initialiser(store);
  const bloques = new Map();
  for (const w of store.db.prepare("SELECT w.cause_json FROM run_waits w JOIN runs r ON r.id=w.run_id WHERE r.status IN ('waiting_quota','waiting_auth')").all()) {
    const cause = JSON.parse(w.cause_json);
    if (cause.statut === 'waiting_auth' || !cause.resetAt || Date.parse(cause.resetAt) > maintenant) bloques.set(cause.runtime, cause.raison);
  }
  const ids = [];
  for (const ligne of store.db.prepare("SELECT id FROM commands WHERE status='pending' AND kind IN ('run.start','run.resume','run.reverify')").all()) {
    const c = store.commande(ligne.id);
    const original = c.kind === 'run.start' ? c : store.commandeLancementRun(c.payload.runId);
    let raison = null;
    try {
      const occurrence = store.db.prepare('SELECT g.active FROM atelier_occurrences o JOIN atelier_goals g ON g.id=o.goal_id WHERE o.command_id=?').get(original?.id);
      if (occurrence?.active === 0 && !original?.run_id) throw new Error('Programmation en pause.');
      const r = original?.payload.mission?.resolution;
      if (r) {
        for (const n of r.pipeline.nodes.filter((n) => !n.disabled && n.type !== 'approval')) {
          const llm = ['agent', 'review'].includes(n.type) ? n.llm || r.agents[n.agent]?.defaultLlm : null;
          if (llm && bloques.has(llm.via === 'anthropic' ? 'claude' : llm.via)) throw new Error(bloques.get(llm.via === 'anthropic' ? 'claude' : llm.via));
          verifierBackend(llm, n, { pipeline: r.pipeline, agent: r.agents[n.agent] });
        }
        if (!original.run_id && r.budget.usdPerMonth) {
          const mois = new Date(maintenant).toISOString().slice(0, 7) + '-01T00:00:00.000Z';
          const cout = store.db.prepare('SELECT COALESCE(SUM(est_cost_usd),0) AS total FROM runs WHERE project_id=? AND started_at>=?').get(r.projet.id, mois).total;
          if (cout >= r.budget.usdPerMonth) throw new Error('Budget mensuel du projet atteint.');
        }
      }
    } catch (err) { raison = err.message; ids.push(c.id); }
    if (original) store.db.prepare('UPDATE atelier_occurrences SET block_reason=? WHERE command_id=?').run(raison, original.id);
  }
  return ids;
}
module.exports = { initialiser, catalogue, resoudre, sauvegarder, creer, lire, lister, programmer, modifier, exclus };
