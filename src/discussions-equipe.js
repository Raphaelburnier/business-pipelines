// Fil d'équipe durable. Les modèles passent par run.start et le maître existants. Le gabarit,
// les compétences admises et la nature qui reçoit les specs viennent de la nature du projet.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const registre = require("agent-orchestrator/src/registre");
const mission = require("agent-orchestrator/src/mission");
const { validerPipeline } = require("agent-orchestrator/packages/schemas");
const schema = require("agent-orchestrator/packages/schemas/equipes");
const missions = require("./missions");
const natures = require("./natures");

const MAX_TOURS = 40;
const OCCUPE = new Set(["pending", "taken", "running", "waiting_auth", "waiting_quota", "waiting_machine", "waiting_approval", "cancelled"]);
const maintenant = () => new Date().toISOString();
const noeudDe = (membre) => `repond-${membre}`;

function initialiser(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS team_threads (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, project_name TEXT NOT NULL,
      objectif TEXT NOT NULL, participants_json TEXT NOT NULL, resolution_json TEXT NOT NULL,
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_turns (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES team_threads(id),
      contenu TEXT NOT NULL, type TEXT NOT NULL, destinataires_json TEXT NOT NULL,
      command_id TEXT NOT NULL REFERENCES commands(id), par TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS team_turns_thread ON team_turns(thread_id, created_at);
    CREATE TABLE IF NOT EXISTS team_drafts (
      id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES team_threads(id),
      payload_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS team_requests (
      id TEXT PRIMARY KEY, action TEXT NOT NULL, hash TEXT NOT NULL,
      par TEXT NOT NULL, canal TEXT, result_json TEXT NOT NULL
    );
  `);
}

/**
 * La discussion d'équipe d'un projet : celle d'une nature de ses pipelines, sinon la première
 * déclarée (un projet de code peut ouvrir une discussion marketing, comme avant).
 * @param {{ projetsDir: string, projectId: string, dossier?: string }} entree
 */
function discussionDuProjet({ projetsDir, projectId, dossier = registre.dossierRegistre() }) {
  const declarees = natures.naturesDeclarees(dossier);
  const possibles = natures.discussionsDeclarees(declarees);
  if (!possibles.length) throw new Error("Aucune nature ne déclare de discussion d'équipe.");
  const fiche = JSON.parse(fs.readFileSync(path.join(projetsDir, projectId, "project.json"), "utf-8"));
  const duProjet = (fiche.pipelines || []).map((a) => {
    try { return natures.classer(registre.lirePipelineBrut(dossier, a.extends), declarees).nature; } catch { return null; }
  });
  return possibles.find((d) => duProjet.includes(d.nature)) || possibles[0];
}

function lireOptions({ projetsDir, projectId, roster, affectations }) {
  const { resolution } = missions.lire({ projetsDir, projectId, roster, affectations });
  const discussion = discussionDuProjet({ projetsDir, projectId });
  const competences = new Set(discussion.competences);
  const gabarit = registre.chargerPipeline(registre.dossierRegistre(), discussion.gabarit);
  const membres = roster.filter((m) => m.registre.some((r) => competences.has(r)) && ["claude", "codex"].includes(m.llm.via))
    .map((m) => ({ membre: m.id, nom: m.nom, role: m.role, llm: m.llm }));
  const base = { projet: { ...resolution.projet, publier: false }, ...gabarit, budget: gabarit.pipeline.budget };
  const configuration = mission.empreinte({ base, membres });
  return { base, discussion, options: schema.options.parse({ projectId, nom: resolution.projet.name, configuration, membres }) };
}

/** La discussion dont un fil a lancé le gabarit, retrouvée par la référence du gabarit. */
function discussionDuFil(row) {
  const p = JSON.parse(row.resolution_json).pipeline;
  const ref = `${p.name}@${p.version}`;
  const discussion = natures.discussionsDeclarees().find((d) => d.gabarit === ref);
  if (!discussion) throw new Error(`Aucune nature ne déclare plus le gabarit ${ref} de cette discussion.`);
  return discussion;
}

function ligneFil(store, id) {
  const row = store.db.prepare("SELECT * FROM team_threads WHERE id = ?").get(id);
  if (!row) throw new Error("Discussion d'équipe inconnue.");
  return row;
}
function resume(row) {
  return schema.resume.parse({ id: row.id, projectId: row.project_id, projet: row.project_name,
    objectif: row.objectif, creeLe: row.created_at, majLe: row.updated_at, participants: JSON.parse(row.participants_json) });
}
function tours(store, filId) {
  return store.db.prepare("SELECT * FROM team_turns WHERE thread_id = ? ORDER BY rowid").all(filId).map((row) => {
    const commande = store.commande(row.command_id);
    const run = commande?.run_id ? store.run(commande.run_id) : null;
    const destinataires = JSON.parse(row.destinataires_json);
    const reponses = [];
    if (run) {
      const etapes = store.etapes(run.id);
      const evenements = store.db.prepare("SELECT step_id, payload_json FROM events WHERE run_id = ? AND type = 'team.reply' ORDER BY id").all(run.id);
      for (const e of evenements) {
        const p = JSON.parse(e.payload_json);
        const etape = etapes.find((s) => s.node_id === p.noeud && s.status === "succeeded" && s.id === e.step_id);
        const rendu = schema.reponse.safeParse(p.reponse);
        if (p.fil === filId && p.tour === row.id && destinataires.includes(p.membre) && p.noeud === noeudDe(p.membre) && etape && rendu.success && !reponses.some((r) => r.membre === p.membre)) {
          reponses.push({ membre: p.membre, noeud: p.noeud, reponse: rendu.data, modeleObserve: etape.llm_model || null });
        }
      }
    }
    return { id: row.id, type: row.type, contenu: row.contenu, par: row.par, creeLe: row.created_at,
      destinataires, commande: row.command_id, run: run?.id || null,
      statut: run?.status || commande?.status || "refused", erreur: commande?.resultat?.raison || null, reponses };
  });
}
function liste(store, projectId) {
  initialiser(store);
  const rows = projectId
    ? store.db.prepare("SELECT * FROM team_threads WHERE project_id = ? ORDER BY updated_at DESC LIMIT 50").all(projectId)
    : store.db.prepare("SELECT * FROM team_threads ORDER BY updated_at DESC LIMIT 50").all();
  return rows.map(resume);
}
function fil(store, id) {
  initialiser(store);
  const row = ligneFil(store, id);
  const brouillons = store.db.prepare("SELECT payload_json FROM team_drafts WHERE thread_id = ? ORDER BY rowid").all(id).map((d) => schema.brouillon.parse(JSON.parse(d.payload_json)));
  return schema.fil.parse({ ...resume(row), tours: tours(store, id), brouillons });
}

function unique(store, qui, requestId, action, contenu, creer) {
  initialiser(store);
  const hash = mission.empreinte(contenu);
  store.db.exec("BEGIN IMMEDIATE");
  try {
    const ancienne = store.db.prepare("SELECT * FROM team_requests WHERE id = ?").get(requestId);
    let result;
    if (ancienne) {
      if (ancienne.action !== action || ancienne.hash !== hash || ancienne.par !== qui.par || ancienne.canal !== (qui.canal ?? null)) {
        throw new Error("Cet identifiant d'envoi a déjà été utilisé pour une autre demande.");
      }
      result = JSON.parse(ancienne.result_json);
    } else {
      result = creer();
      store.db.prepare("INSERT INTO team_requests (id, action, hash, par, canal, result_json) VALUES (?, ?, ?, ?, ?, ?)")
        .run(requestId, action, hash, qui.par, qui.canal ?? null, JSON.stringify(result));
    }
    store.db.exec("COMMIT");
    return result;
  } catch (err) { store.db.exec("ROLLBACK"); throw err; }
}

function mettreEnFile(store, row, demande, qui, verifierBackend) {
  const historique = tours(store, row.id);
  if (historique.length >= MAX_TOURS) throw new Error("Cette discussion a atteint 40 tours. Ouvrir un nouveau fil avec la synthèse retenue.");
  if (historique.some((t) => OCCUPE.has(t.statut))) throw new Error("Un tour est encore en cours ou attend une reprise : terminer ce tour avant le suivant.");
  const participants = JSON.parse(row.participants_json);
  const destinataires = demande.destinataires || participants.map((p) => p.membre);
  if (new Set(destinataires).size !== destinataires.length || destinataires.some((id) => !participants.some((p) => p.membre === id))) {
    throw new Error("Destinataire absent de l'équipe de ce fil ou choisi deux fois.");
  }
  const id = crypto.randomUUID();
  const base = JSON.parse(row.resolution_json);
  const modele = base.pipeline.nodes[0];
  const retenus = participants.filter((p) => destinataires.includes(p.membre));
  const nodes = retenus.map((p, i) => ({ ...modele, id: noeudDe(p.membre), llm: p.llm,
    outputs: [`reponse-${p.membre}.json`],
    inputs: retenus.slice(0, i).map((a) => `reponse-${a.membre}.json`),
    outputSchema: { [`reponse-${p.membre}.json`]: { contenu: "string", questions: "array", propositions: "array" } },
    slice: ["dialogue", `interlocuteur_${p.membre}`], dialogue: { membre: p.membre, fichier: `reponse-${p.membre}.json` } }));
  for (const n of nodes) verifierBackend(n.llm, n);
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }));
  const pipeline = validerPipeline({ ...base.pipeline, nodes, edges }, { agents: base.agents });
  const directives = historique.filter((t) => t.type === "directive").map((t) => t.contenu);
  if (demande.type === "directive") directives.push(demande.contenu);
  let restant = 64_000;
  const contexte = historique.slice(-12).reverse().map((t) => ({ tour: t.id, message: t.contenu, type: t.type,
    reponses: t.reponses.map((r) => {
      const texte = JSON.stringify({ propositions: r.reponse.propositions.map((p, index) => ({ index, titre: p.titre, objectif: p.objectif.slice(0, 600), criteres: p.criteres.slice(0, 4) })),
        questions: r.reponse.questions, contenu: r.reponse.contenu });
      const resume = texte.slice(0, Math.min(restant, 4000));
      restant -= resume.length;
      return { membre: r.membre, resume, abrege: resume.length < texte.length };
    }) })).reverse();
  const spec = { project_name: row.project_id,
    dialogue: { fil: row.id, tour: id, objectif: row.objectif, destinataires, message: demande.contenu,
      type: demande.type, directives, historique: contexte, projet: { id: row.project_id, nom: row.project_name, domaine: base.projet.business } },
    ...Object.fromEntries(retenus.map((p) => [`interlocuteur_${p.membre}`, { nom: p.nom, role: p.role, membre: p.membre }])),
    _mission: { projectId: row.project_id, objectif: row.objectif, criteres: ["Réponse attribuée de chaque destinataire et propositions explicites si utiles"], document: demande.contenu, directives: directives.join("\n"), exclusions: "Aucune modification de l'application ni publication externe dans ce tour." } };
  const acteurs = retenus.map((p) => ({ noeud: noeudDe(p.membre), membre: p.membre, nom: p.nom, agent: modele.agent, type: "agent", llm: p.llm }));
  const contrat = mission.figer({ id, resolution: { ...base, pipeline, spec }, participants: acteurs,
    demande: { ...spec._mission, directives: "Directives persistantes dans le contexte partagé du fil." } });
  const commande = store.creerCommande({ kind: "run.start", payload: { projectId: row.project_id, pipelineIndex: 0,
    llmOverrides: Object.fromEntries(acteurs.map((p) => [p.noeud, p.llm])), mission: contrat }, par: qui.par, canal: qui.canal });
  const date = maintenant();
  store.db.prepare("INSERT INTO team_turns (id, thread_id, contenu, type, destinataires_json, command_id, par, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, row.id, demande.contenu, demande.type, JSON.stringify(destinataires), commande.id, qui.par, date);
  store.db.prepare("UPDATE team_threads SET updated_at = ? WHERE id = ?").run(date, row.id);
  return { fil: row.id, tour: id, commande: commande.id };
}

function ouvrir({ store, qui, params, demande, verifierBackend }) {
  const d = schema.ouverture.parse(demande);
  const result = unique(store, qui, d.requestId, "ouvrir", d, () => {
    const { options, base, discussion } = lireOptions({ ...params, projectId: d.projectId });
    if (options.configuration !== d.configuration) throw new Error("L'équipe ou le projet a changé : relire avant ouverture.");
    if (new Set(d.participants.map((p) => p.membre)).size !== d.participants.length) throw new Error("Un membre a été sélectionné deux fois.");
    const participants = d.participants.map((p) => {
      const membre = options.membres.find((m) => m.membre === p.membre);
      if (!membre) throw new Error(`Membre incompatible avec l'équipe ${discussion.libelle.toLowerCase()}.`);
      return { ...membre, llm: p.llm };
    });
    const date = maintenant();
    store.db.prepare("INSERT INTO team_threads (id, project_id, project_name, objectif, participants_json, resolution_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(d.requestId, d.projectId, options.nom, d.objectif, JSON.stringify(participants), JSON.stringify(base), qui.par, date, date);
    return mettreEnFile(store, ligneFil(store, d.requestId), { contenu: d.contenu, type: d.type }, qui, verifierBackend);
  });
  return fil(store, result.fil);
}
function envoyer({ store, qui, filId, demande, verifierBackend }) {
  const d = schema.message.parse(demande);
  const result = unique(store, qui, d.requestId, "message", { filId, ...d }, () => mettreEnFile(store, ligneFil(store, filId), d, qui, verifierBackend));
  return fil(store, result.fil);
}
function preparerBrouillon({ store, qui, filId, demande }) {
  const d = schema.demandeBrouillon.parse(demande);
  const result = unique(store, qui, d.requestId, "brouillon", { filId, ...d }, () => {
    const f = fil(store, filId);
    const t = f.tours.find((t) => t.id === d.tour);
    const proposition = t?.reponses.find((r) => r.membre === d.membre)?.reponse.propositions[d.proposition];
    if (!proposition) throw new Error("Proposition absente ou réponse non validée.");
    const ancienne = f.brouillons.find((b) => b.origine.tour === d.tour && b.origine.membre === d.membre && b.origine.proposition === d.proposition);
    if (ancienne) return { brouillon: ancienne.id };
    const dialogue = store.commande(t.commande)?.payload.mission?.resolution.spec.dialogue;
    if (!dialogue) throw new Error("Contexte du tour introuvable.");
    const draft = schema.brouillon.parse({ ...proposition, id: d.requestId, projectId: f.projectId,
      origine: { fil: filId, tour: d.tour, membre: d.membre, proposition: d.proposition }, creeLe: maintenant(),
      objectifProjet: f.objectif, directives: dialogue.directives });
    store.db.prepare("INSERT INTO team_drafts (id, thread_id, payload_json, created_at) VALUES (?, ?, ?, ?)")
      .run(draft.id, filId, JSON.stringify(draft), draft.creeLe);
    return { brouillon: draft.id };
  });
  return lireBrouillon(store, result.brouillon);
}
function lireBrouillon(store, id) {
  initialiser(store);
  const d = store.db.prepare("SELECT payload_json FROM team_drafts WHERE id = ?").get(id);
  if (!d) throw new Error("Brouillon d'équipe inconnu.");
  return schema.brouillon.parse(JSON.parse(d.payload_json));
}
function origineBrouillon(store, id, projectId, nature) {
  const d = lireBrouillon(store, id);
  const versNature = discussionDuFil(ligneFil(store, d.origine.fil)).versNature;
  if (!versNature) throw new Error("La nature de cette discussion ne transmet ses specs à aucun workflow.");
  if (d.projectId !== projectId || nature !== versNature) throw new Error(`Cette spec doit être envoyée à un workflow ${versNature} du même projet.`);
  return { origine: d.origine, contexte: { objectifProjet: d.objectifProjet, directives: d.directives, propositionOriginale: { titre: d.titre, objectif: d.objectif, criteres: d.criteres, document: d.document } } };
}
module.exports = { lireOptions, discussionDuProjet, discussionDuFil, liste, fil, ouvrir, envoyer, preparerBrouillon, lireBrouillon, origineBrouillon };
