#!/usr/bin/env node
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { urlCockpit } = require('./reserve-quota');
const ID = 'agent-reserve-v1';
const citer = s => "'" + s.replace(/'/g, "'\"'\"'") + "'";

function installer({ home = os.homedir(), url = null, racine = path.resolve(__dirname, '..') } = {}) {
  const base = path.join(home, '.local/share/agent-reserve');
  const manifeste = path.join(base, 'installation.json');
  const commande = path.join(home, '.local/bin/agent-reserve');
  const config = path.join(home, '.config/agent-reserve/config.json');
  let ancien = null;
  if (fs.existsSync(base)) {
    try { ancien = JSON.parse(fs.readFileSync(manifeste, 'utf8')); } catch { throw new Error('Installation existante non reconnue : aucun fichier remplacé.'); }
    if (ancien.id !== ID) throw new Error('Installation existante non reconnue : aucun fichier remplacé.');
  }
  const lstat = p => { try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
  const cibleCommande = path.join(base, 'reserve-quota.js');
  const wrapper = '#!/bin/sh\n# ' + ID + '\nexec node ' + citer(cibleCommande) + ' "$@"\n';
  const liens = ['claude', 'codex'].map(runtime => ({ runtime, lien: path.join(home, '.' + runtime, 'skills/reserve'), cible: path.join(base, 'skills', runtime, 'reserve') }));
  const fichiers = [commande, cibleCommande, manifeste, ...liens.flatMap(x => [path.join(x.cible, 'SKILL.md'), ...(x.runtime === 'codex' ? [path.join(x.cible, 'agents/openai.yaml')] : [])]), ...(url ? [config] : [])];
  // Ne pas remplacer un fichier étranger, même sous notre nom de commande.
  for (const fichier of fichiers) {
    const st = lstat(fichier);
    if (st && (!ancien?.fichiers?.includes(fichier) || st.isSymbolicLink() || !st.isFile())) throw new Error('Un fichier d’installation appartient à une autre configuration : aucun fichier remplacé.');
  }
  for (const l of liens) {
    const st = lstat(l.lien);
    if (st && (!st.isSymbolicLink() || path.resolve(path.dirname(l.lien), fs.readlinkSync(l.lien)) !== l.cible)) throw new Error('Un skill reserve existe déjà : aucun fichier remplacé.');
  }
  const adresse = url ? urlCockpit(url) : null;
  const modele = fs.readFileSync(path.join(racine, 'cli/reserve-skill.md'), 'utf8');
  const script = fs.readFileSync(path.join(racine, 'bin/reserve-quota.js'));
  function ecrire(fichier, contenu, mode = 0o600) { fs.mkdirSync(path.dirname(fichier), { recursive: true }); fs.writeFileSync(fichier, contenu, { mode }); }
  ecrire(cibleCommande, script, 0o700); ecrire(commande, wrapper, 0o700);
  for (const l of liens) {
    const contenu = modele.replaceAll('{{RUNTIME}}', l.runtime).replaceAll('{{FOURNISSEUR}}', l.runtime === 'codex' ? 'Codex' : 'Claude')
      .replace('{{FRONTMATTER}}', l.runtime === 'claude' ? 'disable-model-invocation: true\nargument-hint: "[1..100|off|status]"' : '')
      .replace('{{ARGUMENTS}}', l.runtime === 'claude' ? '$ARGUMENTS' : 'lire les arguments de la demande explicite qui invoque $reserve.');
    ecrire(path.join(l.cible, 'SKILL.md'), contenu);
    if (l.runtime === 'codex') ecrire(path.join(l.cible, 'agents/openai.yaml'), '# Réglage opérateur : uniquement sur invocation explicite de la commande.\npolicy:\n  allow_implicit_invocation: false\n');
    fs.mkdirSync(path.dirname(l.lien), { recursive: true });
    if (!lstat(l.lien)) fs.symlinkSync(l.cible, l.lien, 'dir');
  }
  if (adresse) ecrire(config, JSON.stringify({ url: adresse }, null, 2) + '\n');
  ecrire(manifeste, JSON.stringify({ id: ID, fichiers: [...new Set([...(ancien?.fichiers || []), ...fichiers])] }, null, 2) + '\n');
  return { commande, skills: liens.map(l => l.lien), configure: Boolean(adresse || fs.existsSync(config)) };
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--cockpit-url')) throw new Error('Usage : node bin/installer-reserve.js [--cockpit-url https://<cockpit-tailnet>]');
    const r = installer({ url: args[1] });
    console.log('Commande agent-reserve et raccourcis reserve installés pour Claude Code et Codex.');
    if (!r.configure) console.log('Configurer COCKPIT_RESERVE_URL avant utilisation.');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { installer };
