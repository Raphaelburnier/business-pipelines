#!/usr/bin/env node
// Service de publication : voir src/publieur.js. Un passage par minute sur chaque projet
// qui a `"publier": true` et un `"github"` dans sa fiche.
const path = require("path");
const publieur = require("../src/publieur");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const ETAT = process.env.PUBLIEUR_ETAT || path.join(RACINE, "etat", "publications.json");
const INTERVALLE = Number(process.env.PUBLIEUR_INTERVALLE_MS || 60000);
const JETON = process.env.GITHUB_TOKEN_PUBLIEUR || "";
// Les miroirs des dépôts système, que le livreur lit sans jeton (docs/SPEC-livraison.md, §4.1).
const MIROIRS = publieur.miroirsSysteme(process.env.PUBLIEUR_MIROIRS);
const MIROIRS_DIR = process.env.PUBLIEUR_MIROIRS_DIR || "/git/systeme";

if (!JETON) {
  console.error("GITHUB_TOKEN_PUBLIEUR absent : rien ne sera publié. Voir specs/publieur.env.example.");
  process.exit(1);
}

const git = publieur.gitAvec({ jeton: JETON });
const api = publieur.apiAvec({ fetchImpl: fetch, jeton: JETON });
let arret = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => (arret = true));
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function passage() {
  const etat = publieur.lireEtat(ETAT);
  for (const projet of publieur.projetsAPublier(PROJETS)) {
    try {
      await publieur.publierProjet({
        projet,
        git,
        api,
        urlDepot: `https://github.com/${projet.github}.git`,
        etat,
        journal: (ligne) => console.log(ligne),
      });
    } catch (err) {
      // Un projet en échec (réseau, droits) n'empêche pas les autres ; il sera retenté.
      console.error(`${projet.id} : ${String(err.message).split("\n")[0]}`);
    }
  }
  publieur.ecrireEtat(ETAT, etat);
  for (const miroir of MIROIRS) {
    try {
      await publieur.tenirMiroir({ miroir, dossier: MIROIRS_DIR, git, api, journal: (ligne) => console.log(ligne) });
    } catch (err) {
      // Un jeton qui ne lit pas ce dépôt, ou le réseau : signalé, retenté au passage suivant.
      console.error(`miroir ${miroir.nom} : ${String(err.message).split("\n")[0]}`);
    }
  }
}

(async () => {
  console.log(`Publieur : projets dans ${PROJETS}, un passage toutes les ${Math.round(INTERVALLE / 1000)} s`);
  while (!arret) {
    await passage();
    await attendre(INTERVALLE);
  }
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
