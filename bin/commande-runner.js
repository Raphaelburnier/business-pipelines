#!/usr/bin/env node
// Consomme les commandes durables du cockpit. Une seule commande à la fois : deux runs
// simultanés partageraient le quota, le workspace et des branches Git sans bénéfice ici.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventStore, chat, cockpitRead } = require("agent-orchestrator");
const api = require("../src/api-lecture");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const STORE = process.env.ORCH_EVENT_STORE || path.join(RACINE, "etat", "events.sqlite");
const INTERVALLE = Number(process.env.COMMAND_POLL_MS || 1000);
const MODELE_CHAT = process.env.COCKPIT_CHAT_MODELE || "sonnet";
const CODES_ATTENDUS = new Set([0, 75, 76, 77]);

let arret = false;
let enfant = null;
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function projet(projectId) {
  const fichier = path.join(PROJETS, projectId, "project.json");
  if (!fichier.startsWith(`${path.resolve(PROJETS)}${path.sep}`) || !fs.existsSync(fichier)) {
    throw new Error(`projet inconnu : ${projectId}`);
  }
  return fichier;
}

function lancer(commande) {
  if (commande.kind !== "run.start") throw new Error(`commande non prise en charge : ${commande.kind}`);
  const fichier = projet(commande.payload.projectId);
  const args = [
    "/agent-orchestrator/bin/orch.js",
    "projet",
    fichier,
    "--pipeline",
    String(commande.payload.pipelineIndex),
    "--distribue",
  ];
  for (const [noeud, llm] of Object.entries(commande.payload.llmOverrides || {})) {
    args.push("--llm", `${noeud}=${llm.via}:${llm.model}`);
  }
  return new Promise((resolve) => {
    enfant = spawn(process.execPath, args, { cwd: RACINE, env: process.env, stdio: "inherit" });
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

async function executerRun(commande) {
  const resultat = await lancer(commande);
  if (CODES_ATTENDUS.has(resultat.code)) return { ok: true, detail: resultat };
  return { ok: false, raison: resultat.erreur || `processus terminé en code ${resultat.code}` };
}

async function demarrer() {
  const store = new EventStore(STORE);
  const reprises = store.reprendreCommandesInterrompues();
  console.log(`Runner de commandes sur ${STORE}${reprises ? ` — ${reprises} commande(s) reprise(s)` : ""}`);
  try {
    await Promise.all([
      boucle(store, ["run.start"], executerRun),
      boucle(store, ["chat.respond"], (commande) => repondre(store, commande)),
    ]);
  } finally {
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
