#!/usr/bin/env node
// Valide le rapport du vérificateur d'improve-app, et le recopie dans le fichier que lit le
// moteur quand une sortie est donnée.
//
// Le moteur efface le rapport désigné par `outcomeFrom` avant de lancer un nœud script,
// pour ne jamais relire le verdict d'un passage précédent. Ce script ne produit pas le
// rapport, il le lit : pointé directement sur test-report.json, le moteur l'effaçait avant
// la lecture (run c560f64f, 2026-09-26). Le verdict vit donc dans son propre fichier.
const fs = require("fs");

const [fichier, sortie] = process.argv.slice(2);
if (!fichier) throw new Error("usage: valider-test-report.js <rapport.json> [verdict.json]");
const rapport = JSON.parse(fs.readFileSync(fichier, "utf-8"));
if (!["PASS", "FAIL"].includes(rapport.verdict) || !Array.isArray(rapport.failures)) {
  throw new Error(`${fichier} : verdict PASS|FAIL et tableau failures attendus`);
}
if (sortie) fs.writeFileSync(sortie, `${JSON.stringify({ verdict: rapport.verdict, failures: rapport.failures }, null, 2)}\n`);
