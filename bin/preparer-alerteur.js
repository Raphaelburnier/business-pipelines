#!/usr/bin/env node
// Opérateur : migrer le SMTP existant sans afficher ni réencoder les secrets en .env.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { envLoader } = require("agent-orchestrator");
const { config } = require("../src/courriel");
const { urlCockpit } = require("../src/alerteur");
function preparer(source, cible) {
  const st = fs.lstatSync(source);
  if (!st.isFile() || st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) || st.size > 32768) throw Error("SOURCE_PRIVEE_REQUISE");
  const ancien = envLoader.parseEnv(fs.readFileSync(source, "utf8"));
  const cfg = {};
  for (const k of ["SMTP_HOTE", "SMTP_PORT", "SMTP_UTILISATEUR", "SMTP_MOTDEPASSE", "ALERTE_EXPEDITEUR", "ALERTE_COCKPIT_URL"]) if (ancien[k]) cfg[k] = ancien[k];
  // Choix explicite du destinataire : adresse du compte SMTP configuré.
  cfg.ALERTE_DESTINATAIRE = ancien.SMTP_UTILISATEUR;
  config(cfg); urlCockpit(cfg.ALERTE_COCKPIT_URL);
  if (fs.existsSync(cible)) {
    const v = JSON.parse(fs.readFileSync(cible, "utf8"));
    const meme = Object.keys(v).length === Object.keys(cfg).length && Object.keys(cfg).every(k => cfg[k] === v[k]);
    if (!meme) throw Error("CONFIGURATION_EXISTANTE_DIFFERENTE");
    const droits = fs.lstatSync(cible);
    if (!droits.isFile() || droits.isSymbolicLink() || droits.uid !== process.getuid() || (droits.mode & 0o077)) throw Error("CIBLE_PRIVEE_REQUISE");
    return { configuration: "reutilisee", destinataire: "compte-smtp" };
  }
  const tmp = path.join(path.dirname(cible), `.alerteur-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.linkSync(tmp, cible); // Publication sans écraser une configuration apparue entre-temps.
  } finally { fs.rmSync(tmp, { force: true }); }
  return { configuration: "creee", destinataire: "compte-smtp", mode: "600" };
}
if (require.main === module) {
  const [source, cible, choix, ...reste] = process.argv.slice(2);
  if (!source || !cible || choix !== "--compte-smtp" || reste.length) { console.error("Usage : preparer-alerteur.js source.env cible.json --compte-smtp"); process.exitCode = 2; }
  else try { console.log(JSON.stringify(preparer(path.resolve(source), path.resolve(cible)))); }
  catch { console.error("Préparation refusée : vérifier la configuration privée source, l'adresse du compte SMTP et l'absence de configuration cible différente."); process.exitCode = 1; }
}
module.exports = { preparer };
