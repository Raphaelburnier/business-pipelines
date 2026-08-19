#!/usr/bin/env node

// Le canal d'alerte, en ligne de commande. Un lecteur de la boîte de plus, celui qui
// parle sans qu'on lui demande.
//
//   node bin/alerter.js         envoie ce qui n'a pas encore été notifié
//   node bin/alerter.js --dry   montre ce qui partirait, sans envoyer ni consigner
//
// Sortie 0 si tout ce qui devait partir est parti, 1 si un envoi a échoué : un cron le
// signale alors sans qu'on ait à lire la sortie. Le raté repartira au réveil suivant,
// puisqu'un échec n'est jamais consigné.
const path = require("path");
const { envLoader } = require("agent-orchestrator");
const alerte = require("../src/alerte");

const RACINE = path.join(__dirname, "..");

// Même garde que l'orchestrateur : une option à valeur qui avale le token suivant sans
// regarder ce qu'il est transforme `--env --dry` en un chemin nommé "--dry".
function consumeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Option ${flag} attend une valeur (reçu : ${value === undefined ? "rien" : value})`);
  }
  return value;
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry") opts.dry = true;
    else if (arg === "--env") opts.env = consumeValue(argv, i++, "--env");
    else throw new Error(`Option inconnue : ${arg}`);
  }
  return opts;
}

// Le fichier d'abord, l'environnement du processus par-dessus. Un réglage passé à la main
// pour un essai doit l'emporter sur le fichier, sinon la seule façon de tester une valeur
// serait de modifier la configuration qui tourne.
function chargerEnv(fichier) {
  const duFichier = envLoader.load(RACINE, null, fichier);
  return { ...duFichier, ...process.env };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const env = chargerEnv(opts.env || path.join(RACINE, "specs", "alerte.env"));

  const resultat = await alerte.envoyer({
    approvalsDir: process.env.APPROVALS_DIR || path.join(RACINE, "approvals"),
    pipelinesDir: path.join(RACINE, "pipelines"),
    cockpitUrl: env.ALERTE_COCKPIT_URL || null,
    // En répétition à blanc, aucun transport n'est résolu : regarder ce qui partirait ne
    // doit pas exiger une configuration d'envoi valide.
    transport: opts.dry ? null : alerte.transportDe(env.ALERTE_TRANSPORT),
    env,
    dry: opts.dry,
  });

  if (resultat.candidats === 0) {
    console.log("Rien à signaler : tout ce qui attend a déjà été notifié dans cet état.");
    return 0;
  }

  for (const envoyee of resultat.envoyees) {
    console.log(`${opts.dry ? "[à blanc] " : "envoyé "}${envoyee.titre}`);
    if (opts.dry) console.log(envoyee.texte.split("\n").map((l) => `  | ${l}`).join("\n"));
  }
  for (const echec of resultat.echecs) {
    console.error(`✘ ${echec.cle} : ${echec.erreur}`);
  }

  return resultat.echecs.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n✘ ${err.message}`);
    process.exit(1);
  });
