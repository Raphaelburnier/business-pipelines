#!/usr/bin/env node
// Client opérateur : les commandes restent signées et appliquées par le cockpit.
// Aucun accès à la base, à SSH ou aux clés depuis ce client.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const AIDE = `Usage : agent-reserve <claude|codex> [1..100|off|status] [--json]
  75       fixe le seuil à 75 % consommés et active la réserve
  off      désactive la réserve en gardant le seuil choisi
  status   affiche l’état, sans modification (action par défaut)
Configuration : COCKPIT_RESERVE_URL ou ~/.config/agent-reserve/config.json.
`;

function analyser(args) {
  const json = args.includes('--json');
  const mots = args.filter(a => a !== '--json');
  if (!mots.length || (mots.length === 1 && ['--help', '-h'].includes(mots[0]))) return { aide: true };
  if (mots.length > 2 || !['claude', 'codex'].includes(mots[0])) throw new Error(AIDE.trim());
  const action = mots[1] || 'status';
  if (!['status', 'off'].includes(action) && !/^(?:[1-9][0-9]?|100)%?$/.test(action)) throw new Error('Seuil attendu : entier de 1 à 100, ou off / status.');
  return { runtime: mots[0], action, seuil: /^\d/.test(action) ? Number(action.replace('%', '')) : null, json };
}

function urlCockpit(brut) {
  let url;
  try { url = new URL(brut); } catch { throw new Error('URL du cockpit absente ou invalide : configurer COCKPIT_RESERVE_URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  // L'opérateur ne doit pas envoyer ses commandes à un service public ou via une redirection.
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' && url.hostname.endsWith('.ts.net') || local && ['http:', 'https:'].includes(url.protocol))) {
    throw new Error('Utiliser la racine HTTPS du cockpit sur le tailnet, sans identifiants ; loopback accepté pour les tests locaux.');
  }
  return url.origin;
}

function configuration(valeur) {
  const c = valeur?.configuration;
  if (!c || typeof c.active !== 'boolean' || !(c.seuilUtilise === null || Number.isInteger(c.seuilUtilise) && c.seuilUtilise >= 1 && c.seuilUtilise <= 100) || c.active && c.seuilUtilise === null) {
    throw new Error('Réponse de réserve invalide : aucune modification envoyée automatiquement.');
  }
  return { active: c.active, seuilUtilise: c.seuilUtilise };
}

async function executer(args, options = {}) {
  const demande = analyser(args);
  const sortie = options.sortie || console.log;
  if (demande.aide) { sortie(AIDE.trimEnd()); return 0; }
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const fichier = path.join(home, '.config/agent-reserve/config.json');
  let adresse = env.COCKPIT_RESERVE_URL;
  if (!adresse) {
    try { adresse = JSON.parse(fs.readFileSync(fichier, 'utf8')).url; }
    catch { throw new Error('Configurer COCKPIT_RESERVE_URL ou installer la commande avec --cockpit-url.'); }
  }
  const base = urlCockpit(adresse);
  const requete = options.fetch || globalThis.fetch;
  const delaiMs = options.delaiMs ?? 5000;
  const attendreMs = options.attendreMs ?? 15000;
  const intervalleMs = options.intervalleMs ?? 250;
  const nom = demande.runtime === 'codex' ? 'Codex' : 'Claude';
  const route = `/api/quota/reserve-${demande.runtime}`;
  const appeler = async (chemin, corps) => {
    let r;
    try {
      r = await requete(base + chemin, { method: corps ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(delaiMs), headers: { accept: 'application/json', ...(corps ? { 'content-type': 'application/json' } : {}) },
        ...(corps ? { body: JSON.stringify(corps) } : {}) });
    } catch {
      throw new Error(corps ? 'Réponse du cockpit perdue. Vérifier status avant de réessayer ; aucune relance automatique du réglage.' : 'Cockpit injoignable ou certificat non valide. Vérifier le tailnet et l’adresse configurée.');
    }
    if (!r.ok) {
      if (r.status === 404) throw new Error(`Réserve ${nom} indisponible sur ce cockpit : vérifier sa version livrée.`);
      if ([401, 403].includes(r.status)) throw new Error('Accès opérateur refusé par le cockpit. Utiliser la connexion tailnet autorisée.');
      throw new Error(`Cockpit : HTTP ${r.status}. Aucun réglage appliqué n’est confirmé.`);
    }
    try { return { status: r.status, data: await r.json() }; }
    catch { throw new Error('Réponse du cockpit illisible. Vérifier status avant toute nouvelle demande.'); }
  };
  const lire = async () => {
    const e = (await appeler(route)).data;
    return { ...e, configuration: configuration(e) };
  };
  const afficher = (etat, commande = null) => {
    const c = etat.configuration;
    if (demande.json) {
      sortie(JSON.stringify({ runtime: demande.runtime, configuration: c, etat: etat.etat,
        mesure: etat.mesure ?? null, modificationEnCours: etat.modificationEnCours ?? null, commande }));
    } else {
      sortie(`Réserve ${nom} : ${c.active ? 'active' : 'désactivée'} ; seuil ${c.seuilUtilise === null ? 'non défini' : c.seuilUtilise + ' % consommés'}.`);
      if (etat.mesure) sortie(`Consommation observée : ${etat.mesure.utilisation} %.`);
      if (etat.etat === 'mesure-inconnue') sortie('Nouveaux appels en attente d’une mesure récente.');
      if (etat.etat === 'seuil-atteint') sortie('Seuil atteint : nouveaux appels en attente.');
      if (etat.modificationEnCours) sortie('Une modification est encore en attente d’application.');
      if (commande) sortie(`Commande ${commande.id} acquittée par le cockpit.`);
    }
  };
  const avant = await lire();
  if (demande.action === 'status') { afficher(avant); return 0; }
  if (avant.autorise !== true) throw new Error('Réglage réservé à l’opérateur ; aucune commande envoyée.');
  if (avant.modificationEnCours) throw new Error('Un réglage de ce fournisseur est déjà en attente. Relire status avant de réessayer.');
  const cible = demande.action === 'off' ? { active: false, seuilUtilise: avant.configuration.seuilUtilise } : { active: true, seuilUtilise: demande.seuil };
  const reponse = await appeler(route, cible);
  const id = reponse.data?.id;
  if (reponse.status !== 202 || typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Acquittement initial invalide. Relire status ; ne pas renvoyer le réglage automatiquement.');
  }
  const fin = Date.now() + attendreMs;
  do {
    const c = (await appeler('/api/commands/' + encodeURIComponent(id))).data?.commande;
    if (!c || c.id !== id) throw new Error('Commande retournée incohérente. Relire status avant toute nouvelle demande.');
    if (c.statut === 'refused' || c.resultat?.ok === false) throw new Error(`Réglage refusé par le cockpit (commande ${id}).`);
    if (c.statut === 'done') {
      if (c.resultat?.ok !== true) throw new Error('Application du réglage non confirmée. Relire status.');
      const apres = await lire(); afficher(apres, { id, statut: 'done' });
      if (apres.configuration.active !== cible.active || apres.configuration.seuilUtilise !== cible.seuilUtilise) {
        throw new Error('Commande acquittée, mais le réglage actuel a changé. Aucune nouvelle écriture automatique.');
      }
      return 0;
    }
    if (!['pending', 'taken'].includes(c.statut)) throw new Error('État de commande inconnu ; application non confirmée.');
    if (Date.now() >= fin) break;
    await new Promise(resolve => setTimeout(resolve, intervalleMs));
  } while (Date.now() <= fin);
  throw new Error(`Réglage envoyé mais encore en attente (commande ${id}). Relire status, sans renvoyer la commande.`);
}

if (require.main === module) executer(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { executer, analyser, urlCockpit, AIDE };
