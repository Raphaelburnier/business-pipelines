// Signature des commandes d'autorité : fusionner une PR, rattacher un pipeline, livrer.
//
// Le runner monte `etat/` en écriture et ses agents ont Bash : une ligne posée directement
// dans `commands` portait jusqu'ici le même pouvoir qu'un clic de Raphaël, puisque le
// publieur et le livreur ne relisaient que `par` et `canal`, deux champs que n'importe quel
// écrivain de la base choisit. Le cockpit signe donc ces commandes par HMAC avec une clé que
// seuls le cockpit, le publieur et le livreur montent ; le runner ne la voit jamais.
//
// La signature couvre l'id, le kind, la charge validée, `par`, `canal` et l'heure de création.
// Une commande recopiée change d'id ; une ancienne commande remise en file est refusée par
// sa fraîcheur.
const crypto = require("crypto");
const fs = require("fs");

const KINDS_SIGNES = new Set(["github.merge", "github.project.attach", "livraison.start"]);
const FRAICHEUR_MS = 30 * 60 * 1000;
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

/**
 * Vérifie une commande lue dans la file. Sans clé, accepte en le disant (transition) ; avec
 * clé, exige une signature valide et une commande de moins de 30 minutes.
 * @param {Buffer|null} cle
 * @param {{ id: string, kind: string, payload: unknown, par: string, canal: string|null, created_at: string, sig?: string|null }} commande
 * @param {{ maintenant?: number, fraicheurMs?: number }} [options]
 * @returns {{ ok: true, transition?: boolean } | { ok: false, raison: string }}
 */
function verifier(cle, commande, { maintenant = Date.now(), fraicheurMs = FRAICHEUR_MS } = {}) {
  if (!KINDS_SIGNES.has(commande.kind)) return { ok: true };
  if (!cle) return { ok: true, transition: true };
  const sig = String(commande.sig || "");
  if (!/^[0-9a-f]{64}$/.test(sig)) return { ok: false, raison: "commande non signée par le cockpit" };
  const attendue = Buffer.from(signer(cle)(commande), "hex");
  if (!crypto.timingSafeEqual(attendue, Buffer.from(sig, "hex"))) {
    return { ok: false, raison: "signature de commande invalide" };
  }
  const age = maintenant - Date.parse(commande.created_at);
  if (!Number.isFinite(age) || age > fraicheurMs || age < -60_000) {
    return { ok: false, raison: "commande signée trop ancienne : recliquer depuis le cockpit" };
  }
  return { ok: true };
}

let cleChargee;
/** La clé désignée par COMMANDES_CLE_FICHIER, lue une fois par processus. */
function cleEnv() {
  if (cleChargee === undefined) cleChargee = lireCle(process.env.COMMANDES_CLE_FICHIER);
  return cleChargee;
}

module.exports = { cleEnv, KINDS_SIGNES, FRAICHEUR_MS, lireCle, canonique, signer, signataire, verifier };
