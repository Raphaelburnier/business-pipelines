// Configuration d'autorité de l'opérateur, conservée dans specs/ et absente du runner.
// Une fusion GitHub ne crée jamais une approbation de modèle.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FIGES = ["deploy/nas", "docker-compose.yaml"];
const SHA = /^[0-9a-f]{40}$/;
const EMPREINTE = /^[0-9a-f]{64}$/;

function empreinte({ git, depot, sha }) {
  if (!SHA.test(String(sha || ""))) throw new Error("modèle : SHA complet attendu");
  const arbre = git(["--git-dir", depot, "ls-tree", "-r", "-z", "--full-tree", sha, "--", ...FIGES]);
  const brut = Buffer.isBuffer(arbre) ? arbre : Buffer.from(arbre);
  const entrees = brut.toString("utf8").split("\0").filter(Boolean).map((ligne) => {
    const m = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(ligne);
    if (!m) throw new Error("modèle : entrée protégée non régulière ou invalide");
    return { chemin: m[3], mode: m[1], blob: m[2] };
  });
  for (const requis of ["deploy/nas/deploy.sh.modele", "docker-compose.yaml"]) {
    if (!entrees.some(e => e.chemin === requis)) throw new Error(`modèle incomplet : ${requis} absent`);
  }
  return { empreinte: crypto.createHash("sha256").update("livraison-modele-v1\0").update(brut).digest("hex"), entrees };
}

function lire(fichier) {
  if (!fichier) return { version: 1, modeles: {}, revoques: [] };
  let texte;
  try { texte = fs.readFileSync(fichier, "utf8"); }
  catch (err) { if (err.code === "ENOENT") return { version: 1, modeles: {}, revoques: [] }; throw err; }
  const lu = JSON.parse(texte);
  if (lu?.version !== 1 || !lu.modeles || typeof lu.modeles !== "object" || Array.isArray(lu.modeles)) throw new Error("registre des modèles approuvés invalide");
  for (const [hash, a] of Object.entries(lu.modeles)) {
    if (!EMPREINTE.test(hash) || !a || !SHA.test(a.cockpit) || typeof a.par !== "string" || !a.par.trim() ||
      typeof a.approuveLe !== "string" || !Number.isFinite(Date.parse(a.approuveLe))) throw new Error("approbation de modèle invalide");
  }
  lu.revoques ??= [];
  if (!Array.isArray(lu.revoques) || lu.revoques.some(hash => !EMPREINTE.test(hash))) throw new Error("révocations de modèles invalides");
  return lu;
}

function ecrire(fichier, valeur) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaire, `${JSON.stringify(valeur, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporaire, fichier);
  } finally { try { fs.unlinkSync(temporaire); } catch {} }
}

function verifierFusion(git, depot, sha) {
  if (!SHA.test(String(sha || ""))) throw new Error("modèle : SHA complet attendu");
  git(["--git-dir", depot, "merge-base", "--is-ancestor", sha, "HEAD"]);
}

function modifier(fichier, mutation) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const verrou = `${fichier}.lock`;
  const fd = fs.openSync(verrou, "wx", 0o600);
  try {
    const registre = lire(fichier);
    const resultat = mutation(registre);
    ecrire(fichier, registre);
    return resultat;
  } finally { fs.closeSync(fd); fs.unlinkSync(verrou); }
}

function approuver({ git, depot, sha, fichier, par, maintenant = new Date() }) {
  if (typeof par !== "string" || !par.trim() || par.length > 200) throw new Error("auteur de l'approbation requis (200 caractères maximum)");
  verifierFusion(git, depot, sha);
  const modele = empreinte({ git, depot, sha });
  const approbation = { cockpit: sha, par: par.trim(), approuveLe: maintenant.toISOString() };
  modifier(fichier, registre => {
    registre.modeles[modele.empreinte] = approbation;
    registre.revoques = registre.revoques.filter(hash => hash !== modele.empreinte);
  });
  return { ...modele, approbation };
}

function revoquer({ fichier, hash }) {
  if (!EMPREINTE.test(String(hash || ""))) throw new Error("empreinte SHA-256 complète attendue");
  modifier(fichier, registre => {
    delete registre.modeles[hash];
    if (!registre.revoques.includes(hash)) registre.revoques.push(hash);
  });
}

function autorisation({ git, depot, sha, fichier }) {
  const modele = empreinte({ git, depot, sha });
  const approbation = lire(fichier).modeles[modele.empreinte];
  if (!approbation) return null;
  verifierFusion(git, depot, approbation.cockpit);
  if (empreinte({ git, depot, sha: approbation.cockpit }).empreinte !== modele.empreinte) throw new Error("approbation incohérente avec son commit source");
  return { ...modele, approbation };
}

module.exports = { FIGES, empreinte, lire, approuver, revoquer, autorisation };
