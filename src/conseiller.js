// Pont du vault : index pour « Demander » et archivage des décisions humaines.
// Le conseiller a été retiré. Les noms historiques du pont sont conservés pour
// ne changer ni son protocole ni sa configuration pendant la livraison.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const vault = require("./vault-index");

// Un travail pris et jamais rendu (agent coupé en plein calcul) revient dans la file.
const PRIS_MAX_MS = 5 * 60_000;
// Une note n’est distribuée qu’à concurrence de trois prises après interruption.
const ESSAIS_MAX = 3;

class RefusConseiller extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS travaux (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cle        TEXT NOT NULL UNIQUE,
  genre      TEXT NOT NULL,
  dossier    TEXT NOT NULL,
  empreinte  TEXT NOT NULL,
  charge     TEXT NOT NULL DEFAULT '{}',
  statut     TEXT NOT NULL DEFAULT 'a_faire',
  essais     INTEGER NOT NULL DEFAULT 0,
  cree_le    TEXT NOT NULL,
  pris_le    TEXT,
  bail       TEXT,
  fini_le    TEXT,
  erreur     TEXT
);
CREATE TABLE IF NOT EXISTS agent (
  cle        TEXT PRIMARY KEY,
  vu_le      TEXT NOT NULL,
  modele     TEXT,
  version    TEXT
);
`;

function avec(base, travail) {
  let db = null;
  try {
    fs.mkdirSync(path.dirname(path.resolve(base)), { recursive: true });
    db = new DatabaseSync(base);
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    // Les installations déjà lancées avant les baux n'ont pas la colonne. SQLite ne propose
    // pas `ADD COLUMN IF NOT EXISTS`, donc la migration idempotente ignore le doublon.
    try {
      db.exec("ALTER TABLE travaux ADD COLUMN bail TEXT");
    } catch {}
    vault.preparer(db);
    return travail(db);
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

const iso = (ms) => new Date(ms).toISOString();
const json = (v, defaut) => {
  try {
    return JSON.parse(v);
  } catch {
    return defaut;
  }
};

// ---------- l'agent du PC ----------

/**
 * Le jeton de l'agent, comparé à son empreinte SHA-256 : le NAS ne garde pas le jeton
 * lui-même. Rend false sans empreinte configurée, jamais « tout le monde ».
 */
function jetonValide(entetes, empreinteAttendue) {
  const attendu = String(empreinteAttendue || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(attendu)) return false;
  const m = String((entetes && entetes.authorization) || "").match(/^Bearer\s+(\S+)$/);
  if (!m) return false;
  const recu = crypto.createHash("sha256").update(m[1]).digest();
  return crypto.timingSafeEqual(recu, Buffer.from(attendu, "hex"));
}

/** Vérifie les réglages qui autorisent le pont vault à créer sa base. */
function erreurConfiguration({ base, approvalsDir, jetonSha256 }) {
  const empreinte = String(jetonSha256 || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(empreinte)) return "CONSEILLER_JETON_SHA256 absent ou invalide";
  const cible = path.resolve(String(base || ""));
  const approbations = path.resolve(String(approvalsDir || ""));
  const relatif = path.relative(approbations, cible);
  if (!relatif || (!relatif.startsWith(`..${path.sep}`) && relatif !== ".." && !path.isAbsolute(relatif))) {
    return "CONSEILLER_BASE doit rester hors du répertoire des approbations";
  }
  return null;
}

function battement(base, { modele = null, version = null } = {}, maintenant = Date.now()) {
  return avec(base, (db) => {
    db.prepare(
      `INSERT INTO agent (cle, vu_le, modele, version) VALUES ('pc', ?, ?, ?)
       ON CONFLICT(cle) DO UPDATE SET vu_le = excluded.vu_le, modele = excluded.modele, version = excluded.version`
    ).run(iso(maintenant), modele ? String(modele).slice(0, 80) : null, version ? String(version).slice(0, 40) : null);
    const inv = vault.inventaire(db);
    return { vault: { head: inv.head, synchroLe: inv.synchroLe, fichiers: inv.fichiers } };
  });
}

function inventaireVault(base) {
  return avec(base, (db) => {
    const inv = vault.inventaire(db);
    return { head: inv.head, blobs: inv.blobs };
  });
}

function recevoirVault(base, lot, maintenant = Date.now()) {
  return avec(base, (db) => vault.appliquer(db, lot, maintenant));
}

function chercherVault(base, texte, opts) {
  return avec(base, (db) => vault.rechercher(db, texte, opts));
}

function lireVault(base, chemin, opts) {
  return avec(base, (db) => vault.lire(db, chemin, opts));
}

/**
 * Ce que l'index donne au chat du cockpit : le périmètre de notes autorisé, et l'état
 * de la dernière synchro, pour que le chat dise quand sa copie date.
 */
function vaultPourChat(base) {
  const synchro = () => avec(base, (db) => vault.inventaire(db).synchroLe);
  return {
    chercher: ({ requete, limite, dossier }) => {
      const resultats = chercherVault(base, requete, { limite, dossier });
      return { synchroLe: synchro(), resultats: resultats.length ? resultats : "aucune note trouvée pour ces mots" };
    },
    lire: ({ chemin, section }) => {
      const note = lireVault(base, chemin, { section });
      if (!note) {
        return vault.dansPerimetre(chemin)
          ? `note ${chemin} absente de l'index (chemin tiré de vault_search ?)`
          : `note ${chemin} hors du périmètre lisible (${vault.PERIMETRE.join(", ")})`;
      }
      return { synchroLe: synchro(), ...note };
    },
  };
}

// Le nom de fichier, les variables et les routes restent ceux du pont installé.
// Seules les notes sont distribuées : conserver les anciens avis en base n'autorise
// ni leur reprise par un ancien PC ni leur affichage après une livraison progressive.
function prendre(base, { maintenant = Date.now() } = {}) {
  return avec(base, (db) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE travaux SET statut = 'abandonne', fini_le = ?, bail = NULL WHERE genre != 'note' AND statut IN ('a_faire', 'en_cours')").run(iso(maintenant));
      db.prepare("UPDATE travaux SET statut = 'a_faire', pris_le = NULL, bail = NULL WHERE genre = 'note' AND statut = 'en_cours' AND pris_le < ?").run(iso(maintenant - PRIS_MAX_MS));
      const t = db.prepare("SELECT * FROM travaux WHERE genre = 'note' AND statut = 'a_faire' AND essais < ? ORDER BY id LIMIT 1").get(ESSAIS_MAX);
      if (!t) { db.exec("COMMIT"); return null; }
      const bail = crypto.randomUUID();
      db.prepare("UPDATE travaux SET statut = 'en_cours', pris_le = ?, bail = ?, essais = essais + 1 WHERE id = ?").run(iso(maintenant), bail, t.id);
      db.exec("COMMIT");
      return { id: t.id, genre: 'note', note: json(t.charge, {}), bail };
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch {}
      throw err;
    }
  });
}

function rendre(base, id, corps, { maintenant = Date.now() } = {}) {
  return avec(base, (db) => {
    const t = db.prepare("SELECT * FROM travaux WHERE id = ?").get(Number(id));
    if (!t) throw new RefusConseiller(404, "travail inconnu");
    if (t.genre !== 'note') return { ignore: "conseiller retiré" };
    if (t.statut !== 'en_cours') return { ignore: `travail ${t.statut}` };
    if (typeof corps?.bail !== 'string' || corps.bail !== t.bail) return { ignore: "bail expiré ou remplacé" };
    const erreur = corps?.erreur ? String(corps.erreur).slice(0, 500) : null;
    db.prepare("UPDATE travaux SET statut = ?, fini_le = ?, erreur = ? WHERE id = ?").run(erreur ? 'echec' : 'fait', iso(maintenant), erreur, t.id);
    return { statut: erreur ? 'echec' : 'fait' };
  });
}

// L'écran conserve l'état de l'archivage sans exposer les avis historiques.
function etatNotes(base, etat) {
  return avec(base, (db) => ({
    ...etat,
    dossiers: etat.dossiers.map((d) => ({
      ...d,
      actions: d.actions.map(({ conseil: _avis, ...action }) => action),
      note_vault: db.prepare("SELECT statut FROM travaux WHERE cle = ? AND genre = 'note'").get(`note:${d.dossier}:${d.empreinte}`)?.statut ?? null,
    })),
  }));
}

function ligneDecision(action) {
  const quoi = [action.type, action.cible].filter(Boolean).join(", ");
  const verdict = action.decision === "approuve" ? "approuvée" : "refusée";
  const note = action.note ? ` Note : ${action.note.replace(/\s+/g, " ")}` : "";
  return `- **Décision** : ${action.id} (${quoi}) ${verdict} par ${action.decision_par || "inconnu"}.${note}`;
}

/**
 * L'entrée du vault pour un dossier tranché, au format de `_context/memory/_PROTOCOLE.md`,
 * encadrée par des marqueurs : l'agent du PC remplace l'entrée si elle existe déjà (une note
 * ajoutée après coup), sinon il l'ajoute en fin de fichier.
 */
// L'agent du PC n'écrit qu'une note au nom simple (lettres, chiffres, - et _) et à
// l'empreinte hexadécimale (bin/conseiller-pc.js, `noteValide`). Un dossier de run s'appelle
// `run:<id>`, et une rallonge de budget a pour empreinte `budget-1` : la note du 2026-10-05
// a été refusée pour ça. Les deux sont ramenés ici à la forme attendue.
const nomDeNote = (dossier) => String(dossier).replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
const empreinteDeNote = (empreinte) =>
  /^[0-9a-f]{16,}$/i.test(String(empreinte)) ? String(empreinte) : crypto.createHash("sha256").update(String(empreinte)).digest("hex");

function entreeVault(source, _anciensAvis, maintenant) {
  const dossier = { ...source, dossier: nomDeNote(source.dossier), empreinte: empreinteDeNote(source.empreinte) };
  const jour = iso(maintenant).slice(0, 10);
  const marqueur = `dossier:${dossier.dossier}:${String(dossier.empreinte).slice(0, 16)}`;
  const lignes = [
    `<!-- ${marqueur} -->`,
    `## ${jour} : dossier ${dossier.dossier} tranché`,
    `**Source** : cockpit, approbations des pipelines${dossier.appliquer_avec ? ` (${dossier.appliquer_avec})` : ""}`,
    `**Projet** : [[PROJECTS#business-pipelines]]`,
    ...(source.source === "run" ? [`**Run** : ${source.projet ?? "?"}, nœud ${source.nodeId ?? "?"}, run ${source.runId ?? "?"}`] : []),
    "",
    ...dossier.actions.map(ligneDecision),
    `<!-- /${marqueur} -->`,
  ];
  return {
    dossier: dossier.dossier,
    empreinte: dossier.empreinte,
    jour,
    chemin: `_context/projects/business-pipelines/decisions/${jour.slice(0, 7)}.md`,
    titre: `Décisions des pipelines, ${jour.slice(0, 7)}`,
    marqueur,
    entree: lignes.join("\n"),
  };
}

/**
 * Met en file la note du vault d'un dossier qui vient d'être tranché. Une nouvelle décision
 * sur le même plan (une note ajoutée) remplace la note encore en attente.
 */
function noter(base, dossier, maintenant = Date.now()) {
  if (!dossier || !dossier.tranche) return null;
  return avec(base, (db) => {
    const charge = JSON.stringify(entreeVault(dossier, [], maintenant));
    db.prepare(
      `INSERT INTO travaux (cle, genre, dossier, empreinte, charge, cree_le) VALUES (?, 'note', ?, ?, ?, ?)
       ON CONFLICT(cle) DO UPDATE SET charge = excluded.charge, statut = 'a_faire', essais = 0, pris_le = NULL, bail = NULL, fini_le = NULL, erreur = NULL`
    ).run(`note:${dossier.dossier}:${dossier.empreinte}`, dossier.dossier, dossier.empreinte, charge, iso(maintenant));
    return JSON.parse(charge);
  });
}

module.exports = { RefusConseiller, erreurConfiguration, jetonValide, battement,
  inventaireVault, recevoirVault, chercherVault, lireVault, vaultPourChat,
  prendre, rendre, etatNotes, noter, entreeVault };
