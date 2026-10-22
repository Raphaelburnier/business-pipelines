#!/usr/bin/env node
// Consomme les commandes durables du cockpit. Une seule commande de run à la fois pour
// garder l'ordre de lancement et la concurrence de quota prévue.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventStore, chat, cockpitRead, envLoader, Maitre, servirMaitre, lireWorkers, wol } = require("agent-orchestrator");
const api = require("../src/api-lecture");
const chatOutils = require("../src/chat-outils");
const registre = require("agent-orchestrator/src/registre");
const { reprendreRun } = require("../src/reprises-runs");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const STORE = process.env.ORCH_EVENT_STORE || path.join(RACINE, "etat", "events.sqlite");
const INTERVALLE = Number(process.env.COMMAND_POLL_MS || 1000);
const MODELE_CHAT = process.env.COCKPIT_CHAT_MODELE || "sonnet";
// Les conseillers de « Demander » : Claude garde sa réflexion adaptative, à cet effort ;
// Codex tourne sur l'abonnement connecté dans ce conteneur (codex login).
const MODELE_CLAUDE = process.env.COCKPIT_CHAT_CLAUDE_MODELE || "opus";
const EFFORT_CLAUDE = process.env.COCKPIT_CHAT_CLAUDE_EFFORT || "high";
const MODELE_CODEX = process.env.COCKPIT_CHAT_CODEX_MODELE || "gpt-5.6-terra:high";
// Codex ne transmet pas tout l'environnement aux serveurs MCP qu'il lance : le script des
// outils reçoit explicitement de quoi retrouver la base, les projets, l'équipe et le vault.
const ENV_OUTILS = ["ORCH_EVENT_STORE", "ORCH_REGISTRE", "ORCH_MACHINE", "COCKPIT_PROJETS_DIR", "COCKPIT_EQUIPE_ROSTER", "COCKPIT_VIA_MACHINES", "CONSEILLER_BASE", "LIVRAISON_AUTORISES_FICHIER", "COCKPIT_CHAT_AGIR"];
const CODES_ATTENDUS = new Set([0, 75, 76, 77, 78]);

let arret = false;
let enfant = null;
// Le maître permanent (agent-orchestrator, src/maitre-distant.js) et son service. Null tant
// qu'il n'écoute pas : un run lancé entre-temps ouvre alors son propre maître, comme avant.
let maitre = null;
let serviceMaitre = null;
const REESSAI_MAITRE_MS = 30_000;
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Les décisions d'approbation ont leur file courte, mais la reprise reste exclusive avec
// tous les autres lancements de CLI du worker.
let finFileLancements = Promise.resolve();
let lancementsReserves = 0;
function lancerExclusif(...args) {
  lancementsReserves += 1;
  const lancement = finFileLancements.then(() => {
    if (arret) return { code: 1, signal: "SIGTERM", erreur: "runner arrêté avant le lancement" };
    return lancer(...args);
  });
  finFileLancements = lancement.then(() => undefined, () => undefined);
  lancement.finally(() => { lancementsReserves -= 1; }).catch(() => undefined);
  return lancement;
}

function projet(projectId) {
  const fichier = path.join(PROJETS, projectId, "project.json");
  if (!fichier.startsWith(`${path.resolve(PROJETS)}${path.sep}`) || !fs.existsSync(fichier)) {
    throw new Error(`projet inconnu : ${projectId}`);
  }
  return fichier;
}

// `reprendre` relance le run arrêté dans son propre dossier de travail (`--resume`), avec
// les mêmes choix de modèle.
function lancer({ projectId, pipelineIndex = 0, llmOverrides = {}, mission = null }, { reprendre = false, commandId = null, runId = null, reverifier = null } = {}) {
  const fichier = mission ? path.join(PROJETS, projectId, "project.json") : projet(projectId);
  // Les scripts du cockpit (`consigne`, `verify-couverture`…) : les nœuds `script` des
  // pipelines du registre les appellent par leur nom, et le moteur ne les a pas.
  const args = [
    require.resolve("agent-orchestrator/bin/orch.js"),
    "projet",
    fichier,
    "--pipeline",
    String(pipelineIndex),
    "--distribue",
    "--handlers",
    "src/stage-handlers.js",
  ];
  if (reprendre) args.push("--resume");
  if (commandId) args.push("--command-id", commandId);
  if (runId) args.push("--run-id", runId);
  if (reverifier) args.push("--reverifier", reverifier);
  for (const [noeud, llm] of Object.entries(llmOverrides || {})) {
    args.push("--llm", `${noeud}=${llm.via}:${llm.model}`);
  }
  return new Promise((resolve) => {
    // Avec le maître permanent en place, le run lui passe ses étapes au lieu d'ouvrir le port.
    const env = maitre ? { ...process.env, ORCH_MAITRE_DISTANT: "1" } : process.env;
    enfant = spawn(process.execPath, args, { cwd: RACINE, env, stdio: "inherit" });
    enfant.on("error", (err) => resolve({ code: 1, erreur: err.message }));
    enfant.on("close", (code, signal) => {
      enfant = null;
      resolve({ code: code ?? 1, signal: signal || null });
    });
  });
}

// L'instantané que lit le chat : ce que l'API du cockpit montre déjà, rien de plus.
function contexteCockpit(store) {
  return {
    releveLe: new Date().toISOString(),
    runs: api.runs(store, { limite: 15 }),
    machines: api.machines(store),
    usage: api.usage(store),
  };
}

// Les outils du chat lisent par les mêmes fonctions que l'API (src/chat-outils.js) : le chat
// voit ce que voit l'écran, jamais plus. `propositions` et `agir` (relancer une CI, écrire
// aux agents) ne vont qu'aux conseillers.
function outilsCockpit(store, { propositions = null, agir = null } = {}) {
  return cockpitRead.serveurCockpitRead({ ...chatOutils.sources(store), propositions, agir });
}

// Le conseiller agit au nom de celui qui a posé la question, tel que le cockpit l'a établi.
const agirPour = (store, commande, agent) => chatOutils.agir(store, { qui: { par: commande.par, canal: commande.canal }, agent });

// Le serveur stdio que Codex lance, et les noms de ses outils pour le prompt. L'identité de
// la question lui passe par l'environnement.
function codexChat(store, commande) {
  const agir = agirPour(store, commande, "codex");
  const noms = cockpitRead.definitionsOutils({ ...chatOutils.sources(store), propositions: { ajouter: () => undefined, nombre: () => 0 }, agir }).map((o) => o.nom);
  const env = Object.fromEntries(ENV_OUTILS.filter((k) => process.env[k]).map((k) => [k, String(process.env[k])]));
  if (agir) Object.assign(env, { COCKPIT_CHAT_PAR: String(commande.par), COCKPIT_CHAT_CANAL: String(commande.canal ?? "") });
  return {
    modele: MODELE_CODEX,
    outils: noms,
    // Avec approval_policy="never", Codex refuse un outil qui écrit tant que le serveur ne
    // déclare pas ses outils approuvés : ici seulement relancer une CI et écrire aux agents.
    mcp: (fichier) => ({ command: process.execPath, args: [path.join(RACINE, "bin", "chat-outils-mcp.js"), fichier], env, ...(agir ? { approbation: "approve" } : {}) }),
  };
}

async function repondre(store, commande) {
  const { threadId, responseMessageId, agent = "cockpit" } = commande.payload;
  const commun = { store, threadId, responseMessageId, agent };
  if (agent === "claude") {
    const agir = agirPour(store, commande, agent);
    return chat.repondreChat({ ...commun, modele: MODELE_CLAUDE, effort: EFFORT_CLAUDE, outils: ({ propositions }) => outilsCockpit(store, { propositions, agir }) });
  }
  if (agent === "codex") return chat.repondreChat({ ...commun, codex: codexChat(store, commande) });
  return chat.repondreChat({ ...commun, contexte: contexteCockpit(store), modele: MODELE_CHAT, outils: await outilsCockpit(store) });
}

// Deux files dans le même processus : un run tient sa boucle pendant des minutes, une
// question ne doit pas l'attendre. Chaque boucle ne réserve que ses propres commandes.
async function boucle(store, kinds, executer, { prioriserRuns = false } = {}) {
  while (!arret) {
    let exclure = [];
    if (kinds.includes("run.resume")) {
      store.attentes.programmer();
      const atelier = require("../src/atelier");
      atelier.programmer(store);
      // Les recettes CLI locales n'utilisent aucun worker distant.
      const verifier = process.env.ORCH_ROLE === "pc" ? () => {} : require("../src/runtime-mission").verifier({
        viaParMachine: JSON.parse(process.env.COCKPIT_VIA_MACHINES || '{"pc":["claude","codex","omniroute","ollama"],"nas":["claude"]}'), machines: api.machines(store),
      });
      exclure = atelier.exclus(store, verifier);
      if (lancementsReserves) { await attendre(INTERVALLE); continue; }
    }
    const commande = store.prendreCommande(prioriserRuns ? { kinds, prioriserRuns: true, exclure } : { kinds });
    if (!commande) {
      await attendre(INTERVALLE);
      continue;
    }
    console.log(`Commande ${commande.id} : ${commande.kind}, demandée par ${commande.par}`);
    await traiterCommande(store, commande, executer);
  }
}

// Les décisions sont enregistrées immédiatement, puis leurs reprises attendent le verrou
// partagé. Ne pas attendre une reprise ici : sinon une CLI longue empêcherait d'enregistrer
// toutes les autres décisions déjà présentes dans la file.
async function boucleApprobations(store) {
  const enCours = new Set();
  while (!arret) {
    const commande = store.prendreCommande({ kinds: ["approval.decide"] });
    if (!commande) {
      await attendre(INTERVALLE);
      continue;
    }
    console.log(`Commande ${commande.id} : ${commande.kind}, demandée par ${commande.par}`);
    let operation;
    operation = traiterCommande(store, commande, (c) => deciderEtReprendre(store, c, lancerExclusif))
      .finally(() => enCours.delete(operation));
    enCours.add(operation);
  }
  await Promise.allSettled(enCours);
}

async function traiterCommande(store, commande, executer) {
  try {
    const resultat = await executer(commande);
    // Un arrêt du runner ne refuse pas la tâche interrompue : elle reste réservée,
    // sera remise en file, et retrouvera son run au redémarrage.
    if (!arret || commande.kind === "chat.respond") {
      store.terminerCommande(commande.id, resultat);
      if (commande.kind === "run.resume") store.attentes.terminer(commande);
    }
  } catch (err) {
    if (!arret || commande.kind === "chat.respond") {
      store.terminerCommande(commande.id, { ok: false, raison: err.message });
      if (commande.kind === "run.resume") store.attentes.terminer(commande);
    }
    console.error(`Commande ${commande.id} refusée : ${err.message}`);
  }
}

function issue(resultat, detail = {}) {
  if (CODES_ATTENDUS.has(resultat.code)) return { ok: true, detail: { ...resultat, ...detail } };
  return { ok: false, raison: resultat.erreur || `processus terminé en code ${resultat.code}` };
}

// Le pipeline et les modèles de la commande qui a créé ce run précis. Un lancement
// ultérieur sur le même projet n'en change ni les modèles ni le dossier.
function lancementDe(store, run) {
  const commande = store.commandeLancementRun(run.id);
  if (commande) return commande.payload;
  // Compatibilité avec les anciens runs CLI : leur journal vérifie toujours l'empreinte
  // du pipeline. Aucun choix de modèle n'est emprunté au dernier run d'un autre lancement.
  const fiche = JSON.parse(fs.readFileSync(projet(run.project_id), "utf8"));
  const index = (fiche.pipelines || []).findIndex((p) => p.extends === run.pipeline_ref);
  if (index < 0) throw new Error("Le pipeline du run n'est plus configuré dans le projet.");
  return {
    projectId: run.project_id,
    pipelineIndex: index,
    llmOverrides: {},
  };
}

// Trancher puis reprendre (phase 5). La décision est écrite par `deciderApprobation`, qui
// revérifie tout, sous la signature de la commande. Rejouée après un redémarrage du runner,
// une décision déjà écrite par cette même commande n'est pas réécrite : seul le run reprend.
async function deciderEtReprendre(store, commande, lancerRun = lancerExclusif) {
  const { approbationId, decision, note = null, actions = [] } = commande.payload;
  const a = store.approbation(approbationId);
  if (!a) throw new Error(`approbation inconnue : ${approbationId}`);
  store.lierDecisionRun(commande.id, a.run_id);
  const dejaEcrite = a.status === decision && a.par === commande.par;
  if (!dejaEcrite) {
    store.deciderApprobation(a.id, { decision, note, par: commande.par, canal: commande.canal, actions });
    store.emettre({ type: "approval.decided", runId: a.run_id, payload: { node: a.node_id, decision, par: commande.par } });
  }
  const run = store.run(a.run_id);
  if (!run) throw new Error(`run inconnu : ${a.run_id}`);
  const lancement = lancementDe(store, run);
  const repris = await lancerRun(lancement, { reprendre: true, runId: a.run_id });
  // « Renvoyer au pipeline » : une orientation que le pipeline ne route nulle part termine
  // simplement le run (marketing@1). Un nouveau tour repart alors, et son nœud `consigne` y
  // reprend la note. Ce nouveau tour est mis en file et lié à sa propre commande.
  // Un pipeline qui gère l'orientation lui-même n'est jamais relancé deux fois.
  if (decision === "oriented" && repris.code === 0 && !orientationRoutee(lancement, a.node_id)) {
    return store.terminerOrientation(commande.id, { payload: lancement, detail: { ...repris, decision } });
  }
  return issue(repris, { runId: a.run_id, decision });
}

// Le pipeline a-t-il une arête qui part du nœud d'approbation sur une orientation ? Dans le
// doute (registre illisible), on répond oui : mieux vaut un tour de moins qu'un tour en double.
function orientationRoutee(lancement, nodeId) {
  try {
    const pipeline = lancement.mission?.resolution.pipeline || registre.resoudreProjet(projet(lancement.projectId), { index: lancement.pipelineIndex }).pipeline;
    return (pipeline.edges || []).some((e) => e.from === nodeId && (!e.on || e.on === "oriented"));
  } catch (err) {
    console.error(`registre illisible, pas de nouveau tour : ${err.message}`);
    return true;
  }
}

// Une PR corrigée hors du run (CI autofix) : tests et revues obligatoires repassent sur sa
// tête, avec les modèles de la commande qui a lancé le run.
async function reverifier(store, commande) {
  const { runId, headSha } = commande.payload;
  const run = store.run(runId);
  if (!run) throw new Error(`run inconnu : ${runId}`);
  const resultat = await lancerExclusif(lancementDe(store, run), { runId, reverifier: headSha });
  return issue(resultat, { runId, headSha });
}

async function executerRun(store, commande) {
  if (commande.kind === "run.resume") return reprendreRun({ store, commande, lancer: lancerExclusif, lancementDe });
  if (commande.kind === "run.reverify") return reverifier(store, commande);
  const resultat = await lancerExclusif(commande.payload, { commandId: commande.id });
  return issue(resultat, { runId: store.commande(commande.id)?.run_id || null });
}

// Le maître vit avec le runner, pas avec un run : le PC reste connecté entre deux runs, et
// le cockpit le voit en ligne avant d'en lancer un (décision du 2026-10-05). L'adresse
// d'écoute (ORCH_MAITRE_HOTE, l'IP tailnet du NAS) peut manquer au démarrage du NAS, avant
// Tailscale : le runner ne tombe pas pour autant, il réessaie, et ses autres files tournent.
async function ouvrirMaitre(store) {
  // Un moteur antérieur à agent-orchestrator#25 n'a pas de maître permanent : chaque run
  // ouvre alors le sien, comme avant, au lieu de faire tomber le runner.
  if (typeof Maitre !== "function" || typeof servirMaitre !== "function") {
    console.error("moteur sans maître permanent : chaque run ouvre son propre maître");
    return;
  }
  while (!arret && !maitre) {
    const candidat = new Maitre({
      store,
      workers: lireWorkers(),
      wol: ["0", "false", "no", "off"].includes(String(process.env.ORCH_REVEIL_MACHINE ?? "1").toLowerCase()) ? null : wol.pourMaitre(),
    });
    try {
      await candidat.demarrer();
      maitre = candidat;
      // L'environnement que le run aurait chargé lui-même, rajouté ici : il ne passe jamais
      // par la file, qui est écrite sur le disque.
      serviceMaitre = servirMaitre({ store, maitre, env: envLoader.load(RACINE, "", process.env.ENV_FILE) });
    } catch (err) {
      await candidat.arreter().catch(() => undefined);
      console.error(`maître permanent indisponible (${err.message}) : nouvel essai dans ${REESSAI_MAITRE_MS / 1000} s`);
      await attendre(REESSAI_MAITRE_MS);
    }
  }
}

async function demarrer() {
  const store = new EventStore(STORE);
  const bail = require("node:crypto").randomUUID();
  try { store.attentes.acquerirBail(bail); }
  catch (err) { store.fermer(); throw err; }
  store.attentes.reconcilier();
  const renouvellement = setInterval(() => {
    try { store.attentes.renouvelerBail(bail); }
    catch (err) { console.error(err.message); arret=true; enfant?.kill("SIGTERM"); }
  }, 1000);
  // Seulement les commandes de ce runner : une livraison réservée par le livreur ne doit pas
  // retourner en file quand la bascule redémarre le runner (docs/SPEC-livraison.md, §4.3).
  const reprises = store.reprendreCommandesInterrompues({ kinds: ["run.start", "run.resume", "approval.decide", "run.reverify", "chat.respond"] });
  console.log(`Runner de commandes sur ${STORE}${reprises ? ` — ${reprises} commande(s) reprise(s)` : ""}`);
  try {
    await Promise.all([
      ouvrirMaitre(store),
      boucle(store, ["run.start", "run.resume", "run.reverify"], (commande) => executerRun(store, commande), { prioriserRuns: true }),
      // La décision est enregistrée hors de la file longue. Son lancement attend le verrou
      // partagé avec les runs : le worker n'exécute toujours qu'une seule CLI à la fois.
      boucleApprobations(store),
      boucle(store, ["chat.respond"], (commande) => repondre(store, commande)),
    ]);
  } finally {
    clearInterval(renouvellement);
    if (serviceMaitre) await serviceMaitre.arreter();
    if (maitre) await maitre.arreter();
    store.attentes.libererBail(bail);
    store.fermer();
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    arret = true;
    if (enfant) enfant.kill(signal);
  });
}

demarrer().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
