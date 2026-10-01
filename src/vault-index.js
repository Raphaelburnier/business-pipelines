// L'index du vault Obsidian sur le NAS (SPEC §7.6) : une copie de la branche principale du
// vault, découpée par section et cherchable en FTS5, dans la base du conseiller.
//
// Le vault vit sur le PC. C'est l'agent du PC qui envoie les fichiers changés depuis la
// dernière synchro, par blob git : le NAS n'a ni clé SSH vers le PC ni dépôt à tenir, et
// il garde de quoi chercher quand le PC dort.
//
// Ces fonctions prennent une connexion ouverte (voir src/conseiller.js) : l'index n'est
// qu'une partie de la base du conseiller, pas un magasin à part.

// Ce que le conseiller a le droit de lire. `notes/` est le savoir technique, `wiki/` en est
// dérivé, `_context/projects/` et `_context/memory/` portent les décisions et l'état des
// projets. Le reste de `_context/` (profil, préférences) n'aide pas à juger un dossier.
const PERIMETRE = ["notes/", "wiki/", "_context/projects/", "_context/memory/"];

// Au-delà, un fichier est un export ou une pièce jointe, pas une note.
const TAILLE_MAX = 200_000;
const EXTRAIT_MAX = 800;
const FICHIERS_MAX = 2_000;
const SUPPRIMES_MAX = 10_000;
const LOT_OCTETS_MAX = 3_500_000;

const tailleOctets = (texte) => Buffer.byteLength(texte, "utf8");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vault_fichiers (
  chemin TEXT PRIMARY KEY,
  blob   TEXT NOT NULL,
  titre  TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS vault_sections USING fts5(
  chemin UNINDEXED,
  titre,
  mots,
  texte,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS vault_etat (
  cle    TEXT PRIMARY KEY,
  valeur TEXT
);
CREATE TABLE IF NOT EXISTS vault_staging_fichiers (
  snapshot TEXT NOT NULL,
  chemin   TEXT NOT NULL,
  blob     TEXT NOT NULL,
  titre    TEXT NOT NULL,
  PRIMARY KEY (snapshot, chemin)
);
CREATE TABLE IF NOT EXISTS vault_staging_supprimes (
  snapshot TEXT NOT NULL,
  chemin   TEXT NOT NULL,
  PRIMARY KEY (snapshot, chemin)
);
CREATE VIRTUAL TABLE IF NOT EXISTS vault_staging_sections USING fts5(
  snapshot UNINDEXED,
  chemin UNINDEXED,
  titre,
  mots,
  texte,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

function dansPerimetre(chemin) {
  const c = String(chemin || "");
  return c.endsWith(".md") && !c.includes("..") && PERIMETRE.some((p) => c.startsWith(p));
}

// Les blocs « Quand consulter cette note » et « Termes couverts » disent de quoi parle la
// note mieux que son texte. Ils sont indexés avec chaque section, et pèsent plus lourd à la
// recherche, pour qu'une section profonde reste trouvable par les termes de sa note.
function motsDeLaNote(contenu) {
  const blocs = [];
  const re = /^>?\s*\**(Quand consulter cette note|Termes couverts)\**\s*:?\s*\n((?:>.*\n?)+)/gim;
  for (const m of contenu.matchAll(re)) blocs.push(m[2].replace(/^>\s?/gm, " "));
  return blocs.join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
}

function titreDe(chemin, contenu) {
  const h1 = contenu.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return chemin.split("/").pop().replace(/\.md$/, "");
}

/**
 * Découpe une note par titre `##` : une section est l'unité qu'on cite, assez courte pour
 * tenir dans le contexte d'un petit modèle avec cinq autres.
 * @param {string} chemin
 * @param {string} contenu
 * @returns {{ titre: string, mots: string, sections: Array<{ titre: string, texte: string }> }}
 */
function decouper(chemin, contenu) {
  const sansEntete = contenu.replace(/^---\n[\s\S]*?\n---\n/, "");
  const titre = titreDe(chemin, sansEntete);
  const mots = motsDeLaNote(sansEntete);
  const sections = [];
  let courant = { titre, texte: [] };
  for (const ligne of sansEntete.split("\n")) {
    const h2 = ligne.match(/^##\s+(.+)$/);
    if (h2) {
      sections.push(courant);
      courant = { titre: `${titre} › ${h2[1].trim()}`, texte: [] };
    } else {
      courant.texte.push(ligne);
    }
  }
  sections.push(courant);
  return {
    titre,
    mots,
    sections: sections.map((s) => ({ titre: s.titre, texte: s.texte.join("\n").trim() })).filter((s) => s.texte.length > 0),
  };
}

function preparer(db) {
  db.exec(SCHEMA);
}

/** Ce que le NAS a déjà : chemin vers blob, et le commit de la dernière synchro complète. */
function inventaire(db) {
  preparer(db);
  const blobs = Object.fromEntries(db.prepare("SELECT chemin, blob FROM vault_fichiers").all().map((l) => [l.chemin, l.blob]));
  const head = db.prepare("SELECT valeur FROM vault_etat WHERE cle = 'head'").get();
  const le = db.prepare("SELECT valeur FROM vault_etat WHERE cle = 'synchro_le'").get();
  return { head: head ? head.valeur : null, synchroLe: le ? le.valeur : null, fichiers: Object.keys(blobs).length, blobs };
}

/**
 * Applique un lot envoyé par le PC. Le commit n'est retenu qu'au dernier lot : une synchro
 * coupée au milieu sera reprise entière au prochain passage, les blobs déjà reçus en moins.
 * @param {any} db
 * @param {{ head: string, fichiers?: Array<{ chemin: string, blob: string, contenu: string }>, supprimes?: string[], fin?: boolean }} lot
 * @param {number} [maintenant]
 */
function appliquer(db, lot, maintenant = Date.now()) {
  preparer(db);
  const head = String(lot?.head || "");
  const fichiers = Array.isArray(lot?.fichiers) ? lot.fichiers : [];
  const supprimes = Array.isArray(lot?.supprimes) ? lot.supprimes : [];
  const debut = lot?.debut === true;
  const fin = lot?.fin === true;
  if (!/^[0-9a-f]{40,64}$/.test(head)) throw new Error("snapshot vault invalide");
  if (typeof lot?.debut !== "boolean" || typeof lot?.fin !== "boolean") throw new Error("bornes du snapshot vault absentes");
  if (fichiers.length > FICHIERS_MAX || supprimes.length > SUPPRIMES_MAX) throw new Error("lot vault trop grand");
  if (fichiers.some((f) => !f || typeof f !== "object" || Array.isArray(f))) throw new Error("fichier vault invalide");

  const chemins = new Set();
  for (const f of fichiers) {
    const chemin = String(f.chemin || "");
    if (chemins.has(chemin)) throw new Error("fichier vault dupliqué dans le lot");
    chemins.add(chemin);
  }
  for (const brut of supprimes) {
    const chemin = String(brut || "");
    if (chemins.has(chemin)) throw new Error("fichier vault à la fois ajouté et supprimé");
    chemins.add(chemin);
  }
  const octets = fichiers.reduce((total, f) => total + (typeof f.contenu === "string" ? tailleOctets(f.contenu) : 0), 0);
  if (octets > LOT_OCTETS_MAX) throw new Error("lot vault dépasse la limite en octets");

  const refuses = [];
  let indexes = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const poserEtat = db.prepare("INSERT INTO vault_etat (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur");
    const snapshot = db.prepare("SELECT valeur FROM vault_etat WHERE cle = 'staging_head'").get()?.valeur || null;
    if (debut) {
      // Le PC n'envoie que les différences. On part donc de l'index publié avant de lui appliquer
      // le diff, sans rendre le staging visible tant que le dernier lot n'est pas arrivé.
      db.exec("DELETE FROM vault_staging_sections; DELETE FROM vault_staging_fichiers; DELETE FROM vault_staging_supprimes;");
      db.prepare("INSERT INTO vault_staging_fichiers (snapshot, chemin, blob, titre) SELECT ?, chemin, blob, titre FROM vault_fichiers").run(head);
      db.prepare("INSERT INTO vault_staging_sections (snapshot, chemin, titre, mots, texte) SELECT ?, chemin, titre, mots, texte FROM vault_sections").run(head);
      poserEtat.run("staging_head", head);
    } else if (snapshot !== head) {
      throw new Error("lot reçu pour un snapshot vault absent ou différent");
    }

    const effacerStaging = (chemin) => {
      db.prepare("DELETE FROM vault_staging_sections WHERE snapshot = ? AND chemin = ?").run(head, chemin);
      db.prepare("DELETE FROM vault_staging_fichiers WHERE snapshot = ? AND chemin = ?").run(head, chemin);
    };
    const marquerSupprime = (chemin) => {
      effacerStaging(chemin);
      db.prepare("INSERT OR IGNORE INTO vault_staging_supprimes (snapshot, chemin) VALUES (?, ?)").run(head, chemin);
    };
    for (const brut of supprimes) {
      const chemin = String(brut || "");
      if (dansPerimetre(chemin)) marquerSupprime(chemin);
      else refuses.push(chemin);
    }

    const insererFichier = db.prepare("INSERT INTO vault_staging_fichiers (snapshot, chemin, blob, titre) VALUES (?, ?, ?, ?)");
    const insererSection = db.prepare("INSERT INTO vault_staging_sections (snapshot, chemin, titre, mots, texte) VALUES (?, ?, ?, ?, ?)");
    for (const f of fichiers) {
      const chemin = String(f.chemin || "");
      const contenu = typeof f.contenu === "string" ? f.contenu : null;
      const valide =
        dansPerimetre(chemin) &&
        /^[0-9a-f]{40,64}$/.test(String(f.blob || "")) &&
        contenu !== null &&
        tailleOctets(contenu) <= TAILLE_MAX;
      if (!valide) {
        // Quand le PC ne peut pas transmettre une note, l'ancienne copie ne doit pas continuer
        // à servir de source sous le nouveau snapshot.
        if (dansPerimetre(chemin)) marquerSupprime(chemin);
        refuses.push(chemin);
        continue;
      }
      db.prepare("DELETE FROM vault_staging_supprimes WHERE snapshot = ? AND chemin = ?").run(head, chemin);
      effacerStaging(chemin);
      const note = decouper(chemin, contenu);
      insererFichier.run(head, chemin, f.blob, note.titre);
      for (const section of note.sections) insererSection.run(head, chemin, section.titre, note.mots, section.texte);
      indexes += 1;
    }

    if (fin) {
      if ((db.prepare("SELECT valeur FROM vault_etat WHERE cle = 'staging_head'").get()?.valeur || null) !== head) {
        throw new Error("fin reçue pour un snapshot vault différent");
      }
      const effacerPublie = (chemin) => {
        db.prepare("DELETE FROM vault_sections WHERE chemin = ?").run(chemin);
        db.prepare("DELETE FROM vault_fichiers WHERE chemin = ?").run(chemin);
      };
      for (const { chemin } of db.prepare("SELECT chemin FROM vault_staging_supprimes WHERE snapshot = ?").all(head)) effacerPublie(chemin);
      for (const { chemin } of db.prepare("SELECT chemin FROM vault_staging_fichiers WHERE snapshot = ?").all(head)) effacerPublie(chemin);
      db.prepare("INSERT INTO vault_fichiers (chemin, blob, titre) SELECT chemin, blob, titre FROM vault_staging_fichiers WHERE snapshot = ?").run(head);
      db.prepare("INSERT INTO vault_sections (chemin, titre, mots, texte) SELECT chemin, titre, mots, texte FROM vault_staging_sections WHERE snapshot = ?").run(head);
      poserEtat.run("head", head);
      poserEtat.run("synchro_le", new Date(maintenant).toISOString());
      db.exec("DELETE FROM vault_staging_sections; DELETE FROM vault_staging_fichiers; DELETE FROM vault_staging_supprimes;");
      db.prepare("DELETE FROM vault_etat WHERE cle = 'staging_head'").run();
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { indexes, refuses };
}

// Mots trop fréquents pour départager deux notes.
const VIDES = new Set(
  "les des une un le la de du et en au aux pour par sur dans avec sans que qui quoi est sont pas plus ce cette ces son sa ses leur the and for with from this that".split(" ")
);

/** Transforme un texte libre en requête FTS5 : chaque mot entre guillemets, reliés par OR. */
function requeteFts(texte) {
  const mots = String(texte || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 3 && !VIDES.has(m));
  return [...new Set(mots)].slice(0, 24).map((m) => `"${m}"`).join(" OR ");
}

function extrait(texte) {
  const t = texte.replace(/\s+/g, " ").trim();
  return t.length > EXTRAIT_MAX ? `${t.slice(0, EXTRAIT_MAX - 1)}…` : t;
}

/**
 * Les sections les plus proches d'un texte, deux au plus par note pour ne pas remplir le
 * contexte avec une seule longue page.
 * @returns {Array<{ chemin: string, titre: string, extrait: string, score: number }>}
 */
function rechercher(db, texte, { limite = 6 } = {}) {
  preparer(db);
  const requete = requeteFts(texte);
  if (!requete) return [];
  const lignes = db
    .prepare(
      `SELECT chemin, titre, texte, bm25(vault_sections, 0, 3.0, 2.0, 1.0) AS score
       FROM vault_sections WHERE vault_sections MATCH ? ORDER BY score LIMIT ?`
    )
    .all(requete, limite * 4);
  const parNote = new Map();
  const resultats = [];
  for (const l of lignes) {
    const n = parNote.get(l.chemin) || 0;
    if (n >= 2) continue;
    parNote.set(l.chemin, n + 1);
    resultats.push({ chemin: l.chemin, titre: l.titre, extrait: extrait(l.texte), score: Number((-l.score).toFixed(3)) });
    if (resultats.length >= limite) break;
  }
  return resultats;
}

module.exports = { PERIMETRE, dansPerimetre, decouper, inventaire, appliquer, rechercher, requeteFts, preparer };
