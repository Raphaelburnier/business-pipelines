const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const script = path.join(__dirname, '../.github/scripts/review-verdict.cjs');
if (!fs.existsSync(script)) {
  test('revue GitHub avec verdict', { skip: '.github absent de l’image ; testé par la CI GitHub' }, () => {});
  return;
}
const { SCHEMA, preparer, lignesModifiees, validerResultat, finaliser, publier, masquer } = require(script);
const requireMoteur = require('node:module').createRequire(require.resolve('agent-orchestrator'));
const yaml = requireMoteur('yaml');
const workflow = yaml.parse(fs.readFileSync(path.join(__dirname, '../.github/workflows/claude-code-review.yml'), 'utf8'));
const head = 'a'.repeat(40), base = 'b'.repeat(40), mergeBase = 'c'.repeat(40);
const env = { GITHUB_REPOSITORY: 'r/p', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_REF: 'refs/heads/main', GITHUB_ACTOR: 'operator', INPUT_PR: '7' };
const pr = { number: 7, state: 'open', draft: false, changed_files: 1, head: { sha: head, repo: { full_name: 'r/p' } }, base: { sha: base, ref: 'main', repo: { full_name: 'r/p' } } };
const patch = '@@ -1,2 +1,2 @@\n const x = 1;\n-return x;\n+return -x;';
function fixture(t, options = {}) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'review-verdict-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const appels = [], posts = [];
  let lectures = 0;
  const api = async (route, opts = {}) => {
    appels.push(route);
    if (opts.corps) { posts.push(opts.corps); return { id: 99 }; }
    if (route === 'repos/r/p') return { default_branch: options.defaultBranch || 'main' };
    if (route.includes('/collaborators/')) return { permission: options.permission || 'write' };
    if (route === 'repos/r/p/pulls/7') { lectures++; return structuredClone(options.bouge && lectures > 1 ? { ...pr, head: { ...pr.head, sha: 'd'.repeat(40) } } : options.pr || pr); }
    if (route.includes('/compare/')) return { base_commit: { sha: base }, merge_base_commit: { sha: mergeBase }, files: options.files || [{ filename: 'src/a.js', status: 'modified', patch, additions: 1, deletions: 1 }] };
    if (route.includes('/git/trees/')) return { truncated: options.truncated || false, tree: [{ path: 'src/a.js', type: 'blob', mode: options.mode || '100644', sha: 'e'.repeat(40) }] };
    if (route.includes('/git/blobs/')) {
      const texte = options.texte || 'const x = 1;\nreturn -x;';
      return { sha: 'e'.repeat(40), encoding: 'base64', size: Buffer.byteLength(texte), content: Buffer.from(texte).toString('base64') };
    }
    if (route.includes('/comments')) return options.comments || [];
    if (route.includes('/reviews')) return options.reviews || [];
    throw new Error('API non prévue');
  };
  return { dossier, api, appels, posts };
}
const contexte = { schema_version: 1, repository: 'r/p', pr: 7, head_sha: head, base_sha: base, merge_base_sha: mergeBase, run_id: '123', run_attempt: '1', ready: true,
  files: [{ path: 'src/a.js', changed_lines: lignesModifiees(patch) }] };
const resultat = { verdict: 'approved', summary: 'Revue complète sans bug identifié.', reviewed_files: ['src/a.js'], findings: [] };
const constat = { path: 'src/a.js', side: 'RIGHT', line: 2, priority: 'P1', title: 'Signe inversé', body: 'Une valeur positive devient négative.' };
const execution = [{ type: 'result', subtype: 'success', is_error: false }];
function terminer(changements = {}) {
  return finaliser({ contexte, sortie: JSON.stringify(resultat), execution, outcome: 'success', conclusion: 'success', ...changements });
}

test('droits séparés, code de confiance, pas de plugin ni de jeton écrivant dans le relecteur', () => {
  assert.deepEqual(workflow.permissions, {});
  assert.ok(workflow.on.pull_request_target);
  assert.equal(workflow.on.pull_request, undefined);
  assert.deepEqual(workflow.jobs['claude-review'].permissions, { contents: 'read', 'pull-requests': 'read' });
  assert.deepEqual(workflow.jobs.publier.permissions, { contents: 'read', 'pull-requests': 'write' });
  for (const job of Object.values(workflow.jobs)) for (const s of job.steps) {
    if (s.uses?.startsWith('actions/checkout')) {
      assert.equal(s.with.ref, '${{ github.sha }}');
      assert.equal(s.with['persist-credentials'], false);
    }
    if (s.run) assert.ok(!s.run.includes('${{'));
  }
  const agent = workflow.jobs['claude-review'].steps.find(s => s.id === 'agent');
  assert.match(agent.uses, /^anthropics\/claude-code-action\/base-action@[0-9a-f]{40}$/);
  assert.equal(agent.with.plugins, undefined);
  assert.equal(agent.with.show_full_output, 'false');
  assert.match(agent.with.claude_args, /--restricted/);
  assert.match(agent.with.claude_args, /--tools Read,Glob,Grep/);
  assert.match(agent.with.claude_args, /mcp__\*/);
  assert.equal(JSON.parse(agent.with.settings).disableAllHooks, true);
  assert.equal(agent.env.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB, '1');
  assert.equal(SCHEMA.additionalProperties, false);
  const uploads = workflow.jobs['claude-review'].steps.filter(s => s.uses?.includes('upload-artifact'));
  assert.deepEqual(uploads.map(s => s.with.path), ['.review-result/verdict.json']);
  assert.match(workflow.jobs.publier.if, /always\(\)/);
});
test('instantané exact : contenus immuables et aucune exécution du code relu', async t => {
  const f = fixture(t, { texte: 'throw new Error("ne jamais exécuter ce fichier");' });
  const c = await preparer({ env, event: { pull_request: pr }, ...f });
  assert.equal(c.ready, true); assert.equal(c.head_sha, head); assert.equal(c.base_sha, base); assert.equal(c.merge_base_sha, mergeBase);
  assert.ok(f.appels.some(r => r.includes(`/git/trees/${head}?`)));
  assert.ok(f.appels.some(r => r.includes(`/git/trees/${mergeBase}?`)));
  assert.match(fs.readFileSync(path.join(f.dossier, '0-head.txt'), 'utf8'), /ne jamais exécuter/);
  assert.deepEqual(f.posts, []);
});
test('Claude bot autorisé, autres bots et acteurs sans écriture refusés', async t => {
  const f = fixture(t);
  assert.equal((await preparer({ env: { ...env, GITHUB_ACTOR: 'claude[bot]' }, event: { pull_request: pr }, ...f })).ready, true);
  await assert.rejects(preparer({ env: { ...env, GITHUB_ACTOR: 'other[bot]' }, event: {}, ...f }), /bot non admis/);
  const non = fixture(t, { permission: 'read' });
  await assert.rejects(preparer({ env, event: {}, ...non }), /sans droit/);
});
test('fork, brouillon et workflow de branche refusés avant modèle', async t => {
  for (const modif of [{ head: { ...pr.head, repo: { full_name: 'fork/p' } } }, { draft: true }]) {
    const f = fixture(t, { pr: { ...pr, ...modif } });
    await assert.rejects(preparer({ env, event: {}, ...f }));
  }
  const f = fixture(t);
  await assert.rejects(preparer({ env: { ...env, GITHUB_REF: 'refs/heads/codex/change' }, event: {}, ...f }), /hors branche/);
});
test('la vraie branche par défaut est utilisée pour la relance manuelle', async t => {
  const f = fixture(t, { defaultBranch: 'master', pr: { ...pr, base: { ...pr.base, ref: 'master' } } });
  assert.equal((await preparer({ env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/master' }, event: {}, ...f })).ready, true);
});
test('diff incomplet, binaire, traversée de chemin et PR déplacée restent indisponibles', async t => {
  for (const opts of [{ files: [] }, { files: [{ filename: 'a.png', status: 'added' }] },
    { files: [{ filename: 'src/a.js', status: 'modified', patch, additions: 2, deletions: 1 }] },
    { files: [{ filename: '../a.js', status: 'added', patch }] }, { texte: 'a\0b' }, { mode: '120000' }, { truncated: true }, { bouge: true }, { pr: { ...pr, changed_files: 61 } }]) {
    const f = fixture(t, opts), c = await preparer({ env, event: { pull_request: pr }, ...f });
    assert.equal(c.ready, false, JSON.stringify(opts)); assert.ok(c.reason);
  }
});
test('la publication relit la PR après les commentaires et refuse une approbation devenue périmée', async t => {
  const f = fixture(t, { bouge: true });
  const r = await publier({ env, resultat: terminer(), ...f });
  assert.equal(r.status, 'stale');
  assert.match(f.posts[0].body, /PÉRIMÉE/);
});
test('le parseur distingue les lignes ajoutées et supprimées', () => {
  assert.deepEqual(lignesModifiees(patch), { LEFT: [2], RIGHT: [2] });
});
test('approbation complète et correction étayée sont deux verdicts explicites', () => {
  assert.equal(terminer().verdict, 'approved');
  assert.equal(terminer({ sortie: JSON.stringify({ ...resultat, verdict: 'changes_requested', findings: [constat] }) }).verdict, 'changes_requested');
});
test('aucune approbation sur quota, erreur, sortie absente, partielle ou incohérente', () => {
  for (const args of [{ outcome: 'failure' }, { conclusion: 'failure' }, { execution: [] },
    { execution: [{ type: 'result', subtype: 'success', is_error: true }] }, { sortie: '' },
    { sortie: JSON.stringify({ ...resultat, reviewed_files: [] }) },
    { sortie: JSON.stringify({ ...resultat, findings: [constat] }) },
    { sortie: JSON.stringify({ ...resultat, verdict: 'changes_requested' }) },
    { sortie: JSON.stringify({ ...resultat, verdict: 'incomplete' }) }]) {
    assert.equal(terminer(args).status, 'unavailable');
  }
  const quota = terminer({ outcome: 'failure', execution: [{ type: 'result', subtype: 'error', is_error: true, errors: ['weekly usage limit reached'] }] });
  assert.equal(quota.reason, 'quota');
});
test('un constat doit pointer une vraie ligne changée et un fichier relu', () => {
  for (const f of [{ ...constat, line: 1 }, { ...constat, path: 'absent.js' }, { ...constat, priority: 'UNKNOWN' }]) {
    assert.throws(() => validerResultat({ ...resultat, verdict: 'changes_requested', findings: [f] }, contexte));
  }
});
test('publication idempotente et verdict périmé si tête ou base déplacée', async t => {
  const f = fixture(t), r = terminer();
  assert.equal((await publier({ env, resultat: r, ...f })).published, true);
  assert.match(f.posts[0].body, /APPROUVÉ/); assert.ok(f.posts[0].body.includes(head));
  assert.equal(f.posts[0].event, 'COMMENT'); assert.equal(f.posts[0].commit_id, head);
  const m = f.posts[0].body.split('\n')[0];
  const doublon = fixture(t, { comments: [{ user: { login: 'github-actions[bot]' }, body: m }] });
  assert.equal((await publier({ env, resultat: r, ...doublon })).status, 'duplicate'); assert.equal(doublon.posts.length, 0);
  const revueExistante = fixture(t, { reviews: [{ user: { login: 'github-actions[bot]' }, body: m, commit_id: head }] });
  assert.equal((await publier({ env, resultat: r, ...revueExistante })).status, 'duplicate'); assert.equal(revueExistante.posts.length, 0);
  for (const change of [{ head: { ...pr.head, sha: 'e'.repeat(40) } }, { base: { ...pr.base, sha: 'e'.repeat(40) } }]) {
    const stale = fixture(t, { pr: { ...pr, ...change } });
    assert.equal((await publier({ env, resultat: r, ...stale })).status, 'stale');
    assert.match(stale.posts[0].body, /PÉRIMÉE/); assert.doesNotMatch(stale.posts[0].body, /APPROUVÉ/);
  }
});
test('les constats créent une revue inline sur le commit exact et les liens de suppression visent la merge-base', async t => {
  const f = fixture(t), r = terminer({ sortie: JSON.stringify({ ...resultat, verdict: 'changes_requested', findings: [{ ...constat, side: 'LEFT' }] }) });
  assert.equal((await publier({ env, resultat: r, ...f })).verdict, 'changes_requested');
  assert.equal(f.posts[0].commit_id, head);
  assert.equal(f.posts[0].comments[0].side, 'LEFT'); assert.equal(f.posts[0].comments[0].line, 2);
  assert.ok(f.posts[0].body.includes(`/blob/${mergeBase}/src/a.js#L2`));
});
test('provenance du résultat contrôlée et erreur sans fausse approbation publiée', async t => {
  const f = fixture(t);
  for (const change of [{ repository: 'other/p' }, { run_id: '321' }, { run_attempt: '2' }, { pr: 8 }]) {
    await assert.rejects(publier({ env, resultat: { ...terminer(), ...change }, ...f }));
  }
  const r = terminer({ outcome: 'failure' });
  await publier({ env, resultat: r, ...f });
  assert.match(f.posts[0].body, /INDISPONIBLE/); assert.doesNotMatch(f.posts[0].body, /APPROUVÉ/);
});
test('texte public assaini : jetons, identité, réseau, HTML et mentions', () => {
  const brut = 'ghp_' + 'A'.repeat(30) + ' test@example.invalid 192.0.2.1 host.test.ts.net <img> @operator';
  const sain = masquer(brut);
  assert.doesNotMatch(sain, /ghp_|test@example|192\.0\.2|host\.test|<img>|@operator/);
});
