#!/usr/bin/env node
// Service réseau de confiance : aucune CLI d'agent ni file de lancement de runs.
const path = require("node:path");
const { EventStore, envLoader } = require("agent-orchestrator");
const { ouvrirMaitrePermanent } = require("../src/maitre-permanent");
const racine = path.resolve(__dirname, "..");
const fichier = process.env.ORCH_EVENT_STORE || path.join(racine, "etat/events.sqlite");
const store = new EventStore(fichier);
let sante = null;
let service = null;
let arret = false;
let reveiller = () => {};
const pause = () => new Promise(resolve => { const minuterie = setTimeout(resolve, 30000); reveiller = () => { clearTimeout(minuterie); resolve(); }; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { arret = true; reveiller(); });
(async () => {
  try {
    while (!arret && !service) {
      try {
        service = await ouvrirMaitrePermanent({ store, env: envLoader.load(racine, "", process.env.ENV_FILE) });
        sante = require("../src/sante-plateforme").surveillerService("maitre", { fichier });
      }
      catch (err) { console.error(`maître permanent indisponible : ${err.message}`); if (!arret) await pause(); }
    }
    while (!arret) await pause();
  } finally { sante?.arreter(); if (service) await service.arreter(); store.fermer(); }
})().catch(err => { console.error(err.message); process.exitCode = 1; });
