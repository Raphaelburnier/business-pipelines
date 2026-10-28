const { arreterProcessus } = require("./arret-processus");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function attendreCommande(store, id, delaiMs = 12000) {
  const fin = performance.now() + delaiMs;
  do {
    const c = store.commande(id);
    if (["done", "refused"].includes(c?.status)) {
      if (c.status !== "done" || c.resultat?.detail?.arretConfirme !== true) throw new Error(c.resultat?.raison || "arrêt distant non confirmé");
      return;
    }
    if (performance.now() >= fin) throw new Error("arrêt distant non confirmé : maître indisponible");
    await pause(25);
  } while (true);
}

async function traiterControle({ store, commande, enfants, arreter = arreterProcessus }) {
  if (commande.kind === "execution.pause") return store.controle.appliquerPause(commande);
  const detail = store.controle.demanderAnnulation(commande);
  if (detail.dejaTermine) { store.terminerCommande(commande.id, { ok: true, detail }); return; }
  const runId = detail.runId;
  const locaux = [...enfants].filter(p => (p.lancement?.runId || store.commande(p.lancement?.commandId)?.run_id) === runId);
  const distants = store.etapes(runId).filter(e => e.status === "running" && e.machine_id && e.machine_id !== store.machineId);
  const controles = distants.map(e => store.creerCommande({ kind: "step.cancel", payload: { machine: e.machine_id, stepId: e.id, confirmer: true }, par: commande.par, canal: commande.canal }));
  try {
    await Promise.all([...locaux.map(p => arreter(p)), ...controles.map(c => attendreCommande(store, c.id))]);
    // Une CLI orpheline s'arrête en observant le marqueur ; sa fin d'étape reste requise.
    const fin = performance.now() + 10000;
    while (!locaux.length && store.etapes(runId).some(e => e.status === "running" && (!e.machine_id || e.machine_id === store.machineId))) {
      if (performance.now() >= fin) throw new Error("arrêt local non confirmé : exécution hors du runner");
      await pause(25);
    }
    store.controle.finaliserAnnulation(commande);
  } catch (err) {
    store.emettre({ type: "run.cancel_unconfirmed", runId, payload: { commandeId: commande.id, raison: err.message } });
    throw err;
  }
}
module.exports = { traiterControle };
