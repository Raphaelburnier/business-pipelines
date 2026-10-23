// Signature des commandes d'autorité : fusionner une PR, rattacher un pipeline, livrer,
// relancer une CI, écrire à l'agent d'une PR, et la question du chat qui peut demander ces
// deux dernières.
//
// Le runner monte `etat/` en écriture et ses agents ont Bash : une ligne posée directement
// dans `commands` portait jusqu'ici le même pouvoir qu'un clic de Raphaël, puisque le
// publieur et le livreur ne relisaient que `par` et `canal`, deux champs que n'importe quel
// écrivain de la base choisit. Le cockpit signe donc ces commandes par HMAC avec une clé que
// seuls le cockpit, le publieur et le livreur montent ; le runner ne la voit jamais.
//
// La signature couvre l'id, le kind, la charge validée, `par`, `canal` et l'heure de création.
// Une commande recopiée change d'id ; une ancienne commande remise en file est refusée par
// sa fraîcheur. L'id sert aussi de nonce : le registre du publieur et du livreur refuse une
// commande déjà vue, et toute commande signée avant leur démarrage, puisque ce registre vit
// en mémoire, hors de `etat/` que le runner peut réécrire.
//
// Le chat tourne dans le runner, sans la clé. Une relance CI ou un commentaire qu'il dépose
// cite donc la question `chat.respond` signée qui l'a demandé (`payload.origine`) : même
// auteur, question fraîche, au plus MAX_ACTIONS_PAR_QUESTION actions par question. Un agent
// du runner ne peut ainsi agir qu'au nom d'une vraie question récente, et pas sans fin.
const crypto = require("crypto");
const fs = require("fs");

const KINDS_SIGNES = new Set(["github.merge", "github.project.attach", "livraison.start", "github.ci.rerun", "github.pr.comment", "chat.respond"]);
const KINDS_DELEGUES = new Set(["github.ci.rerun", "github.pr.comment"]);
const KIND_QUESTION = "chat.respond";
const FRAICHEUR_MS = 30 * 60 * 1000;
const MAX_ACTIONS_PAR_QUESTION = 5;
const TAILLE_MIN = 32;

/**
 * Lit la clé (fichier brut, au moins 32 octets). Absente : null, et la vérification reste en
 * mode transition. Présente mais trop courte : erreur, pour qu'une clé tronquée se voie.
 * @param {string|null|undefined} fichier
 * @returns {Buffer|null}
 */
function lireCle(fichier) {
  if (!fichier) return null;
  let brut;
  try {
    brut = fs.readFileSync(fichier);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "EISDIR") return null;
    throw err;
  }
  const cle = Buffer.from(brut.toString("utf8").trim(), "utf8");
  if (cle.length < TAILLE_MIN) throw new Error(`clé de signature trop courte dans ${fichier} (${TAILLE_MIN} octets minimum)`);
  return cle;
}

/** @param {{ id: string, kind: string, payload: unknown, par: string, canal: string|null|undefined, created_at: string }} c */
function canonique(c) {
  return JSON.stringify([c.id, c.kind, c.payload, c.par, c.canal ?? null, c.created_at]);
}

/** @param {Buffer} cle */
function signer(cle) {
  return (/** @type {Parameters<typeof canonique>[0]} */ c) => crypto.createHmac("sha256", cle).update(canonique(c)).digest("hex");
}

/**
 * Le signataire à passer à `store.creerCommande` pour un kind d'autorité, ou undefined.
 * @param {Buffer|null} cle
 * @param {string} kind
 */
function signataire(cle, kind) {
  return cle && KINDS_SIGNES.has(kind) ? signer(cle) : undefined;
}

/** @typedef {{ id: string, kind: string, payload: any, par: string, canal: string|null, created_at: string, sig?: string|null }} CommandeLue */

/**
 * Les ids déjà exécutés, gardés le temps de leur fraîcheur, et le compte des actions par
 * question du chat. Une commande créée avant `demarrage` est refusée : le registre d'avant
 * le redémarrage est perdu, il ne peut plus dire si elle a déjà servi.
 * @param {{ demarrage?: number }} [options]
 */
function creerRegistre({ demarrage = Date.now() } = {}) {
  /** @type {Map<string, number>} */
  const vus = new Map();
  /** @type {Map<string, { n: number, expire: number }>} */
  const parQuestion = new Map();
  /** @param {number} maintenant */
  const purger = (maintenant) => {
    for (const [id, expire] of vus) if (expire < maintenant) vus.delete(id);
    for (const [id, q] of parQuestion) if (q.expire < maintenant) parQuestion.delete(id);
  };
  return {
    /**
     * @param {CommandeLue} commande
     * @param {{ maintenant: number, fraicheurMs: number, origine?: CommandeLue }} options
     * @returns {string|null} la raison du refus, ou null
     */
    consommer(commande, { maintenant, fraicheurMs, origine }) {
      purger(maintenant);
      const reference = origine || commande;
      if (Date.parse(reference.created_at) < demarrage) return "commande signée avant le redémarrage du service : recliquer depuis le cockpit";
      if (vus.has(commande.id)) return "commande déjà exécutée : une commande signée ne sert qu'une fois";
      if (origine) {
        const q = parQuestion.get(origine.id) || { n: 0, expire: Date.parse(origine.created_at) + fraicheurMs };
        if (q.n >= MAX_ACTIONS_PAR_QUESTION) return `plus de ${MAX_ACTIONS_PAR_QUESTION} actions pour une même question du chat : reposer la question`;
        parQuestion.set(origine.id, { ...q, n: q.n + 1 });
      }
      vus.set(commande.id, maintenant + fraicheurMs + 60_000);
      return null;
    },
  };
}

/**
 * @param {Buffer} cle
 * @param {CommandeLue} commande
 * @param {number} maintenant
 * @param {number} fraicheurMs
 * @returns {string|null}
 */
function refusSignature(cle, commande, maintenant, fraicheurMs) {
  const sig = String(commande.sig || "");
  if (!/^[0-9a-f]{64}$/.test(sig)) return "commande non signée par le cockpit";
  const attendue = Buffer.from(signer(cle)(commande), "hex");
  if (!crypto.timingSafeEqual(attendue, Buffer.from(sig, "hex"))) return "signature de commande invalide";
  const age = maintenant - Date.parse(commande.created_at);
  if (!Number.isFinite(age) || age > fraicheurMs || age < -60_000) return "commande signée trop ancienne : recliquer depuis le cockpit";
  return null;
}

/**
 * Vérifie une commande lue dans la file. Sans clé, accepte en le disant (transition) ; avec
 * clé, exige une signature valide et une commande de moins de 30 minutes, ou, pour une
 * action du chat, une question d'origine qui remplit ces conditions. Avec un registre, la
 * commande est consommée : la revoir est refusé.
 * @param {Buffer|null} cle
 * @param {CommandeLue} commande
 * @param {{ maintenant?: number, fraicheurMs?: number, registre?: ReturnType<typeof creerRegistre>, lireCommande?: (id: string) => CommandeLue|null }} [options]
 * @returns {{ ok: true, transition?: boolean } | { ok: false, raison: string }}
 */
function verifier(cle, commande, { maintenant = Date.now(), fraicheurMs = FRAICHEUR_MS, registre, lireCommande } = {}) {
  if (!KINDS_SIGNES.has(commande.kind)) return { ok: true };
  if (!cle) return { ok: true, transition: true };
  /** @type {CommandeLue|undefined} */
  let origine;
  const idOrigine = commande.payload && commande.payload.origine;
  if (KINDS_DELEGUES.has(commande.kind) && !commande.sig && idOrigine) {
    const question = lireCommande ? lireCommande(String(idOrigine)) : null;
    if (!question || question.kind !== KIND_QUESTION) return { ok: false, raison: "question du chat d'origine introuvable" };
    const refus = refusSignature(cle, question, maintenant, fraicheurMs);
    if (refus) return { ok: false, raison: `question du chat d'origine : ${refus}` };
    if (question.par !== commande.par || (question.canal ?? null) !== (commande.canal ?? null)) {
      return { ok: false, raison: "l'action du chat n'est pas au nom de celui qui a posé la question" };
    }
    origine = question;
  } else {
    const refus = refusSignature(cle, commande, maintenant, fraicheurMs);
    if (refus) return { ok: false, raison: refus };
  }
  const refus = registre ? registre.consommer(commande, { maintenant, fraicheurMs, origine }) : null;
  return refus ? { ok: false, raison: refus } : { ok: true };
}

let cleChargee;
/** La clé désignée par COMMANDES_CLE_FICHIER, lue une fois par processus. */
function cleEnv() {
  if (cleChargee === undefined) cleChargee = lireCle(process.env.COMMANDES_CLE_FICHIER);
  return cleChargee;
}

module.exports = { cleEnv, KINDS_SIGNES, KINDS_DELEGUES, FRAICHEUR_MS, MAX_ACTIONS_PAR_QUESTION, lireCle, canonique, signer, signataire, creerRegistre, verifier };
