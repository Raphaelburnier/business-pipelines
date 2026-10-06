#!/usr/bin/env node
// Service de publication : voir src/publieur.js. Un passage par minute sur chaque projet
// qui a `"publier": true` et un `"github"` dans sa fiche.
const path = require("path");
const publieur = require("../src/publieur");
const pullRequests = require("../src/pull-requests");
const { lireAutorises } = require("../src/livreur");
const { EventStore } = require("agent-orchestrator");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const ETAT = process.env.PUBLIEUR_ETAT || path.join(RACINE, "etat", "publications.json");
const INTERVALLE = Number(process.env.PUBLIEUR_INTERVALLE_MS || 60000);
const JETON = process.env.GITHUB_TOKEN_PUBLIEUR || "";
// Les miroirs des dépôts système, que le livreur lit sans jeton (docs/SPEC-livraison.md, §4.1).
// Leur propre jeton, en lecture seule : celui du dessus écrit, et un jeton GitHub donne les
// mêmes droits à tous ses dépôts. Jamais de repli sur lui : sans jeton de miroirs, pas de miroirs.
const MIROIRS = publieur.miroirsSysteme(process.env.PUBLIEUR_MIROIRS);
const MIROIRS_DIR = process.env.PUBLIEUR_MIROIRS_DIR || "/git/systeme";
const JETON_MIROIRS = process.env.GITHUB_TOKEN_MIROIRS || "";

// Les PR vues et fusionnées depuis le cockpit (src/pull-requests.js) : un troisième jeton,
// qui seul peut fusionner. Absent, le cockpit le dit et ne propose aucune fusion.
const JETON_FUSION = process.env.GITHUB_TOKEN_FUSION || "";
const PR_INSTANTANE = process.env.PULL_REQUESTS_ETAT || path.join(RACINE, "etat", "pull-requests.json");
const PR_DEPOTS = pullRequests.depotsSurveilles({ texte: process.env.PULL_REQUESTS_DEPOTS, miroirs: MIROIRS, projetsDir: PROJETS });
// Qui peut fusionner : la même liste que pour livrer, relue à chaque commande. Le cockpit la
// vérifie aussi, mais l'event store où arrive la commande est écrit par d'autres services.
const AUTORISES = process.env.LIVRAISON_AUTORISES_FICHIER || path.join(RACINE, "specs", "livraison.json");
const SONDE_COMMANDES_MS = 3000;

if (!JETON) {
  console.error("GITHUB_TOKEN_PUBLIEUR absent : rien ne sera publié. Voir specs/publieur.env.example.");
  process.exit(1);
}
const apiFusion = JETON_FUSION ? publieur.apiAvec({ fetchImpl: fetch, jeton: JETON_FUSION }) : null;
if (!apiFusion) console.error("GITHUB_TOKEN_FUSION absent : le cockpit ne voit ni ne fusionne les PR. Voir specs/publieur.env.example.");

const git = publieur.gitAvec({ jeton: JETON });
const api = publieur.apiAvec({ fetchImpl: fetch, jeton: JETON });
const gitMiroirs = JETON_MIROIRS ? publieur.gitAvec({ jeton: JETON_MIROIRS }) : null;
const apiMiroirs = JETON_MIROIRS ? publieur.apiAvec({ fetchImpl: fetch, jeton: JETON_MIROIRS }) : null;
if (MIROIRS.length && !JETON_MIROIRS) {
  console.error("GITHUB_TOKEN_MIROIRS absent : les miroirs ne sont pas tenus. Voir specs/publieur.env.example.");
}
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
  for (const miroir of gitMiroirs ? MIROIRS : []) {
    try {
      await publieur.tenirMiroir({ miroir, dossier: MIROIRS_DIR, git: gitMiroirs, api: apiMiroirs, journal: (ligne) => console.log(ligne) });
    } catch (err) {
      // Un jeton qui ne lit pas ce dépôt, ou le réseau : signalé, retenté au passage suivant.
      console.error(`miroir ${miroir.nom} : ${String(err.message).split("\n")[0]}`);
    }
  }
  await releverPullRequests();
}

async function releverPullRequests() {
  if (!apiFusion) {
    pullRequests.ecrireInstantane(PR_INSTANTANE, { releveLe: new Date().toISOString(), erreur: "GITHUB_TOKEN_FUSION absent", depots: [] });
    return;
  }
  try {
    pullRequests.ecrireInstantane(PR_INSTANTANE, await pullRequests.relever({ api: apiFusion, depots: PR_DEPOTS }));
  } catch (err) {
    console.error(`relevé des PR : ${String(err.message).split("\n")[0]}`);
  }
}

// Une fusion demandée depuis le cockpit (commande `github.merge`). Revérifiée de bout en bout
// par `fusionner` : PR ouverte, même tête, CI verte, fusionnable. Jamais rejouée après un
// redémarrage : la PR peut avoir changé entre-temps, il suffit de recliquer.
async function servirFusions(store) {
  store.abandonnerCommandesInterrompues({ kinds: ["github.merge"], raison: "publieur redémarré pendant la fusion : recliquer si besoin" });
  while (!arret) {
    let commande = null;
    try {
      commande = store.prendreCommande({ kinds: ["github.merge"] });
    } catch (err) {
      console.error(`file des fusions illisible : ${err.message}`);
    }
    if (!commande) {
      await attendre(SONDE_COMMANDES_MS);
      continue;
    }
    const { depot, numero, sha, baseSha } = commande.payload;
    let resultat;
    if (!apiFusion) {
      resultat = { ok: false, raison: "GITHUB_TOKEN_FUSION absent du publieur" };
    } else if (!lireAutorises(AUTORISES).has(String(commande.par))) {
      resultat = { ok: false, raison: `${commande.par} n'est pas autorisé à fusionner (specs/livraison.json)` };
    } else {
      try {
        const fusion = await pullRequests.fusionner({ api: apiFusion, demande: { depot, numero, sha, baseSha } });
        resultat = fusion.fusionnee ? { ok: true, detail: fusion } : { ok: false, raison: fusion.message || "GitHub n'a pas fusionné" };
      } catch (err) {
        resultat = { ok: false, raison: String(err.message).split("\n")[0] };
      }
    }
    store.terminerCommande(commande.id, resultat);
    console.log(`fusion ${depot}#${numero} demandée par ${commande.par} : ${resultat.ok ? "faite" : resultat.raison}`);
    await releverPullRequests();
  }
}

(async () => {
  console.log(`Publieur : projets dans ${PROJETS}, un passage toutes les ${Math.round(INTERVALLE / 1000)} s`);
  console.log(`PR surveillées : ${PR_DEPOTS.join(", ") || "aucun dépôt"}`);
  // Les fusions tournent dans leur propre boucle : un clic n'attend pas la fin d'un passage.
  const store = process.env.ORCH_EVENT_STORE ? new EventStore(process.env.ORCH_EVENT_STORE) : null;
  if (!store) console.error("ORCH_EVENT_STORE absent : les fusions demandées depuis le cockpit ne sont pas servies.");
  const fusions = store ? servirFusions(store) : Promise.resolve();
  while (!arret) {
    await passage();
    await attendre(INTERVALLE);
  }
  await fusions;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
