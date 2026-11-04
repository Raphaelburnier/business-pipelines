#!/usr/bin/env node
// Procédure opérateur documentée dans docs/SPEC-livraison-runs-vivants.md.
const { execFileSync } = require("node:child_process");
const { recupererMaintenance } = require("../src/maintenance-livraison");
const args = process.argv.slice(2);
try {
  if (args.length !== 3 || args[0] !== "--liberer" || args[2] !== "--bascule-terminee") {
    throw new Error("Usage opérateur : node bin/maintenance-livraison.js --liberer <commandeId> --bascule-terminee ; vérifier d'abord qu'aucune bascule ni construction ne continue");
  }
  recupererMaintenance({ fichier: process.env.ORCH_EVENT_STORE || "/app/etat/events.sqlite", commandeId: args[1], basculeTerminee: true,
    verifierServices() {
      for (const service of ["cockpit", "runner", "maitre", "cockpit_relais", "publieur", "livreur", "tailscale_whois", "alerteur"]) {
        const etat = execFileSync("/usr/bin/docker", ["inspect", `business_${service}`, "--format", "{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}"], { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (etat !== "true healthy") throw new Error("Tous les services doivent être en marche et sains avant la récupération");
      }
      execFileSync("/usr/bin/docker", ["exec", "business_cockpit", "node", "bin/verifier-sante.js", "cockpit"], { timeout: 5000, stdio: "ignore" });
    },
  });
  console.log("Maintenance libérée et journalisée. La pause opérateur conserve sa valeur.");
} catch (err) {
  console.error(err.message?.includes("spawnSync") || err.message?.includes("Command failed") ? "Vérification des services impossible : maintenance conservée" : err.message);
  process.exitCode = 1;
}
