const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { MaintenanceExecution } = require("agent-orchestrator/src/maintenance-execution");

function verifierBaseExistante(fichier) {
  let db;
  try {
    db = new DatabaseSync(fichier, { readOnly: true });
    for (const table of ["runs", "steps", "commands"]) db.prepare(`SELECT status FROM ${table} LIMIT 1`).get();
    db.prepare("SELECT payload_json FROM events LIMIT 1").get();
  } catch { throw new Error("Base d'exécution existante requise : livreur suspendu"); }
  finally { db?.close(); }
}

// Lecture seule : une base absente ne devient jamais une base vide « sans run ».
function verifierAvantBascule(fichier, commandeId) {
  let db;
  try {
    db = new DatabaseSync(fichier, { readOnly: true });
    db.exec("PRAGMA busy_timeout=5000; BEGIN");
    const maintenance = new MaintenanceExecution({ db });
    maintenance.verifierProprietaire(commandeId);
    maintenance.verifierRepos();
    db.exec("COMMIT");
  } catch (err) {
    // Ne pas publier le chemin de la base ou une erreur SQLite brute dans le cockpit.
    if (/maintenance|propriétaire|travail en cours/i.test(err.message)) throw err;
    throw new Error("État d'exécution indisponible : livraison refusée avant la bascule");
  } finally { db?.close(); }
}

function issueCertaine(fin, incident) {
  if (incident || fin.signal) return false;
  if (fin.demarre === false || fin.code === 0) return true;
  if (fin.etape === "restaurer") return fin.code !== 70 && fin.dernieres?.includes("Restauration confirmée.");
  return ["preparer", "construire"].includes(fin.etape)
    && fin.dernieres?.includes("Échec avant la bascule ; rien n'a été remplacé.");
}

function poserIncident(fichier) {
  try { fs.writeFileSync(fichier, "Maintenance conservée après une livraison d'issue incertaine. Vérification opérateur requise.\n", { mode: 0o600, flag: "wx" }); }
  catch (err) { if (err.code !== "EEXIST") throw err; }
}

async function executerSousMaintenance({ store, commandeId, incidentFichier, preparer, basculer }) {
  if (store.maintenance?.version !== 1) throw new Error("Moteur incompatible : maintenance v1 requise avant de livrer");
  store.maintenance.activer(commandeId);
  let prete;
  try { prete = preparer(); }
  catch (err) {
    if (!fs.existsSync(incidentFichier)) store.maintenance.liberer(commandeId);
    throw err;
  }
  try {
    const fin = await basculer(prete);
    if (issueCertaine(fin, fs.existsSync(incidentFichier))) store.maintenance.liberer(commandeId);
    else poserIncident(incidentFichier);
    return { prete, fin };
  } catch (err) {
    poserIncident(incidentFichier);
    throw err;
  }
}

// Réservé à la procédure opérateur : aucune récupération automatique après un crash.
function recupererMaintenance({ fichier, commandeId, basculeTerminee, verifierServices }) {
  if (basculeTerminee !== true) throw new Error("Confirmer manuellement que la bascule est terminée avant de libérer");
  verifierBaseExistante(fichier);
  verifierServices();
  const db = new DatabaseSync(fichier);
  db.exec("PRAGMA busy_timeout=5000");
  const store = { db, emettre({ type, payload }) {
    db.prepare("INSERT INTO events(ts,machine_id,type,payload_json) VALUES(?, 'operateur', ?, ?)")
      .run(new Date().toISOString(), type, JSON.stringify(payload));
  } };
  const maintenance = new MaintenanceExecution(store);
  try {
    return maintenance.transaction(() => {
      maintenance.verifierProprietaire(commandeId);
      if (db.prepare("SELECT 1 FROM commands WHERE kind='livraison.start' AND status IN ('pending','taken') LIMIT 1").get()) throw new Error("Une commande de livraison est encore ouverte : récupération refusée");
      maintenance.verifierRepos();
      return maintenance.liberer(commandeId);
    });
  } finally { db.close(); }
}

module.exports = { verifierBaseExistante, verifierAvantBascule, issueCertaine, executerSousMaintenance, recupererMaintenance };
