#!/usr/bin/env node
// Appelé par le modèle protégé dans le livreur. Aucun appel de modèle ou création de base.
const { verifierAvantBascule } = require("../src/maintenance-livraison");
const id = process.env.LIVRAISON_COMMANDE_ID;
try {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "")) throw new Error("Commande de livraison identifiée requise : lancer depuis le cockpit");
  verifierAvantBascule(process.env.ORCH_EVENT_STORE || "/app/etat/events.sqlite", id);
  console.log("Maintenance v1 confirmée : aucun travail en cours.");
} catch (err) { console.error(err.message); process.exitCode = 1; }
