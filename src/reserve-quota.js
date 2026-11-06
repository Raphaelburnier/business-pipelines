const path = require('node:path');
const registre = require('agent-orchestrator/src/registre');

// Les missions portent déjà leur résolution figée. Les anciens lancements CLI
// utilisent le même résolveur et les mêmes surcharges que leur exécution.
function verifierLancement(store, lancement, { projetsDir = path.join(__dirname, '..', 'projects'), registreDir = registre.dossierRegistre(), maintenant = Date.now() } = {}) {
  if (!store?.reserveQuota?.bloque(maintenant)) return;
  const r = lancement?.mission?.resolution || registre.resoudreProjet(path.join(projetsDir, lancement.projectId, 'project.json'), {
    index: lancement.pipelineIndex || 0, lancement: lancement.llmOverrides || {}, registre: registreDir,
  });
  for (const n of r.pipeline.nodes.filter(n => !n.disabled && ['agent', 'review'].includes(n.type))) {
    store.reserveQuota.verifier(n.llm || r.agents[n.agent]?.defaultLlm, maintenant);
  }
}
// Le publieur détient déjà la clé du cockpit ; le runner ne la reçoit pas.
// Le journal et l'acquittement atomiques du moteur dédupliquent le rejeu après crash,
// y compris après un redémarrage du publieur (pas de registre de nonces en mémoire).
function traiterReglage({ store, commande, cleSignature, autorises, journal = console.warn }) {
  const signature = require('./signature-commandes');
  if (commande.kind !== 'quota.reserve.set') throw new Error('commande de réserve attendue');
  const preuve = signature.verifier(cleSignature, commande);
  if (!preuve.ok || !autorises.has(commande.par)) {
    return store.terminerCommande(commande.id, { ok: false, raison: preuve.ok ? 'Réglage réservé à l’opérateur' : preuve.raison });
  }
  if (preuve.transition) journal('Réglage de réserve sans vérification HMAC : mode transition existant, clé absente.');
  return store.reserveQuota.appliquer(commande);
}
function servirReglages({ store, cleSignature, lireAutorises, intervalleMs = 250, journal = console.warn }) {
  store.reprendreCommandesInterrompues({ kinds: ['quota.reserve.set'] });
  const t = setInterval(() => {
    let c;
    try {
      c = store.prendreCommande({ kinds: ['quota.reserve.set'] });
      if (c) traiterReglage({ store, commande: c, cleSignature, autorises: lireAutorises(), journal });
    } catch (err) {
      if (c) store.terminerCommande(c.id, { ok: false, raison: err.message });
      journal(`Réglage de réserve non appliqué : ${err.message}`);
    }
  }, intervalleMs);
  return { arreter() { clearInterval(t); } };
}
module.exports = { verifierLancement, traiterReglage, servirReglages };
