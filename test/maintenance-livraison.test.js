const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventStore } = require("agent-orchestrator");
const { executerSousMaintenance, verifierAvantBascule, recupererMaintenance, verifierBaseExistante } = require("../src/maintenance-livraison");
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "livraison-maintenance-"));
  const fichier = path.join(dir, "events.sqlite"), incidentFichier = path.join(dir, "incident-livraison");
  const store = new EventStore(fichier);
  const c = store.creerCommande({ kind: "livraison.start", payload: { cockpit: "a".repeat(40), moteur: "b".repeat(40), registre: "c".repeat(40) }, par: "operateur", canal: "tailnet" });
  store.prendreCommande({ kinds: ["livraison.start"] });
  return { dir, fichier, store, commandeId: c.id, incidentFichier, preparer: () => ({ release: "recette" }),
    fermer() { store.fermer(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("un run actif refuse sans préparer ni lancer de bascule", async () => {
  const f = fixture(); let appels = 0;
  try {
    f.store.creerRun({ pipelineRef: "recette@1" });
    await assert.rejects(executerSousMaintenance({ ...f, preparer: () => appels++, basculer: () => appels++ }), /travail en cours/);
    assert.equal(appels, 0); assert.equal(f.store.maintenance.etat().active, false);
  } finally { f.fermer(); }
});

test("la maintenance couvre la préparation, une attente et la bascule, puis libère la file", async () => {
  const f = fixture();
  try {
    const c = f.store.creerCommande({ kind: "run.start", payload: { projectId: "demo" }, par: "operateur" });
    await executerSousMaintenance({ ...f, preparer: () => {
      verifierAvantBascule(f.fichier, f.commandeId);
      assert.equal(f.store.prendreCommande({ kinds: ["run.start"] }), null); return f.preparer();
    }, basculer: async () => {
      await new Promise(r => setTimeout(r, 50));
      verifierAvantBascule(f.fichier, f.commandeId);
      assert.equal(f.store.prendreCommande({ kinds: ["run.start"] }), null);
      return { code: 0, etape: "sante", dernieres: [] };
    } });
    assert.equal(f.store.maintenance.etat().active, false);
    assert.equal(f.store.prendreCommande({ kinds: ["run.start"] }).id, c.id);
    assert.equal(fs.existsSync(f.incidentFichier), false);
  } finally { f.fermer(); }
});

for (const fin of [
  { code: 1, etape: "construire", dernieres: ["Échec avant la bascule ; rien n'a été remplacé."] },
  { code: 1, etape: "restaurer", dernieres: ["Restauration confirmée."] },
  { code: 1, etape: "preparer", demarre: false, dernieres: [] },
]) test(`une issue certaine libère le verrou : ${fin.etape}`, async () => {
  const f = fixture();
  try {
    await executerSousMaintenance({ ...f, basculer: async () => fin });
    assert.equal(f.store.maintenance.etat().active, false);
  } finally { f.fermer(); }
});

for (const fin of [
  { code: 1, etape: "construire", dernieres: [] },
  { code: 1, etape: "basculer", dernieres: [] },
  { code: 70, etape: "restaurer", dernieres: ["Restauration confirmée."] },
  { code: 0, signal: "SIGKILL", etape: "sante", dernieres: [] },
]) test(`une issue incertaine conserve le verrou et un incident privé : ${JSON.stringify(fin)}`, async () => {
  const f = fixture();
  try {
    await executerSousMaintenance({ ...f, basculer: async () => fin });
    assert.equal(f.store.maintenance.etat().active, true);
    assert.equal(fs.statSync(f.incidentFichier).mode & 0o777, 0o600);
    f.store.abandonnerCommandesInterrompues({ kinds: ["livraison.start"], raison: "redémarrage" });
    assert.equal(f.store.maintenance.etat().active, true);
  } finally { f.fermer(); }
});

test("une erreur de préparation libère ; une panne du pilote de bascule conserve", async () => {
  const f = fixture();
  try {
    await assert.rejects(executerSousMaintenance({ ...f, preparer: () => { throw new Error("archive invalide"); } }), /archive invalide/);
    assert.equal(f.store.maintenance.etat().active, false);
    await assert.rejects(executerSousMaintenance({ ...f, basculer: () => { throw new Error("pilote coupé"); } }), /pilote coupé/);
    assert.equal(f.store.maintenance.etat().active, true);
    assert.equal(fs.existsSync(f.incidentFichier), true);
  } finally { f.fermer(); }
});

test("la vérification refuse une base absente ou corrompue sans la créer/réparer", () => {
  const f = fixture();
  try {
    const absente = path.join(f.dir, "absente.sqlite");
    assert.throws(() => verifierAvantBascule(absente, f.commandeId), /indisponible/);
    assert.equal(fs.existsSync(absente), false);
    assert.throws(() => verifierBaseExistante(absente), /Base d'exécution existante requise/);
    assert.equal(fs.existsSync(absente), false);
    const corrompue = path.join(f.dir, "corrompue.sqlite"); fs.writeFileSync(corrompue, "invalide");
    assert.throws(() => verifierAvantBascule(corrompue, f.commandeId), /indisponible/);
    assert.equal(fs.readFileSync(corrompue, "utf8"), "invalide");
    assert.throws(() => verifierAvantBascule(f.fichier, f.commandeId), /Maintenance absente/);
    f.store.maintenance.activer(f.commandeId);
    assert.throws(() => verifierAvantBascule(f.fichier, "autre"), /propriétaire/);
    verifierAvantBascule(f.fichier, f.commandeId);
  } finally { f.fermer(); }
});

test("la récupération exige confirmation, services sains, propriétaire exact et aucune livraison ouverte", () => {
  const f = fixture();
  try {
    f.store.maintenance.activer(f.commandeId);
    const options = { ...f, basculeTerminee: true, verifierServices() {} };
    assert.throws(() => recupererMaintenance({ ...options, basculeTerminee: false }), /Confirmer manuellement/);
    assert.throws(() => recupererMaintenance({ ...options, verifierServices() { throw new Error("malade"); } }), /malade/);
    assert.throws(() => recupererMaintenance({ ...options, commandeId: "autre" }), /propriétaire/);
    assert.throws(() => recupererMaintenance(options), /livraison.*ouverte/);
    assert.equal(f.store.maintenance.etat().active, true);
    f.store.terminerCommande(f.commandeId, { ok: false, raison: "redémarrage" });
    const avant = f.store.controle.etat();
    recupererMaintenance(options);
    assert.equal(f.store.maintenance.etat().active, false);
    assert.deepEqual(f.store.controle.etat(), avant);
    const journal = f.store.evenements().filter(e => e.type === "execution.maintenance_changed");
    assert.equal(journal.length, 2);
    assert.equal(journal.at(-1).machine_id, "operateur");
  } finally { f.fermer(); }
});

test("un incident existant n'est pas écrasé par une fausse réussite", async () => {
  const f = fixture();
  try {
    fs.writeFileSync(f.incidentFichier, "restauration non confirmée\n", { mode: 0o600 });
    await executerSousMaintenance({ ...f, basculer: async () => ({ code: 0, etape: "sante" }) });
    assert.equal(f.store.maintenance.etat().active, true);
    assert.equal(fs.readFileSync(f.incidentFichier, "utf8"), "restauration non confirmée\n");
  } finally { f.fermer(); }
});
