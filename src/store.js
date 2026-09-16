// Le store des approbations : plans gelés, registres de décisions, boîte des demandes en
// attente et journal des alertes, dans une base SQLite au lieu de fichiers JSON.
//
// Pourquoi une base. Les fichiers portaient des chemins absolus d'une machine à l'autre, et
// ne marchaient que parce que le run et le cockpit montaient le même dossier sur le même
// hôte. Une table se lit par dossier, pas par chemin, et garde l'historique des décisions
// d'un plan remplacé au lieu de l'écraser.
//
// Pourquoi `node:sqlite`. Il est livré avec Node 22 : aucune compilation native dans l'image
// Alpine, aucune dépendance de plus.
//
// Une connexion par opération, fermée aussitôt. Le cockpit et le run sont deux processus
// qui écrivent la même base : le journal WAL et le délai d'attente sur verrou suffisent à
// les faire cohabiter, et une connexion qui ne vit pas ne garde jamais un fichier remplacé
// ou supprimé entre deux requêtes.
//
// La base vit dans le dossier des approbations, hors du workspace, pour la raison qui
// valait déjà pour les fichiers : les agents écrivent dans le workspace, et une approbation
// rangée là serait falsifiable par ce qu'elle contrôle.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const FICHIER = "approbations.sqlite";

// Distincte de Refus, comme JsonIllisible : une base illisible est une panne à réparer,
// pas une décision refusée. Le message nomme le fichier.
class StoreIllisible extends Error {}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  dossier      TEXT PRIMARY KEY,
  empreinte    TEXT NOT NULL,
  gele_le      TEXT,
  collecte_le  TEXT,
  actions_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registres (
  dossier       TEXT PRIMARY KEY,
  plan          TEXT NOT NULL,
  reponse       TEXT,
  reponse_par   TEXT,
  reponse_le    TEXT,
  reponse_canal TEXT
);
-- Une ligne par décision, indexée par l'empreinte du plan qu'elle tranche. Réécrire le
-- registre d'un plan remplace ses lignes à lui, jamais celles d'un plan précédent : c'est
-- l'historique que les fichiers perdaient.
CREATE TABLE IF NOT EXISTS decisions (
  dossier   TEXT NOT NULL,
  plan      TEXT NOT NULL,
  action_id TEXT NOT NULL,
  rang      INTEGER NOT NULL,
  decision  TEXT NOT NULL,
  par       TEXT,
  canal     TEXT,
  le        TEXT,
  motif     TEXT,
  PRIMARY KEY (dossier, plan, action_id)
);
CREATE TABLE IF NOT EXISTS attentes (
  dossier        TEXT PRIMARY KEY,
  empreinte      TEXT NOT NULL,
  depuis         TEXT,
  actions        INTEGER NOT NULL,
  appliquer_avec TEXT,
  rang           INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS alertes (
  cle       TEXT PRIMARY KEY,
  dossier   TEXT,
  empreinte TEXT,
  le        TEXT,
  rang      INTEGER NOT NULL
);
`;

function cheminBase(approvalsDir) {
  return path.join(path.resolve(approvalsDir || "."), FICHIER);
}

// Ouvre, prépare, exécute, ferme. Toute erreur SQLite ressort en StoreIllisible qui nomme
// la base : « file is not a database » sans chemin renvoie chercher au mauvais endroit.
function avec(approvalsDir, travail) {
  const chemin = cheminBase(approvalsDir);
  let db = null;
  try {
    fs.mkdirSync(path.dirname(chemin), { recursive: true });
    db = new DatabaseSync(chemin);
    db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
    return travail(db);
  } catch (err) {
    if (err instanceof StoreIllisible) throw err;
    if (err && (err.code === "ERR_SQLITE_ERROR" || /sqlite|database/i.test(err.message))) {
      throw new StoreIllisible(`${chemin} est illisible : ${err.message}`);
    }
    throw err;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }
}

// Plusieurs écritures qui forment un tout : elles passent ensemble ou pas du tout, comme le
// renommage atomique le garantissait pour un fichier.
function transaction(db, travail) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = travail();
    db.exec("COMMIT");
    return r;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

const sansNull = (objet) => Object.fromEntries(Object.entries(objet).filter(([, v]) => v !== null && v !== undefined));

// ---------- plans gelés ----------

function lirePlan(approvalsDir, dossier) {
  return avec(approvalsDir, (db) => {
    const ligne = db.prepare("SELECT * FROM plans WHERE dossier = ?").get(dossier);
    if (!ligne) return null;
    return {
      empreinte: ligne.empreinte,
      gele_le: ligne.gele_le,
      collecte_le: ligne.collecte_le,
      actions: JSON.parse(ligne.actions_json),
    };
  });
}

function gelerPlan(approvalsDir, dossier, { empreinte, gele_le = null, collecte_le = null, actions }) {
  avec(approvalsDir, (db) => {
    db.prepare(
      `INSERT INTO plans (dossier, empreinte, gele_le, collecte_le, actions_json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(dossier) DO UPDATE SET empreinte = excluded.empreinte, gele_le = excluded.gele_le,
         collecte_le = excluded.collecte_le, actions_json = excluded.actions_json`
    ).run(dossier, empreinte, gele_le, collecte_le, JSON.stringify(actions || []));
  });
}

// ---------- registres de décisions ----------

// Rend la forme que le juge d'approbation et le cockpit lisaient dans le fichier :
// { plan, decisions: [...], reponse?, reponse_par?, reponse_le?, reponse_canal? }.
function lireRegistre(approvalsDir, dossier) {
  return avec(approvalsDir, (db) => {
    const registre = db.prepare("SELECT * FROM registres WHERE dossier = ?").get(dossier);
    if (!registre) return null;
    const decisions = db
      .prepare("SELECT action_id, decision, par, canal, le, motif FROM decisions WHERE dossier = ? AND plan = ? ORDER BY rang")
      .all(dossier, registre.plan)
      .map((d) => sansNull({ ...d }));
    return sansNull({
      plan: registre.plan,
      decisions,
      reponse: registre.reponse,
      reponse_par: registre.reponse_par,
      reponse_le: registre.reponse_le,
      reponse_canal: registre.reponse_canal,
    });
  });
}

// Remplace le registre courant du dossier, comme l'écriture du fichier le faisait. Les
// décisions d'un autre plan restent en base : elles ne valent plus rien pour le juge, qui
// ne lit que celles du plan désigné, mais elles restent une trace de qui a décidé quoi.
function ecrireRegistre(approvalsDir, dossier, registre) {
  avec(approvalsDir, (db) =>
    transaction(db, () => {
      db.prepare(
        `INSERT INTO registres (dossier, plan, reponse, reponse_par, reponse_le, reponse_canal) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(dossier) DO UPDATE SET plan = excluded.plan, reponse = excluded.reponse,
           reponse_par = excluded.reponse_par, reponse_le = excluded.reponse_le, reponse_canal = excluded.reponse_canal`
      ).run(
        dossier,
        registre.plan,
        registre.reponse ?? null,
        registre.reponse_par ?? null,
        registre.reponse_le ?? null,
        registre.reponse_canal ?? null
      );
      db.prepare("DELETE FROM decisions WHERE dossier = ? AND plan = ?").run(dossier, registre.plan);
      const inserer = db.prepare(
        "INSERT INTO decisions (dossier, plan, action_id, rang, decision, par, canal, le, motif) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      (registre.decisions || []).forEach((d, i) => {
        inserer.run(dossier, registre.plan, d.action_id, i, d.decision, d.par ?? null, d.canal ?? null, d.le ?? null, d.motif ?? null);
      });
    })
  );
}

// ---------- boîte des demandes en attente ----------

function lireBoite(approvalsDir) {
  return avec(approvalsDir, (db) => ({
    en_attente: db
      .prepare("SELECT dossier, empreinte, depuis, actions, appliquer_avec FROM attentes ORDER BY rang")
      .all()
      .map((e) => ({ ...e, appliquer_avec: e.appliquer_avec ?? null })),
  }));
}

// Une entrée par dossier : déposer remplace la demande au lieu de l'empiler, et `null` la
// retire. Même règle que la boîte en fichier, pour la même raison.
function deposer(approvalsDir, dossier, entree) {
  avec(approvalsDir, (db) =>
    transaction(db, () => {
      db.prepare("DELETE FROM attentes WHERE dossier = ?").run(dossier);
      if (!entree) return;
      const { rang } = db.prepare("SELECT COALESCE(MAX(rang), -1) + 1 AS rang FROM attentes").get();
      db.prepare("INSERT INTO attentes (dossier, empreinte, depuis, actions, appliquer_avec, rang) VALUES (?, ?, ?, ?, ?, ?)").run(
        dossier,
        entree.empreinte,
        entree.depuis ?? null,
        entree.actions ?? 0,
        entree.appliquer_avec ?? null,
        rang
      );
    })
  );
}

// Abandonner un plan : le geste qui consistait à supprimer son fichier gelé. Le plan, le
// registre courant et la demande en attente partent ensemble. Les décisions déjà prises
// restent en base, rattachées à l'empreinte qu'elles tranchaient : abandonner un plan ne
// réécrit pas qui avait décidé quoi.
function abandonnerPlan(approvalsDir, dossier) {
  return avec(approvalsDir, (db) =>
    transaction(db, () => {
      const retires =
        db.prepare("DELETE FROM plans WHERE dossier = ?").run(dossier).changes +
        db.prepare("DELETE FROM registres WHERE dossier = ?").run(dossier).changes +
        db.prepare("DELETE FROM attentes WHERE dossier = ?").run(dossier).changes;
      return retires > 0;
    })
  );
}

// ---------- journal des alertes ----------

function lireJournal(approvalsDir) {
  return avec(approvalsDir, (db) => ({
    envoyees: db.prepare("SELECT cle, dossier, empreinte, le FROM alertes ORDER BY rang").all().map((e) => sansNull({ ...e })),
  }));
}

// Idempotent sur la clé : consigner deux fois la même alerte ne la double pas.
function consignerAlerte(approvalsDir, { cle, dossier = null, empreinte = null, le = null }) {
  avec(approvalsDir, (db) => {
    const { rang } = db.prepare("SELECT COALESCE(MAX(rang), -1) + 1 AS rang FROM alertes").get();
    db.prepare("INSERT OR IGNORE INTO alertes (cle, dossier, empreinte, le, rang) VALUES (?, ?, ?, ?, ?)").run(cle, dossier, empreinte, le, rang);
  });
}

module.exports = {
  FICHIER,
  StoreIllisible,
  cheminBase,
  lirePlan,
  gelerPlan,
  lireRegistre,
  ecrireRegistre,
  lireBoite,
  deposer,
  abandonnerPlan,
  lireJournal,
  consignerAlerte,
};
