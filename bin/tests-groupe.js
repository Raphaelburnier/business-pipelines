#!/usr/bin/env node
// Lance une part des tests serveur, pour répartir `npm test` sur plusieurs jobs de CI (18.17).
//
//   node bin/tests-groupe.js <groupe> <nombre de groupes>
//
// La liste vient du script `test` de package.json, découpé sur « && » : un fichier de test
// ajouté là est forcément lancé par un groupe, sans seconde liste à tenir. Les commandes sont
// réparties par durée, la plus longue d'abord dans le groupe le moins chargé. Quatre fichiers
// faisaient 200 des 330 secondes de la CI du 19 novembre, joués l'un après l'autre.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Secondes mesurées en local le 19 novembre 2026 ; un fichier absent compte pour 2.
const DUREES = {
  "test/deploiement.test.js": 58, "test/sante-plateforme.test.js": 57, "test/ci-autofix.test.js": 52,
  "test/reprises-runs.test.js": 34, "test/agent-gated-merge.test.js": 22, "test/deploiement-alerteur.test.js": 12,
  "test/livreur.test.js": 12, "test/suivi-livraisons.test.js": 11, "test/command-run.test.js": 11, "test/acces.test.js": 8,
  "test/deploiement-runs.test.js": 6, "test/ai-studio.test.js": 6, "test/controle-execution.test.js": 6,
};

function commandes(script) {
  return script.split("&&").map((c) => c.trim()).filter(Boolean);
}

function duree(commande) {
  const fichiers = commande.match(/test\/[\w.-]+\.test\.js/g) || [];
  return fichiers.reduce((total, f) => total + (DUREES[f] ?? 2), 0) || 2;
}

function repartir(liste, nombre) {
  const groupes = Array.from({ length: nombre }, () => ({ total: 0, commandes: [] }));
  const triees = liste.map((c, i) => ({ c, i, d: duree(c) })).sort((a, b) => b.d - a.d || a.i - b.i);
  for (const { c, i, d } of triees) {
    const cible = groupes.reduce((min, g) => (g.total < min.total ? g : min), groupes[0]);
    cible.total += d;
    cible.commandes.push({ c, i });
  }
  // Dans un groupe, l'ordre du script est gardé : il reste celui que les auteurs ont lu.
  return groupes.map((g) => ({ total: g.total, commandes: g.commandes.sort((a, b) => a.i - b.i).map((x) => x.c) }));
}

function main(argv) {
  const groupe = Number(argv[0]);
  const nombre = Number(argv[1]);
  if (!Number.isInteger(nombre) || nombre < 1 || !Number.isInteger(groupe) || groupe < 1 || groupe > nombre) {
    console.error("usage : node bin/tests-groupe.js <groupe> <nombre de groupes>");
    return 2;
  }
  const racine = path.join(__dirname, "..");
  const script = require(path.join(racine, "package.json")).scripts.test;
  const part = repartir(commandes(script), nombre)[groupe - 1];
  console.log(`groupe ${groupe}/${nombre} : ${part.commandes.length} commande(s), environ ${part.total} s`);
  for (const commande of part.commandes) {
    console.log(`\n> ${commande}`);
    const r = spawnSync(commande, { cwd: racine, shell: true, stdio: "inherit" });
    if (r.status !== 0) return r.status || 1;
  }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { commandes, repartir, duree };
