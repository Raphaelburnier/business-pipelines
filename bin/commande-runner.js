#!/usr/bin/env node
// Consomme les commandes durables du cockpit. Une seule commande à la fois : deux runs
// simultanés partageraient le quota, le workspace et des branches Git sans bénéfice ici.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventStore, chat, cockpitRead, envLoader, Maitre, servirMaitre, lireWorkers, wol } = require("agent-orchestrator");
const api = require("../src/api-lecture");
const registre = require("agent-orchestrator/src/registre");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const STORE = process.env.ORCH_EVENT_STORE || path.join(RACINE, "etat", "events.sqlite");
const INTERVALLE = Number(process.env.COMMAND_POLL_MS || 1000);
const MODELE_CHAT = process.env.COCKPIT_CHAT_MODELE || "sonnet";
const CODES_ATTENDUS = new Set([0, 75, 76, 77]);

let arret = false;
let enfant = null;
// Le maître permanent (agent-orchestrator, src/maitre-distant.js) et son service. Null tant
// qu'il n'écoute pas : un run lancé entre-temps ouvre alors son propre maître, comme avant.
let maitre = null;
let serviceMaitre = null;
const REESSAI_MAITRE_MS = 30_000;
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function projet(projectId) {
  const fichier = path.join(PROJETS, projectId, "project.json");
  if (!fichier.startsWith(`${path.resolve(PROJETS)}${path.sep}`) || !fs.existsSync(fichier)) {
    throw new Error(`projet inconnu : ${projectId}`);
  }
  return fichier;
}

// `reprendre` relance le run arrêté dans le dossier de travail du projet (`--resume`), avec
// les mêmes choix de modèle.
function lancer({ projectId, pipelineIndex = 0, llmOverrides = {} }, { reprendre = false } = {}) {
  const fichier = projet(projectId);
  // Les scripts du cockpit (`consigne`, `verify-couverture`…) : les nœuds `script` des
  // pipelines du registre les appellent par leur nom, et le moteur ne les a pas.
  const args = [
    "/agent-orchestrator/bin/orch.js",
    "projet",
    fichier,
    "--pipeline",
    String(pipelineIndex),
    "--distribue",
    "--handlers",
    "src/stage-handlers.js",
  ];
  if (reprendre) args.push("--resume");
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

// Les outils du chat lisent par les mêmes fonctions que l'API : le chat voit ce que voit
// l'écran, jamais plus.
function outilsCockpit(store) {
  return cockpitRead.serveurCockpitRead({
    store,
    runs: ({ projet, statut, limite }) => api.runs(store, { projet, statut, limite }),
    run: (id) => api.run(store, id),
    etat: () => ({ machines: api.machines(store), usage: api.usage(store) }),
  });
}

async function repondre(store, commande) {
  const { threadId, responseMessageId } = commande.payload;
  return chat.repondreChat({
    store,
    threadId,
    responseMessageId,
    contexte: contexteCockpit(store),
    modele: MODELE_CHAT,
    outils: await outilsCockpit(store),
  });
}

// Deux files dans le même processus : un run tient sa boucle pendant des minutes, une
// question ne doit pas l'attendre. Chaque boucle ne réserve que ses propres commandes.
async function boucle(store, kinds, executer) {
  while (!arret) {
    const commande = store.prendreCommande({ kinds });
    if (!commande) {
      await attendre(INTERVALLE);
      continue;
    }
    console.log(`Commande ${commande.id} : ${commande.kind}, demandée par ${commande.par}`);
    try {
      store.terminerCommande(commande.id, await executer(commande));
    } catch (err) {
      store.terminerCommande(commande.id, { ok: false, raison: err.message });
      console.error(`Commande ${commande.id} refusée : ${err.message}`);
    }
  }
}

function issue(resultat, detail = {}) {
  if (CODES_ATTENDUS.has(resultat.code)) return { ok: true, detail: { ...resultat, ...detail } };
  return { ok: false, raison: resultat.erreur || `processus terminé en code ${resultat.code}` };
}

// Le pipeline et les modèles avec lesquels le run arrêté a été lancé. Le pipeline se lit
// dans la fiche du projet (`extends` = la référence du run). Les modèles viennent de la
// dernière commande `run.start` de ce projet : un projet n'a qu'un dossier de travail, donc
// le run à reprendre est le dernier lancé.
function lancementDe(store, run) {
  const fiche = JSON.parse(fs.readFileSync(projet(run.project_id), "utf8"));
  const index = (fiche.pipelines || []).findIndex((p) => p.extends === run.pipeline_ref);
  const derniere = store
    .commandes({ limite: 5000 })
    .filter((c) => c.kind === "run.start" && c.payload.projectId === run.project_id)
    .pop();
  return {
    projectId: run.project_id,
    pipelineIndex: index >= 0 ? index : 0,
    llmOverrides: (derniere && derniere.payload.llmOverrides) || {},
  };
}

// Trancher puis reprendre (phase 5). La décision est écrite par `deciderApprobation`, qui
// revérifie tout, sous la signature de la commande. Rejouée après un redémarrage du runner,
// une décision déjà écrite par cette même commande n'est pas réécrite : seul le run reprend.
async function deciderEtReprendre(store, commande) {
  const { approbationId, decision, note = null, actions = [] } = commande.payload;
  const a = store.approbation(approbationId);
  if (!a) throw new Error(`approbation inconnue : ${approbationId}`);
  const dejaEcrite = a.status === decision && a.par === commande.par;
  if (!dejaEcrite) {
    store.deciderApprobation(a.id, { decision, note, par: commande.par, canal: commande.canal, actions });
    store.emettre({ type: "approval.decided", runId: a.run_id, payload: { node: a.node_id, decision, par: commande.par } });
  }
  const run = store.run(a.run_id);
  if (!run) throw new Error(`run inconnu : ${a.run_id}`);
  const lancement = lancementDe(store, run);
  const repris = await lancer(lancement, { reprendre: true });
  // « Renvoyer au pipeline » : une orientation que le pipeline ne route nulle part termine
  // simplement le run (marketing@1). Un nouveau tour repart alors, et son nœud `consigne` y
  // reprend la note. Un pipeline qui gère l'orientation lui-même n'est jamais relancé deux fois.
  if (decision === "oriented" && CODES_ATTENDUS.has(repris.code) && !orientationRoutee(lancement, a.node_id)) {
    return issue(await lancer(lancement), { runId: a.run_id, decision, nouveauTour: true });
  }
  return issue(repris, { runId: a.run_id, decision });
}

// Le pipeline a-t-il une arête qui part du nœud d'approbation sur une orientation ? Dans le
// doute (registre illisible), on répond oui : mieux vaut un tour de moins qu'un tour en double.
function orientationRoutee(lancement, nodeId) {
  try {
    const { pipeline } = registre.resoudreProjet(projet(lancement.projectId), { index: lancement.pipelineIndex });
    return (pipeline.edges || []).some((e) => e.from === nodeId && (!e.on || e.on === "oriented"));
  } catch (err) {
    console.error(`registre illisible, pas de nouveau tour : ${err.message}`);
    return true;
  }
}

async function executerRun(store, commande) {
  if (commande.kind === "approval.decide") return deciderEtReprendre(store, commande);
  return issue(await lancer(commande.payload));
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
  // Seulement les commandes de ce runner : une livraison réservée par le livreur ne doit pas
  // retourner en file quand la bascule redémarre le runner (docs/SPEC-livraison.md, §4.3).
  const reprises = store.reprendreCommandesInterrompues({ kinds: ["run.start", "approval.decide", "chat.respond"] });
  console.log(`Runner de commandes sur ${STORE}${reprises ? ` — ${reprises} commande(s) reprise(s)` : ""}`);
  try {
    await Promise.all([
      ouvrirMaitre(store),
      // Les décisions passent dans la file des runs : elles en relancent un, et deux runs à
      // la fois partageraient le dossier de travail.
      boucle(store, ["run.start", "approval.decide"], (commande) => executerRun(store, commande)),
      boucle(store, ["chat.respond"], (commande) => repondre(store, commande)),
    ]);
  } finally {
    if (serviceMaitre) await serviceMaitre.arreter();
    if (maitre) await maitre.arreter();
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
