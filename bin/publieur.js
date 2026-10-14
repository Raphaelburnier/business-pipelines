#!/usr/bin/env node
// Service de publication : voir src/publieur.js. Un passage par minute sur chaque projet
// qui a `"publier": true` et un `"github"` dans sa fiche.
const path = require("path");
const publieur = require("../src/publieur");
const pullRequests = require("../src/pull-requests");
const suivi = require("../src/suivi-livraisons");
const { lireAutorises } = require("../src/livreur");
const rattachements = require("../src/rattachements");
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
const COMMANDES_GITHUB = ["github.merge", "github.ci.rerun", rattachements.KIND];
// Le seul dépôt où un rattachement de pipeline peut écrire : celui des fiches du cockpit.
const DEPOT_COCKPIT = process.env.COCKPIT_DEPOT || "Raphaelburnier/business-pipelines";
// Une PR d'agent prête, non sensible, dont tests et revues couvrent la tête, est fusionnée par
// le publieur. `0` laisse toutes les fusions au clic du cockpit.
const FUSION_AUTO = !["0", "false", "non", "off"].includes(String(process.env.PUBLIEUR_FUSION_AUTO ?? "1").toLowerCase());

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
// Le suivi des livraisons vit dans l'event store du moteur : il survit à un redémarrage du
// publieur, qui repart des livraisons non finies. Le même store porte la file des fusions.
const store = process.env.ORCH_EVENT_STORE ? new EventStore(process.env.ORCH_EVENT_STORE) : null;
if (!store) console.error("ORCH_EVENT_STORE absent : ni suivi des livraisons, ni fusions demandées depuis le cockpit.");
// Le suivi lit les CI (Actions) et les conversations : le jeton de fusion en a le droit.
const apiSuivi = apiFusion || api;
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
        store,
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
  await suivreLivraisons();
  await releverPullRequests();
}

// La livraison d'une PR, si elle vient d'un run : seules celles-là portent des preuves.
function livraisonDePR(depot, numero) {
  if (!store) return null;
  return store.livraisons({ enCours: true }).find((l) => String(l.repo).toLowerCase() === depot.toLowerCase() && l.pr === numero) || null;
}

// Les preuves au moment de fusionner, sur le SHA exact du PUT. `strict` : la fusion automatique
// exige tests et revues ; un clic peut passer outre une livraison sans attestation, jamais
// une preuve périmée.
function verifierPreuves({ strict }) {
  return async ({ depot, numero, sha }) => {
    const livraison = livraisonDePR(depot, numero);
    if (!livraison) return null;
    const p = await suivi.preuvesDe({ api: apiSuivi, depot, livraison, sha });
    if (!p) return null;
    return strict || !p.expliciteAutorise ? p.raison : null;
  };
}

async function suivreLivraisons() {
  if (!store) return;
  const projets = publieur.projetsAPublier(PROJETS);
  const reverifier = async ({ livraison, headSha }) => {
    const projet = projets.find((p) => p.id === livraison.projectId);
    if (!projet) return;
    try {
      publieur.demanderReverification({ git, store, projet, urlDepot: `https://github.com/${projet.github}.git`, livraison, headSha, journal: (l) => console.log(l) });
    } catch (err) {
      console.error(`livraison ${livraison.runId.slice(0, 8)} : revérification non demandée, ${String(err.message).split("\n")[0]}`);
    }
  };
  const fusionnerAuto = apiFusion && FUSION_AUTO
    ? async ({ livraison, detail, depot }) => {
        try {
          const fusion = await pullRequests.fusionner({ api: apiFusion, demande: { depot, numero: livraison.pr, sha: detail.sha, baseSha: detail.baseSha }, verifierPreuves: verifierPreuves({ strict: true }) });
          console.log(`fusion automatique ${depot}#${livraison.pr} : ${fusion.fusionnee ? "faite" : fusion.message || "refusée par GitHub"}`);
        } catch (err) {
          console.log(`fusion automatique ${depot}#${livraison.pr} non faite : ${String(err.message).split("\n")[0]}`);
        }
      }
    : null;
  try {
    await suivi.suivreLivraisons({ api: apiSuivi, store, projets, journal: (ligne) => console.log(ligne), reverifier, fusionnerAuto });
  } catch (err) {
    console.error(`suivi des livraisons : ${String(err.message).split("\n")[0]}`);
  }
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
  store.abandonnerCommandesInterrompues({ kinds: COMMANDES_GITHUB, raison: "publieur redémarré pendant l'action GitHub : recliquer si besoin" });
  while (!arret) {
    let commande = null;
    try {
      commande = store.prendreCommande({ kinds: COMMANDES_GITHUB });
    } catch (err) {
      console.error(`file des fusions illisible : ${err.message}`);
    }
    if (!commande) {
      await attendre(SONDE_COMMANDES_MS);
      continue;
    }
    const { depot, numero, sha, baseSha, runId, tentative } = commande.payload;
    let resultat;
    if (!apiFusion) {
      resultat = { ok: false, raison: "GITHUB_TOKEN_FUSION absent du publieur" };
    } else if (!lireAutorises(AUTORISES).has(String(commande.par))) {
      resultat = { ok: false, raison: `${commande.par} n'est pas autorisé à fusionner (specs/livraison.json)` };
    } else if (commande.kind === rattachements.KIND) {
      try {
        if (commande.payload.depot !== DEPOT_COCKPIT) throw new Error(`rattachement refusé hors du dépôt du cockpit (${DEPOT_COCKPIT})`);
        const pr = await rattachements.proposer({ api: apiFusion, depot: DEPOT_COCKPIT, projet: commande.payload.projet, pipeline: commande.payload.pipeline, par: commande.par });
        resultat = { ok: true, detail: pr };
      } catch (err) {
        resultat = { ok: false, raison: String(err.message).split("\n")[0] };
      }
    } else if (commande.kind === "github.ci.rerun") {
      try {
        const detail = await pullRequests.relancerCI({ api: apiFusion, demande: { depot, numero, sha, runId, tentative } });
        resultat = { ok: true, detail };
      } catch (err) {
        resultat = { ok: false, raison: String(err.message).split("\n")[0] };
      }
    } else {
      try {
        const fusion = await pullRequests.fusionner({ api: apiFusion, demande: { depot, numero, sha, baseSha }, verifierPreuves: verifierPreuves({ strict: false }) });
        resultat = fusion.fusionnee ? { ok: true, detail: fusion } : { ok: false, raison: fusion.message || "GitHub n'a pas fusionné" };
      } catch (err) {
        resultat = { ok: false, raison: String(err.message).split("\n")[0] };
      }
    }
    store.terminerCommande(commande.id, resultat);
    if (commande.kind === rattachements.KIND) {
      console.log(`rattachement ${commande.payload.pipeline} → ${commande.payload.projet} demandé par ${commande.par} : ${resultat.ok ? `PR #${resultat.detail.numero}` : resultat.raison}`);
    } else {
      console.log(`${commande.kind === "github.ci.rerun" ? "relance CI" : "fusion"} ${depot}#${numero} demandée par ${commande.par} : ${resultat.ok ? (resultat.detail?.statut || "faite") : resultat.raison}`);
    }
    // Une fusion confirmée remonte au run sans attendre le passage suivant.
    await suivreLivraisons();
    await releverPullRequests();
  }
}

(async () => {
  console.log(`Publieur : projets dans ${PROJETS}, un passage toutes les ${Math.round(INTERVALLE / 1000)} s`);
  console.log(`PR surveillées : ${PR_DEPOTS.join(", ") || "aucun dépôt"}`);
  // Les fusions tournent dans leur propre boucle : un clic n'attend pas la fin d'un passage.
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
