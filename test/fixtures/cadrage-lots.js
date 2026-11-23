// Les tests historiques exercent réservation, sensibilité et multi-dépôts.
// Leur cadrage est synthétique et uniquement en mémoire : aucun ancien objectif
// de production ne devient lançable pour conserver un scénario de test.
const feuille = require("../../web/src/avenir/feuille.json");
let utilisateurs = 0;
let restaurations = [];
function installer() {
  if (utilisateurs++ === 0) {
    for (const id of ["3.7", "3.8", "10.2"]) {
      const e = feuille.lots.flatMap(l => l.etapes).find(e => e.id === id);
      const avant = { cadrage: e.cadrage, suivi: e.suivi };
      restaurations.push(() => { e.cadrage = avant.cadrage; e.suivi = avant.suivi; });
      e.cadrage = { revision: 1, criteres: ["Le résultat du scénario synthétique est vérifié."],
        directives: ["Conserver les données synthétiques du test."], exclusions: ["Aucun fournisseur réel."],
        dependances: [], cloture: { fusionRequise: true, recetteRequise: true } };
      e.suivi = { phase: "a-faire", attente: null, preuves: [] };
    }
  }
  return () => { if (--utilisateurs === 0) { for (const restaurer of restaurations) restaurer(); restaurations = []; } };
}
module.exports = { installer };
