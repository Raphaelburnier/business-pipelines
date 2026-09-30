const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { RequeteInvalide } = require("./store");
const { lireJson, ecrireJson } = require("../durable");

// Le partage NAS est monté dans le Cockpit et déclaré comme dossier de modèles dans
// Comfy Desktop. ComfyUI lit donc les poids directement sur le NAS, sans synchroniseur.
const MAX_MODEL_BYTES = 32 * 1024 ** 3;
const MODEL_CATEGORIES = Object.freeze([
  "checkpoints", "loras", "vae", "controlnet", "diffusion_models",
  "text_encoders", "clip_vision", "upscale_models",
]);
const NOM_MODELE = /^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,199}\.safetensors$/i;

function categorieValide(categorie) {
  if (!MODEL_CATEGORIES.includes(categorie)) throw new RequeteInvalide("type de modèle non pris en charge");
  return categorie;
}

function nomValide(nom) {
  if (typeof nom !== "string" || !NOM_MODELE.test(nom) || nom.includes("..") || /[. ]\.safetensors$/i.test(nom) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(nom)) {
    throw new RequeteInvalide("nom de modèle invalide : fichier .safetensors sans chemin attendu");
  }
  return nom;
}

function verifierSafetensors(fichier, taille) {
  const fd = fs.openSync(fichier, "r");
  try {
    const prefixe = Buffer.alloc(8);
    if (fs.readSync(fd, prefixe, 0, 8, 0) !== 8) throw new RequeteInvalide("fichier safetensors incomplet");
    const longueur = prefixe.readBigUInt64LE();
    if (longueur < 2n || longueur > 16n * 1024n * 1024n || longueur + 8n >= BigInt(taille)) {
      throw new RequeteInvalide("en-tête safetensors invalide");
    }
    const entete = Buffer.alloc(Number(longueur));
    if (fs.readSync(fd, entete, 0, entete.length, 8) !== entete.length) throw new RequeteInvalide("en-tête safetensors incomplet");
    let json;
    try { json = JSON.parse(entete.toString("utf8")); }
    catch { throw new RequeteInvalide("en-tête safetensors illisible"); }
    const tenseurs = Object.entries(json || {}).filter(([nom]) => nom !== "__metadata__");
    if (!tenseurs.length || !tenseurs.every(([, t]) => t && typeof t.dtype === "string" && Array.isArray(t.shape) &&
      Array.isArray(t.data_offsets) && t.data_offsets.length === 2 &&
      Number.isSafeInteger(t.data_offsets[0]) && Number.isSafeInteger(t.data_offsets[1]) &&
      t.data_offsets[0] >= 0 && t.data_offsets[1] >= t.data_offsets[0] &&
      t.data_offsets[1] <= taille - 8 - entete.length) ||
      !tenseurs.some(([, t]) => t.data_offsets[1] > t.data_offsets[0])) {
      throw new RequeteInvalide("ce fichier ne contient pas de tenseurs safetensors valides");
    }
  } finally { fs.closeSync(fd); }
}

class ModelLibrary {
  constructor(modelsRoot) {
    this.root = path.resolve(modelsRoot);
    this.enCours = new Set();
    fs.mkdirSync(this.root, { recursive: true });
  }

  chemin(categorie, nom) {
    return path.join(this.root, categorieValide(categorie), nomValide(nom));
  }

  liste() {
    return MODEL_CATEGORIES.flatMap((categorie) => {
      const dossier = path.join(this.root, categorie);
      if (!fs.existsSync(dossier)) return [];
      if (!fs.lstatSync(dossier).isDirectory()) return [];
      return fs.readdirSync(dossier, { withFileTypes: true })
        .filter((e) => {
          if (!e.isFile()) return false;
          try { nomValide(e.name); return true; }
          catch { return false; }
        })
        .map((e) => {
          const nom = nomValide(e.name);
          const meta = lireJson(`${this.chemin(categorie, nom)}.json`);
          return { category: categorie, name: nom, size: fs.statSync(this.chemin(categorie, nom)).size, sha256: meta?.sha256 || null };
        });
    }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }

  async ajouter(categorie, nom, flux) {
    const type = categorieValide(categorie);
    const cible = this.chemin(type, nom);
    const dossier = path.dirname(cible);
    fs.mkdirSync(dossier, { recursive: true });
    if (!fs.lstatSync(dossier).isDirectory()) throw new RequeteInvalide("dossier de modèles invalide sur le NAS");
    const cle = `${type}/${nom.toLowerCase()}`;
    if (this.enCours.has(cle) || fs.readdirSync(dossier).some((existant) => existant.toLowerCase() === nom.toLowerCase())) {
      throw new RequeteInvalide("ce modèle existe déjà sur le NAS");
    }
    const tailleAnnoncee = Number(flux.headers?.["content-length"] || 0);
    if (tailleAnnoncee > MAX_MODEL_BYTES) throw new RequeteInvalide("modèle trop volumineux (32 Gio maximum)");
    const temporaire = path.join(dossier, `.upload-${crypto.randomUUID()}.part`);
    const empreinte = crypto.createHash("sha256");
    let taille = 0;
    const controle = new Transform({
      transform(morceau, _encodage, suivant) {
        taille += morceau.length;
        if (taille > MAX_MODEL_BYTES) return suivant(new RequeteInvalide("modèle trop volumineux (32 Gio maximum)"));
        empreinte.update(morceau);
        suivant(null, morceau);
      },
    });
    this.enCours.add(cle);
    try {
      await pipeline(flux, controle, fs.createWriteStream(temporaire, { flags: "wx", mode: 0o644 }));
      if (taille === 0) throw new RequeteInvalide("checkpoint vide");
      verifierSafetensors(temporaire, taille);
      // Le conteneur tourne comme root sur le NAS, mais Comfy Desktop ouvre le
      // partage SMB avec le compte Windows : le fichier doit rester lisible.
      fs.chmodSync(temporaire, 0o644);
      // link() échoue si un autre upload a créé la même cible entre-temps. Aucune
      // écriture partielle ni remplacement silencieux d'un modèle existant.
      fs.linkSync(temporaire, cible);
      const modele = { category: type, name: nom, size: taille, sha256: empreinte.digest("hex") };
      try { ecrireJson(`${cible}.json`, modele); }
      catch (err) { fs.unlinkSync(cible); throw err; }
      return modele;
    } catch (err) {
      if (err.code === "EEXIST") throw new RequeteInvalide("ce modèle existe déjà sur le NAS");
      throw err;
    } finally {
      this.enCours.delete(cle);
      try { fs.unlinkSync(temporaire); } catch {}
    }
  }
}

module.exports = { ModelLibrary, MAX_MODEL_BYTES, MODEL_CATEGORIES, categorieValide, nomValide, verifierSafetensors };
