// Contrôle normal de la CI, également utilisable avant une PR avec --base <ref>.
// Comparer au premier parent du merge testé pour refuser un cadrage modifié sans
// nouvelle révision ; une première migration sans feuille JSON n'a pas de précédent.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { assemblerFeuille, creerCadreur, validerEvolution } = require("../src/cadrage-lots.mjs");
const FICHIERS = ["web/src/avenir/feuille.json", "web/src/avenir/feuille-archive.json"];
const cwd = path.join(__dirname, "..");
// review-verdict.cjs borne chaque fichier à 100 000 octets. Refuser tôt un
// formatage trop volumineux plutôt que découvrir un diff tronqué après publication.
for (const fichier of FICHIERS) {
  if (fs.statSync(path.join(cwd, fichier)).size > 100000) {
    throw new Error(`${fichier} au-delà des 100 000 octets admis par la revue : lancer npm run feuille:formater, qui archive les lots et défauts faits sans supprimer de données ; si cela ne suffit pas, cadrer un découpage.`);
  }
}
const feuille = assemblerFeuille(...FICHIERS.map((f) => require(path.join(cwd, f))));
creerCadreur(feuille, require("../web/src/avenir/objectifs.json"));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--base")) throw new Error("Usage : node bin/valider-feuille.js [--base ref]");
const base = args[1] || (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_NAME === "pull_request" ? "HEAD^1" : null);

// Le contenu d'un fichier à la révision de base, ou null s'il n'y existait pas encore.
function aLaBase(fichier) {
  try { return execFileSync("git", ["show", `${base}:${fichier}`], { cwd, stdio: "pipe", encoding: "utf8" }); }
  catch (e) {
    // Distinguer le fichier absent de la révision illisible avant d'accepter une migration.
    const fichiers = execFileSync("git", ["ls-tree", "--name-only", base, fichier], { cwd, encoding: "utf8" });
    if (fichiers.trim()) throw e;
    return null;
  }
}

if (base) {
  execFileSync("git", ["rev-parse", "--verify", base], { cwd, stdio: "pipe" });
  const [principale, archive] = FICHIERS.map(aLaBase);
  // Une base antérieure à l'archive n'a que la feuille principale : tout y était.
  if (principale) validerEvolution(assemblerFeuille(JSON.parse(principale), archive ? JSON.parse(archive) : { lots: [], defauts: [] }), feuille);
}
console.log("Feuille, archive et catalogue cohérents ; cadrages, dépendances et clôtures valides.");
