const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { lireJson, ecrireJson } = require("../durable");

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ETATS_TERMINAUX = new Set(["completed", "failed", "cancelled"]);

class RequeteInvalide extends Error {}
class Introuvable extends Error {}
class ArchiveIndisponible extends Error {}

function slug(valeur) {
  return String(valeur || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function idValide(valeur, nom = "identifiant") {
  const id = String(valeur || "");
  if (!ID.test(id)) throw new RequeteInvalide(`${nom} invalide : lettres minuscules, chiffres et tirets uniquement`);
  return id;
}

function sous(racine, ...morceaux) {
  const base = path.resolve(racine);
  const cible = path.resolve(base, ...morceaux);
  if (cible !== base && !cible.startsWith(`${base}${path.sep}`)) {
    throw new RequeteInvalide("chemin refusé : sortie de la racine de stockage");
  }
  return cible;
}

function isoMaintenant() {
  return new Date().toISOString();
}

function generationId(date = new Date()) {
  const horodatage = date.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return `gen_${horodatage}_${crypto.randomBytes(3).toString("hex")}`;
}

class AIStudioStore {
  constructor(racine, archiveRoot = path.join(racine, "archive")) {
    if (!racine) throw new Error("AI_STUDIO_STORAGE_ROOT est requis");
    this.racine = path.resolve(racine);
    this.archiveRoot = path.resolve(archiveRoot);
    if (this.archiveRoot === this.racine) throw new Error("l'archive AI Studio doit être distincte des données de travail");
    this.profilsDir = sous(this.racine, "profiles");
    this.workflowsDir = sous(this.racine, "workflows");
    this.tempDir = sous(this.racine, "temp");
    fs.mkdirSync(this.profilsDir, { recursive: true });
    fs.mkdirSync(this.workflowsDir, { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });
    this.db = new DatabaseSync(sous(this.racine, "index.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ai_profiles (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
        checkpoint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_generations (
        id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, status TEXT NOT NULL,
        prompt_id TEXT, workflow_id TEXT NOT NULL, seed INTEGER NOT NULL,
        image_path TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        metadata_path TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_generations_profile_date
        ON ai_generations(profile_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS ai_generations_status
        ON ai_generations(status, created_at ASC);
    `);
    this.reindexer();
  }

  fermer() {
    this.db.close();
  }

  cheminProfil(id) {
    return sous(this.profilsDir, idValide(id, "profil"));
  }

  profil(id) {
    const profil = lireJson(sous(this.cheminProfil(id), "profile.json"));
    if (!profil) throw new Introuvable(`profil « ${id} » introuvable`);
    return { ...profil, references: this.references(id) };
  }

  profils() {
    const lignes = this.db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM ai_generations g WHERE g.profile_id = p.id AND g.status = 'completed') AS generation_count
      FROM ai_profiles p ORDER BY p.updated_at DESC, p.name COLLATE NOCASE
    `).all();
    return lignes.map((ligne) => {
      const profil = this.profil(ligne.id);
      return { ...profil, generation_count: Number(ligne.generation_count || 0) };
    });
  }

  creerProfil(demande) {
    const nom = String(demande.name || "").trim();
    if (!nom || nom.length > 80) throw new RequeteInvalide("le nom du personnage est requis (80 caractères maximum)");
    const id = idValide(demande.id ? slug(demande.id) : slug(nom), "profil");
    const dossier = this.cheminProfil(id);
    if (fs.existsSync(path.join(dossier, "profile.json"))) throw new RequeteInvalide(`le profil « ${id} » existe déjà`);
    const maintenant = isoMaintenant();
    const resolution = demande.default_resolution || {};
    const profil = {
      id,
      name: nom,
      project_id: idValide(slug(demande.project_id || id), "projet"),
      description: String(demande.description || "").trim().slice(0, 1000),
      identity_prompt: String(demande.identity_prompt || "").trim().slice(0, 4000),
      negative_prompt: String(demande.negative_prompt || "").trim().slice(0, 4000),
      checkpoint: String(demande.checkpoint || "").trim().slice(0, 255),
      identity_method: "none",
      identity_strength: 0,
      loras: [],
      ipadapter: null,
      face_identity: null,
      preferred_presets: [],
      preferred_ratio: String(demande.preferred_ratio || "4:5"),
      default_resolution: {
        width: entierBorne(resolution.width, 832, 256, 4096, "largeur"),
        height: entierBorne(resolution.height, 1040, 256, 4096, "hauteur"),
      },
      created_at: maintenant,
      updated_at: maintenant,
    };
    fs.mkdirSync(sous(dossier, "references"), { recursive: true });
    fs.mkdirSync(sous(dossier, "generations"), { recursive: true });
    fs.mkdirSync(sous(dossier, "presets"), { recursive: true });
    fs.mkdirSync(sous(dossier, "favorites"), { recursive: true });
    ecrireJson(sous(dossier, "profile.json"), profil);
    this.indexerProfil(profil);
    return { ...profil, references: [] };
  }

  modifierProfil(id, changements) {
    const courant = this.profil(id);
    const permis = ["name", "description", "identity_prompt", "negative_prompt", "checkpoint", "preferred_ratio"];
    const prochain = { ...courant };
    delete prochain.references;
    for (const cle of permis) {
      if (changements[cle] !== undefined) prochain[cle] = String(changements[cle]).trim();
    }
    if (changements.project_id !== undefined) prochain.project_id = idValide(slug(changements.project_id), "projet");
    if (!prochain.name || prochain.name.length > 80) throw new RequeteInvalide("le nom du personnage est requis (80 caractères maximum)");
    if (changements.default_resolution) {
      prochain.default_resolution = {
        width: entierBorne(changements.default_resolution.width, courant.default_resolution.width, 256, 4096, "largeur"),
        height: entierBorne(changements.default_resolution.height, courant.default_resolution.height, 256, 4096, "hauteur"),
      };
    }
    prochain.updated_at = isoMaintenant();
    ecrireJson(sous(this.cheminProfil(id), "profile.json"), prochain);
    this.indexerProfil(prochain);
    return this.profil(id);
  }

  references(profileId) {
    const dossier = sous(this.cheminProfil(profileId), "references");
    if (!fs.existsSync(dossier)) return [];
    return fs.readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.(png|jpe?g|webp)$/i.test(e.name))
      .map((e) => ({ name: e.name, url: `/api/ai-studio/profiles/${encodeURIComponent(profileId)}/references/${encodeURIComponent(e.name)}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  ajouterReference(profileId, { name, mime, buffer }) {
    this.profil(profileId);
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new RequeteInvalide("image de référence vide");
    if (buffer.length > 12 * 1024 * 1024) throw new RequeteInvalide("image de référence trop grande (12 Mio maximum)");
    const extension = extensionImage(mime, buffer);
    const base = slug(path.basename(String(name || "reference"), path.extname(String(name || "")))) || "reference";
    const fichier = `${base}-${crypto.randomBytes(3).toString("hex")}.${extension}`;
    ecrireBufferAtomique(sous(this.cheminProfil(profileId), "references", fichier), buffer, { exclusif: true });
    return { name: fichier, url: `/api/ai-studio/profiles/${encodeURIComponent(profileId)}/references/${encodeURIComponent(fichier)}` };
  }

  cheminReference(profileId, nom) {
    const propre = path.basename(String(nom || ""));
    if (propre !== nom || !/^[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(propre)) throw new RequeteInvalide("nom de référence invalide");
    const cible = sous(this.cheminProfil(profileId), "references", propre);
    if (!fs.existsSync(cible)) throw new Introuvable("référence introuvable");
    return cible;
  }

  creerGeneration({ id = generationId(), profileId, projectId, workflowId, request, settings, workflow, seed, parentId = null }) {
    this.profil(profileId);
    if (!/^gen_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(id)) throw new RequeteInvalide("generation_id invalide");
    const creee = isoMaintenant();
    const date = new Date(creee);
    const dossier = sous(
      this.cheminProfil(profileId),
      "generations",
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      id
    );
    if (fs.existsSync(dossier)) throw new RequeteInvalide(`la génération « ${id} » existe déjà`);
    fs.mkdirSync(dossier, { recursive: true });
    const relatifDossier = path.relative(this.racine, dossier);
    const metadata = {
      schema_version: 1,
      generation_id: id,
      profile_id: profileId,
      project_id: idValide(projectId || profileId, "projet"),
      parent_generation_id: parentId,
      status: "draft",
      progress: 0,
      prompt_id: null,
      workflow_id: workflowId,
      request,
      settings,
      seed,
      outputs: [],
      error: null,
      approved_at: null,
      archived_at: null,
      archive_error: null,
      created_at: creee,
      updated_at: creee,
      storage: {
        directory: relatifDossier,
        metadata: path.join(relatifDossier, "metadata.json"),
        workflow: path.join(relatifDossier, "workflow.json"),
        image: null,
      },
    };
    ecrireJson(path.join(dossier, "workflow.json"), workflow);
    ecrireJson(path.join(dossier, "metadata.json"), metadata);
    this.indexerGeneration(metadata);
    return metadata;
  }

  generation(id) {
    if (!/^gen_[0-9]{8}_[0-9]{6}_[a-f0-9]{6}$/.test(String(id || ""))) throw new RequeteInvalide("generation_id invalide");
    const ligne = this.db.prepare("SELECT metadata_path FROM ai_generations WHERE id = ?").get(id);
    if (!ligne) throw new Introuvable(`génération « ${id} » introuvable`);
    const metadata = lireJson(sous(this.racine, ligne.metadata_path));
    if (!metadata) throw new Introuvable(`métadonnées absentes pour « ${id} »`);
    return metadata;
  }

  generations({ profileId = null, status = null, limit = 100 } = {}) {
    const conditions = [];
    const valeurs = [];
    if (profileId) {
      conditions.push("profile_id = ?");
      valeurs.push(idValide(profileId, "profil"));
    }
    if (status) {
      conditions.push("status = ?");
      valeurs.push(String(status));
    }
    const borne = Math.max(1, Math.min(Number(limit) || 100, 500));
    const sql = `SELECT metadata_path FROM ai_generations ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
    valeurs.push(borne);
    return this.db.prepare(sql).all(...valeurs).map((ligne) => lireJson(sous(this.racine, ligne.metadata_path))).filter(Boolean);
  }

  nonTerminales() {
    return this.db.prepare("SELECT metadata_path FROM ai_generations WHERE status NOT IN ('completed', 'failed', 'cancelled') ORDER BY created_at ASC")
      .all()
      .map((ligne) => lireJson(sous(this.racine, ligne.metadata_path)))
      .filter(Boolean);
  }

  archivagesEnAttente() {
    return this.db.prepare("SELECT metadata_path FROM ai_generations WHERE status = 'completed' ORDER BY created_at ASC")
      .all()
      .map((ligne) => lireJson(sous(this.racine, ligne.metadata_path)))
      .filter((g) => g?.approved_at && !g.archived_at);
  }

  majGeneration(id, changements) {
    const courant = this.generation(id);
    const metadata = {
      ...courant,
      ...changements,
      storage: { ...courant.storage, ...(changements.storage || {}) },
      updated_at: isoMaintenant(),
    };
    ecrireJson(sous(this.racine, metadata.storage.metadata), metadata);
    this.indexerGeneration(metadata);
    return metadata;
  }

  sauverImage(id, buffer, { extension = "png", source = null } = {}) {
    const generation = this.generation(id);
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("ComfyUI a rendu une image vide");
    const ext = ["png", "jpg", "jpeg", "webp"].includes(extension) ? extension : "png";
    const cheminRelatif = path.join(generation.storage.directory, `image.${ext}`);
    ecrireBufferAtomique(sous(this.racine, cheminRelatif), buffer);
    return this.majGeneration(id, {
      storage: { image: cheminRelatif },
      outputs: source ? [source] : generation.outputs,
    });
  }

  approuverGeneration(id) {
    const generation = this.generation(id);
    if (generation.status !== "completed" || !generation.storage.image) {
      throw new RequeteInvalide("seule une image générée avec succès peut être validée");
    }
    if (generation.approved_at) return generation;
    return this.majGeneration(id, { approved_at: isoMaintenant(), archive_error: null });
  }

  archiverGeneration(id) {
    const generation = this.generation(id);
    if (generation.status !== "completed" || !generation.approved_at || !generation.storage.image) {
      throw new RequeteInvalide("l'archivage demande une image réussie et validée");
    }
    if (generation.archived_at) return generation;
    const date = new Date(generation.created_at);
    const relatifArchive = path.join(
      idValide(generation.project_id || generation.profile_id, "projet"),
      idValide(generation.profile_id, "profil"),
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      id
    );
    const dossierFinal = sous(this.archiveRoot, relatifArchive);
    const parent = path.dirname(dossierFinal);
    const metadataFinal = path.join(dossierFinal, "metadata.json");
    const maintenant = isoMaintenant();
    const archivee = {
      ...generation,
      archived_at: maintenant,
      archive_error: null,
      archive: {
        directory: relatifArchive,
        image: path.join(relatifArchive, path.basename(generation.storage.image)),
        workflow: path.join(relatifArchive, "workflow.json"),
        metadata: path.join(relatifArchive, "metadata.json"),
      },
      updated_at: maintenant,
    };

    try {
      fs.mkdirSync(parent, { recursive: true });
      if (fs.existsSync(dossierFinal)) {
        const dejaArchivee = lireJson(metadataFinal);
        if (!dejaArchivee || dejaArchivee.generation_id !== id || dejaArchivee.status !== "completed" || !dejaArchivee.approved_at ||
            !fs.existsSync(path.join(dossierFinal, "workflow.json")) ||
            !fs.existsSync(path.join(dossierFinal, path.basename(generation.storage.image)))) {
          throw new Error("archive existante incomplète : intervention nécessaire");
        }
        ecrireJson(sous(this.racine, generation.storage.metadata), dejaArchivee);
        this.indexerGeneration(dejaArchivee);
        return dejaArchivee;
      }

      const temporaire = sous(parent, `.${id}.${crypto.randomBytes(6).toString("hex")}.tmp`);
      fs.mkdirSync(temporaire);
      try {
        fs.copyFileSync(this.cheminImage(id), path.join(temporaire, path.basename(generation.storage.image)));
        fs.copyFileSync(this.cheminWorkflow(id), path.join(temporaire, "workflow.json"));
        ecrireJson(path.join(temporaire, "metadata.json"), archivee);
        fs.renameSync(temporaire, dossierFinal);
      } catch (err) {
        fs.rmSync(temporaire, { recursive: true, force: true });
        throw err;
      }
      ecrireJson(sous(this.racine, generation.storage.metadata), archivee);
      this.indexerGeneration(archivee);
      return archivee;
    } catch (err) {
      throw new ArchiveIndisponible(`archivage NAS impossible : ${err.message}`, { cause: err });
    }
  }

  cheminImage(id) {
    const generation = this.generation(id);
    if (!generation.storage.image) throw new Introuvable("image pas encore disponible");
    const cible = sous(this.racine, generation.storage.image);
    if (!fs.existsSync(cible)) throw new Introuvable("image absente du stockage");
    return cible;
  }

  cheminWorkflow(id) {
    const generation = this.generation(id);
    const cible = sous(this.racine, generation.storage.workflow);
    if (!fs.existsSync(cible)) throw new Introuvable("workflow absent du stockage");
    return cible;
  }

  indexerProfil(profil) {
    this.db.prepare(`
      INSERT INTO ai_profiles (id, name, description, checkpoint, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
        checkpoint=excluded.checkpoint, updated_at=excluded.updated_at
    `).run(profil.id, profil.name, profil.description || "", profil.checkpoint || "", profil.created_at, profil.updated_at);
  }

  indexerGeneration(g) {
    this.db.prepare(`
      INSERT INTO ai_generations
        (id, profile_id, status, prompt_id, workflow_id, seed, image_path, error, created_at, updated_at, metadata_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, prompt_id=excluded.prompt_id,
        image_path=excluded.image_path, error=excluded.error, updated_at=excluded.updated_at,
        metadata_path=excluded.metadata_path
    `).run(
      g.generation_id, g.profile_id, g.status, g.prompt_id || null, g.workflow_id,
      Number(g.seed), g.storage.image || null, g.error || null, g.created_at, g.updated_at,
      g.storage.metadata
    );
  }

  reindexer() {
    // L'index est un cache intégral, pas un second original. Le reconstruire évite de
    // conserver une génération effacée ou déplacée hors du Cockpit.
    this.db.exec("DELETE FROM ai_generations; DELETE FROM ai_profiles;");
    if (!fs.existsSync(this.profilsDir)) return;
    for (const entree of fs.readdirSync(this.profilsDir, { withFileTypes: true })) {
      if (!entree.isDirectory() || !ID.test(entree.name)) continue;
      const profil = lireJson(sous(this.profilsDir, entree.name, "profile.json"));
      if (!profil) continue;
      this.indexerProfil(profil);
      const generations = sous(this.profilsDir, entree.name, "generations");
      if (!fs.existsSync(generations)) continue;
      for (const metadataPath of trouverMetadata(generations)) {
        const metadata = lireJson(metadataPath);
        if (!metadata || !metadata.generation_id) continue;
        metadata.storage.metadata = path.relative(this.racine, metadataPath);
        this.indexerGeneration(metadata);
      }
    }
  }
}

function trouverMetadata(racine) {
  const trouves = [];
  const visiter = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const cible = path.join(dossier, entree.name);
      if (entree.isDirectory()) visiter(cible);
      else if (entree.isFile() && entree.name === "metadata.json") trouves.push(cible);
    }
  };
  visiter(racine);
  return trouves;
}

function entierBorne(valeur, defaut, min, max, nom) {
  const n = valeur === undefined || valeur === null || valeur === "" ? defaut : Number(valeur);
  if (!Number.isInteger(n) || n < min || n > max) throw new RequeteInvalide(`${nom} doit être un entier entre ${min} et ${max}`);
  return n;
}

function extensionImage(mime, buffer) {
  const signatures = [
    { ext: "png", mime: "image/png", ok: buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
    { ext: "jpg", mime: "image/jpeg", ok: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9 },
    { ext: "webp", mime: "image/webp", ok: buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP" },
  ];
  const trouve = signatures.find((s) => s.ok && (!mime || mime === s.mime));
  if (!trouve) throw new RequeteInvalide("format refusé : PNG, JPEG ou WebP attendu");
  return trouve.ext;
}

function ecrireBufferAtomique(chemin, buffer, { exclusif = false } = {}) {
  if (exclusif && fs.existsSync(chemin)) throw new RequeteInvalide(`le fichier « ${path.basename(chemin)} » existe déjà`);
  const temporaire = `${chemin}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporaire, buffer, { flag: "wx" });
    if (exclusif && fs.existsSync(chemin)) throw new RequeteInvalide(`le fichier « ${path.basename(chemin)} » existe déjà`);
    fs.renameSync(temporaire, chemin);
  } catch (err) {
    try { fs.unlinkSync(temporaire); } catch {}
    throw err;
  }
}

module.exports = {
  AIStudioStore,
  RequeteInvalide,
  Introuvable,
  ArchiveIndisponible,
  ETATS_TERMINAUX,
  slug,
  idValide,
  sous,
  generationId,
  extensionImage,
  ecrireBufferAtomique,
};
