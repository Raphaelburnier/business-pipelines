#!/usr/bin/env node

// Un réveil du cron : lire l'état, choisir UNE action, la faire, prévenir.
//
//   node bin/cycle.js --plan ajustement-prix --spec ./specs/ajustement-prix.json
//   node bin/cycle.js --plan ... --spec ... --dry    dit ce qu'il ferait, ne fait rien
//
// Ce que ce fichier n'a pas le droit d'être, c'est malin. Le choix vit dans src/cycle.js
// et se teste sans rien lancer ; ici on exécute ce qui a été décidé, et on rend compte.
const path = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs");

const cycle = require("../src/cycle");
const cockpit = require("../src/cockpit");

const RACINE = path.join(__dirname, "..");
const APPROVALS = process.env.APPROVALS_DIR || path.join(RACINE, "approvals");
const PIPELINES = path.join(RACINE, "pipelines");

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
    if (arg === "--plan") opts.plan = consumeValue(argv, i++, "--plan");
    else if (arg === "--spec") opts.spec = consumeValue(argv, i++, "--spec");
    else if (arg === "--dry") opts.dry = true;
    else throw new Error(`Option inconnue : ${arg}`);
  }
  if (!opts.plan || !opts.spec) {
    throw new Error("Usage : node bin/cycle.js --plan <pipeline> --spec <spec.json> [--dry]");
  }
  return opts;
}

// L'empreinte de la boîte entière. Sert à distinguer un arrêt normal d'un vrai plantage,
// voir plus bas.
function empreinteBoite() {
  const p = path.join(APPROVALS, "EN-ATTENTE.json");
  if (!fs.existsSync(p)) return "";
  const boite = JSON.parse(fs.readFileSync(p, "utf-8"));
  return (boite.en_attente || [])
    .map((e) => `${e.dossier}:${e.empreinte}`)
    .sort()
    .join("|");
}

function lancer(pipeline, spec) {
  console.log(`→ node orchestrator.js ${pipeline} ${spec}`);
  return spawnSync("node", ["orchestrator.js", pipeline, spec], {
    cwd: RACINE,
    stdio: "inherit",
  });
}

// Un pipeline de planification se TERMINE en erreur quand il aboutit : le stage
// d'approbation lève pour arrêter net, c'est sa façon de rendre la main. Un code de sortie
// ne dit donc pas si le run a réussi, et le lire seul ferait passer chaque planification
// réussie pour une panne, tous les jours, jusqu'à ce qu'on cesse de regarder.
//
// Ce qui distingue les deux est observable ailleurs : un arrêt sur approbation a déposé
// une demande dans la boîte. Si la boîte a changé, l'arrêt est le bon.
function verdictPlanification(avant, apres, code) {
  if (code === 0) return { ok: true, quoi: "terminé sans rien laisser à décider" };
  if (apres !== avant) return { ok: true, quoi: "arrêté sur approbation, la demande est déposée" };
  return { ok: false, quoi: "échec réel : aucune demande déposée" };
}

async function alerter(dry) {
  // L'alerte est lancée comme un processus séparé, avec sa propre configuration et son
  // propre code de sortie. Un canal d'alerte mal réglé doit se signaler sans empêcher le
  // cycle de tourner : prévenir est important, travailler l'est plus.
  const args = ["bin/alerter.js"];
  if (dry) args.push("--dry");
  const r = spawnSync("node", args, { cwd: RACINE, stdio: "inherit" });
  if (r.status !== 0) console.error("✘ le canal d'alerte a échoué (le cycle, lui, a fait son travail)");
  return r.status === 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const decision = cycle.prochaine({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES });

  console.log(`${decision.action.toUpperCase()} : ${decision.raison}`);

  if (opts.dry) {
    console.log("(à blanc : rien n'a été lancé)");
    await alerter(true);
    return 0;
  }

  if (decision.action === "attendre") {
    await alerter(false);
    return 0;
  }

  if (decision.action === "appliquer") {
    const r = lancer(decision.dossier.appliquer_avec, opts.spec);
    // L'application, elle, réussit avec un code 0. Elle n'a pas d'arrêt normal : la
    // décision humaine est déjà prise, il ne reste que des gestes à faire ou à refuser.
    if (r.status !== 0) {
      console.error("✘ l'application a échoué");
      return 1;
    }
    await alerter(false);
    return 0;
  }

  const avant = empreinteBoite();
  const r = lancer(opts.plan, opts.spec);
  const verdict = verdictPlanification(avant, empreinteBoite(), r.status);
  console.log(`${verdict.ok ? "✓" : "✘"} planification : ${verdict.quoi}`);

  // On prévient même quand la planification a échoué : s'il restait une demande d'un tour
  // précédent, elle attend toujours, et l'échec du jour ne doit pas la rendre muette.
  await alerter(false);
  return verdict.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\n✘ ${err.message}`);
    process.exit(1);
  });
