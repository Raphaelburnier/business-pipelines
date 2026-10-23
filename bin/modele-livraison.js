#!/usr/bin/env node
// Commande opérateur sur le NAS. Le runner n'a ni ce registre monté ni son droit d'écriture.
const path = require("node:path");
const { parseArgs } = require("node:util");
const modeles = require("../src/modeles-livraison");
const { gitLocal } = require("../src/livreur");

try {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    sha: { type: "string" }, empreinte: { type: "string" }, par: { type: "string" },
    miroir: { type: "string", default: "/git/systeme/business-pipelines.git" },
    fichier: { type: "string", default: "/volume1/docker/business-pipelines/specs/livraison-modeles.json" },
  } });
  const [action, ...reste] = positionals;
  if (reste.length || !["inspecter", "approuver", "revoquer"].includes(action)) throw new Error("usage : modele-livraison.js inspecter|approuver --sha <SHA complet> [--par <opérateur>] | revoquer --empreinte <SHA-256> [--miroir <dépôt>] [--fichier <registre>]");
  const options = { git: gitLocal(), depot: path.resolve(values.miroir), fichier: path.resolve(values.fichier), sha: values.sha, par: values.par };
  let resultat;
  if (action === "inspecter") resultat = modeles.empreinte(options);
  if (action === "approuver") resultat = modeles.approuver(options);
  if (action === "revoquer") { modeles.revoquer({ fichier: options.fichier, hash: values.empreinte }); resultat = { revoquee: values.empreinte }; }
  console.log(JSON.stringify(resultat, null, 2));
} catch (err) { console.error(err.message); process.exitCode = 1; }
