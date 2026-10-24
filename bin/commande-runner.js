#!/usr/bin/env node
// Consomme les commandes durables du cockpit. Les runs peuvent être lancés en parallèle ;
// le maître applique la capacité configurée de chaque worker au dispatch des étapes.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventStore, chat, cockpitRead, envLoader, Maitre, servirMaitre, lireWorkers, wol } = require("agent-orchestrator");
const api = require("../src/api-lecture");
const chatOutils = require("../src/chat-outils");
const registre = require("agent-orchestrator/src/registre");
const { reprendreRun, terminerReprise } = require("../src/reprises-runs");
const { raisonEchec } = require("../src/echec-run");

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
const DELAI_DIAGNOSTIC_RUN_MS = 6 * 60 * 60 * 1000;
// Codex ne transmet pas tout l'environnement aux serveurs MCP qu'il lance : le script des
// outils reçoit explicitement de quoi retrouver la base, les projets, l'équipe et le vault.
const ENV_OUTILS = ["ORCH_EVENT_STORE", "ORCH_REGISTRE", "ORCH_MACHINE", "COCKPIT_PROJETS_DIR", "COCKPIT_EQUIPE_ROSTER", "COCKPIT_VIA_MACHINES", "CONSEILLER_BASE", "LIVRAISON_AUTORISES_FICHIER", "COCKPIT_CHAT_AGIR"];
const CODES_ATTENDUS = new Set([0, 75, 76, 77, 78]);

let arret = false;
const enfants = new Set();
let prochaineSondeQuotaCodex = 0;
let sondeQuotaCodexEnCours = false;
let dernierEtatQuotaLogge = null;
// Le maître permanent (agent-orchestrator, src/maitre-distant.js) et son service. Null tant
// qu'il n'écoute pas : un run lancé entre-temps ouvre alors son propre maître, comme avant.
let maitre = null;
let serviceMaitre = null;
const REESSAI_MAITRE_MS = 30_000;
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sonderQuotaCodex(store) {
  if (sondeQuotaCodexEnCours || Date.now() < prochaineSondeQuotaCodex) return;
  sondeQuotaCodexEnCours = true;
  prochaineSondeQuotaCodex = Date.now() + 5 * 60_000;
  void require("../src/codex-quota").lireQuotaCodex().then((snapshot) => {
    if (snapshot) store.emettre({ type: "runtime.quota_snapshot", payload: snapshot });
  }).catch((err) => {
    console.warn(`Quota Codex inconnu : ${err.message}`);
  }).finally(() => { sondeQuotaCodexEnCours = false; });
}

// Les reprises et décisions utilisent le même chemin de lancement que les nouveaux runs.
const lancementsParRun = new Map();
function capaciteRuns() {
  const distants=[...(maitre?.connexions.values() || [])].reduce((n,c)=>n+(Number.isInteger(c.capacites?.concurrence)?c.capacites.concurrence:1),0);
  return Math.min(64,1+distants); // une voie locale, puis la capacité annoncée des workers
}
function lancerParallele(lancement, options = {}) {
  const key = options.runId ? options.store?.commandeLancementRun(options.runId)?.id || options.runId : options.commandId;
  const avant = lancementsParRun.get(key) || Promise.resolve();
  const operation = avant.catch(()=>{}).then(async()=> {
    while (!arret && (!maitre || enfants.size >= capaciteRuns())) await attendre(Math.min(INTERVALLE,50));
    if (arret) return { code: 1, signal: "SIGTERM", erreur: "runner arrêté avant le lancement" };
    return lancer(lancement, options);
  });
  if (key) {
    lancementsParRun.set(key,operation);
    void operation.finally(()=>{if(lancementsParRun.get(key)===operation)lancementsParRun.delete(key);}).catch(()=>{});
  }
  return operation;
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
function delaiDiagnosticRun() {
  const variable = "COCKPIT_RUN_DIAGNOSTIC_MS";
  const brut = process.env[variable];
  if (brut === undefined || brut === "") return DELAI_DIAGNOSTIC_RUN_MS;
  const valeur = Number(brut);
  const maximum = 24 * 60 * 60 * 1000;
  if (!Number.isSafeInteger(valeur) || valeur < 1 || valeur > maximum) {
    throw new Error(`${variable} doit être un entier entre 1 et ${maximum} ms`);
  }
  return valeur;
}

function diagnosticRun(store, runId, debut) {
  if (!runId || !store) return;
  const run = store.run(runId);
  if (!run || run.status !== "running") return;
  const evenements = store.evenements({ runId });
  const dernierEvenement = evenements.at(-1);
  const progression = new Set([
    "step.progress", "step.started", "step.finished", "script.start", "script.done",
    "node.done", "cycle.loop", "checkpoint.commit", "workspace.outputs.received",
  ]);
  const derniereProgression = [...evenements].reverse().find((e) => progression.has(e.type));
  const etapesEnCours = store.etapes(runId)
    .filter((e) => e.status === "running")
    .map((e) => ({ id: e.id, noeud: e.node_id, type: e.type, machine: e.machine_id, demarreeLe: e.started_at }));
  store.emettre({
    type: "run.long_running",
    runId,
    payload: {
      seuilMs: delaiDiagnosticRun(),
      dureeMs: Date.now() - Date.parse(debut),
      dernierEvenement: dernierEvenement ? { type: dernierEvenement.type, le: dernierEvenement.ts } : null,
      derniereProgression: derniereProgression ? { type: derniereProgression.type, le: derniereProgression.ts } : null,
      etapesEnCours,
      action: "diagnostic uniquement ; aucune interruption automatique",
    },
  });
}

function lancer({ projectId, pipelineIndex = 0, llmOverrides = {}, mission = null }, { reprendre = false, commandId = null, runId = null, reverifier = null, store = null } = {}) {
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
    const env = { ...process.env, ORCH_MAITRE_DISTANT: "1" };
    const debut = new Date().toISOString();
    const seuilMs = delaiDiagnosticRun();
    const processus = spawn(process.execPath, args, { cwd: RACINE, env, stdio: "inherit" });
    enfants.add(processus);
    let diagnostique = false;
    const surveillance = setInterval(() => {
      if (diagnostique || Date.now() - Date.parse(debut) < seuilMs) return;
      const id = runId || (commandId && store?.commande(commandId)?.run_id);
      if (!id || store?.run(id)?.status !== "running") return;
      diagnostique = true;
      try {
        diagnosticRun(store, id, debut);
        console.warn(`Run ${id} actif depuis ${Math.round((Date.now() - Date.parse(debut)) / 60_000)} min : diagnostic enregistré, le run continue.`);
      } catch (err) {
        console.error(`Diagnostic du run ${id} impossible : ${err.message}`);
      }
    }, Math.min(INTERVALLE, 1000));
    const terminer = (resultat) => {
      clearInterval(surveillance);
      enfants.delete(processus);
      resolve(resultat);
    };
    processus.once("error", (err) => terminer({ code: 1, erreur: err.message, debut }));
    processus.once("close", (code, signal) => {
      terminer({ code: code ?? 1, signal: signal || null, debut });
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
const agirPour = (store, commande, agent) => chatOutils.agir(store, { qui: { par: commande.par, canal: commande.canal }, agent, origine: commande.id });

// Le serveur stdio que Codex lance, et les noms de ses outils pour le prompt. L'identité de
// la question lui passe par l'environnement.
function codexChat(store, commande) {
  const agir = agirPour(store, commande, "codex");
  const noms = cockpitRead.definitionsOutils({ ...chatOutils.sources(store), propositions: { ajouter: () => undefined, nombre: () => 0 }, agir }).map((o) => o.nom);
  const env = Object.fromEntries(ENV_OUTILS.filter((k) => process.env[k]).map((k) => [k, String(process.env[k])]));
  if (agir) Object.assign(env, { COCKPIT_CHAT_PAR: String(commande.par), COCKPIT_CHAT_CANAL: String(commande.canal ?? ""), COCKPIT_CHAT_ORIGINE: commande.id });
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
  const enCours = new Set();
  while (!arret) {
    let exclure = [];
    if (kinds.includes("run.resume")) {
      sonderQuotaCodex(store);
      store.attentes.programmer({ machineDisponible });
      // Un objectif planifié illisible ne doit pas arrêter la file des runs : elle continue
      // sans exclusions, comme avant le calendrier.
      try {
        const atelier = require("../src/atelier");
        atelier.programmer(store);
        // Les recettes CLI locales n'utilisent aucun worker distant.
        const verifier = process.env.ORCH_ROLE === "pc" ? () => {} : require("../src/runtime-mission").verifier({
          viaParMachine: JSON.parse(process.env.COCKPIT_VIA_MACHINES || '{"pc":["claude","codex","omniroute","ollama"],"nas":["claude"]}'), machines: api.machines(store),
        });
        exclure = atelier.exclus(store, verifier);
      } catch (err) {
        console.error(`Calendrier : programmation ignorée pour ce tour (${err.message})`);
      }
    }
    if (kinds.includes("run.resume")) exclure.push(...store.attentes.exclureMachines(machineDisponible));
    const quota = kinds.includes("run.resume") ? require("../src/quota").etatQuota(store) : null;
    if (quota && quota.statut !== dernierEtatQuotaLogge) {
      dernierEtatQuotaLogge = quota.statut;
      console.info(quota.statut === "inconnu"
        ? "Quota Claude Code/Codex inconnu : ordre normal de file."
        : quota.statut === "bas" ? `Quota bas (<25 %, fenêtre la plus basse : ${quota.restantLePlusBas} %) : reprises, runs prioritaires, puis FIFO.`
          : `Quota suffisant (fenêtre la plus basse : ${quota.restantLePlusBas} %) : ordre normal de file.`);
    }
    const sousSeuil = Boolean(prioriserRuns && quota?.sousSeuil);
    const filtre = kinds.includes("run.resume") ? { kinds, prioriserRuns: sousSeuil, exclure } : { kinds };
    if (kinds.includes("run.resume") && (!maitre || enCours.size >= capaciteRuns())) { await attendre(INTERVALLE); continue; }
    const commande = store.prendreCommande(filtre);
    if (!commande) {
      await attendre(INTERVALLE);
      continue;
    }
    console.log(`Commande ${commande.id} : ${commande.kind}, demandée par ${commande.par}`);
    // La réservation durable empêche les doublons. Le maître borne la concurrence réelle.
    if (!kinds.includes("run.resume")) await traiterCommande(store, commande, executer);
    else {
      let operation;
      operation = traiterCommande(store, commande, executer).catch(err=>console.error(err.message)).finally(()=>enCours.delete(operation));
      enCours.add(operation);
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  await Promise.allSettled(enCours);
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
    operation = traiterCommande(store, commande, (c) => deciderEtReprendre(store, c, lancerParallele))
      .finally(() => enCours.delete(operation));
    enCours.add(operation);
  }
  await Promise.allSettled(enCours);
}

async function traiterCommande(store, commande, executer) {
  const acquitter = (resultat) => commande.kind === "run.resume"
    ? terminerReprise({ store, commande, resultat }) : store.terminerCommande(commande.id, resultat);
  try {
    const resultat = await executer(commande);
    // Un arrêt du runner ne refuse pas la tâche interrompue : elle reste réservée,
    // sera remise en file, et retrouvera son run au redémarrage.
    if (!arret || commande.kind === "chat.respond") {
      acquitter(resultat);
    }
  } catch (err) {
    if (!arret || commande.kind === "chat.respond") {
      acquitter({ ok: false, raison: err.message });
    }
    console.error(`Commande ${commande.id} refusée : ${err.message}`);
  }
}

function issue(store, resultat, detail = {}) {
  if (CODES_ATTENDUS.has(resultat.code)) return { ok: true, detail: { ...resultat, ...detail } };
  return { ok: false, raison: raisonEchec(store, detail.runId || null, resultat) };
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
async function deciderEtReprendre(store, commande, lancerRun = lancerParallele) {
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
  const repris = await lancerRun(lancement, { reprendre: true, runId: a.run_id, store });
  // « Renvoyer au pipeline » : une orientation que le pipeline ne route nulle part termine
  // simplement le run (marketing@1). Un nouveau tour repart alors, et son nœud `consigne` y
  // reprend la note. Ce nouveau tour est mis en file et lié à sa propre commande.
  // Un pipeline qui gère l'orientation lui-même n'est jamais relancé deux fois.
  if (decision === "oriented" && repris.code === 0 && !orientationRoutee(lancement, a.node_id)) {
    return store.terminerOrientation(commande.id, { payload: lancement, detail: { ...repris, decision } });
  }
  return issue(store, repris, { runId: a.run_id, decision });
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
  const resultat = await lancerParallele(lancementDe(store, run), { runId, reverifier: headSha, store });
  return issue(store, resultat, { runId, headSha });
}

async function executerRun(store, commande) {
  const lancerAvecDiagnostic = (lancement, options = {}) => lancerParallele(lancement, { ...options, store });
  if (commande.kind === "run.resume") return reprendreRun({ store, commande, lancer: lancerAvecDiagnostic, lancementDe, machineDisponible });
  if (commande.kind === "run.reverify") return reverifier(store, commande);
  const resultat = await lancerParallele(commande.payload, { commandId: commande.id, store });
  return issue(store, resultat, { runId: store.commande(commande.id)?.run_id || null });
}

function machineDisponible(machine) {
  return Boolean(maitre?.machineDisponible(machine));
}

// Le maître vit avec le runner, pas avec un run : le PC reste connecté entre deux runs, et
// le cockpit le voit en ligne avant d'en lancer un (décision du 2026-10-05). L'adresse
// d'écoute (ORCH_MAITRE_HOTE, l'IP tailnet du NAS) peut manquer au démarrage du NAS, avant
// Tailscale : le runner ne tombe pas pour autant, il réessaie, et ses autres files tournent.
async function ouvrirMaitre(store) {
  if (typeof Maitre !== "function" || typeof servirMaitre !== "function") {
    throw new Error("moteur incompatible : maître permanent requis");
  }
  while (!arret && !maitre) {
    const candidat = new Maitre({
      store,
      workers: lireWorkers(),
      wol: ["0", "false", "no", "off"].includes(String(process.env.ORCH_REVEIL_MACHINE ?? "1").toLowerCase()) ? null : wol.pourMaitre(),
    });
    try {
      await candidat.demarrer();
      // L'environnement que le run aurait chargé lui-même, rajouté ici : il ne passe jamais
      // par la file, qui est écrite sur le disque.
      serviceMaitre = servirMaitre({ store, maitre: candidat, env: envLoader.load(RACINE, "", process.env.ENV_FILE) });
      maitre = candidat;
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
    catch (err) { console.error(err.message); arret=true; for (const processus of enfants) processus.kill("SIGTERM"); }
  }, 1000);
  // Seulement les commandes de ce runner : une livraison réservée par le livreur ne doit pas
  // retourner en file quand la bascule redémarre le runner (docs/SPEC-livraison.md, §4.3).
  const reprises = store.reprendreCommandesInterrompues({ kinds: ["run.start", "run.resume", "approval.decide", "run.reverify", "chat.respond"] });
  console.log(`Runner de commandes sur ${STORE}${reprises ? ` — ${reprises} commande(s) reprise(s)` : ""}`);
  try {
    await Promise.all([
      ouvrirMaitre(store),
      boucle(store, ["run.start", "run.resume", "run.reverify"], (commande) => executerRun(store, commande), { prioriserRuns: true }),
      // La décision est enregistrée hors de la file longue ; le maître borne les étapes
      // concurrentes comme pour les autres runs.
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
    for (const processus of enfants) processus.kill(signal);
  });
}

demarrer().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
