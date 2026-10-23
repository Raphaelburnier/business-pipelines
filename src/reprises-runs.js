// Point d'intégration isolé du runner : la reprise n'est jamais un run.start et
// réutilise le lancement figé, y compris après redémarrage et après une autre mission.
const { raisonEchec } = require("./echec-run");

async function reprendreRun({ store, commande, lancer, lancementDe }) {
  const runId = commande.payload.runId;
  if (!store.attentes.validerCommande(commande)) {
    return { ok: true, detail: { runId, dejaTraitee: true } };
  }
  const run = store.run(runId);
  const lancement = lancementDe(store, run);
  const resultat = await lancer(lancement, { reprendre: true, runId });
  if (![0, 75, 76, 77, 78].includes(resultat.code)) throw new Error(raisonEchec(store, runId, resultat));
  return { ok: true, detail: { ...resultat, runId } };
}
module.exports = { reprendreRun };
