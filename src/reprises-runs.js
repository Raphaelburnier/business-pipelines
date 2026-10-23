// Point d'intégration isolé du runner : la reprise n'est jamais un run.start et
// réutilise le lancement figé, y compris après redémarrage et après une autre mission.
const { raisonEchec } = require("./echec-run");

async function reprendreRun({ store, commande, lancer, lancementDe, machineDisponible }) {
  const runId = commande.payload.runId;
  if (!store.attentes.validerCommande(commande, Date.now(), { machineDisponible })) {
    return { ok: true, detail: { runId, dejaTraitee: true } };
  }
  const run = store.run(runId);
  const lancement = lancementDe(store, run);
  const resultat = await lancer(lancement, { reprendre: true, runId });
  if (![0, 75, 76, 77, 78].includes(resultat.code)) throw new Error(raisonEchec(store, runId, resultat));
  return { ok: true, detail: { ...resultat, runId } };
}
// Une panne entre l'acquittement et la libération de l'attente ne doit pas laisser
// active_command_id lié à une commande déjà terminée. Au redémarrage, tout est encore
// réservé et rejouable, ou tout est acquitté, jamais seulement la moitié.
function terminerReprise({ store, commande, resultat }) {
  store.db.exec("BEGIN IMMEDIATE");
  try {
    store.terminerCommande(commande.id, resultat);
    store.attentes.terminer(commande);
    store.db.exec("COMMIT");
  } catch (err) { store.db.exec("ROLLBACK"); throw err; }
}
module.exports = { reprendreRun, terminerReprise };
