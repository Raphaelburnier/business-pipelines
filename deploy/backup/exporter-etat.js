// Exécuté sur l'entrée standard de Node dans le cockpit. stdout = archive uniquement.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');

async function exporter(racine = '/app', sortie = process.stdout) {
  const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-backup-'));
  fs.chmodSync(temporaire, 0o700);
  try {
    const fichiers = {};
    const deadline = Date.now() + 120000;
    const instantane = async (source, cible) => {
      const origine = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
      try {
        await backup(origine, cible, { rate: 200, progress: () => { if (Date.now() > deadline) throw Error('délai SQLite'); } });
      } finally { origine.close(); }
      fs.chmodSync(cible, 0o600);
      const copie = new DatabaseSync(cible);
      const tables = {};
      try {
        // Fermer le WAL sur la copie indépendante, jamais sur la source vivante.
        copie.exec('PRAGMA journal_mode=DELETE');
        if (copie.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('intégrité SQLite');
        for (const { name } of copie.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
          tables[name] = Number(copie.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n);
        }
      } finally { copie.close(); }
      return tables;
    };
    const bases = {};
    const copier = async (relatif) => {
      if (Date.now() > deadline) throw Error('délai export');
      const source = path.join(racine, relatif);
      const stat = fs.lstatSync(source, { bigint: true });
      const cible = path.join(temporaire, relatif);
      // Les journaux vivants ne font pas partie d'une copie SQLite indépendante.
      if (/\.sqlite-(wal|shm|journal)$/.test(relatif) && fs.existsSync(source.replace(/-(wal|shm|journal)$/, ''))) return;
      if (stat.isDirectory()) {
        fs.mkdirSync(cible, { recursive: true, mode: 0o700 });
        for (const nom of fs.readdirSync(source).sort()) await copier(`${relatif}/${nom}`);
      } else if (stat.isFile()) {
        fs.mkdirSync(path.dirname(cible), { recursive: true, mode: 0o700 });
        let contenu;
        if (relatif.endsWith('.sqlite')) {
          bases[relatif] = await instantane(source, cible);
          contenu = fs.readFileSync(cible);
        } else {
          // O_NOFOLLOW ferme la course remplacement-par-lien entre lstat et open.
          const fd = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          try {
            const avant = fs.fstatSync(fd, { bigint: true });
            if (!avant.isFile() || avant.ino !== stat.ino || avant.dev !== stat.dev) throw Error('source changée');
            contenu = fs.readFileSync(fd);
            const apres = fs.fstatSync(fd, { bigint: true });
            if (avant.mtimeNs !== apres.mtimeNs || avant.ctimeNs !== apres.ctimeNs || avant.size !== apres.size) throw Error('source changée');
          } finally { fs.closeSync(fd); }
          fs.writeFileSync(cible, contenu, { mode: 0o600, flag: 'wx' });
        }
        fichiers[relatif] = crypto.createHash('sha256').update(contenu).digest('hex');
      } else throw Error('type de fichier refusé');
    };
    // Les bases des approbations sont aussi vivantes : même API que pour events.sqlite.
    for (const source of ['etat/events.sqlite', 'specs', 'approvals', 'projects']) await copier(source);
    const tables = bases['etat/events.sqlite'];
    if (!tables) throw Error('event store absent');
    // Vérifier la configuration indispensable sans la journaliser.
    JSON.parse(fs.readFileSync(path.join(temporaire, 'specs/workers.json'), 'utf8'));
    fs.writeFileSync(path.join(temporaire, 'manifest.json'), JSON.stringify({ version: 1, creeLe: new Date().toISOString(), fichiers, tables, bases }), { mode: 0o600 });
    const tar = spawn('tar', ['-czf', '-', '-C', temporaire, 'manifest.json', 'etat', 'specs', 'approvals', 'projects'], { stdio: ['ignore', 'pipe', 'ignore'] });
    const fin = new Promise((resolve, reject) => {
      tar.once('error', reject);
      tar.once('exit', (code) => code === 0 ? resolve() : reject(Error('export archive refusé')));
    });
    try { await Promise.all([pipeline(tar.stdout, sortie), fin]); }
    finally { if (tar.exitCode === null) tar.kill('SIGKILL'); }
  } finally {
    fs.rmSync(temporaire, { recursive: true, force: true });
  }
}
if (!module.parent) exporter().catch(() => { process.stderr.write('Export de sauvegarde refusé.\n'); process.exitCode = 1; });
module.exports = { exporter };
