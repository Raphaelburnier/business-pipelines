#!/usr/bin/env node
// Sur le PC : aucun secret n'est écrit dans Git, ni en clair dans le dossier d'archives.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

const MAGIC = Buffer.from('COCKPIT-BACKUP-1\n');
const NOM = /^cockpit-etat-\d{8}T\d{9}Z-[a-f0-9]{8}\.cbackup$/;
const CONFIG = path.join(os.homedir(), '.config/cockpit-backup/config.json');
function prive(fichier) {
  const s = fs.lstatSync(fichier);
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o077) || s.uid !== process.getuid()) throw Error('permissions privées requises');
}
function cle(fichier) {
  prive(fichier);
  const valeur = fs.readFileSync(fichier);
  if (valeur.length !== 32) throw Error('clé invalide');
  return valeur;
}
function initialiser(fichier) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
  fs.writeFileSync(fichier, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
}
function configuration(fichier = CONFIG) {
  prive(fichier);
  const c = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(c.ssh || '')) throw Error('cible SSH invalide');
  for (const k of ['archives', 'cle']) if (!path.isAbsolute(c[k] || '')) throw Error('chemin absolu requis');
  if (c.cle.startsWith(`${c.archives}/`)) throw Error('clé séparée des archives requise');
  return c;
}
function enfant(commande, args, options = {}) {
  const p = spawn(commande, args, { stdio: ['pipe', 'pipe', 'ignore'], ...options });
  const fin = new Promise((resolve, reject) => {
    p.once('error', reject);
    p.once('exit', (code) => code === 0 ? resolve() : reject(Error('commande interrompue ou refusée')));
  });
  // Le consommateur peut devoir terminer son pipeline avant d'attendre la commande.
  fin.catch(() => {});
  return { p, fin };
}
function statut(dossier, donnees) {
  const tmp = path.join(dossier, `statut.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(donnees, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, path.join(dossier, 'statut.json'));
}
function retenir(dossier, nombre = 14) {
  for (const nom of fs.readdirSync(dossier).filter(n => NOM.test(n)).sort().reverse().slice(nombre)) fs.unlinkSync(path.join(dossier, nom));
}
async function sauvegarder(c, { commande, args, entree, delai = 300000, retention = 14 } = {}) {
  fs.mkdirSync(c.archives, { recursive: true, mode: 0o700 });
  const s = fs.lstatSync(c.archives);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) throw Error('dossier privé requis');
  // La destination doit être sur le PC, jamais un montage réseau du NAS.
  const type = fs.statfsSync(c.archives).type >>> 0;
  if ([0x6969, 0xff534d42, 0xfe534d42].includes(type)) throw Error('destination réseau refusée');
  const key = cle(c.cle);
  const lock = path.join(c.archives, '.verrou');
  const lockFd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_RDWR | fs.constants.O_NOFOLLOW, 0o600);
  // flock porte sur la description ouverte partagée avec le fils : libération par le
  // noyau même après SIGKILL/redémarrage, sans verrou périmé à supprimer à la main.
  const reservation = spawnSync('flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', lockFd] });
  if (reservation.status !== 0) { fs.closeSync(lockFd); key.fill(0); throw Error('sauvegarde déjà active ou flock indisponible'); }
  const nom = `cockpit-etat-${new Date().toISOString().replace(/[-:.]/g, '')}-${crypto.randomBytes(4).toString('hex')}.cbackup`;
  const partiel = path.join(c.archives, `.${nom}.partiel`);
  const fichier = path.join(c.archives, nom);
  let child;
  let timer;
  let precedent = {};
  try {
    try { precedent = JSON.parse(fs.readFileSync(path.join(c.archives, 'statut.json'), 'utf8')); } catch { /* premier passage */ }
    const nonce = crypto.randomBytes(12);
    const header = Buffer.concat([MAGIC, nonce]);
    const chiffreur = crypto.createCipheriv('aes-256-gcm', key, nonce);
    chiffreur.setAAD(header);
    fs.writeFileSync(partiel, header, { flag: 'wx', mode: 0o600 });
    const executable = commande || 'ssh';
    const argumentsSsh = args || ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', c.ssh,
      'sudo -n /usr/local/bin/docker exec -i business_cockpit node --no-warnings -'];
    child = enfant(executable, argumentsSsh);
    const code = entree === undefined ? fs.readFileSync(path.join(__dirname, '../deploy/backup/exporter-etat.js')) : entree;
    let octetsExportes = 0;
    child.p.stdout.on('data', bloc => { octetsExportes += bloc.length; });
    child.p.stdin.on('error', () => {});
    child.p.stdin.end(code);
    timer = setTimeout(() => child.p.kill('SIGKILL'), delai);
    try {
      await Promise.all([pipeline(child.p.stdout, chiffreur, fs.createWriteStream(partiel, { flags: 'a', mode: 0o600 })), child.fin]);
    } finally { clearTimeout(timer); }
    if (!octetsExportes) throw Error('export vide refusé');
    fs.appendFileSync(partiel, chiffreur.getAuthTag());
    const fd = fs.openSync(partiel, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(partiel, fichier);
    const resultat = { dernierSucces: new Date().toISOString(), archive: nom, octets: fs.statSync(fichier).size, dernierEchec: null };
    statut(c.archives, resultat);
    retenir(c.archives, retention);
    return resultat;
  } catch (err) {
    statut(c.archives, { ...precedent, dernierEchec: new Date().toISOString(), erreur: 'Sauvegarde interrompue ou refusée ; archives précédentes conservées.' });
    throw err;
  } finally {
    clearTimeout(timer);
    if (child && child.p.exitCode === null) { child.p.kill('SIGKILL'); await child.fin.catch(() => {}); }
    fs.rmSync(partiel, { force: true });
    fs.closeSync(lockFd);
    key.fill(0);
  }
}
async function restaurer(c, archive, destination) {
  if (!path.isAbsolute(destination) || fs.existsSync(destination)) throw Error('destination neuve absolue requise');
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tmp = fs.mkdtempSync(path.join(parent, '.restauration-'));
  fs.chmodSync(tmp, 0o700);
  let key;
  try {
    key = cle(c.cle);
    const fd = fs.openSync(archive, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let header, tag, taille;
    try {
      taille = fs.fstatSync(fd).size;
      if (taille < MAGIC.length + 12 + 16) throw Error('archive tronquée');
      header = Buffer.alloc(MAGIC.length + 12); tag = Buffer.alloc(16);
      fs.readSync(fd, header, 0, header.length, 0);
      fs.readSync(fd, tag, 0, tag.length, taille - 16);
      if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw Error('format inconnu');
      const dechiffreur = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
      dechiffreur.setAAD(header); dechiffreur.setAuthTag(tag);
      // Authentification complète avant la moindre extraction.
      await pipeline(fs.createReadStream(archive, { fd, autoClose: false, start: header.length, end: taille - 17 }), dechiffreur,
        fs.createWriteStream(path.join(tmp, 'etat.tar.gz'), { flags: 'wx', mode: 0o600 }));
    } finally { fs.closeSync(fd); }
    const validation = enfant('python3', [path.join(__dirname, '../deploy/backup/verifier-restauration.py'), path.join(tmp, 'etat.tar.gz'), path.join(tmp, 'etat')]);
    validation.p.stdin.end();
    let sortie = '';
    for await (const bloc of validation.p.stdout) sortie += bloc.toString();
    await validation.fin;
    const resultat = JSON.parse(sortie);
    // Refuser une destination apparue pendant le contrôle (rename écraserait un dossier vide).
    fs.mkdirSync(destination, { mode: 0o700 });
    try {
      for (const nom of fs.readdirSync(path.join(tmp, 'etat'))) fs.renameSync(path.join(tmp, 'etat', nom), path.join(destination, nom));
    } catch (err) { fs.rmSync(destination, { recursive: true, force: true }); throw err; }
    return resultat;
  } finally { if (key) key.fill(0); fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function main(args) {
  if (args[0] === '--initialiser-cle' && args.length === 2) { initialiser(path.resolve(args[1])); console.log('Clé locale créée ; conserver une copie privée séparée.'); return; }
  const c = configuration(process.env.COCKPIT_BACKUP_CONFIG || CONFIG);
  let resultat;
  if (args[0] === '--statut' && args.length === 1) {
    const etat = JSON.parse(fs.readFileSync(path.join(c.archives, 'statut.json'), 'utf8'));
    const ageHeures = etat.dernierSucces ? (Date.now() - Date.parse(etat.dernierSucces)) / 3600000 : null;
    console.log(JSON.stringify({ ...etat, ageHeures, perime: ageHeures === null || ageHeures > 36 }));
    return;
  }
  if (args[0] === '--restaurer' && args[2] === '--vers' && args.length === 4) resultat = await restaurer(c, path.resolve(args[1]), path.resolve(args[3]));
  else if (!args.length) resultat = await sauvegarder(c);
  else throw Error('arguments invalides');
  // Les compteurs de tables ne sont visibles que dans le rapport privé de recette.
  console.log(JSON.stringify(resultat.tables ? { integrite: resultat.integrite, fichiers: resultat.fichiers, creeLe: resultat.creeLe } : resultat));
}
if (require.main === module) main(process.argv.slice(2)).catch(() => { console.error('Sauvegarde/restauration refusée. Vérifier la configuration privée, la connexion et le statut local.'); process.exitCode = 1; });
module.exports = { MAGIC, NOM, initialiser, configuration, sauvegarder, restaurer, retenir };
