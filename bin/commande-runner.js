#!/usr/bin/env node
// Consomme les commandes durables du cockpit. Une seule commande à la fois : deux runs
// simultanés partageraient le quota, le workspace et des branches Git sans bénéfice ici.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventStore } = require("agent-orchestrator");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const STORE = process.env.ORCH_EVENT_STORE || path.join(RACINE, "etat", "events.sqlite");
const INTERVALLE = Number(process.env.COMMAND_POLL_MS || 1000);
const CODES_ATTENDUS = new Set([0, 75, 76]);

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

async function boucle() {
  const store = new EventStore(STORE);
  const reprises = store.reprendreCommandesInterrompues();
  console.log(`Runner de commandes sur ${STORE}${reprises ? ` — ${reprises} commande(s) reprise(s)` : ""}`);
  try {
    while (!arret) {
      const commande = store.prendreCommande();
      if (!commande) {
        await attendre(INTERVALLE);
        continue;
      }
      console.log(`Commande ${commande.id} : ${commande.kind}, demandée par ${commande.par}`);
      try {
        const resultat = await lancer(commande);
        if (CODES_ATTENDUS.has(resultat.code)) {
          store.terminerCommande(commande.id, { ok: true, detail: resultat });
        } else {
          store.terminerCommande(commande.id, { ok: false, raison: resultat.erreur || `processus terminé en code ${resultat.code}` });
        }
      } catch (err) {
        store.terminerCommande(commande.id, { ok: false, raison: err.message });
        console.error(`Commande ${commande.id} refusée : ${err.message}`);
      }
    }
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

boucle().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
