// La livraison vue du cockpit (docs/SPEC-livraison.md, §5 et §6) : ce que rend
// `GET /api/livraison`, et les contrôles de `POST /api/livraisons`.
//
// Le cockpit ne calcule rien et ne déploie rien. Il lit la proposition que le livreur écrit
// dans etat/livraison.json, les commandes `livraison.start` de l'event store et les
// événements `livraison.*` du livreur. Pour livrer, il dépose une commande signée, rien de
// plus. La forme rendue est `livraison.reponse` de agent-orchestrator/packages/schemas.
const fs = require("fs");
const signature = require("./signature-commandes");

const KIND = "livraison.start";
const DEPOTS = ["cockpit", "moteur", "registre"];
const LIGNES_JOURNAL = 30;
const HISTORIQUE = 5;

class RefusLivraison extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Les logins tailnet autorisés à livrer. Fichier absent ou illisible : personne. */
function autorises(fichier) {
  try {
    const lu = JSON.parse(fs.readFileSync(fichier, "utf-8"));
    return new Set((Array.isArray(lu.autorises) ? lu.autorises : []).map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Seule une identité établie par le tailnet, et inscrite, livre (§3.2). */
function peutLivrer(qui, fichierAutorises) {
  return Boolean(qui && qui.canal === "tailnet" && autorises(fichierAutorises).has(String(qui.par)));
}

/** La proposition du livreur, ou la raison de son absence. */
function lireProposition(fichier) {
  let lu;
  try {
    lu = JSON.parse(fs.readFileSync(fichier, "utf-8"));
  } catch {
    return { proposition: null, erreur: "le livreur n'a pas encore publié de proposition" };
  }
  if (lu.erreur) return { proposition: null, erreur: String(lu.erreur) };
  return { proposition: lu, erreur: null };
}

// Une commande et ce que le livreur en a raconté, ramenées à une seule livraison.
function livraisonDe(store, commande) {
  const evenements = store.db
    .prepare(
      `SELECT type, payload_json FROM events
       WHERE type LIKE 'livraison.%' AND json_extract(payload_json, '$.commande') = ?
       ORDER BY id`
    )
    .all(commande.id)
    .map((e) => ({ type: String(e.type), payload: JSON.parse(String(e.payload_json)) }));

  let etape = null;
  let fin = null;
  let journal = [];
  for (const e of evenements) {
    if (e.type === "livraison.etape") etape = e.payload.etape;
    if (e.type === "livraison.journal") journal = journal.concat(e.payload.lignes || []);
    if (e.type === "livraison.fin") fin = e.payload;
  }
  if (fin && Array.isArray(fin.journal) && !journal.length) journal = fin.journal;

  const resultat = commande.resultat || null;
  const detail = (resultat && resultat.detail) || {};
  let issue = fin ? fin.issue : null;
  // Une commande close sans événement de fin (refusée avant d'être prise, livreur coupé) :
  // son résultat suffit à dire comment elle a fini.
  if (!issue && commande.status === "done") issue = "livree";
  if (!issue && commande.status === "refused") issue = "echec";

  return {
    id: String(commande.id),
    par: String(commande.par),
    statut: commande.status,
    cible: commande.payload,
    demandeeLe: String(commande.created_at),
    termineeLe: commande.done_at ? String(commande.done_at) : null,
    etape: fin && fin.etape ? fin.etape : etape,
    issue,
    raison: (fin && fin.raison) || (resultat && resultat.ok === false ? resultat.raison : null) || null,
    release: (fin && fin.release) || detail.release || null,
    journal: journal.slice(-LIGNES_JOURNAL).map(String),
  };
}

function commandesLivraison(store, limite) {
  return store.db
    .prepare("SELECT * FROM commands WHERE kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(KIND, limite)
    .map((ligne) => ({
      ...ligne,
      payload: JSON.parse(String(ligne.payload_json)),
      resultat: ligne.result_json ? JSON.parse(String(ligne.result_json)) : null,
    }));
}

/**
 * La réponse de `GET /api/livraison`.
 * @param {{ store: any, propositionFichier: string, autorisesFichier: string, qui: { par: string, canal: string } }} entree
 */
function etat({ store, propositionFichier, autorisesFichier, qui }) {
  const { proposition, erreur } = lireProposition(propositionFichier);
  const livraisons = commandesLivraison(store, HISTORIQUE + 1).map((c) => livraisonDe(store, c));
  const enCours = livraisons.find((l) => l.statut === "pending" || l.statut === "taken") || null;
  return {
    proposition,
    erreur,
    enCours,
    historique: livraisons.filter((l) => l !== enCours).slice(0, HISTORIQUE),
    peutLivrer: peutLivrer(qui, autorisesFichier),
  };
}

/**
 * Les contrôles de `POST /api/livraisons`, puis la commande. Tout est synchrone entre la
 * vérification et l'écriture : deux clics rapides ne peuvent pas déposer deux livraisons.
 * @returns la commande créée ; lève RefusLivraison (code HTTP + raison) sinon.
 */
function demander({ store, demande, propositionFichier, autorisesFichier, qui, cleSignature = signature.cleEnv() }) {
  if (!qui || qui.canal !== "tailnet") {
    throw new RefusLivraison(403, "livrer exige une identité établie par le tailnet");
  }
  if (!peutLivrer(qui, autorisesFichier)) {
    throw new RefusLivraison(403, `« ${qui.par} » n'est pas autorisé à livrer`);
  }
  const { proposition, erreur } = lireProposition(propositionFichier);
  if (!proposition) throw new RefusLivraison(409, `aucune proposition de livraison : ${erreur}`);
  if (!proposition.disponible) throw new RefusLivraison(409, "la production est déjà à jour");
  const cible = {};
  for (const d of DEPOTS) {
    if (!demande || demande[d] !== proposition.disponible[d]) {
      throw new RefusLivraison(409, "la proposition a changé depuis l'affichage : recharger avant de livrer");
    }
    cible[d] = demande[d];
  }
  const ouvertes = store.db
    .prepare("SELECT COUNT(*) AS n FROM commands WHERE kind = ? AND status IN ('pending', 'taken')")
    .get(KIND);
  if (Number(ouvertes.n) > 0) throw new RefusLivraison(409, "une livraison est déjà en cours");
  return store.creerCommande({ kind: KIND, payload: cible, par: qui.par, canal: qui.canal, signer: signature.signataire(cleSignature, KIND) });
}

module.exports = { KIND, RefusLivraison, autorises, peutLivrer, etat, demander };
