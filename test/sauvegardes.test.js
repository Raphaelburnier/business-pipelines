const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { initialiser, sauvegarder, restaurer, retenir, MAGIC, NOM } = require('../bin/sauvegarder-etat');
const exporter = path.resolve(__dirname, '../deploy/backup/exporter-etat.js');

function fixture() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  const source = path.join(racine, 'source');
  for (const d of ['etat', 'specs', 'approvals', 'projects']) fs.mkdirSync(path.join(source, d), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(source, 'specs/workers.json'), JSON.stringify({ workers: [{ machine: 'test' }] }));
  fs.writeFileSync(path.join(source, 'specs/prive.env'), 'SECRET_DE_TEST=non-reel\n');
  const db = new DatabaseSync(path.join(source, 'etat/events.sqlite'));
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE events (id INTEGER PRIMARY KEY, valeur TEXT); INSERT INTO events VALUES (1, 'dans le WAL');");
  const decisions = new DatabaseSync(path.join(source, 'approvals/approbations.sqlite'));
  decisions.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE decisions (id); INSERT INTO decisions VALUES (42)");
  const c = { archives: path.join(racine, 'archives'), cle: path.join(racine, 'cle') };
  initialiser(c.cle);
  return { racine, source, c, db, options: { commande: process.execPath, args: ['--no-warnings', '-e', `require(${JSON.stringify(exporter)}).exporter(process.argv[1]).catch(()=>process.exitCode=1)`, source], entree: '' },
    nettoyer() { decisions.close(); db.close(); fs.rmSync(racine, { recursive: true, force: true }); } };
}
function chiffrer(c, contenu, nom) {
  const nonce = crypto.randomBytes(12), header = Buffer.concat([MAGIC, nonce]);
  const cipher = crypto.createCipheriv('aes-256-gcm', fs.readFileSync(c.cle), nonce); cipher.setAAD(header);
  const archive = path.join(path.dirname(c.cle), nom);
  fs.writeFileSync(archive, Buffer.concat([header, cipher.update(contenu), cipher.final(), cipher.getAuthTag()]));
  return archive;
}

test('SQLite active avec WAL, configuration secrète, chiffrement et restauration intégrale', async () => {
  const f = fixture();
  try {
    assert.ok(fs.statSync(path.join(f.source, 'etat/events.sqlite-wal')).size > 0);
    const resultat = await sauvegarder(f.c, f.options);
    assert.match(resultat.archive, NOM);
    const fichier = path.join(f.c.archives, resultat.archive);
    assert.equal(fs.statSync(fichier).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(fichier).includes(Buffer.from('SECRET_DE_TEST')));
    const destination = path.join(f.racine, 'restaure');
    const recu = await restaurer(f.c, fichier, destination);
    assert.equal(recu.integrite, 'ok'); assert.equal(recu.bases, 2);
    const decisions = new DatabaseSync(path.join(destination, 'approvals/approbations.sqlite'), { readOnly: true });
    assert.equal(decisions.prepare('SELECT id FROM decisions').get().id, 42); decisions.close(); assert.equal(recu.tables.events, 1);
    const copie = new DatabaseSync(path.join(destination, 'etat/events.sqlite'), { readOnly: true });
    assert.equal(copie.prepare('SELECT valeur FROM events').get().valeur, 'dans le WAL'); copie.close();
    assert.equal(fs.readFileSync(path.join(destination, 'specs/prive.env'), 'utf8'), 'SECRET_DE_TEST=non-reel\n');
    assert.equal(fs.statSync(path.join(destination, 'specs/prive.env')).mode & 0o777, 0o600);
    await assert.rejects(restaurer(f.c, fichier, destination));
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.c.archives, 'statut.json'))).dernierSucces, resultat.dernierSucces);
  } finally { f.nettoyer(); }
});

test('altération, troncature et mauvaise clé refusées avant extraction', async () => {
  const f = fixture();
  try {
    const resultat = await sauvegarder(f.c, f.options);
    const valide = fs.readFileSync(path.join(f.c.archives, resultat.archive));
    for (const [nom, contenu] of [['altere', Buffer.from(valide)], ['tronque', valide.subarray(0, 25)]]) {
      if (nom === 'altere') contenu[MAGIC.length + 30] ^= 1;
      const archive = path.join(f.racine, nom); fs.writeFileSync(archive, contenu);
      const cible = path.join(f.racine, `refus-${nom}`);
      await assert.rejects(restaurer(f.c, archive, cible)); assert.equal(fs.existsSync(cible), false);
    }
    fs.writeFileSync(f.c.cle, crypto.randomBytes(32));
    await assert.rejects(restaurer(f.c, path.join(f.c.archives, resultat.archive), path.join(f.racine, 'mauvaise-cle')));
    assert.equal(fs.readdirSync(f.racine).some(n => n.startsWith('.restauration-')), false);
  } finally { f.nettoyer(); }
});

test('échec export/SSH et échéance ne publient aucune archive et préservent le dernier succès', async () => {
  const f = fixture();
  try {
    const premiere = await sauvegarder(f.c, f.options);
    for (const code of ['process.exit(0)', 'process.stdout.write("incomplet");process.exit(1)', 'setTimeout(()=>{},10000)']) {
      await assert.rejects(sauvegarder(f.c, { commande: process.execPath, args: ['-e', code], entree: '', delai: 100 }));
      assert.deepEqual(fs.readdirSync(f.c.archives).filter(n => NOM.test(n)), [premiere.archive]);
      assert.equal(fs.readdirSync(f.c.archives).some(n => n.endsWith('.partiel')), false);
      const statut = JSON.parse(fs.readFileSync(path.join(f.c.archives, 'statut.json')));
      assert.equal(statut.dernierSucces, premiere.dernierSucces); assert.ok(statut.dernierEchec);
    }
    await sauvegarder(f.c, f.options); // verrou noyau libéré après échec
  } finally { f.nettoyer(); }
});

test('verrou exclusif et clé privée ; clé existante jamais remplacée', async () => {
  const f = fixture();
  try {
    assert.throws(() => initialiser(f.c.cle));
    const enCours = sauvegarder(f.c, { commande: process.execPath, args: ['-e', 'setTimeout(()=>{},10000)'], entree: '', delai: 200 });
    await assert.rejects(sauvegarder(f.c, f.options), /déjà active/);
    await assert.rejects(enCours);
    fs.chmodSync(f.c.cle, 0o644); await assert.rejects(sauvegarder(f.c, f.options), /privées/);
  } finally { f.nettoyer(); }
});

test('export refuse les liens au lieu de suivre une clé extérieure', async () => {
  const f = fixture();
  try {
    fs.symlinkSync(f.c.cle, path.join(f.source, 'specs/lien'));
    await assert.rejects(sauvegarder(f.c, f.options));
    assert.equal(fs.readdirSync(f.c.archives).filter(n => NOM.test(n)).length, 0);
  } finally { f.nettoyer(); }
});

test('rétention limitée aux archives terminées ; les autres fichiers restent intacts', () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.c.archives, { mode: 0o700 });
    for (let i = 1; i <= 20; i++) fs.writeFileSync(path.join(f.c.archives, `cockpit-etat-202610${String(i).padStart(2, '0')}T050000000Z-aaaaaaaa.cbackup`), 'test');
    fs.writeFileSync(path.join(f.c.archives, 'autre.cbackup'), 'conserver');
    retenir(f.c.archives);
    assert.equal(fs.readdirSync(f.c.archives).filter(n => NOM.test(n)).length, 14);
    assert.equal(fs.existsSync(path.join(f.c.archives, 'cockpit-etat-20261001T050000000Z-aaaaaaaa.cbackup')), false);
    assert.equal(fs.existsSync(path.join(f.c.archives, 'autre.cbackup')), true);
  } finally { f.nettoyer(); }
});

test('restauration refuse traversée, liens, doublons et manifeste incohérent même authentifiés', async () => {
  const f = fixture();
  try {
    for (const genre of ['traversee', 'lien', 'doublon', 'manifeste']) {
      const tar = spawnSync('python3', ['-c', `import io,tarfile,sys,json
b=io.BytesIO()
with tarfile.open(fileobj=b,mode='w:gz') as t:
 g=sys.argv[1]
 if g=='lien':
  i=tarfile.TarInfo('specs/lien');i.type=tarfile.SYMTYPE;i.linkname='/etc/passwd';t.addfile(i)
 else:
  for n in (['../hors'] if g=='traversee' else ['specs/x','specs/x'] if g=='doublon' else ['manifest.json']):
   c=b'{}';i=tarfile.TarInfo(n);i.size=len(c);t.addfile(i,io.BytesIO(c))
sys.stdout.buffer.write(b.getvalue())`, genre]);
      assert.equal(tar.status, 0);
      const archive = chiffrer(f.c, tar.stdout, `${genre}.cbackup`);
      const cible = path.join(f.racine, `restaure-${genre}`);
      await assert.rejects(restaurer(f.c, archive, cible)); assert.equal(fs.existsSync(cible), false);
    }
    assert.equal(fs.existsSync(path.join(f.racine, 'hors')), false);
  } finally { f.nettoyer(); }
});

// Le NAS exécute exactement cette forme (node - sur stdin), différente d'un require local.
test('entrée standard native du conteneur lance bien un export non vide', () => {
  const code = fs.readFileSync(exporter, 'utf8').replace("exporter().catch", "exporter('/racine-inexistante-pour-recette').catch");
  const p = spawnSync(process.execPath, ['--no-warnings', '-'], { input: code });
  assert.equal(p.status, 1);
  assert.match(p.stderr.toString(), /Export de sauvegarde refusé/);
});

test('le journal des alertes est sauvegardé avant les événements, même si la source progresse entre les deux copies', async () => {
  const f = fixture(); let journal;
  try {
    const dossier = path.join(f.source, 'etat/alertes'); fs.mkdirSync(dossier, { mode: 0o700 });
    journal = new DatabaseSync(path.join(dossier, 'notifications.sqlite'));
    journal.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE curseur(id INTEGER); INSERT INTO curseur VALUES(1)');
    // Une vraie écriture survient juste après la copie d'events.sqlite : avec l'ordre
    // inverse, le curseur copié ensuite désignerait l'événement2 absent de l'archive.
    const code = `const s=require('node:sqlite'),b=s.backup;s.backup=async(...a)=>{const r=await b(...a);if(a[1].endsWith('etat/events.sqlite')){const d=new s.DatabaseSync(process.argv[1]+'/etat/events.sqlite');d.exec(\"INSERT INTO events VALUES(2,'apres')\");d.close();const j=new s.DatabaseSync(process.argv[1]+'/etat/alertes/notifications.sqlite');j.exec('UPDATE curseur SET id=2');j.close()}return r};require(${JSON.stringify(exporter)}).exporter(process.argv[1]).catch(e=>{console.error(e.message);process.exitCode=1});`;
    const resultat = await sauvegarder(f.c, { ...f.options, args: ['--no-warnings', '-e', code, f.source] });
    const destination = path.join(f.racine, 'restaure-alertes');
    const recu = await restaurer(f.c, path.join(f.c.archives, resultat.archive), destination);
    assert.equal(recu.bases, 3);
    const sourceCopie = new DatabaseSync(path.join(destination, 'etat/events.sqlite'), { readOnly: true });
    const journalCopie = new DatabaseSync(path.join(destination, 'etat/alertes/notifications.sqlite'), { readOnly: true });
    try {
      assert.equal(f.db.prepare('SELECT MAX(id) AS id FROM events').get().id, 2, 'la progression concurrente a bien eu lieu');
      assert.equal(journal.prepare('SELECT id FROM curseur').get().id, 2);
      assert.ok(journalCopie.prepare('SELECT id FROM curseur').get().id <= sourceCopie.prepare('SELECT MAX(id) AS id FROM events').get().id);
      assert.equal(journalCopie.prepare('SELECT id FROM curseur').get().id, 1);
    } finally { journalCopie.close(); sourceCopie.close(); }
  } finally { journal?.close(); f.nettoyer(); }
});
