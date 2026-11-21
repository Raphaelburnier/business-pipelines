const { test } = require("node:test");
const assert = require("node:assert/strict");
const { creerCadreur, indexerFeuille, construireCadrage, validerEvolution } = require("../src/cadrage-lots.mjs");

function exemple() {
  const etape = { id: "1.2", titre: "Commande unique", detail: "x".repeat(1100),
    fichiers: ["BP src/demo.js"], statut: "a-faire",
    cadrage: { revision: 1, criteres: ["Un double clic crée une seule commande.", "Le résultat reste lisible après rechargement."],
      directives: ["Utiliser la base temporaire."], exclusions: ["Aucune écriture en production."],
      dependances: ["1.1"], cloture: { fusionRequise: true, recetteRequise: true } },
    suivi: { phase: "a-faire", attente: null, preuves: [] } };
  const lot = { id: "1", titre: "Commandes", but: "Empêcher les doublons utilisateur.", etapes: [
    { id: "1.1", titre: "Prérequis historique", statut: "fait", fichiers: [] }, etape] };
  const feuille = { lots: [lot], defauts: [] };
  const catalogue = [{ id: "1.2", revision: 1, projet: "business-pipelines", fichiers: etape.fichiers }];
  return { feuille, catalogue, lot, etape, cadreur: creerCadreur(feuille, catalogue) };
}

test("deux critères restent séparés, le détail long et le but arrivent intégralement", () => {
  const { etape, lot } = exemple();
  const mission = construireCadrage(etape, lot, { criteres: ["Critère supplémentaire."] });
  assert.deepEqual(mission.criteres, [...etape.cadrage.criteres, "Critère supplémentaire."]);
  assert.ok(mission.document.includes(etape.detail));
  assert.ok(mission.document.includes(lot.but));
  assert.match(mission.document, /Dépendances : 1.1/);
  assert.deepEqual(construireCadrage(etape, lot, mission), mission, "normalisation idempotente");
});

test("un client qui retire les consignes reçoit quand même le socle canonique", () => {
  const { cadreur, etape } = exemple();
  const s = cadreur.cadrer("1.2", { criteres: [], directives: "", exclusions: "", document: "" });
  assert.deepEqual(s.criteres, etape.cadrage.criteres);
  assert.match(s.directives, /base temporaire/);
  assert.match(s.exclusions, /production/);
});

test("les dépendances sont relues après la présentation du plan", () => {
  const { cadreur, feuille } = exemple();
  assert.equal(cadreur.blocage("1.2"), null);
  feuille.lots[0].etapes[0].statut = "en-cours";
  assert.match(cadreur.blocage("1.2"), /dépendance non terminée : 1.1/);
  assert.throws(() => cadreur.cadrer("1.2", {}), /dépendance non terminée/);
});

test("dépendances inconnues, autoréférences, cycles et doublons sont refusés", () => {
  for (const deps of [["inconnue"], ["1.2"], ["1.1", "1.1"]]) {
    const { feuille, etape } = exemple(); etape.cadrage.dependances = deps;
    assert.throws(() => indexerFeuille(feuille), /inconnue|cycle|dupliquées/);
  }
  const { feuille, etape } = exemple();
  const autre = structuredClone(etape); autre.id = "1.3"; autre.cadrage.dependances = ["1.2"];
  etape.cadrage.dependances = ["1.3"]; feuille.lots[0].etapes.push(autre);
  assert.throws(() => indexerFeuille(feuille), /cycle/);
});

test("cadrage absent, état actif et référence périmée ne sont pas lançables", () => {
  const { cadreur, etape } = exemple();
  const c = etape.cadrage;
  delete etape.cadrage; delete etape.suivi;
  assert.match(cadreur.blocage("1.2"), /cadrage manquant/);
  etape.cadrage = c; etape.suivi = { phase: "developpement", attente: null, preuves: [] }; etape.statut = "en-cours";
  assert.match(cadreur.blocage("1.2"), /en cours ou fait/);
  etape.statut = "a-faire"; etape.suivi.phase = "a-faire"; c.revision = 2;
  assert.match(cadreur.blocage("1.2"), /révision périmée/);
});

test("phases incohérentes et blocages sans raison sont refusés", () => {
  const { feuille, etape } = exemple();
  etape.suivi.phase = "recette-attendue";
  assert.throws(() => indexerFeuille(feuille), /incohérents/);
  etape.statut = "en-cours"; etape.suivi.phase = "bloque";
  assert.throws(() => indexerFeuille(feuille), /blocage sans raison/);
  etape.suivi.attente = "Attente de la livraison opérateur.";
  assert.doesNotThrow(() => indexerFeuille(feuille));
});

test("clôture : preuves requises, bonne révision et même code vérifié", () => {
  const { feuille, etape } = exemple();
  etape.statut = "fait"; etape.suivi.phase = "clos";
  const preuve = type => ({ type, reference: "rapport-synthetique", revision: 1, commit: "a".repeat(40) });
  for (const type of ["verification", "fusion", "recette"]) {
    assert.throws(() => indexerFeuille(feuille), /clôture sans preuve/);
    etape.suivi.preuves.push(preuve(type));
  }
  assert.doesNotThrow(() => indexerFeuille(feuille));
  etape.suivi.preuves[2].commit = "b".repeat(40);
  assert.throws(() => indexerFeuille(feuille), /commits différents/);
  etape.suivi.preuves[2].revision = 2;
  assert.throws(() => indexerFeuille(feuille), /autre révision/);
});

test("dispense de recette motivée et limites des champs : aucun texte tronqué", () => {
  const { feuille, etape, lot } = exemple();
  etape.cadrage.cloture.recetteRequise = false;
  assert.throws(() => indexerFeuille(feuille), /dispense.*motivée/);
  etape.cadrage.cloture.motifDispenseRecette = "Document sans modification de production.";
  assert.doesNotThrow(() => indexerFeuille(feuille));
  assert.throws(() => construireCadrage(etape, lot, { criteres: ["x".repeat(1001)] }), /hors limites/);
  assert.throws(() => construireCadrage(etape, lot, { directives: "x".repeat(4001) }), /dépasse/);
});

test("la migration laisse les tâches anciennes visibles mais interdit leur départ", () => {
  const objectifs = require("../src/objectifs-avenirs");
  assert.throws(() => objectifs.cadrerMission({ projectId: "business-pipelines", criteres: [],
    contexte: { _roadmapObjective: { id: "3.6", revision: 1 } } }), /cadrage manquant/);
  assert.doesNotThrow(() => indexerFeuille(require("../web/src/avenir/feuille.json")));
});

test("un départ différé refuse un socle supprimé ou une nouvelle révision", () => {
  const restaurer = require("./fixtures/cadrage-lots").installer();
  try {
    const objectifs = require("../src/objectifs-avenirs");
    const ref = { id: "3.8", revision: 1 }, contexte = { _roadmapObjective: ref };
    const cadre = objectifs.cadrerMission({ projectId: "agent-orchestrator", criteres: [], contexte });
    const mission = { ...cadre, resolution: { projet: { id: "agent-orchestrator" },
      spec: { _mission: { projectId: "agent-orchestrator", objectifFeuille: ref } } } };
    assert.doesNotThrow(() => objectifs.verifierDepartMission(mission));
    assert.throws(() => objectifs.verifierDepartMission({ ...mission, criteres: [] }), /cadrage.*changé/);
    ref.revision = 2;
    assert.throws(() => objectifs.verifierDepartMission(mission), /révision périmée/);
    assert.doesNotThrow(() => objectifs.verifierDepartMission({ resolution: { spec: {} } }), "mission sans tâche système conservée");
  } finally { restaurer(); }
});

test("modifier le contenu ou les dépendances impose une nouvelle révision", () => {
  const { feuille, etape } = exemple(), avant = structuredClone(feuille);
  etape.cadrage.criteres.push("Un troisième résultat observable.");
  assert.throws(() => validerEvolution(avant, feuille), /incrémenter la révision/);
  etape.cadrage.revision++;
  assert.doesNotThrow(() => validerEvolution(avant, feuille));
});

test("les phases de suivi évoluent sans réécrire le cadrage", () => {
  const { feuille, etape } = exemple(), avant = structuredClone(feuille);
  etape.statut = "en-cours"; etape.suivi.phase = "fusion-attendue";
  assert.doesNotThrow(() => validerEvolution(avant, feuille));
});
