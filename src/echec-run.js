// La raison d'un run en échec telle que le moteur l'a écrite dans `run.finished`, plutôt que
// le code de sortie de orch.js, qui ne dit que « 1 ». Seule la fin écrite depuis ce lancement
// compte : un run repris garde dans son journal l'erreur de ses segments précédents.

/**
 * @param {any} store l'event store du moteur
 * @param {string|null} runId
 * @param {{ code: number|null, erreur?: string, debut?: string }} resultat ce que rend le lancement
 * @returns {string}
 */
function raisonEchec(store, runId, resultat) {
  if (resultat.erreur) return resultat.erreur;
  const fins = runId ? store.evenements({ runId }).filter((e) => e.type === "run.finished" && (!resultat.debut || e.ts >= resultat.debut)) : [];
  const fin = fins.at(-1);
  const erreur = fin && fin.payload && fin.payload.status === "failed" ? fin.payload.error : null;
  return erreur ? String(erreur).split("\n")[0].slice(0, 500) : `processus terminé en code ${resultat.code}`;
}

module.exports = { raisonEchec };
