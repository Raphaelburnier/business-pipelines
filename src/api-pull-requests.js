// Les PR GitHub dans le cockpit : ce que lit la page, et la fusion qu'elle demande.
//
// Le cockpit ne parle jamais à GitHub. Il lit l'instantané du publieur
// (etat/pull-requests.json, src/pull-requests.js) et dépose une commande signée
// `github.merge`, que le publieur exécute avec son propre jeton après avoir tout revérifié.
// Seule une identité tailnet autorisée à livrer (specs/livraison.json) peut fusionner.
const fs = require("fs");
const pullRequests = require("./pull-requests");

const KIND = "github.merge";
const KIND_CI = "github.ci.rerun";
// Au-delà, le relevé est trop vieux pour fonder une fusion : le publieur est sans doute arrêté.
const PERIME_S = 600;

class RefusPullRequest extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function autorises(fichier) {
  try {
    const lu = JSON.parse(fs.readFileSync(fichier, "utf8"));
    return new Set((Array.isArray(lu.autorises) ? lu.autorises : []).map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

const peutFusionner = (qui, fichier) => Boolean(qui && qui.canal === "tailnet" && autorises(fichier).has(String(qui.par)));
const cle = (depot, numero) => `${depot}#${numero}`;

// Les fusions demandées : en cours (pas encore servies) et les dernières terminées, avec leur
// issue. La page montre « fusion en cours » et la raison d'un refus.
function fusionsDemandees(store) {
  const toutes = store.commandes({ limite: 5000 }).filter((c) => c.kind === KIND);
  const enCours = new Set(toutes.filter((c) => c.status === "pending" || c.status === "taken").map((c) => cle(c.payload.depot, c.payload.numero)));
  // Une PR fusionnée reste dans l'instantané jusqu'au relevé suivant du publieur : sans ce
  // filtre, elle restait affichée avec son bouton, et un second clic partait pour rien
  // (constaté le 2026-10-06 sur #68). Une PR fusionnée ne se rouvre pas, le filtre est sûr.
  const fusionnees = new Set(toutes.filter((c) => c.status === "done" && c.resultat && c.resultat.ok).map((c) => cle(c.payload.depot, c.payload.numero)));
  const recentes = toutes
    .filter((c) => c.status === "done" || c.status === "refused")
    .slice(-5)
    .reverse()
    .map((c) => ({
      depot: c.payload.depot,
      numero: c.payload.numero,
      par: c.par,
      ok: Boolean(c.resultat && c.resultat.ok),
      raison: c.resultat && !c.resultat.ok ? c.resultat.raison : null,
      le: c.done_at || c.created_at,
    }));
  return { enCours, fusionnees, recentes };
}

function relancesDemandees(store) {
  return store.commandes({ limite: 5000 }).filter((c) => c.kind === KIND_CI);
}

/**
 * Ce que montre la carte « Pull requests » de la page Décisions.
 * @param {{ store: any, instantaneFichier: string, autorisesFichier: string, qui: any, maintenant?: number }} opts
 */
function etat({ store, instantaneFichier, autorisesFichier, qui, maintenant = Date.now() }) {
  const instantane = pullRequests.lireInstantane(instantaneFichier);
  const { enCours, fusionnees, recentes } = fusionsDemandees(store);
  const relances = relancesDemandees(store);
  const age = instantane && instantane.releveLe ? Math.round((maintenant - Date.parse(instantane.releveLe)) / 1000) : null;
  return {
    releveLe: instantane ? instantane.releveLe : null,
    perime: age === null || !Number.isFinite(age) || age < -60 || age > PERIME_S,
    erreur: instantane ? instantane.erreur || null : "aucun relevé du publieur pour l'instant",
    peutFusionner: peutFusionner(qui, autorisesFichier),
    depots: ((instantane && instantane.depots) || []).map((d) => ({
      ...d,
      ouvertes: (d.ouvertes || []).filter((pr) => !fusionnees.has(cle(d.depot, pr.numero))).map((pr) => ({
        ...pr,
        raison: pullRequests.raisonDeNePasFusionner(pr),
        fusionEnCours: enCours.has(cle(d.depot, pr.numero)),
        ciRelanceEnCours: relances.some((c) =>
          c.payload.depot === d.depot && c.payload.numero === pr.numero &&
          c.payload.runId === pr.ci.runId && c.payload.tentative === pr.ci.tentative &&
          (c.status === "pending" || c.status === "taken" || (c.status === "done" && c.resultat?.ok))),
      })),
    })),
    recentes,
  };
}

/** Dépose une relance CI après relecture de la PR et vérification du relevé affiché. */
function demanderRelanceCI({ store, instantaneFichier, autorisesFichier, qui, demande }) {
  if (!peutFusionner(qui, autorisesFichier)) {
    throw new RefusPullRequest(403, "seule une identité tailnet autorisée peut relancer la CI");
  }
  const depot = String((demande && demande.depot) || "");
  const numero = Number(demande && demande.numero);
  const sha = String((demande && demande.sha) || "");
  const runId = Number(demande && demande.runId);
  const tentative = Number(demande && demande.tentative);
  const vue = etat({ store, instantaneFichier, autorisesFichier, qui });
  if (vue.perime) throw new RefusPullRequest(503, "relevé des PR trop ancien : attendre le publieur");
  const pr = vue.depots.find((d) => d.depot === depot)?.ouvertes.find((p) => p.numero === numero);
  if (!pr) throw new RefusPullRequest(404, `PR #${numero} de ${depot} absente du relevé`);
  if (pr.sha !== sha) throw new RefusPullRequest(409, "la PR a bougé depuis l'affichage : recharger avant de relancer la CI");
  if (!pr.interne || !pr.versDefaut || pr.etat !== "open") {
    throw new RefusPullRequest(409, "la relance est réservée aux PR internes ouvertes vers la branche par défaut");
  }
  // Une CI verte sur une base dépassée se relance aussi : le publieur met la branche à jour.
  const perimee = pr.ci.etat === "verte" && pr.ci.basePerimee === true;
  if ((pr.ci.etat !== "rouge" && !perimee) || pr.ci.runId !== runId || pr.ci.tentative !== tentative ||
      !Number.isSafeInteger(runId) || runId <= 0 || !Number.isSafeInteger(tentative) || tentative < 1) {
    throw new RefusPullRequest(409, "aucune CI rouge récente ne peut être relancée pour cette tête");
  }
  if (pr.ciRelanceEnCours) throw new RefusPullRequest(409, "une relance CI est déjà en cours pour cette PR");
  try {
    return store.creerCommande({ kind: KIND_CI, payload: { depot, numero, sha, runId, tentative }, par: qui.par, canal: qui.canal });
  } catch (err) {
    throw new RefusPullRequest(400, err.message);
  }
}

/**
 * Dépose une fusion pour le publieur. Refusée d'ici si elle n'a aucune chance : le publieur
 * revérifie de toute façon contre GitHub au moment de fusionner.
 * @param {{ store: any, instantaneFichier: string, autorisesFichier: string, qui: any, demande: any }} opts
 */
function demander({ store, instantaneFichier, autorisesFichier, qui, demande }) {
  if (!peutFusionner(qui, autorisesFichier)) {
    throw new RefusPullRequest(403, "seule une identité tailnet autorisée peut fusionner (specs/livraison.json sur le NAS)");
  }
  const depot = String((demande && demande.depot) || "");
  const numero = Number(demande && demande.numero);
  const sha = String((demande && demande.sha) || "");
  const baseSha = String((demande && demande.baseSha) || "");
  if (fusionsDemandees(store).fusionnees.has(cle(depot, numero))) {
    throw new RefusPullRequest(409, `PR #${numero} déjà fusionnée depuis le cockpit`);
  }
  const vue = etat({ store, instantaneFichier, autorisesFichier, qui });
  if (vue.perime) throw new RefusPullRequest(503, "relevé des PR trop ancien : le publieur ne tourne pas, ou n'a pas de jeton de fusion");
  const d = vue.depots.find((x) => x.depot === depot);
  const pr = d && d.ouvertes.find((p) => p.numero === numero);
  if (!pr) throw new RefusPullRequest(404, `PR #${numero} de ${depot} absente du relevé`);
  if (pr.sha !== sha) throw new RefusPullRequest(409, "la PR a bougé depuis l'affichage : recharger avant de fusionner");
  if (pr.baseSha !== baseSha) throw new RefusPullRequest(409, "la base a bougé depuis l'affichage : recharger avant de fusionner");
  if (pr.fusionEnCours) throw new RefusPullRequest(409, "une fusion est déjà demandée pour cette PR");
  if (pr.raison) throw new RefusPullRequest(409, `PR non fusionnable : ${pr.raison}`);
  try {
    return store.creerCommande({ kind: KIND, payload: { depot, numero, sha, baseSha }, par: qui.par, canal: qui.canal });
  } catch (err) {
    throw new RefusPullRequest(400, err.message);
  }
}

module.exports = { etat, demander, demanderRelanceCI, peutFusionner, RefusPullRequest, KIND, KIND_CI, PERIME_S };
