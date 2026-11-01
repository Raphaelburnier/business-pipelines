// Lecture seule du journal moteur ; état d'envoi distinct et durable.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const courriel = require("./courriel");
const MINUTE = 60000;
const hash = valeur => crypto.createHash("sha256").update(JSON.stringify(valeur)).digest("hex");
const temoin = e => e ? hash([e.id, e.ts, e.type, e.run_id, e.step_id, e.machine_id, e.payload_json]) : null;
const erreur = code => Object.assign(new Error(code), { code });
const identifiant = x => typeof x === "string" && /^[a-zA-Z0-9_.@:/-]{1,160}$/.test(x) ? x : null;
function payload(e) { try { return JSON.parse(e.payload_json); } catch { return {}; } }
function genre(e) {
  if (e.type === "alerte") return "alerte";
  if (e.type === "run.failed" || (e.type === "run.finished" && payload(e)?.status === "failed")) return "run.failed";
  return null;
}
const SUJETS = {
  "etape.perdue": "Une étape a perdu son worker ; vérifier le run et la connexion de la machine.",
  "machine.reveil_echoue": "Le réveil d'une machine a échoué ; vérifier sa disponibilité.",
  "machine.indisponible": "Une machine reste indisponible ; vérifier son worker et sa connexion.",
};
function message(e, contexte, baseUrl, epoch) {
  const type = genre(e), p = payload(e), run = identifiant(e.run_id), machine = identifiant(p?.machine || e.machine_id);
  const sujet = typeof p?.sujet === "string" && Object.hasOwn(SUJETS, p.sujet) ? p.sujet : null;
  const titre = type === "run.failed" ? `[Cockpit] Run en échec${run ? ` ${run.slice(0, 8)}` : ""}` : "[Cockpit] Intervention nécessaire";
  const lignes = [type === "run.failed" ? "Un run s'est terminé en échec." : sujet ? SUJETS[sujet] : "Une alerte d'exploitation demande une vérification dans le cockpit."];
  if (run) lignes.push(`Run : ${run}`);
  if (type === "alerte" && machine) lignes.push(`Machine : ${machine}`);
  if (identifiant(contexte?.project_id)) lignes.push(`Projet : ${contexte.project_id}`);
  if (identifiant(contexte?.pipeline_ref)) lignes.push(`Pipeline : ${contexte.pipeline_ref}`);
  if (typeof e.ts === "string" && Number.isFinite(Date.parse(e.ts))) lignes.push(`Événement : ${new Date(e.ts).toISOString()}`);
  if (baseUrl) lignes.push(`Consulter : ${new URL(run ? `/runs/${encodeURIComponent(run)}` : "/", baseUrl).href}`);
  lignes.push("Guide : https://github.com/Raphaelburnier/business-pipelines/blob/main/docs/runbooks/alertes.md");
  lignes.push("Diagnostic et interventions dans le cockpit ; ce message ne déclenche aucune action.");
  // Le sujet, le code d'erreur et la raison libres ne sortent pas du cockpit.
  const groupe = type === "alerte" ? hash([sujet || "autre", machine || "inconnue"]) : null;
  return { titre, texte: lignes.join("\n"), messageId: `<${hash([epoch, e.id])}@cockpit.invalid>`, groupe };
}
function urlCockpit(valeur) {
  if (!valeur) return null;
  let u;
  try { u = new URL(valeur); } catch { throw erreur("CONFIG_URL"); }
  if (u.protocol !== "https:" || u.username || u.password) throw erreur("CONFIG_URL");
  return u.origin;
}
const SCHEMA = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, evenement INTEGER NOT NULL, genre TEXT NOT NULL, groupe TEXT,
  message_json TEXT NOT NULL, statut TEXT NOT NULL, tentatives INTEGER NOT NULL DEFAULT 0,
  prochaine INTEGER NOT NULL, cree INTEGER NOT NULL, envoyee INTEGER, erreur TEXT
);
CREATE INDEX IF NOT EXISTS notifications_attente ON notifications(statut, prochaine, evenement);
CREATE TABLE IF NOT EXISTS groupes (id TEXT PRIMARY KEY, dernier INTEGER NOT NULL);
`;

class Alerteur {
  constructor({ source, dossier, cockpitUrl = null, maintenant = Date.now, log = () => {}, pointEntree = "service" }) {
    this.maintenant = maintenant; this.log = log; this.pointEntree = pointEntree;
    this.cockpitUrl = urlCockpit(cockpitUrl); this.verrou = null;
    fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(dossier);
    if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) throw erreur("DOSSIER_PRIVE_REQUIS");
    try {
      this.verrou = fs.openSync(path.join(dossier, "service.lock"), fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
      const r = spawnSync("flock", ["-n", "3"], { stdio: ["ignore", "ignore", "ignore", this.verrou] });
      if (r.status !== 0) throw erreur("INSTANCE_DEJA_ACTIVE");
      this.db = new DatabaseSync(path.join(dossier, "notifications.sqlite"), { timeout: 5000 });
      fs.chmodSync(path.join(dossier, "notifications.sqlite"), 0o600);
      this.db.exec(SCHEMA);
      this.source = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
      this.source.exec("PRAGMA query_only=ON");
      if (this.lire("curseur") === undefined) this.initialiser();
    } catch (e) { this.fermer(); throw e; }
  }
  lire(cle) { const r = this.db.prepare("SELECT valeur FROM meta WHERE cle=?").get(cle); return r ? JSON.parse(r.valeur) : undefined; }
  poser(cle, valeur) { this.db.prepare("INSERT INTO meta VALUES (?,?) ON CONFLICT(cle) DO UPDATE SET valeur=excluded.valeur").run(cle, JSON.stringify(valeur)); }
  journal(event, champs = {}) { this.log({ event, pointEntree: this.pointEntree, correlationId: champs.notificationId || this.lire("epoch"), ...champs }); }
  initialiser() {
    this.source.exec("BEGIN");
    try {
      const premier = this.source.prepare("SELECT * FROM events ORDER BY id LIMIT 1").get();
      const dernier = this.source.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 1").get();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.poser("epoch", crypto.randomUUID()); this.poser("ancre", temoin(premier));
        this.poser("curseur", dernier?.id || 0); this.poser("temoin", temoin(dernier));
        this.poser("sourceCode", "ok"); this.poser("dernierTour", this.maintenant());
        this.db.exec("COMMIT");
      } catch (e) { this.db.exec("ROLLBACK"); throw e; }
      this.source.exec("COMMIT");
      this.journal("alerteur.initialise", { curseur: dernier?.id || 0 });
    } catch (e) { if (this.source.isTransaction) this.source.exec("ROLLBACK"); throw e; }
  }
  ingester({ pages = 10 } = {}) {
    let ajoutees = 0;
    for (let page = 0; page < pages; page++) {
      this.source.exec("BEGIN");
      try {
        const curseur = this.lire("curseur"), ancre = this.lire("ancre");
        const premier = this.source.prepare("SELECT * FROM events ORDER BY id LIMIT 1").get();
        const dernier = this.source.prepare("SELECT * FROM events ORDER BY id DESC LIMIT 1").get();
        const precedent = curseur ? this.source.prepare("SELECT * FROM events WHERE id=?").get(curseur) : null;
        if ((ancre && ancre !== temoin(premier)) || (dernier?.id || 0) < curseur || (curseur && this.lire("temoin") !== temoin(precedent))) throw erreur("SOURCE_CHANGE_OU_RECULE");
        const lignes = this.source.prepare("SELECT * FROM events WHERE id>? ORDER BY id LIMIT 500").all(curseur);
        const maintenant = this.maintenant(), epoch = this.lire("epoch");
        this.db.exec("BEGIN IMMEDIATE");
        try {
          if (!ancre && premier) this.poser("ancre", temoin(premier));
          for (const e of lignes) {
            const type = genre(e);
            if (!type) continue;
            const contexte = e.run_id ? this.source.prepare("SELECT project_id,pipeline_ref FROM runs WHERE id=?").get(e.run_id) : null;
            const m = message(e, contexte, this.cockpitUrl, epoch), id = hash([epoch, e.id]);
            const precedentGroupe = m.groupe ? this.db.prepare("SELECT dernier FROM groupes WHERE id=?").get(m.groupe) : null;
            const enAttente = m.groupe && this.db.prepare("SELECT 1 FROM notifications WHERE groupe=? AND statut='pending' LIMIT 1").get(m.groupe);
            const groupe = Boolean(enAttente || (precedentGroupe && maintenant - precedentGroupe.dernier < 15 * MINUTE));
            const r = this.db.prepare("INSERT OR IGNORE INTO notifications(id,evenement,genre,groupe,message_json,statut,prochaine,cree) VALUES (?,?,?,?,?,?,?,?)")
              .run(id, e.id, type, m.groupe, JSON.stringify(m), groupe ? "grouped" : "pending", maintenant, maintenant);
            if (r.changes && !groupe) {
              ajoutees++;
              if (m.groupe) this.db.prepare("INSERT INTO groupes VALUES (?,?) ON CONFLICT(id) DO UPDATE SET dernier=excluded.dernier").run(m.groupe, maintenant);
            }
          }
          if (lignes.length) { const fin = lignes.at(-1); this.poser("curseur", fin.id); this.poser("temoin", temoin(fin)); }
          this.poser("sourceCode", "ok"); this.poser("dernierTour", maintenant);
          this.poser("retardEvenements", (dernier?.id || 0) - this.lire("curseur"));
          this.db.exec("COMMIT");
        } catch (e) { this.db.exec("ROLLBACK"); throw e; }
        this.source.exec("COMMIT");
        if (lignes.length < 500) break;
      } catch (e) {
        if (this.source.isTransaction) this.source.exec("ROLLBACK");
        this.poser("sourceCode", e.code === "SOURCE_CHANGE_OU_RECULE" ? e.code : "SOURCE_INDISPONIBLE");
        throw e;
      }
    }
    return ajoutees;
  }
  async envoyer({ transport, env = {}, maximum = 3 }) {
    const lignes = this.db.prepare("SELECT * FROM notifications WHERE statut='pending' AND prochaine<=? ORDER BY evenement LIMIT ?").all(this.maintenant(), maximum);
    let envoyees = 0, echecs = 0;
    for (const n of lignes) {
      const maintenant = this.maintenant(), tentative = n.tentatives + 1;
      // Une interruption après l'acceptation SMTP peut rejouer ce Message-ID, jamais perdre le message.
      this.db.prepare("UPDATE notifications SET tentatives=?, prochaine=? WHERE id=?").run(tentative, maintenant + MINUTE, n.id);
      try {
        await transport(JSON.parse(n.message_json), env);
        this.db.exec("BEGIN IMMEDIATE");
        try {
          this.db.prepare("UPDATE notifications SET statut='sent', envoyee=?, erreur=NULL WHERE id=?").run(this.maintenant(), n.id);
          if (n.groupe) this.db.prepare("UPDATE groupes SET dernier=? WHERE id=?").run(this.maintenant(), n.groupe);
          this.poser("dernierSucces", this.maintenant()); this.db.exec("COMMIT");
        } catch (e) { this.db.exec("ROLLBACK"); throw e; }
        envoyees++; this.journal("alerte.envoyee", { notificationId: n.id, evenementId: n.evenement, genre: n.genre, tentative });
      } catch (e) {
        const code = courriel.categorie(e), delai = Math.min(3600000, MINUTE * 2 ** Math.min(tentative - 1, 6));
        this.db.prepare("UPDATE notifications SET erreur=?, prochaine=? WHERE id=?").run(code, this.maintenant() + delai, n.id);
        echecs++; this.journal("alerte.reessai", { notificationId: n.id, evenementId: n.evenement, code, tentative, delai });
      }
      this.poser("dernierTour", this.maintenant());
    }
    // Rétention bornée des accusés ; aucun message en attente n'est supprimé.
    this.db.prepare("DELETE FROM notifications WHERE statut IN ('sent','grouped') AND (cree<? OR id NOT IN (SELECT id FROM notifications WHERE statut IN ('sent','grouped') ORDER BY evenement DESC LIMIT 10000))")
      .run(this.maintenant() - 30 * 86400000);
    this.db.prepare("DELETE FROM groupes WHERE dernier<? AND id NOT IN (SELECT groupe FROM notifications WHERE statut='pending' AND groupe IS NOT NULL)").run(this.maintenant() - 15 * MINUTE);
    return { envoyees, echecs };
  }
  fermer() { this.source?.close(); this.source = null; this.db?.close(); this.db = null; if (this.verrou !== null) fs.closeSync(this.verrou); this.verrou = null; }
}
function etat(dossier, maintenant = Date.now()) {
  const db = new DatabaseSync(path.join(dossier, "notifications.sqlite"), { readOnly: true });
  try {
    const m = Object.fromEntries(db.prepare("SELECT * FROM meta").all().map(x => [x.cle, JSON.parse(x.valeur)]));
    const compteurs = Object.fromEntries(db.prepare("SELECT statut,COUNT(*) AS n FROM notifications GROUP BY statut").all().map(x => [x.statut, x.n]));
    const echecs = Object.fromEntries(db.prepare("SELECT erreur,COUNT(*) AS n FROM notifications WHERE statut='pending' AND erreur IS NOT NULL GROUP BY erreur").all().map(x => [x.erreur, x.n]));
    const ancien = db.prepare("SELECT MIN(cree) AS ancien FROM notifications WHERE statut='pending'").get().ancien;
    return { ok: m.sourceCode === "ok" && Number.isFinite(m.dernierTour) && maintenant - m.dernierTour < 180000,
      sourceCode: m.sourceCode, echecs, curseur: m.curseur, retardEvenements: m.retardEvenements || 0, compteurs,
      dernierTour: m.dernierTour, dernierSucces: m.dernierSucces || null, ageAttenteMs: ancien === null ? null : maintenant - ancien };
  } finally { db.close(); }
}
module.exports = { Alerteur, etat, genre, message, urlCockpit };
