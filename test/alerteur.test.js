const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const { EventStore, Reporter } = require("agent-orchestrator");
const { Alerteur, etat, urlCockpit } = require("../src/alerteur");
const courriel = require("../src/courriel");
const { charger } = require("../bin/alerteur");
const MODULE = path.resolve(__dirname, "../src/alerteur");

function fixture() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "alerteur-"));
  const source = path.join(racine, "events.sqlite"), dossier = path.join(racine, "alertes");
  const store = new EventStore(source); store.machineId = "nas-test";
  const logs = []; let heure = Date.now(), a;
  const ouvrir = () => a = new Alerteur({ source, dossier, maintenant: () => heure, cockpitUrl: "https://cockpit.example.invalid", log: v => logs.push(v) });
  const evenement = (type, payload = {}, runId = null) => store.emettre({ type, payload, runId });
  const run = (statut = "failed") => {
    const id = store.creerRun({ pipelineRef: "dev@1", projectId: "demo" });
    store.statutRun(id, statut);
    new Reporter(racine, { store, runId: id, silencieux: true }).event("run:finished", { status: statut, error: "SECRET_FAUX_NE_PAS_TRANSMETTRE" });
    return id;
  };
  return { racine, source, dossier, store, logs, ouvrir, evenement, run, avancer: ms => { heure += ms; }, maintenant: () => heure,
    fermer() { a?.fermer(); store.fermer(); fs.rmSync(racine, { recursive: true, force: true }); } };
}
const prive = () => ({ SMTP_HOTE: "localhost", SMTP_PORT: 587, SMTP_UTILISATEUR: "robot@example.invalid", SMTP_MOTDEPASSE: "secret-factice", ALERTE_DESTINATAIRE: "dest@example.invalid", ALERTE_COCKPIT_URL: "https://cockpit.example.invalid" });

test("premier démarrage sans historique ; le vrai Reporter produit ensuite un courriel durable, sans doublon après redémarrage", async () => {
  const f = fixture();
  try {
    f.run(); f.evenement("alerte", { sujet: "machine.indisponible", machine: "pc" });
    let a = f.ouvrir(); assert.equal(a.ingester(), 0);
    const id = f.run(); const evenementsAvant = f.store.db.prepare("SELECT COUNT(*) AS n FROM events").get().n;
    assert.equal(a.ingester(), 1);
    const recus = []; await a.envoyer({ transport: async m => recus.push(m) });
    assert.equal(recus.length, 1); assert.match(recus[0].texte, new RegExp(id)); assert.match(recus[0].texte, /dev@1/);
    assert.equal(JSON.stringify(recus).includes("SECRET_FAUX"), false);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM events").get().n, evenementsAvant);
    assert.throws(() => a.source.prepare("DELETE FROM events").run(), /readonly|read-only/i);
    a.fermer(); a = f.ouvrir(); a.ingester(); await a.envoyer({ transport: async m => recus.push(m) });
    assert.equal(recus.length, 1); assert.equal(etat(f.dossier, f.maintenant()).compteurs.sent, 1);
  } finally { f.fermer(); }
});

test("source initialement vide : premier événement traité ; succès, annulations et bruits ignorés", async () => {
  const f = fixture();
  try {
    const a = f.ouvrir(); f.run("succeeded"); f.run("cancelled"); f.evenement("step.progress"); f.evenement("run.failed");
    assert.equal(a.ingester(), 1);
    const recus = []; await a.envoyer({ transport: async m => recus.push(m) });
    assert.equal(recus.length, 1); assert.match(recus[0].titre, /Run en échec/);
  } finally { f.fermer(); }
});

test("panne SMTP : message conservé, autres envoyés, délai borné et reprise avec le même Message-ID", async () => {
  const f = fixture();
  try {
    let a = f.ouvrir(); f.run(); f.run(); a.ingester();
    const ids = []; let premier = true;
    const transport = async m => { ids.push(m.messageId); if (premier) { premier = false; throw Object.assign(Error("SECRET_PASSWORD"), { code: "EAUTH" }); } };
    assert.deepEqual(await a.envoyer({ transport }), { envoyees: 1, echecs: 1 });
    assert.equal(etat(f.dossier, f.maintenant()).compteurs.pending, 1);
    assert.deepEqual(await a.envoyer({ transport }), { envoyees: 0, echecs: 0 });
    a.fermer(); f.avancer(60001); a = f.ouvrir();
    assert.deepEqual(await a.envoyer({ transport }), { envoyees: 1, echecs: 0 });
    assert.equal(ids[0], ids[2]); assert.equal(JSON.stringify(f.logs).includes("SECRET_PASSWORD"), false);
    f.run(); a.ingester();
    const casse = async () => { throw Object.assign(Error("SECRET_AUTH"), { code: "EAUTH" }); };
    for (let i = 0; i < 10; i++) { await a.envoyer({ transport: casse }); f.avancer(3600001); }
    const pending = a.db.prepare("SELECT * FROM notifications WHERE statut='pending'").get();
    assert.ok(pending); assert.ok(pending.prochaine - (f.maintenant() - 3600001) <= 3600000);
  } finally { f.fermer(); }
});

test("une même alerte machine est regroupée ; les machines et runs distincts restent notifiés", async () => {
  const f = fixture();
  try {
    const a = f.ouvrir();
    for (let i = 0; i < 5; i++) f.evenement("alerte", { sujet: "machine.indisponible", machine: "pc" });
    f.evenement("alerte", { sujet: "machine.indisponible", machine: "autre" }); f.run(); f.run();
    assert.equal(a.ingester(), 4); assert.equal(etat(f.dossier, f.maintenant()).compteurs.grouped, 4);
    const recus = []; await a.envoyer({ transport: async m => recus.push(m), maximum: 10 }); assert.equal(recus.length, 4);
    f.evenement("alerte", { sujet: "machine.indisponible", machine: "pc" }); assert.equal(a.ingester(), 0);
    f.avancer(15 * 60000 + 1); f.evenement("alerte", { sujet: "machine.indisponible", machine: "pc" }); assert.equal(a.ingester(), 1);
    f.avancer(30 * 60000); f.evenement("alerte", { sujet: "machine.indisponible", machine: "pc" }); assert.equal(a.ingester(), 0, "le premier message reste en attente, il n'est pas perdu ni multiplié");
  } finally { f.fermer(); }
});

test("pagination de 1 202 événements, curseur atomique et aucune modification du journal moteur", async () => {
  const f = fixture();
  try {
    const a = f.ouvrir();
    f.store.db.exec("BEGIN"); f.run(); for (let i = 0; i < 1200; i++) f.evenement("step.progress"); f.run(); f.store.db.exec("COMMIT");
    assert.equal(a.ingester({ pages: 1 }), 1); assert.equal(etat(f.dossier, f.maintenant()).retardEvenements, 702);
    assert.equal(a.ingester(), 1); assert.equal(etat(f.dossier, f.maintenant()).curseur, 1202);
    assert.equal(a.ingester(), 0); assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1202);
  } finally { f.fermer(); }
});

for (const mode of ["recul", "ancre", "curseur"]) test(`un journal source ${mode} incohérent bloque sans avancer ni envoyer`, () => {
  const f = fixture();
  try {
    f.evenement("run.started"); const a = f.ouvrir(); f.run(); a.ingester(); const curseur = a.lire("curseur");
    if (mode === "recul") f.store.db.exec("DELETE FROM events WHERE id>1");
    else f.store.db.prepare("UPDATE events SET payload_json=? WHERE id=?").run('{"modifie":true}', mode === "ancre" ? 1 : curseur);
    assert.throws(() => a.ingester(), { code: "SOURCE_CHANGE_OU_RECULE" });
    assert.equal(a.lire("curseur"), curseur); assert.equal(etat(f.dossier, f.maintenant()).ok, false);
  } finally { f.fermer(); }
});

test("verrou noyau exclusif entre processus, libéré quand le propriétaire ferme", () => {
  const f = fixture();
  try {
    const a = f.ouvrir();
    const p = spawnSync(process.execPath, ["--no-warnings", "-e", `try{new(require(${JSON.stringify(MODULE)}).Alerteur)({source:process.argv[1],dossier:process.argv[2]});process.exit(2)}catch(e){process.exit(e.code==='INSTANCE_DEJA_ACTIVE'?7:3)}`, f.source, f.dossier]);
    assert.equal(p.status, 7);
    a.fermer(); f.ouvrir();
  } finally { f.fermer(); }
});

test("SIGKILL après acceptation externe : la reprise conserve le message, réutilise son ID et ne reste pas verrouillée", async () => {
  const f = fixture();
  try {
    let a = f.ouvrir(); f.run(); a.ingester();
    const id = JSON.parse(a.db.prepare("SELECT message_json FROM notifications").get().message_json).messageId;
    a.fermer();
    const code = `const a=new(require(${JSON.stringify(MODULE)}).Alerteur)({source:process.argv[1],dossier:process.argv[2]});a.envoyer({transport:async m=>{process.stdout.write(m.messageId+'\\n');process.kill(process.pid,'SIGKILL')}});`;
    const p = spawn(process.execPath, ["--no-warnings", "-e", code, f.source, f.dossier], { stdio: ["ignore", "pipe", "pipe"] });
    let sortie = ""; p.stdout.on("data", b => { sortie += b; });
    const [codeFin, signal] = await once(p, "exit"); assert.equal(codeFin, null); assert.equal(signal, "SIGKILL"); assert.equal(sortie.trim(), id);
    f.avancer(120000); a = f.ouvrir(); const recus = []; await a.envoyer({ transport: async m => recus.push(m) });
    assert.equal(recus[0].messageId, id); assert.equal(etat(f.dossier, f.maintenant()).compteurs.sent, 1);
  } finally { f.fermer(); }
});

test("raisons libres et champs inattendus ne sortent pas dans le courriel ou les logs", async () => {
  const f = fixture();
  try {
    const a = f.ouvrir(); f.evenement("alerte", { sujet: "SECRET_JETON", raison: "SECRET_MOTDEPASSE", machine: "pc" });
    f.run(); a.ingester(); const recus = []; await a.envoyer({ transport: async m => recus.push(m) });
    const texte = JSON.stringify([recus, f.logs]); assert.equal(texte.includes("SECRET_"), false);
    assert.match(recus[0].texte, /Consulter : https:\/\/cockpit.example.invalid\//);
    assert.equal(recus.length, 2);
  } finally { f.fermer(); }
});

test("rétention des accusés bornée à 10 000 ; aucune notification en attente supprimée", async () => {
  const f = fixture();
  try {
    const a = f.ouvrir(); f.run(); a.ingester();
    a.db.exec("BEGIN");
    const q = a.db.prepare("INSERT INTO notifications(id,evenement,genre,message_json,statut,prochaine,cree) VALUES (?,?,'alerte','{}','sent',?,?)");
    for (let i = 0; i < 10005; i++) q.run(`factice-${i}`, i, f.maintenant(), f.maintenant());
    a.db.exec("COMMIT");
    await a.envoyer({ transport: async () => {}, maximum: 0 });
    assert.deepEqual(etat(f.dossier, f.maintenant()).compteurs, { pending: 1, sent: 10000 });
    f.avancer(31 * 86400000); await a.envoyer({ transport: async () => {}, maximum: 0 });
    assert.deepEqual(etat(f.dossier, f.maintenant()).compteurs, { pending: 1 });
  } finally { f.fermer(); }
});

test("configuration privée et destination requises ; une URL de décision ou en clair n'est pas acceptée", () => {
  const f = fixture();
  try {
    const c = path.join(f.racine, "smtp.json"); fs.writeFileSync(c, JSON.stringify(prive()), { mode: 0o600 });
    assert.equal(charger(c).SMTP_PORT, 587);
    fs.chmodSync(c, 0o644); assert.throws(() => charger(c), { code: "CONFIG_PERMISSIONS" }); fs.chmodSync(c, 0o600);
    fs.writeFileSync(c, JSON.stringify({ ...prive(), ANTHROPIC_API_KEY: "factice" })); assert.throws(() => charger(c), { code: "CONFIG_INVALIDE" });
    assert.throws(() => courriel.config({ ...prive(), ALERTE_DESTINATAIRE: "" }), { code: "CONFIG_MANQUANTE" });
    assert.throws(() => urlCockpit("http://cockpit.example.invalid"), { code: "CONFIG_URL" });
    assert.throws(() => urlCockpit("https://user:pass@cockpit.example.invalid"), { code: "CONFIG_URL" });
    assert.equal(urlCockpit("https://cockpit.example.invalid/?action=oui"), "https://cockpit.example.invalid");
  } finally { f.fermer(); }
});

test("vrai client SMTP : un serveur sans STARTTLS ne reçoit ni AUTH ni message", async () => {
  const commandes = [], sockets = new Set();
  const serveur = net.createServer(s => {
    sockets.add(s); s.on("close", () => sockets.delete(s)); s.write("220 smtp-test ESMTP\r\n");
    let tampon = "";
    s.on("data", b => { tampon += b; while (tampon.includes("\r\n")) {
      const i = tampon.indexOf("\r\n"), ligne = tampon.slice(0, i); tampon = tampon.slice(i + 2); commandes.push(ligne);
      if (ligne.startsWith("EHLO")) s.write("250-smtp-test\r\n250 AUTH PLAIN LOGIN\r\n");
      else if (ligne === "STARTTLS") s.write("454 TLS unavailable\r\n");
      else s.write("500 commande inattendue\r\n");
    } });
  });
  serveur.listen(0, "127.0.0.1"); await once(serveur, "listening");
  try {
    await assert.rejects(courriel.envoyer({ titre: "Test", texte: "Test" }, { ...prive(), SMTP_HOTE: "127.0.0.1", SMTP_PORT: serveur.address().port }));
    assert.ok(commandes.includes("STARTTLS")); assert.equal(commandes.some(x => x.startsWith("AUTH") || x.startsWith("MAIL FROM")), false);
  } finally { for (const s of sockets) s.destroy(); await new Promise(r => serveur.close(r)); }
});

test("service CLI natif : initialisation, santé, reprise d'erreur et logs sans adresse ni mot de passe", async () => {
  const f = fixture();
  try {
    const c = path.join(f.racine, "smtp.json"); fs.writeFileSync(c, JSON.stringify({ ...prive(), SMTP_PORT: 1 }), { mode: 0o600 });
    const env = { ...process.env, ALERTE_SOURCE: f.source, ALERTE_ETAT_DIR: f.dossier, ALERTE_CONFIG: c };
    const lancer = option => spawnSync(process.execPath, ["--no-warnings", path.resolve(__dirname, "../bin/alerteur.js"), option], { env, encoding: "utf8", timeout: 10000 });
    assert.equal(lancer("--une-passe").status, 0);
    assert.equal(lancer("--sante").status, 0);
    f.run(); const p = lancer("--une-passe"); assert.equal(p.status, 1);
    assert.equal(p.stdout.includes("secret-factice"), false); assert.equal(p.stdout.includes("robot@"), false);
    assert.equal(etat(f.dossier).compteurs.pending, 1); assert.equal(lancer("--sante").status, 0, "le transport indisponible n'est pas confondu avec un processus arrêté");
    assert.match(p.stdout, /alerte.reessai/);
  } finally { f.fermer(); }
});

test("préparation opérateur : secrets littéraux préservés, destinataire choisi, ancienne configuration jamais réécrite", () => {
  const f = fixture();
  try {
    const { preparer } = require("../bin/preparer-alerteur");
    const source = path.join(f.racine, "ancien.env"), cible = path.join(f.racine, "nouveau.json");
    const secret = "factice-$-#-apostrophe'";
    const texte = `SMTP_HOTE=smtp.example.invalid\nSMTP_UTILISATEUR=robot@example.invalid\nSMTP_MOTDEPASSE="${secret}"\nALERTE_DESTINATAIRE=autre@example.invalid\nANTHROPIC_API_KEY=NE_PAS_COPIER\nALERTE_COCKPIT_URL=https://cockpit.example.invalid\n`;
    fs.writeFileSync(source, texte, { mode: 0o600 });
    assert.equal(preparer(source, cible).configuration, "creee");
    const valeur = JSON.parse(fs.readFileSync(cible)); assert.equal(valeur.SMTP_MOTDEPASSE, secret);
    assert.equal(valeur.ALERTE_DESTINATAIRE, "robot@example.invalid"); assert.equal(valeur.ANTHROPIC_API_KEY, undefined);
    assert.equal(fs.statSync(cible).mode & 0o777, 0o600); assert.equal(fs.readFileSync(source, "utf8"), texte);
    assert.equal(preparer(source, cible).configuration, "reutilisee");
    valeur.ALERTE_DESTINATAIRE = "autre@example.invalid"; fs.writeFileSync(cible, JSON.stringify(valeur));
    assert.throws(() => preparer(source, cible), /EXISTANTE_DIFFERENTE/);
    assert.equal(JSON.parse(fs.readFileSync(cible)).ALERTE_DESTINATAIRE, "autre@example.invalid");
  } finally { f.fermer(); }
});
