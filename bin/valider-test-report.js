#!/usr/bin/env node
const fs = require("fs");

const fichier = process.argv[2];
if (!fichier) throw new Error("usage: valider-test-report.js <rapport.json>");
const rapport = JSON.parse(fs.readFileSync(fichier, "utf-8"));
if (!["PASS", "FAIL"].includes(rapport.verdict) || !Array.isArray(rapport.failures)) {
  throw new Error(`${fichier} : verdict PASS|FAIL et tableau failures attendus`);
}
