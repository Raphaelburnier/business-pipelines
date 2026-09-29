// Le livreur : met en production la version du cockpit que Raphaël a validée dans le
// cockpit (docs/SPEC-livraison.md).
//
// Il est le seul à tenir le pouvoir de déployer, c'est-à-dire le socket Docker, et donc root
// sur le NAS. En échange, il n'écoute rien : aucun port, aucune entrée réseau. Il lit la file
// de commandes de l'event store, ne construit que des commits présents dans les miroirs du
// NAS et fusionnés sur leur branche par défaut, puis exécute le même deploy.sh que
// bin/livrer.sh. Il n'y a qu'une logique de bascule, et elle voyage avec la version livrée.
//
// Ce module ne touche ni Docker ni l'event store : il est testé sur de vrais dépôts git dans
// un dossier temporaire. bin/livreur.js fait la boucle et les effets.
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const KIND = "livraison.start";
const DEPOTS = /** @type {const} */ (["cockpit", "moteur", "registre"]);
const SHA = /^[0-9a-f]{40}$/;
// Où chaque dépôt se pose dans l'archive, comme bin/livrer.sh.
const EMPLACEMENTS = { cockpit: ".", moteur: ".moteur", registre: "agent-registry" };

class Refus extends Error {}

/** Un git local, sans jeton. `safe.directory=*` : les miroirs appartiennent à un autre compte. */
function gitLocal() {
  /** @param {string[]} args */
  return (args, { entree } = {}) =>
    execFileSync("git", ["-c", "safe.directory=*", ...args], {
      input: entree,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
}

const texte = (tampon) => tampon.toString("utf-8").trim();

/** Le fichier `.release` posé par chaque livraison : cockpit=, moteur=, registre=, construite=. */
function lireRelease(fichier) {
  let brut;
  try {
    brut = fs.readFileSync(fichier, "utf-8");
  } catch {
    return null;
  }
  const valeurs = {};
  for (const ligne of brut.split("\n")) {
    const i = ligne.indexOf("=");
    if (i > 0) valeurs[ligne.slice(0, i).trim()] = ligne.slice(i + 1).trim();
  }
  return valeurs;
}

/** Les logins tailnet autorisés à livrer. Fichier absent ou illisible : personne. */
function lireAutorises(fichier) {
  try {
    const lu = JSON.parse(fs.readFileSync(fichier, "utf-8"));
    return new Set((Array.isArray(lu.autorises) ? lu.autorises : []).map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Un SHA complet pour une référence du dépôt, ou null s'il n'y est pas. */
function resoudre(git, depot, ref) {
  try {
    return texte(git(["--git-dir", depot, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`]));
  } catch {
    return null;
  }
}

/** Les commits de `avant` (exclu) à `apres`, sans les merges, les plus récents d'abord. */
function commitsEntre(git, depot, avant, apres, limite = 50) {
  const brut = texte(
    git(["--git-dir", depot, "log", "--no-merges", `-${limite}`, "--format=%H%x1f%s%x1f%an%x1f%cI", `${avant}..${apres}`])
  );
  if (!brut) return [];
  return brut.split("\n").map((ligne) => {
    const [sha, titre, auteur, date] = ligne.split("\x1f");
    return { sha, titre, auteur, date };
  });
}

/**
 * Ce qui tourne, ce qui peut partir, et les commits entre les deux. `disponible` vaut null
 * quand la production est à jour. Le cockpit affiche ce résultat, il ne le calcule jamais :
 * il n'a pas accès aux miroirs.
 * @param {{ git: Function, miroirs: Record<string, string>, release: Record<string, string>|null, maintenant?: Date }} entree
 */
function proposition({ git, miroirs, release, maintenant = new Date() }) {
  const enProduction = {};
  const tetes = {};
  const commits = {};
  for (const d of DEPOTS) {
    const tete = resoudre(git, miroirs[d], "HEAD");
    if (!tete) throw new Error(`miroir ${d} vide ou absent : ${miroirs[d]}`);
    // .release peut porter une forme courte (livraisons de bin/livrer.sh d'avant) : le miroir
    // la complète quand il la connaît.
    const prod = release && release[d] ? resoudre(git, miroirs[d], release[d]) : null;
    enProduction[d] = prod || (release && release[d]) || null;
    tetes[d] = tete;
    commits[d] = prod ? commitsEntre(git, miroirs[d], prod, tete) : [];
  }
  const aJour = DEPOTS.every((d) => enProduction[d] === tetes[d]);
  return { enProduction, disponible: aJour ? null : tetes, commits, calculeeLe: maintenant.toISOString() };
}

/**
 * Tout ce qui doit être vrai avant de préparer quoi que ce soit. Le cockpit a déjà contrôlé
 * l'identité : le livreur recontrôle, parce que c'est lui qui tient le pouvoir.
 */
function verifierDemande({ git, miroirs, payload, par, canal, autorises }) {
  if (canal !== "tailnet") {
    throw new Refus(`identité non prouvée (canal « ${canal || "inconnu"} ») : une livraison exige le tailnet`);
  }
  if (!autorises.has(String(par || ""))) throw new Refus(`« ${par} » n'est pas autorisé à livrer (specs/livraison.json)`);
  for (const d of DEPOTS) {
    const sha = payload && payload[d];
    if (!SHA.test(String(sha || ""))) throw new Refus(`${d} : SHA complet attendu`);
    if (resoudre(git, miroirs[d], sha) !== sha) throw new Refus(`${d} : ${sha.slice(0, 7)} absent du miroir du NAS`);
    try {
      git(["--git-dir", miroirs[d], "merge-base", "--is-ancestor", sha, "HEAD"]);
    } catch {
      throw new Refus(`${d} : ${sha.slice(0, 7)} n'est pas sur la branche par défaut`);
    }
  }
}

const horodatage = (date) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
};

/**
 * Construit la release comme bin/livrer.sh : export exact des trois SHA, `.release`, archive
 * et empreinte, deploy.sh tiré du modèle DE LA VERSION LIVRÉE. Rien n'est lu d'un dossier de
 * travail.
 * @returns {{ release: string, dossier: string, archive: string, empreinte: string, deploy: string }}
 */
function preparerRelease({ git, miroirs, payload, releasesDir, par = null, maintenant = new Date() }) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), "livraison-"));
  try {
    const stage = path.join(travail, "business-pipelines");
    for (const d of DEPOTS) {
      const cible = path.join(stage, EMPLACEMENTS[d]);
      fs.mkdirSync(cible, { recursive: true });
      const tar = git(["--git-dir", miroirs[d], "archive", payload[d]]);
      execFileSync("tar", ["-x", "-C", cible], { input: tar, maxBuffer: 512 * 1024 * 1024 });
    }
    const construite = maintenant.toISOString();
    fs.writeFileSync(
      path.join(stage, ".release"),
      [...DEPOTS.map((d) => `${d}=${payload[d]}`), `construite=${construite}`, ...(par ? [`par=${par}`] : []), ""].join("\n")
    );

    const release = `cockpit-${horodatage(maintenant)}`;
    const nomArchive = `business-cockpit-${DEPOTS.map((d) => payload[d].slice(0, 7)).join("-")}.tar.gz`;
    const dossier = path.join(releasesDir, release);
    fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const archive = path.join(dossier, nomArchive);
    // GNU tar : les propriétaires numériques gardent l'archive identique à celle de bin/livrer.sh.
    execFileSync("tar", ["-czf", archive, "--owner=1000", "--group=1000", "--numeric-owner", "-C", stage, "."]);
    const empreinte = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");

    const modele = texte(git(["--git-dir", miroirs.cockpit, "show", `${payload.cockpit}:deploy/nas/deploy.sh.modele`]));
    const version = DEPOTS.map((d) => `${d} ${payload[d].slice(0, 7)}`).join(" · ");
    const script = `${modele
      .replaceAll("@RELEASE@", release)
      .replaceAll("@ARCHIVE@", nomArchive)
      .replaceAll("@SHA256@", empreinte)
      .replaceAll("@VERSION@", version)}\n`;
    if (/@[A-Z0-9]+@/.test(script)) throw new Error("deploy.sh contient encore un champ non rempli");
    const deploy = path.join(dossier, "deploy.sh");
    fs.writeFileSync(deploy, script, { mode: 0o700 });
    return { release, dossier, archive, empreinte, deploy };
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
}

/**
 * L'étape que révèle une ligne de deploy.sh, ou null. Les repères sont les messages que le
 * script imprime déjà : les changer là-bas demande de les changer ici.
 * @param {string} ligne
 * @param {string} courante
 */
function etapeDeLigne(ligne, courante) {
  if (/^Construction des images/.test(ligne)) return "construire";
  if (/^Bascule/.test(ligne)) return "basculer";
  if (/restauration/i.test(ligne)) return "restaurer";
  // sha256sum -c valide l'archive, puis le script sauvegarde l'installation en place.
  if (courante === "preparer" && /: OK$/.test(ligne)) return "sauvegarder";
  if (courante === "basculer" && /\b(Started|Running|Healthy)\b/.test(ligne)) return "sante";
  return null;
}

/**
 * Garde les `garder` entrées les plus récentes d'un dossier parmi celles que `retenir`
 * désigne, et supprime les autres. Rien d'autre n'est touché.
 * @returns {string[]} les noms supprimés
 */
function retention({ dossier, retenir, garder = 5 }) {
  let noms;
  try {
    noms = fs.readdirSync(dossier).filter(retenir);
  } catch {
    return [];
  }
  const tries = noms
    .map((nom) => ({ nom, t: fs.statSync(path.join(dossier, nom)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const supprimes = tries.slice(garder).map((x) => x.nom);
  for (const nom of supprimes) fs.rmSync(path.join(dossier, nom), { recursive: true, force: true });
  return supprimes;
}

function ecrireJson(fichier, valeur) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(temporaire, `${JSON.stringify(valeur, null, 2)}\n`);
  fs.renameSync(temporaire, fichier);
}

module.exports = {
  KIND,
  DEPOTS,
  Refus,
  gitLocal,
  lireRelease,
  lireAutorises,
  proposition,
  verifierDemande,
  preparerRelease,
  etapeDeLigne,
  retention,
  ecrireJson,
};
