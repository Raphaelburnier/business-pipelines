// Contrôle normal de la CI, également utilisable avant une PR avec --base <ref>.
// Comparer au premier parent du merge testé pour refuser un cadrage modifié sans
// nouvelle révision ; une première migration sans feuille JSON n'a pas de précédent.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { creerCadreur, validerEvolution } = require("../src/cadrage-lots.mjs");
const feuille = require("../web/src/avenir/feuille.json");
creerCadreur(feuille, require("../web/src/avenir/objectifs.json"));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== "--base")) throw new Error("Usage : node bin/valider-feuille.js [--base ref]");
const base = args[1] || (process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_EVENT_NAME === "pull_request" ? "HEAD^1" : null);
if (base) {
  const cwd = path.join(__dirname, "..");
  execFileSync("git", ["rev-parse", "--verify", base], { cwd, stdio: "pipe" });
  let precedent;
  try { precedent = execFileSync("git", ["show", `${base}:web/src/avenir/feuille.json`], { cwd, stdio: "pipe", encoding: "utf8" }); }
  catch (e) {
    // Distinguer le fichier absent de la révision illisible avant d'accepter une migration.
    const fichiers = execFileSync("git", ["ls-tree", "--name-only", base, "web/src/avenir/feuille.json"], { cwd, encoding: "utf8" });
    if (fichiers.trim()) throw e;
  }
  if (precedent) validerEvolution(JSON.parse(precedent), feuille);
}
console.log("Feuille et catalogue cohérents ; cadrages, dépendances et clôtures valides.");
