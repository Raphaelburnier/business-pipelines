#!/usr/bin/env node
// Service de publication : voir src/publieur.js. Un passage par minute sur chaque projet
// qui a `"publier": true` et un `"github"` dans sa fiche.
const path = require("path");
const publieur = require("../src/publieur");
const pullRequests = require("../src/pull-requests");
const suivi = require("../src/suivi-livraisons");
const { lireAutorises } = require("../src/livreur");
const rattachements = require("../src/rattachements");
const signature = require("../src/signature-commandes");
const { EventStore } = require("agent-orchestrator");

const RACINE = path.resolve(__dirname, "..");
const PROJETS = process.env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
const ETAT = process.env.PUBLIEUR_ETAT || path.join(RACINE, "etat", "publications.json");
const INTERVALLE = Number(process.env.PUBLIEUR_INTERVALLE_MS || 60000);
const JETON_PUBLIEUR = process.env.GITHUB_TOKEN_PUBLIEUR || "";
// Les miroirs des dépôts système, que le livreur lit sans jeton (docs/SPEC-livraison.md, §4.1).
// Leur propre jeton, en lecture seule : ne pas réutiliser les jetons de publication/fusion,
// qui ont des droits d'écriture. Sans jeton de miroirs, pas de miroirs.
const MIROIRS = publieur.miroirsSysteme(process.env.PUBLIEUR_MIROIRS);
const MIROIRS_DIR = process.env.PUBLIEUR_MIROIRS_DIR || "/git/systeme";
const JETON_MIROIRS = process.env.GITHUB_TOKEN_MIROIRS || "";

// Les PR vues et fusionnées depuis le cockpit (src/pull-requests.js) : ce jeton a également
// les droits d'écriture nécessaires au publieur. On le privilégie pour inclure les dépôts
// système ; le jeton publication dédié reste un repli limité aux projets auxquels il a accès.
const JETON_FUSION = process.env.GITHUB_TOKEN_FUSION || "";
const CHOIX_JETON_PUBLICATION = publieur.choisirJetonPublication({ fusion: JETON_FUSION, publieur: JETON_PUBLIEUR });
const JETON_PUBLICATION = CHOIX_JETON_PUBLICATION.jeton;
const PR_INSTANTANE = process.env.PULL_REQUESTS_ETAT || path.join(RACINE, "etat", "pull-requests.json");
const PR_DEPOTS = pullRequests.depotsSurveilles({ texte: process.env.PULL_REQUESTS_DEPOTS, miroirs: MIROIRS, projetsDir: PROJETS });
// Qui peut fusionner : la même liste que pour livrer, relue à chaque commande. Le cockpit la
// vérifie aussi, mais l'event store où arrive la commande est écrit par d'autres services.
const AUTORISES = process.env.LIVRAISON_AUTORISES_FICHIER || path.join(RACINE, "specs", "livraison.json");
const SONDE_COMMANDES_MS = 3000;
const COMMANDES_GITHUB = ["github.merge", "github.ci.rerun", "github.pr.comment", rattachements.KIND];
// Le seul dépôt où un rattachement de pipeline peut écrire : celui des fiches du cockpit.
const DEPOT_COCKPIT = process.env.COCKPIT_DEPOT || "Raphaelburnier/business-pipelines";
// Une PR d'agent prête, non sensible, dont tests et revues couvrent la tête, est fusionnée par
// le publieur. `0` laisse toutes les fusions au clic du cockpit.
const FUSION_AUTO = !["0", "false", "non", "off"].includes(String(process.env.PUBLIEUR_FUSION_AUTO ?? "1").toLowerCase());
// Remettre à jour les PR d'agents vertes dont la base a avancé. `0` les laisse au bouton du cockpit.
const MAJ_BASE_AUTO = !["0", "false", "non", "off"].includes(String(process.env.PUBLIEUR_MAJ_BASE_AUTO ?? "1").toLowerCase());

if (!JETON_PUBLICATION) {
  console.error("GITHUB_TOKEN_FUSION et GITHUB_TOKEN_PUBLIEUR absents : rien ne sera publié. Voir specs/publieur.env.example.");
  process.exit(1);
}
// Clé partagée avec le cockpit seul (COMMANDES_CLE_FICHIER) : une fusion ou un rattachement
// non signé est refusé. Sans clé, transition : accepté avec un avertissement à chaque fois.
const CLE_COMMANDES = signature.cleEnv();
if (!CLE_COMMANDES) console.error("COMMANDES_CLE_FICHIER absent ou vide : les fusions ne sont pas vérifiées. Voir docs/SECURITE-COMMANDES.md.");
const apiFusion = JETON_FUSION ? publieur.apiAvec({ fetchImpl: fetch, jeton: JETON_FUSION }) : null;
if (!apiFusion) console.error("GITHUB_TOKEN_FUSION absent : le cockpit ne voit ni ne fusionne les PR. Voir specs/publieur.env.example.");

console.log(`Authentification GitHub du publieur : ${CHOIX_JETON_PUBLICATION.source}`);
const git = publieur.gitAvec({ jeton: JETON_PUBLICATION });
const api = publieur.apiAvec({ fetchImpl: fetch, jeton: JETON_PUBLICATION });
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
        if (!pullRequests.depotSurveille(PR_DEPOTS, depot)) {
          console.log(`fusion automatique ${depot}#${livraison.pr} non faite : dépôt non surveillé`);
          return;
        }
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
  let instantane = null;
  try {
    instantane = await pullRequests.relever({ api: apiFusion, depots: PR_DEPOTS });
    pullRequests.ecrireInstantane(PR_INSTANTANE, instantane);
  } catch (err) {
    console.error(`relevé des PR : ${String(err.message).split("\n")[0]}`);
  }
  if (instantane && MAJ_BASE_AUTO) await mettreAJourBasesDepassees(instantane);
}

// Une PR d'agent verte sur une base dépassée attendrait sans fin : sa branche est mise à jour
// une fois par base, ce qui relance sa CI sur le merge courant. Un conflit est laissé à l'agent.
const basesMisesAJour = new Set();
async function mettreAJourBasesDepassees(instantane) {
  for (const pr of pullRequests.aMettreAJour(instantane)) {
    const cle = `${pr.depot}#${pr.numero}@${pr.baseSha}`;
    if (basesMisesAJour.has(cle)) continue;
    basesMisesAJour.add(cle);
    try {
      await pullRequests.mettreAJourBranche({ api: apiFusion, ...pr });
      console.log(`${pr.depot}#${pr.numero} : CI verte sur une base dépassée, branche mise à jour pour une nouvelle CI`);
    } catch (err) {
      console.error(`${pr.depot}#${pr.numero} : mise à jour de la branche refusée : ${String(err.message).split("\n")[0]}`);
    }
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
    const preuve = signature.verifier(CLE_COMMANDES, commande);
    if (preuve.ok && preuve.transition) console.error(`${commande.kind} ${commande.id} accepté sans vérification de signature (transition)`);
    if (!apiFusion) {
      resultat = { ok: false, raison: "GITHUB_TOKEN_FUSION absent du publieur" };
    } else if (!preuve.ok) {
      resultat = { ok: false, raison: preuve.raison };
    } else if (!lireAutorises(AUTORISES).has(String(commande.par))) {
      resultat = { ok: false, raison: `${commande.par} n'est pas autorisé à fusionner (specs/livraison.json)` };
    } else if (commande.kind !== rattachements.KIND && !pullRequests.depotSurveille(PR_DEPOTS, depot)) {
      resultat = { ok: false, raison: `${depot} n'est pas un dépôt surveillé : le publieur n'y agit pas` };
    } else if (commande.kind === rattachements.KIND) {
      try {
        if (commande.payload.depot !== DEPOT_COCKPIT) throw new Error(`rattachement refusé hors du dépôt du cockpit (${DEPOT_COCKPIT})`);
        const pr = await rattachements.proposer({ api: apiFusion, depot: DEPOT_COCKPIT, projet: commande.payload.projet, pipeline: commande.payload.pipeline, par: commande.par });
        resultat = { ok: true, detail: pr };
      } catch (err) {
        resultat = { ok: false, raison: String(err.message).split("\n")[0] };
      }
    } else if (commande.kind === "github.pr.comment") {
      try {
        const detail = await pullRequests.commenter({ api: apiFusion, demande: commande.payload });
        resultat = { ok: true, detail };
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
      const quoi = { "github.ci.rerun": "relance CI", "github.pr.comment": "commentaire" }[commande.kind] || "fusion";
      console.log(`${quoi} ${depot}#${numero} demandée par ${commande.par} : ${resultat.ok ? (resultat.detail?.statut || "faite") : resultat.raison}`);
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
