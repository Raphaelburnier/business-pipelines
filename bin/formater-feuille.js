// Une entrée par ligne, comme l'ancienne feuille TypeScript : le diff reste lisible
// et sous la limite de lecture du workflow de revue, sans enlever de données.
// Les lots entièrement faits et les défauts faits passent dans feuille-archive.json :
// la feuille principale ne garde que le travail ouvert et ne grossit plus avec l'historique.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { assemblerFeuille } = require("../src/cadrage-lots.mjs");
const dossier = path.join(__dirname, "../web/src/avenir");
const fichiers = { principale: path.join(dossier, "feuille.json"), archive: path.join(dossier, "feuille-archive.json") };

function lire(fichier) {
  const donnees = JSON.parse(fs.readFileSync(fichier, "utf8"));
  assert.deepEqual(Object.keys(donnees).sort(), ["defauts", "lots"]);
  return donnees;
}

function formater(donnees) {
  const lots = donnees.lots.map(({ etapes, ...lot }) => {
    const champs = Object.entries(lot).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    champs.push(`      "etapes": [\n${etapes.map(e => `        ${JSON.stringify(e)}`).join(',\n')}\n      ]`);
    return `    {\n${champs.join(',\n')}\n    }`;
  });
  // Compacter les lignes de structure économise la marge des nouveaux suivis.
  // Les longues entrées restent identiques : seule leur enveloppe perd des espaces.
  // Garder l'indentation des longues entrées évite de réécrire tout leur diff :
  // GitHub peut sinon omettre le patch, même quand chaque fichier reste sous 100 Ko.
  const sortie = `{\n  "lots": [\n${lots.join(',\n')}\n  ],\n  "defauts": [\n${donnees.defauts.map(d => `    ${JSON.stringify(d)}`).join(',\n')}\n  ]\n}\n`.replace(/^(?! *\{"id":) +/gm, "");
  assert.deepEqual(JSON.parse(sortie), donnees, "Le formatage ne doit modifier aucune donnée.");
  return sortie;
}

const principale = lire(fichiers.principale);
const archive = lire(fichiers.archive);
// Comparer sans l'ordre des défauts : archiver déplace un défaut fait en fin de liste.
const contenu = (f) => ({ lots: f.lots, defauts: [...f.defauts].sort((a, b) => a.id.localeCompare(b.id)) });
const avant = contenu(assemblerFeuille(principale, archive));

const fini = (lot) => lot.etapes.length > 0 && lot.etapes.every((e) => e.statut === "fait");
const parNumero = (a, b) => String(a.id).localeCompare(String(b.id), "fr", { numeric: true });
archive.lots = [...archive.lots, ...principale.lots.filter(fini)].sort(parNumero);
principale.lots = principale.lots.filter((lot) => !fini(lot));
archive.defauts = [...archive.defauts, ...principale.defauts.filter((d) => d.statut === "fait")];
principale.defauts = principale.defauts.filter((d) => d.statut !== "fait");
assert.deepEqual(contenu(assemblerFeuille(principale, archive)), avant, "L'archivage ne doit modifier aucune donnée.");

for (const [cle, donnees] of [["principale", principale], ["archive", archive]]) {
  const sortie = formater(donnees);
  fs.writeFileSync(fichiers[cle], sortie);
  console.log(`${path.basename(fichiers[cle])} formatée sans changement de données : ${Buffer.byteLength(sortie)} octets.`);
}
