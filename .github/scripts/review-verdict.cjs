// Code de confiance de la branche par défaut. Le code relu reste une donnée.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[1-9][0-9]{0,19}$/;
const LIMITES = { fichiers: 60, fichier: 100000, total: 500000, resultat: 100000 };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'summary', 'reviewed_files', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['approved', 'changes_requested', 'incomplete'] },
    summary: { type: 'string', minLength: 1, maxLength: 2000 },
    reviewed_files: { type: 'array', maxItems: 60, items: { type: 'string' } },
    findings: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false, required: ['path', 'side', 'line', 'priority', 'title', 'body'],
      properties: { path: { type: 'string' }, side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
        line: { type: 'integer', minimum: 1 }, priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        title: { type: 'string', minLength: 1, maxLength: 120 }, body: { type: 'string', minLength: 1, maxLength: 2000 } }
    } }
  }
};
const verifier = (condition, raison) => { if (!condition) throw new Error(raison); };
function lireJson(fichier, maximum = 6000000) {
  const stat = fs.lstatSync(fichier);
  verifier(stat.isFile() && !stat.isSymbolicLink() && stat.size <= maximum, 'fichier de résultat invalide');
  return JSON.parse(fs.readFileSync(fichier, 'utf8'));
}
function masquer(texte) {
  return String(texte).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/(?:gh[opsur]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{16}|xox[abpors]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, '[secret masqué]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g, '[clé privée masquée]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[adresse masquée]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[adresse réseau masquée]')
    .replace(/\b[\w.-]+\.ts\.net\b/gi, '[hôte masqué]')
    .replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/`{3,}/g, "'''").replace(/@(?!\u200b)/g, '@\u200b');
}
function cheminValide(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= 400 && !/[\x00-\x1f\x7f\\]/.test(p) &&
    !p.startsWith('/') && p.split('/').every(s => s && s !== '.' && s !== '..') && masquer(p) === p;
}
function gh(route, { pages = false, corps } = {}) {
  const args = ['api', route];
  if (pages) args.push('--paginate', '--slurp');
  if (corps) args.push('--method', 'POST', '--input', '-');
  let sortie;
  try { sortie = execFileSync('gh', args, { encoding: 'utf8', input: corps ? JSON.stringify(corps) : undefined,
    timeout: 30000, maxBuffer: 6000000, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch { throw new Error('API GitHub inaccessible'); }
  const resultat = JSON.parse(sortie);
  return pages ? resultat.flat() : resultat;
}
function identite(env) {
  verifier(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || ''), 'dépôt invalide');
  verifier(ID.test(env.GITHUB_RUN_ID || '') && ID.test(env.GITHUB_RUN_ATTEMPT || ''), 'run invalide');
  return { repository: env.GITHUB_REPOSITORY, run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT };
}
function instantane(pr, repo, defaut) {
  verifier(pr.state === 'open' && !pr.draft, 'PR fermée ou brouillon');
  verifier(pr.head?.repo?.full_name === repo && pr.base?.repo?.full_name === repo, 'PR externe refusée');
  verifier(pr.base.ref === defaut && SHA.test(pr.head.sha) && SHA.test(pr.base.sha), 'références de PR invalides');
  return { pr: pr.number, head_sha: pr.head.sha, base_sha: pr.base.sha };
}
function lignesModifiees(patch) {
  const lignes = { LEFT: [], RIGHT: [] };
  let gauche = 0, droite = 0, hunk = false;
  for (const l of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (m) { gauche = Number(m[1]); droite = Number(m[2]); hunk = true; continue; }
    if (!hunk || l.startsWith('\\')) continue;
    if (l.startsWith('+')) lignes.RIGHT.push(droite++);
    else if (l.startsWith('-')) lignes.LEFT.push(gauche++);
    else if (l.startsWith(' ')) { gauche++; droite++; }
  }
  return lignes;
}
async function preparer({ env, event, api = gh, dossier }) {
  const meta = identite(env), repo = meta.repository;
  verifier(['pull_request_target', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), 'événement non admis');
  const numero = String(event.pull_request?.number ?? env.INPUT_PR ?? '');
  verifier(/^[1-9][0-9]{0,9}$/.test(numero), 'numéro de PR invalide');
  const defaut = (await api(`repos/${repo}`)).default_branch;
  verifier(typeof defaut === 'string' && env.GITHUB_REF === `refs/heads/${defaut}`, 'workflow hors branche par défaut');
  const acteur = env.GITHUB_ACTOR || '';
  if (acteur.endsWith('[bot]')) verifier(acteur === 'claude[bot]', 'bot non admis');
  else {
    verifier(/^[A-Za-z0-9-]+$/.test(acteur), 'acteur invalide');
    const droits = await api(`repos/${repo}/collaborators/${encodeURIComponent(acteur)}/permission`);
    verifier(['admin', 'maintain', 'write'].includes(droits.permission), 'acteur sans droit d’écriture');
  }
  const pr = await api(`repos/${repo}/pulls/${numero}`);
  verifier(pr.number === Number(numero), 'PR inattendue');
  const contexte = { schema_version: 1, ...meta, ...instantane(pr, repo, defaut), ready: false, files: [] };
  fs.mkdirSync(dossier, { recursive: true });
  try {
    verifier(!event.pull_request || event.pull_request.head?.sha === contexte.head_sha, 'tête de l’événement périmée');
    verifier(Number.isInteger(pr.changed_files) && pr.changed_files <= LIMITES.fichiers, 'limite de fichiers dépassée');
    const comparaison = await api(`repos/${repo}/compare/${contexte.base_sha}...${contexte.head_sha}`);
    verifier(comparaison.base_commit?.sha === contexte.base_sha && SHA.test(comparaison.merge_base_commit?.sha), 'comparaison invalide');
    contexte.merge_base_sha = comparaison.merge_base_commit.sha;
    verifier(Array.isArray(comparaison.files) && comparaison.files.length === pr.changed_files, 'diff incomplet');
    let total = 0;
    const arbres = new Map();
    for (const [i, f] of comparaison.files.entries()) {
      verifier(cheminValide(f.filename) && (!f.previous_filename || cheminValide(f.previous_filename)), 'chemin non admissible');
      verifier(['added', 'modified', 'removed', 'renamed'].includes(f.status) && typeof f.patch === 'string', 'diff binaire ou tronqué');
      const entree = { path: f.filename, previous_path: f.previous_filename, status: f.status, patch: f.patch, changed_lines: lignesModifiees(f.patch) };
      verifier(Number.isSafeInteger(f.additions) && Number.isSafeInteger(f.deletions) &&
        entree.changed_lines.RIGHT.length === f.additions && entree.changed_lines.LEFT.length === f.deletions, 'patch tronqué');
      for (const cote of ['base', 'head']) {
        if (cote === 'base' && f.status === 'added' || cote === 'head' && f.status === 'removed') continue;
        const fichier = cote === 'base' ? f.previous_filename || f.filename : f.filename;
        const ref = cote === 'base' ? contexte.merge_base_sha : contexte.head_sha;
        if (!arbres.has(ref)) {
          const arbre = await api(`repos/${repo}/git/trees/${ref}?recursive=1`);
          verifier(arbre.truncated === false && Array.isArray(arbre.tree), 'arbre de sources incomplet');
          arbres.set(ref, arbre.tree);
        }
        const blob = arbres.get(ref).find(e => e.path === fichier);
        verifier(blob?.type === 'blob' && ['100644', '100755'].includes(blob.mode) && SHA.test(blob.sha), 'lien, sous-module ou fichier absent');
        const donnees = await api(`repos/${repo}/git/blobs/${blob.sha}`);
        verifier(donnees.sha === blob.sha && donnees.encoding === 'base64' && donnees.size <= LIMITES.fichier, 'fichier non textuel ou trop volumineux');
        const brut = Buffer.from(donnees.content, 'base64'), texte = brut.toString('utf8');
        verifier(brut.length === donnees.size && !brut.includes(0) && Buffer.from(texte).equals(brut), 'contenu non textuel');
        total += brut.length;
        verifier(total <= LIMITES.total, 'limite de lecture dépassée');
        const nom = `${i}-${cote}.txt`;
        fs.writeFileSync(path.join(dossier, nom), texte);
        entree[`${cote}_file`] = nom;
      }
      contexte.files.push(entree);
    }
    const relue = instantane(await api(`repos/${repo}/pulls/${numero}`), repo, defaut);
    verifier(relue.head_sha === contexte.head_sha && relue.base_sha === contexte.base_sha, 'PR déplacée pendant la préparation');
    contexte.ready = true;
  } catch (err) { contexte.reason = err.message; }
  fs.writeFileSync(path.join(dossier, 'context.json'), JSON.stringify(contexte, null, 2));
  return contexte;
}
function validerResultat(r, contexte) {
  verifier(r && typeof r === 'object' && Object.keys(r).sort().join() === ['findings', 'reviewed_files', 'summary', 'verdict'].join(), 'résultat non conforme');
  verifier(['approved', 'changes_requested', 'incomplete'].includes(r.verdict), 'verdict invalide');
  verifier(typeof r.summary === 'string' && r.summary.trim() && r.summary.length <= 2000, 'résumé invalide');
  verifier(Array.isArray(r.reviewed_files) && r.reviewed_files.length <= LIMITES.fichiers && r.reviewed_files.every(f => contexte.files.some(x => x.path === f)), 'couverture invalide');
  verifier(new Set(r.reviewed_files).size === r.reviewed_files.length, 'couverture dupliquée');
  verifier(Array.isArray(r.findings) && r.findings.length <= 20, 'constats invalides');
  if (r.verdict !== 'incomplete') verifier(r.reviewed_files.length === contexte.files.length, 'revue partielle');
  verifier(r.verdict !== 'approved' || r.findings.length === 0, 'approbation avec constats');
  verifier(r.verdict !== 'changes_requested' || r.findings.length > 0, 'correction sans constat');
  const findings = r.findings.map(f => {
    verifier(f && Object.keys(f).sort().join() === ['body', 'line', 'path', 'priority', 'side', 'title'].join(), 'constat non conforme');
    const fichier = contexte.files.find(x => x.path === f.path);
    verifier(fichier && ['LEFT', 'RIGHT'].includes(f.side) && Number.isInteger(f.line) && fichier.changed_lines[f.side].includes(f.line), 'constat hors du diff');
    verifier(['P0', 'P1', 'P2', 'P3'].includes(f.priority), 'priorité invalide');
    verifier(typeof f.title === 'string' && f.title.trim() && f.title.length <= 120 && typeof f.body === 'string' && f.body.trim() && f.body.length <= 2000, 'texte de constat invalide');
    return { ...f, ...(f.side === 'LEFT' && fichier.previous_path ? { source_path: fichier.previous_path } : {}), title: masquer(f.title), body: masquer(f.body) };
  });
  return { verdict: r.verdict, summary: masquer(r.summary), reviewed_files: [...r.reviewed_files], findings };
}
function finaliser({ contexte, sortie, execution, outcome, conclusion }) {
  const r = { schema_version: 1, repository: contexte.repository, pr: contexte.pr, head_sha: contexte.head_sha,
    base_sha: contexte.base_sha, merge_base_sha: contexte.merge_base_sha, run_id: contexte.run_id, run_attempt: contexte.run_attempt,
    status: 'unavailable', verdict: null, summary: '', findings: [], reviewed_files: [] };
  if (!contexte.ready) { r.reason = masquer(contexte.reason || 'préparation incomplète'); return r; }
  const resultat = Array.isArray(execution) ? execution.findLast(m => m.type === 'result') : null;
  if (outcome !== 'success' || conclusion !== 'success' || !resultat || resultat.subtype !== 'success' || resultat.is_error !== false) {
    const erreur = JSON.stringify(resultat?.errors || resultat?.result || '');
    r.reason = /quota|usage limit|rate.limit|allowance|out of.*usage/i.test(erreur) ? 'quota' : 'provider_error';
    return r;
  }
  try {
    verifier(typeof sortie === 'string' && Buffer.byteLength(sortie) <= LIMITES.resultat, 'résultat trop volumineux');
    Object.assign(r, validerResultat(JSON.parse(sortie), contexte));
    r.status = r.verdict === 'incomplete' ? 'unavailable' : 'reviewed';
    if (r.status === 'unavailable') { r.reason = 'incomplete'; r.verdict = null; r.findings = []; }
  } catch (err) { r.reason = masquer(err.message); }
  return r;
}
function validerEnveloppe(r, env) {
  const ident = identite(env);
  verifier(r.schema_version === 1 && r.repository === ident.repository && r.run_id === ident.run_id && r.run_attempt === ident.run_attempt, 'provenance du verdict invalide');
  verifier(Number.isSafeInteger(r.pr) && r.pr > 0 && SHA.test(r.head_sha) && SHA.test(r.base_sha), 'cible du verdict invalide');
  verifier(!env.INPUT_PR || env.INPUT_PR === String(r.pr), 'numéro de PR inattendu');
  verifier(['reviewed', 'unavailable'].includes(r.status), 'statut invalide');
  verifier(typeof r.summary === 'string' && r.summary.length <= 5000 && Array.isArray(r.findings) && r.findings.length <= 20, 'enveloppe trop volumineuse');
  verifier(r.status !== 'reviewed' || ['approved', 'changes_requested'].includes(r.verdict), 'verdict absent');
  verifier(r.status !== 'reviewed' || r.verdict !== 'approved' || r.findings.length === 0, 'approbation incohérente');
  verifier(r.status !== 'reviewed' || r.verdict !== 'changes_requested' || r.findings.length > 0, 'correction incohérente');
}
async function publier({ env, resultat, api = gh }) {
  validerEnveloppe(resultat, env);
  const r = { ...resultat }, repo = r.repository;
  const defaut = (await api(`repos/${repo}`)).default_branch;
  const pr = await api(`repos/${repo}/pulls/${r.pr}`);
  if (pr.state !== 'open' || pr.draft) return { published: false, status: 'closed' };
  verifier(pr.head?.repo?.full_name === repo && pr.base?.repo?.full_name === repo && pr.base.ref === defaut, 'PR externe ou cible modifiée');
  if (pr.head.sha !== r.head_sha || pr.base.sha !== r.base_sha) { r.status = 'stale'; r.verdict = null; r.findings = []; }
  const marqueur = `<!-- github-review:v1:${r.head_sha}:${r.base_sha}:${r.run_id}:${r.run_attempt} -->`;
  const commentaires = await api(`repos/${repo}/issues/${r.pr}/comments?per_page=100`, { pages: true });
  if (commentaires.some(c => c.user?.login === 'github-actions[bot]' && c.body?.includes(marqueur))) return { published: false, status: 'duplicate' };
  const revues = await api(`repos/${repo}/pulls/${r.pr}/reviews?per_page=100`, { pages: true });
  if (revues.some(c => c.user?.login === 'github-actions[bot]' && c.commit_id === r.head_sha && c.body?.includes(marqueur))) return { published: false, status: 'duplicate' };
  const actuel = await api(`repos/${repo}/pulls/${r.pr}`);
  if (actuel.state !== 'open' || actuel.draft) return { published: false, status: 'closed' };
  verifier(actuel.head?.repo?.full_name === repo && actuel.base?.repo?.full_name === repo && actuel.base.ref === defaut, 'PR externe ou cible modifiée');
  if (actuel.head.sha !== r.head_sha || actuel.base.sha !== r.base_sha) { r.status = 'stale'; r.verdict = null; r.findings = []; }
  const titre = r.status === 'stale' ? 'PÉRIMÉE' : r.status !== 'reviewed' ? 'INDISPONIBLE' : r.verdict === 'approved' ? 'APPROUVÉ' : 'CORRECTIONS DEMANDÉES';
  const lignes = [marqueur, '## Revue Claude', '', `**Verdict : ${titre}** — consultatif.`, '', `Commit relu : \`${r.head_sha}\` · base : \`${r.base_sha}\`.`,
    `Exécution : https://github.com/${repo}/actions/runs/${r.run_id}/attempts/${r.run_attempt}`, ''];
  if (r.status === 'reviewed') {
    lignes.push(masquer(r.summary));
    for (const f of r.findings) {
      verifier(cheminValide(f.path) && Number.isInteger(f.line) && f.line > 0 && ['LEFT', 'RIGHT'].includes(f.side) && ['P0', 'P1', 'P2', 'P3'].includes(f.priority), 'constat publié invalide');
      const ref = f.side === 'LEFT' ? r.merge_base_sha : r.head_sha;
      const source = f.source_path || f.path;
      verifier(SHA.test(ref) && cheminValide(source), 'référence de constat invalide');
      lignes.push('', `- **${f.priority} · ${masquer(f.title)}** — [${f.path}:${f.line}](https://github.com/${repo}/blob/${ref}/${source.split('/').map(encodeURIComponent).join('/')}#L${f.line})`, `  ${masquer(f.body)}`);
    }
  } else lignes.push(r.status === 'stale' ? 'La tête ou la base a changé. Ce résultat ne vaut pas pour la PR courante ; relancer la revue.' : `Aucune approbation. Motif : ${masquer(r.reason || 'résultat absent')}. Une absence de constat ne prouve pas une revue réussie.`);
  if (r.status === 'reviewed') {
    // Une revue COMMENT reste consultative ; les constats inline conservent les
    // conversations non résolues qui bloquent déjà la fusion dans le gate existant.
    const revue = await api(`repos/${repo}/pulls/${r.pr}/reviews`, { corps: {
      commit_id: r.head_sha, event: 'COMMENT', body: lignes.join('\n'),
      comments: r.findings.map(f => ({ path: f.path, side: f.side, line: f.line,
        body: `**${f.priority} · ${masquer(f.title)}**\n\n${masquer(f.body)}` }))
    } });
    return { published: true, status: r.status, verdict: r.verdict, review_id: revue.id };
  }
  const commentaire = await api(`repos/${repo}/issues/${r.pr}/comments`, { corps: { body: lignes.join('\n') } });
  return { published: true, status: r.status, verdict: r.verdict, comment_id: commentaire.id };
}
function sorties(donnees) {
  if (process.env.GITHUB_OUTPUT) for (const [k, v] of Object.entries(donnees)) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
}
async function main() {
  const env = process.env, dossier = path.resolve('.review-input');
  if (process.argv[2] === 'prepare') {
    const contexte = await preparer({ env, event: lireJson(env.GITHUB_EVENT_PATH), dossier });
    sorties({ ready: String(contexte.ready), schema: JSON.stringify(SCHEMA) });
  } else if (process.argv[2] === 'finalize') {
    let execution;
    try { execution = lireJson(env.EXECUTION_FILE || path.join(env.RUNNER_TEMP, 'claude-execution-output.json')); } catch {}
    const r = finaliser({ contexte: lireJson(path.join(dossier, 'context.json')), sortie: env.STRUCTURED_OUTPUT, execution, outcome: env.AGENT_OUTCOME, conclusion: env.AGENT_CONCLUSION });
    fs.mkdirSync('.review-result', { recursive: true });
    fs.writeFileSync('.review-result/verdict.json', JSON.stringify(r, null, 2));
    sorties({ reviewed: String(r.status === 'reviewed') });
  } else if (process.argv[2] === 'publish') {
    const r = await publier({ env, resultat: lireJson('.review-result/verdict.json', LIMITES.resultat) });
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `Revue : ${r.status} · ${r.verdict || 'aucune approbation'}.\n`);
  } else throw new Error('commande inconnue');
}
module.exports = { SCHEMA, LIMITES, masquer, lignesModifiees, preparer, validerResultat, finaliser, publier, validerEnveloppe };
if (require.main === module) main().catch(err => { console.error(masquer(err.message)); process.exitCode = 1; });
