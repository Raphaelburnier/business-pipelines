#!/usr/bin/env node
// L'agent du conseiller sur le PC : il calcule, le NAS décide de tout le reste.
//
// Toutes les 20 s, il dit au cockpit qu'il est là, envoie les notes du vault qui ont changé,
// puis prend les travaux en file un par un :
// - un avis ou une réponse : le prompt arrive tout prêt du NAS, l'agent le passe à Ollama
//   sur le GPU et renvoie le JSON produit, sans rien y ajouter ;
// - une note de décision : l'agent l'écrit dans le vault local et la commite, seule.
//
// Il ne sort que vers le cockpit (tailnet) et vers Ollama (boucle locale). Aucun port
// ouvert : si le PC dort, l'agent aussi, et le cockpit affiche « PC endormi ».
//
// Réglages dans `.env` à la racine du dépôt (voir .env.example) :
//   CONSEILLER_JETON        le jeton dont le NAS garde l'empreinte (obligatoire)
//   CONSEILLER_COCKPIT_URL  URL HTTPS Tailnet du cockpit (obligatoire)
//   CONSEILLER_MODELE       qwen3:8b par défaut
//   CONSEILLER_OLLAMA_URL   http://127.0.0.1:11434 par défaut
//   CONSEILLER_VAULT        dossier du vault Git (obligatoire)
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { dansPerimetre } = require("../src/vault-index");

const RACINE = path.resolve(__dirname, "..");

function lireEnv(fichier) {
  const env = {};
  if (!fs.existsSync(fichier)) return env;
  for (const ligne of fs.readFileSync(fichier, "utf8").split("\n")) {
    const m = ligne.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}

const ENV = { ...lireEnv(path.join(RACINE, ".env")), ...process.env };
const COCKPIT = (ENV.CONSEILLER_COCKPIT_URL || "").replace(/\/$/, "");
const JETON = (ENV.CONSEILLER_JETON || "").trim();
const MODELE = ENV.CONSEILLER_MODELE || "qwen3:8b";
const OLLAMA = (ENV.CONSEILLER_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const VAULT = ENV.CONSEILLER_VAULT || "";
const PERIODE_MS = Number(ENV.CONSEILLER_PERIODE_S || 20) * 1000;
const SYNCHRO_MS = Number(ENV.CONSEILLER_SYNCHRO_S || 300) * 1000;
const VERSION = require("../package.json").version;
// Au-delà de ce nombre de travaux d'affilée, on rend la main pour battre et synchroniser.
const TRAVAUX_PAR_TOUR = 5;
const LOT_MAX = 1_500_000;

const journal = (...m) => console.log(new Date().toISOString(), ...m);

// ---------- le cockpit ----------

async function appel(requete, corps = {}, delaiMs = 30_000) {
  const reponse = await fetch(`${COCKPIT}/api/conseiller/${requete}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${JETON}`, "Content-Type": "application/json" },
    body: JSON.stringify(corps),
    signal: AbortSignal.timeout(delaiMs),
  });
  if (reponse.status === 204) return null;
  const texte = await reponse.text();
  let donnees = null;
  try {
    donnees = JSON.parse(texte);
  } catch {}
  if (!reponse.ok) throw new Error(`${requete} : HTTP ${reponse.status} ${(donnees && donnees.erreur) || texte.slice(0, 200)}`);
  return donnees;
}

// ---------- git dans le vault ----------

function git(args, { entree = null, binaire = false } = {}) {
  return new Promise((resoudre, rejeter) => {
    const p = spawn("git", ["-C", VAULT, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    const sortie = [];
    let erreur = "";
    p.stdout.on("data", (b) => sortie.push(b));
    p.stderr.on("data", (b) => (erreur += b));
    p.on("error", rejeter);
    p.on("close", (code) => {
      const tout = Buffer.concat(sortie);
      if (code !== 0) return rejeter(Object.assign(new Error(`git ${args[0]} : ${erreur.trim() || `code ${code}`}`), { sortie: tout.toString() }));
      resoudre(binaire ? tout : tout.toString());
    });
    if (entree !== null) p.stdin.end(entree);
    else p.stdin.end();
  });
}

// Chemin et blob de chaque note du périmètre, telles que HEAD les porte : on envoie ce qui
// est commité, jamais un brouillon en cours de frappe dans Obsidian.
async function arbre() {
  const brut = await git(["ls-tree", "-r", "-z", "HEAD"]);
  const out = new Map();
  for (const entree of brut.split("\0")) {
    const m = entree.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/s);
    if (m && dansPerimetre(m[2])) out.set(m[2], m[1]);
  }
  return out;
}

// Contenu de plusieurs blobs en un seul processus git : sur /mnt/c, un processus par
// fichier coûte une minute au premier envoi.
async function contenus(blobs) {
  if (!blobs.length) return new Map();
  const brut = await git(["cat-file", "--batch"], { entree: `${blobs.join("\n")}\n`, binaire: true });
  const out = new Map();
  let i = 0;
  while (i < brut.length) {
    const fin = brut.indexOf(0x0a, i);
    const [sha, type, taille] = brut.subarray(i, fin).toString().split(" ");
    if (type !== "blob") {
      i = fin + 1;
      continue;
    }
    const n = Number(taille);
    out.set(sha, brut.subarray(fin + 1, fin + 1 + n).toString("utf8"));
    i = fin + 1 + n + 1;
  }
  return out;
}

async function synchroniser() {
  const head = (await git(["rev-parse", "HEAD"])).trim();
  const distant = await appel("vault/inventaire");
  const local = await arbre();
  const supprimes = new Set(Object.keys(distant.blobs).filter((c) => !local.has(c)));
  const changes = [...local].filter(([c, b]) => distant.blobs[c] !== b);
  if (!changes.length && !supprimes.size && distant.head === head) return;

  const textes = await contenus([...new Set(changes.map(([, b]) => b))]);
  const envoyables = [];
  for (const [chemin, blob] of changes) {
    const contenu = textes.get(blob);
    // Une note devenue trop grosse ou illisible doit disparaître de l'index publié, plutôt que
    // laisser le NAS répondre avec sa version précédente.
    if (contenu === undefined || Buffer.byteLength(contenu, "utf8") > 200_000) {
      supprimes.add(chemin);
      continue;
    }
    envoyables.push({ chemin, blob, contenu });
  }

  let lot = [];
  let taille = 0;
  let debut = true;
  const envoyer = async (fin) => {
    await appel("vault/lot", { head, debut, fin, fichiers: lot, supprimes: fin ? [...supprimes] : [] }, 120_000);
    debut = false;
    lot = [];
    taille = 0;
  };
  for (const fichier of envoyables) {
    const octets = Buffer.byteLength(fichier.contenu, "utf8");
    if (taille + octets > LOT_MAX && lot.length) await envoyer(false);
    lot.push(fichier);
    taille += octets;
  }
  await envoyer(true);
  journal(`vault envoyé : ${envoyables.length} note(s) changée(s), ${supprimes.size} retirée(s), HEAD ${head.slice(0, 7)}`);
}

// ---------- les travaux ----------

async function ollama(travail) {
  const corps = {
    model: MODELE,
    messages: travail.messages,
    format: travail.format,
    stream: false,
    // qwen3 pense à voix haute par défaut : ici on veut le JSON, pas le raisonnement.
    think: false,
    options: { temperature: 0.2, num_ctx: 8192 },
  };
  let reponse = await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: JSON.stringify(corps), signal: AbortSignal.timeout(120_000) });
  if (reponse.status === 400 && /think/i.test(await reponse.clone().text())) {
    // Un modèle sans mode « réflexion » refuse l'option au lieu de l'ignorer.
    delete corps.think;
    reponse = await fetch(`${OLLAMA}/api/chat`, { method: "POST", body: JSON.stringify(corps), signal: AbortSignal.timeout(120_000) });
  }
  if (!reponse.ok) throw new Error(`Ollama : HTTP ${reponse.status} ${(await reponse.text()).slice(0, 200)}`);
  const donnees = await reponse.json();
  const texte = donnees && donnees.message ? donnees.message.content : "";
  try {
    return JSON.parse(texte);
  } catch {
    throw new Error(`Ollama a rendu autre chose que du JSON : ${String(texte).slice(0, 120)}`);
  }
}

// L'entrée est remplacée si le fichier la porte déjà (une note ajoutée après coup), ajoutée
// en fin de fichier sinon. Seul ce fichier est commité, même si d'autres attendent.
function noteValide(note) {
  const dossier = String(note?.dossier || "");
  const jour = String(note?.jour || "");
  const marqueur = String(note?.marqueur || "");
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(dossier) || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  const empreinte = String(note.empreinte || "");
  const chemin = `_context/projects/business-pipelines/decisions/${jour.slice(0, 7)}.md`;
  const marqueurAttendu = `dossier:${dossier}:${empreinte.slice(0, 16)}`;
  if (!/^[0-9a-f]{16,}$/i.test(empreinte) || note.chemin !== chemin || marqueur !== marqueurAttendu) return null;
  if (typeof note.entree !== "string" || note.entree.length > 12_000) return null;
  const debut = `<!-- ${marqueur} -->`;
  const fin = `<!-- /${marqueur} -->`;
  if (!note.entree.startsWith(`${debut}\n`) || !note.entree.endsWith(fin) || !note.entree.includes(`dossier ${dossier} tranché`)) return null;
  return { chemin, jour, dossier, marqueur, entree: note.entree, titre: String(note.titre || "Décisions des pipelines").slice(0, 160) };
}

function horsDe(racine, cible) {
  const relatif = path.relative(racine, cible);
  return relatif === ".." || relatif.startsWith(`..${path.sep}`) || path.isAbsolute(relatif);
}

function cheminDansVault(chemin) {
  const racine = fs.realpathSync(VAULT);
  const absolu = path.resolve(racine, chemin);
  if (horsDe(racine, absolu)) throw new Error(`chemin de note refusé : ${chemin}`);
  // Un dossier du vault peut être un lien symbolique : on résout l'ancêtre existant avant de
  // créer quoi que ce soit, sinon mkdir fabriquerait des répertoires hors du vault.
  let existant = path.dirname(absolu);
  while (!fs.existsSync(existant)) existant = path.dirname(existant);
  if (horsDe(racine, fs.realpathSync(existant))) throw new Error(`parent de note hors vault : ${chemin}`);
  fs.mkdirSync(path.dirname(absolu), { recursive: true });
  if (horsDe(racine, fs.realpathSync(path.dirname(absolu)))) {
    throw new Error(`parent de note hors vault : ${chemin}`);
  }
  if (fs.existsSync(absolu) && fs.lstatSync(absolu).isSymbolicLink()) throw new Error(`lien symbolique refusé : ${chemin}`);
  return absolu;
}

async function ecrireNote(brute) {
  const note = noteValide(brute);
  if (!note) throw new Error("note du NAS refusée : forme ou destination invalide");
  const absolu = cheminDansVault(note.chemin);
  const actuel = fs.existsSync(absolu) ? fs.readFileSync(absolu, "utf8") : null;
  const sale = (await git(["status", "--porcelain=v1", "--", note.chemin])).trim() !== "";
  // Un fichier modifié n'est accepté que s'il porte exactement notre écriture d'un essai
  // interrompu (crash entre l'écriture et le commit) : on reprend alors le commit.
  const commite = sale ? await git(["show", `HEAD:./${note.chemin}`]).catch(() => null) : actuel;
  const apres = avecEntree(commite ?? `# ${note.titre}\n`, note);
  if (sale && actuel !== apres) {
    throw new Error(`note non écrite : ${note.chemin} contient déjà une modification humaine`);
  }
  // Déjà commitée par un essai dont le résultat n'a pas atteint le NAS.
  if (!sale && actuel === apres) return (await git(["log", "-1", "--format=%H", "--", note.chemin])).trim();
  if (!sale) remplacer(absolu, apres);
  try {
    await git(["add", "--", note.chemin]);
    await git(["commit", "-m", `chore(vault): decision business-pipelines/${note.dossier}`, "--", note.chemin]);
  } catch (err) {
    // Sans ce retour arrière, le fichier resterait modifié et chaque essai suivant le
    // prendrait pour une modification humaine.
    await git(["reset", "-q", "--", note.chemin]).catch(() => undefined);
    if (commite === null) fs.rmSync(absolu, { force: true });
    else remplacer(absolu, commite);
    throw err;
  }
  return (await git(["rev-parse", "HEAD"])).trim();
}

function avecEntree(avant, note) {
  const echappe = note.marqueur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bloc = new RegExp(`<!-- ${echappe} -->[\\s\\S]*?<!-- /${echappe} -->`);
  return bloc.test(avant) ? avant.replace(bloc, () => note.entree) : `${avant.replace(/\n*$/, "\n")}\n${note.entree}\n`;
}

function remplacer(absolu, contenu) {
  const temporaire = path.join(path.dirname(absolu), `.${path.basename(absolu)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temporaire, contenu, { mode: 0o600 });
    fs.renameSync(temporaire, absolu);
  } finally {
    fs.rmSync(temporaire, { force: true });
  }
}

async function traiter(travail) {
  try {
    if (travail.perime) return await appel("resultat", { id: travail.id, bail: travail.bail, erreur: "dossier tranché ou replanifié" });
    if (travail.genre === "note") {
      const commit = await ecrireNote(travail.note);
      await synchroniser();
      journal(`note du vault commitée et synchronisée : ${travail.note.chemin} (${commit.slice(0, 7)})`);
      return await appel("resultat", { id: travail.id, bail: travail.bail, commit });
    }
    const debut = Date.now();
    const sortie = await ollama(travail);
    journal(`${travail.genre} ${travail.id} calculé en ${Math.round((Date.now() - debut) / 1000)} s`);
    return await appel("resultat", { ...sortie, id: travail.id, bail: travail.bail, modele: MODELE });
  } catch (err) {
    journal(`travail ${travail.id} en échec : ${err.message}`);
    return appel("resultat", { id: travail.id, bail: travail.bail, erreur: err.message }).catch(() => undefined);
  }
}

// ---------- la boucle ----------

let derniereSynchro = 0;

// Un appel Ollama ou une première synchronisation du vault peut durer plus qu'un battement.
// Le NAS sait alors que l'agent calcule encore, sans ouvrir de port sur le PC.
async function avecBattement(travail) {
  const battre = () =>
    appel("battement", { modele: MODELE, version: VERSION }).catch((err) => {
      journal(`battement en échec : ${err.message}`);
    });
  const minuterie = setInterval(battre, PERIODE_MS);
  try {
    return await travail();
  } finally {
    clearInterval(minuterie);
  }
}

async function tour() {
  const b = await appel("battement", { modele: MODELE, version: VERSION });
  if (Date.now() - derniereSynchro > SYNCHRO_MS || !b.vault.head) {
    await avecBattement(synchroniser);
    derniereSynchro = Date.now();
  }
  for (let i = 0; i < TRAVAUX_PAR_TOUR; i += 1) {
    const travail = await appel("travail");
    if (!travail) break;
    await avecBattement(() => traiter(travail));
    await appel("battement", { modele: MODELE, version: VERSION });
  }
}

function verifierConfiguration() {
  if (!JETON) return "CONSEILLER_JETON manquant dans .env";
  if (!COCKPIT || !/^https:\/\//.test(COCKPIT)) return "CONSEILLER_COCKPIT_URL HTTPS manquant ou invalide dans .env";
  if (!VAULT || !fs.existsSync(VAULT)) return "CONSEILLER_VAULT manquant ou introuvable dans .env";
  if (!fs.existsSync(path.join(VAULT, ".git"))) return "CONSEILLER_VAULT doit désigner un dépôt Git";
  return null;
}

async function main() {
  const erreur = verifierConfiguration();
  if (erreur) {
    console.error(`conseiller PC arrêté : ${erreur}`);
    process.exit(1);
  }
  journal(`conseiller PC : ${COCKPIT}, modèle ${MODELE}, vault ${VAULT}`);
  for (;;) {
    try {
      await tour();
    } catch (err) {
      journal(`tour en échec : ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, PERIODE_MS));
  }
}

if (require.main === module) main();

module.exports = { lireEnv, noteValide, verifierConfiguration };
