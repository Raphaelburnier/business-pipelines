#!/usr/bin/env node
// Service indépendant : ni SDK d'agent, ni autorité d'écriture sur les runs.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const courriel = require("../src/courriel");
const { Alerteur, etat, urlCockpit } = require("../src/alerteur");
const CONFIG = new Set(["SMTP_HOTE", "SMTP_PORT", "SMTP_UTILISATEUR", "SMTP_MOTDEPASSE", "ALERTE_DESTINATAIRE", "ALERTE_EXPEDITEUR", "ALERTE_COCKPIT_URL"]);
function charger(fichier) {
  const st = fs.lstatSync(fichier);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) || st.size > 32768) throw Object.assign(new Error("Configuration privée requise."), { code: "CONFIG_PERMISSIONS" });
  const env = JSON.parse(fs.readFileSync(fichier, "utf8"));
  if (!env || Array.isArray(env) || typeof env !== "object" || Object.keys(env).some(k => !CONFIG.has(k))) throw Object.assign(new Error("Configuration inconnue."), { code: "CONFIG_INVALIDE" });
  courriel.config(env); urlCockpit(env.ALERTE_COCKPIT_URL);
  return env;
}
async function main(args) {
  const autorisees = ["--une-passe", "--etat", "--sante", "--verifier-config", "--tester"];
  if (args.length > 1 || (args.length && !autorisees.includes(args[0]))) throw Object.assign(new Error("Arguments invalides."), { code: "ARGUMENTS" });
  const dossier = process.env.ALERTE_ETAT_DIR || "/app/alertes";
  if (["--etat", "--sante"].includes(args[0])) {
    const s = etat(dossier);
    if (args[0] === "--etat") console.log(JSON.stringify(s));
    return s.ok ? 0 : 1;
  }
  const env = charger(process.env.ALERTE_CONFIG || "/app/specs/alerteur.json");
  if (args[0] === "--verifier-config") { console.log(JSON.stringify({ configuration: "valide", destinataire: "configure", tlsExige: true })); return 0; }
  const pointEntree = args[0] === "--une-passe" ? "cli" : args[0] === "--tester" ? "recette" : "service";
  const log = valeur => console.log(JSON.stringify({ ...valeur, pointEntree }));
  if (args[0] === "--tester") {
    const correlationId = crypto.randomUUID();
    await courriel.envoyer({ titre: "[Cockpit] Test des alertes externes", texte: "Test du lot 4.2 : le canal d'alerte est joignable. Aucun run n'a été lancé ou arrêté. Les interventions restent dans le cockpit.", messageId: `<test-${correlationId}@cockpit.invalid>` }, env);
    log({ event: "alerte.test_envoye", correlationId }); return 0;
  }
  const a = new Alerteur({ source: process.env.ALERTE_SOURCE || "/app/source/events.sqlite", dossier, cockpitUrl: env.ALERTE_COCKPIT_URL, log, pointEntree });
  let arreter = false;
  let reveiller;
  const stopper = () => { arreter = true; reveiller?.(); };
  process.on("SIGTERM", stopper); process.on("SIGINT", stopper);
  try {
    do {
      const ajoutees = a.ingester();
      const r = await a.envoyer({ transport: courriel.envoyer, env });
      if (ajoutees) a.journal("alerte.preparee", { ajoutees });
      if (args[0] === "--une-passe") return r.echecs ? 1 : 0;
      if (!arreter) await new Promise(resolve => { const t = setTimeout(() => { reveiller = null; resolve(); }, 15000); reveiller = () => { clearTimeout(t); reveiller = null; resolve(); }; });
    } while (!arreter);
    return 0;
  } finally { process.removeListener("SIGTERM", stopper); process.removeListener("SIGINT", stopper); a.fermer(); }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const pointEntree = args[0] === "--tester" ? "recette" : args.length ? "cli" : "service";
  main(args).then(code => { process.exitCode = code; }).catch(e => {
    const transport = courriel.categorie(e);
    const code = ["CONFIG_PERMISSIONS", "CONFIG_INVALIDE", "CONFIG_MANQUANTE", "CONFIG_URL", "ARGUMENTS", "DOSSIER_PRIVE_REQUIS", "INSTANCE_DEJA_ACTIVE", "SOURCE_CHANGE_OU_RECULE"].includes(e.code) ? e.code : transport !== "TRANSPORT_ERREUR" ? transport : "ALERTEUR_INDISPONIBLE";
    console.error(JSON.stringify({ event: "alerteur.erreur", correlationId: crypto.randomUUID(), pointEntree, code })); process.exitCode = 1;
  });
}
module.exports = { charger, main };
