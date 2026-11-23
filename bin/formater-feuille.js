// Une entrée par ligne, comme l'ancienne feuille TypeScript : le diff reste lisible
// et sous la limite de lecture du workflow de revue, sans enlever de données.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const fichier = path.join(__dirname, "../web/src/avenir/feuille.json");
const donnees = JSON.parse(fs.readFileSync(fichier, "utf8"));
assert.deepEqual(Object.keys(donnees).sort(), ["defauts", "lots"]);
const lots = donnees.lots.map(({ etapes, ...lot }) => {
  const champs = Object.entries(lot).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  champs.push(`      "etapes": [\n${etapes.map(e => `        ${JSON.stringify(e)}`).join(',\n')}\n      ]`);
  return `    {\n${champs.join(',\n')}\n    }`;
});
// L'indentation externe ne porte aucune donnée. La retirer économise la marge
// nécessaire aux nouveaux suivis, en gardant une entrée par ligne pour la revue.
const sortie = `{\n  "lots": [\n${lots.join(',\n')}\n  ],\n  "defauts": [\n${donnees.defauts.map(d => `    ${JSON.stringify(d)}`).join(',\n')}\n  ]\n}\n`.replace(/^  /gm, "");
assert.deepEqual(JSON.parse(sortie), donnees, "Le formatage ne doit modifier aucune donnée.");
fs.writeFileSync(fichier, sortie);
console.log(`Feuille formatée sans changement de données : ${Buffer.byteLength(sortie)} octets.`);
