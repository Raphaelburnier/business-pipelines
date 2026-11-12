const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { executer } = require('../bin/reserve-quota');
const { installer } = require('../bin/installer-reserve');
const ID = '00000000-0000-4000-8000-000000000001';
const env = { COCKPIT_RESERVE_URL: 'https://cockpit.example.ts.net' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

function api({ autorise = true, pending = null, statut = 'done', lectureApres = null } = {}) {
  const appels = []; let configuration = { active: false, seuilUtilise: null }, cible;
  const fetch = async (url, opts) => {
    const route = new URL(url).pathname;
    appels.push({ route, ...opts });
    if (opts.method === 'POST') { cible = JSON.parse(opts.body); return json({ id: ID, statut: 'pending' }, 202); }
    if (route.startsWith('/api/commands/')) {
      if (statut === 'done') configuration = lectureApres || cible;
      return json({ commande: { id: ID, statut, resultat: statut === 'done' ? { ok: true } : statut === 'refused' ? { ok: false } : null } });
    }
    return json({ configuration, etat: configuration.active ? 'autorise' : 'desactive', autorise, modificationEnCours: pending });
  };
  return { fetch, appels };
}

test('status et absence d’action lisent sans écrire, pour chaque fournisseur', async () => {
  for (const runtime of ['claude', 'codex']) {
    const a = api(), sortie = [];
    assert.equal(await executer([runtime, '--json'], { env, fetch: a.fetch, sortie: x => sortie.push(x) }), 0);
    assert.deepEqual(a.appels.map(x => [x.route, x.method]), [[`/api/quota/reserve-${runtime}`, 'GET']]);
    assert.deepEqual(JSON.parse(sortie[0]).configuration, { active: false, seuilUtilise: null });
  }
});

test('75 active seulement la cible et attend la commande puis le réglage effectif', async () => {
  for (const runtime of ['claude', 'codex']) {
    const a = api(), sorties = [];
    await executer([runtime, '75', '--json'], { env, fetch: a.fetch, sortie: x => sorties.push(x) });
    const post = a.appels.filter(x => x.method === 'POST');
    assert.equal(post.length, 1); assert.equal(post[0].route, `/api/quota/reserve-${runtime}`);
    assert.deepEqual(JSON.parse(post[0].body), { active: true, seuilUtilise: 75 });
    assert.equal(post[0].headers['content-type'], 'application/json');
    assert.equal(post[0].redirect, 'error');
    assert.equal('authorization' in post[0].headers, false); assert.equal('tailscale-user-login' in post[0].headers, false);
    assert.equal(a.appels.at(-2).route, '/api/commands/' + ID);
    const lu = JSON.parse(sorties[0]); assert.equal(lu.commande.statut, 'done'); assert.deepEqual(lu.configuration, { active: true, seuilUtilise: 75 });
  }
});

test('off conserve le seuil précédent, sans toucher à l’autre fournisseur', async () => {
  const a = api(); let premiere = true;
  const fetch = async (url, opts) => {
    if (premiere) { premiere = false; return json({ configuration: { active: true, seuilUtilise: 81 }, autorise: true }); }
    return a.fetch(url, opts);
  };
  await executer(['codex', 'off'], { env, fetch, sortie() {} });
  assert.deepEqual(JSON.parse(a.appels.find(x => x.method === 'POST').body), { active: false, seuilUtilise: 81 });
  assert.ok(a.appels.every(x => !x.route.endsWith('claude')));
});

test('arguments invalides refusés avant toute requête', async () => {
  for (const args of [['codex', '0'], ['claude', '101'], ['codex', '74.5'], ['codex', '75;whoami'], ['autre', '75'], ['codex', '75', 'off']]) {
    await assert.rejects(executer(args, { env, fetch() { assert.fail('requête inattendue'); } }));
  }
});

test('lecture seule ou modification déjà en attente : aucun POST', async () => {
  for (const opts of [{ autorise: false }, { pending: { id: ID } }]) {
    const a = api(opts);
    await assert.rejects(executer(['claude', '60'], { env, fetch: a.fetch }), /opérateur|déjà en attente/);
    assert.equal(a.appels.filter(x => x.method === 'POST').length, 0);
  }
});

test('202 pending ou refused ne deviennent pas une réussite et ne sont pas rejoués', async () => {
  for (const statut of ['pending', 'refused']) {
    const a = api({ statut }), sorties = [];
    await assert.rejects(executer(['codex', '75'], { env, fetch: a.fetch, sortie: x => sorties.push(x), attendreMs: 5, intervalleMs: 1 }), /encore en attente|refusé/);
    assert.equal(a.appels.filter(x => x.method === 'POST').length, 1); assert.deepEqual(sorties, []);
  }
});

test('réponse POST perdue : une seule écriture, état à relire avant retry', async () => {
  const a = api(); let posts = 0;
  const fetch = (url, opts) => { if (opts.method === 'POST') { posts++; throw new Error('connexion interrompue'); } return a.fetch(url, opts); };
  await assert.rejects(executer(['codex', '75'], { env, fetch }), /aucune relance automatique/); assert.equal(posts, 1);
});

test('réglage modifié après acquittement : ne pas écraser la nouvelle décision', async () => {
  const a = api({ lectureApres: { active: true, seuilUtilise: 90 } });
  await assert.rejects(executer(['codex', '75'], { env, fetch: a.fetch, sortie() {} }), /réglage actuel a changé/);
  assert.equal(a.appels.filter(x => x.method === 'POST').length, 1);
});

test('404 d’une extension non livrée et URL hors tailnet donnent une erreur sans repli SSH', async () => {
  await assert.rejects(executer(['codex', '75'], { env, fetch: async () => json({}, 404) }), /version livrée/);
  for (const url of ['https://public.example.invalid', 'https://user:password@cockpit.example.ts.net', 'http://cockpit.example.ts.net']) {
    await assert.rejects(executer(['codex'], { env: { COCKPIT_RESERVE_URL: url }, fetch() { assert.fail('requête inattendue'); } }));
  }
});

test('installation stable, réinstallation idempotente et refus de remplacer un skill existant', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reserve-install-'));
  try {
    const r = installer({ home, url: env.COCKPIT_RESERVE_URL });
    assert.ok(fs.statSync(r.commande).mode & 0o100);
    for (const lien of r.skills) { assert.ok(fs.lstatSync(lien).isSymbolicLink()); assert.ok(fs.existsSync(path.join(lien, 'SKILL.md'))); }
    installer({ home });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.config/agent-reserve/config.json'))), { url: env.COCKPIT_RESERVE_URL });
    fs.unlinkSync(r.skills[0]); fs.mkdirSync(r.skills[0]); fs.writeFileSync(path.join(r.skills[0], 'SKILL.md'), 'personnel');
    assert.throws(() => installer({ home }), /skill reserve existe déjà/);
    assert.equal(fs.readFileSync(path.join(r.skills[0], 'SKILL.md'), 'utf8'), 'personnel');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('commande installée exécutable hors du dépôt, avec vrai HTTP et acquittement différé', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'reserve avec espaces-'));
  let configuration = { active: false, seuilUtilise: null }, cible, posts = 0, lectures = 0;
  const serveur = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'POST') {
      posts++; let corps = ''; req.on('data', b => corps += b); req.on('end', () => { cible = JSON.parse(corps); res.writeHead(202); res.end(JSON.stringify({ id: ID, statut: 'pending' })); }); return;
    }
    if (req.url.startsWith('/api/commands/')) {
      lectures++; const done = lectures > 1; if (done) configuration = cible;
      return res.end(JSON.stringify({ commande: { id: ID, statut: done ? 'done' : 'taken', resultat: done ? { ok: true } : null } }));
    }
    res.end(JSON.stringify({ configuration, etat: configuration.active ? 'autorise' : 'desactive', autorise: true }));
  });
  try {
    await new Promise(resolve => serveur.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${serveur.address().port}`;
    const r = installer({ home });
    const fin = await new Promise((resolve, reject) => {
      const p = spawn(r.commande, ['codex', '78', '--json'], { cwd: os.tmpdir(), env: { ...process.env, COCKPIT_RESERVE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = ''; p.stdout.on('data', b => out += b); p.stderr.on('data', b => err += b); p.on('error', reject); p.on('close', code => resolve({ code, out, err }));
    });
    assert.equal(fin.code, 0, fin.err); assert.equal(posts, 1); assert.ok(lectures > 1);
    assert.deepEqual(JSON.parse(fin.out).configuration, { active: true, seuilUtilise: 78 });
  } finally { await new Promise(resolve => serveur.close(resolve)); fs.rmSync(home, { recursive: true, force: true }); }
});
