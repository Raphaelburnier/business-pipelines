const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cycle = require("../src/cycle");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const T0 = Date.parse("2026-08-19T12:00:00.000Z");
const PERIME = Date.parse("2026-08-20T00:30:00.000Z"); // 13,5 h après la collecte, au-delà des 12 h
const PIPELINES = path.join(__dirname, "..", "pipelines");

// Deux actions, pour que « partiellement décidé » soit un état représentable : avec une
// seule action, décider revient toujours à tout décider, et la règle qui distingue les
// deux ne serait jamais exercée.
const ACTIONS = [
  { id: "prix-001", type: "changement_prix", cible: "v1|1|0", valeur: { de: 100, vers: 90, devise: "EUR" } },
  { id: "prix-002", type: "changement_prix", cible: "v1|2|0", valeur: { de: 200, vers: 180, devise: "EUR" } },
];

function bac({ vide = false, planAbsent = false, decisions = [], appliquerAvec = "ajustement-prix-appliquer" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cycle-"));
  if (vide) {
    fs.writeFileSync(path.join(dir, "EN-ATTENTE.json"), JSON.stringify({ en_attente: [] }));
    return dir;
  }

  const registre = path.join(dir, "ajustement-prix.decisions.json");
  const planGele = path.join(dir, "ajustement-prix.plan.json");

  if (!planAbsent) {
    fs.writeFileSync(
      planGele,
      JSON.stringify({
        empreinte: "abc123",
        gele_le: "2026-08-19T11:30:00.000Z",
        collecte_le: "2026-08-19T11:00:00.000Z",
        actions: ACTIONS,
      })
    );
  }

  if (decisions.length > 0) {
    fs.writeFileSync(
      registre,
      JSON.stringify({
        plan: "abc123",
        decisions: decisions.map((id) => ({ action_id: id, decision: "approuve", par: "raphael" })),
      })
    );
  }

  fs.writeFileSync(
    path.join(dir, "EN-ATTENTE.json"),
    JSON.stringify({
      en_attente: [
        {
          dossier: "ajustement-prix",
          empreinte: "abc123",
          depuis: "2026-08-19T11:30:00.000Z",
          actions: ACTIONS.length,
          registre,
          plan_gele: planGele,
          appliquer_avec: appliquerAvec,
        },
      ],
    })
  );
  return dir;
}

const prochaine = (dir, maintenant = T0) =>
  cycle.prochaine({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant });

test("rien en attente : c'est le seul moment où planifier ne piétine personne", () => {
  assert.strictEqual(prochaine(bac({ vide: true })).action, "planifier");
});

test("une décision en cours n'est JAMAIS replanifiée sous les doigts de celui qui décide", () => {
  const d = prochaine(bac({ decisions: ["prix-001"] }));
  assert.strictEqual(d.action, "attendre", "replanifier changerait l'empreinte et ferait refuser son clic");
  assert.match(d.raison, /1 action\(s\) décidée\(s\) sur 2/);
});

test("aucune décision encore prise, plan frais : on attend aussi", () => {
  assert.strictEqual(prochaine(bac()).action, "attendre");
});

test("tout est décidé : on applique, avec le pipeline que la demande désigne", () => {
  const d = prochaine(bac({ decisions: ["prix-001", "prix-002"] }));
  assert.strictEqual(d.action, "appliquer");
  assert.strictEqual(d.dossier.appliquer_avec, "ajustement-prix-appliquer");
});

test("tout décidé mais la demande ne dit pas quoi lancer : on refuse de choisir à sa place", () => {
  const d = prochaine(bac({ decisions: ["prix-001", "prix-002"], appliquerAvec: null }));
  assert.strictEqual(d.action, "attendre");
  assert.match(d.raison, /ne dit pas quel pipeline/);
});

test("périmé et jamais décidé : on attend, replanifier dépenserait pour personne", () => {
  const d = prochaine(bac(), PERIME);
  assert.strictEqual(d.action, "attendre", "sinon le planificateur est repayé toutes les 12 h, indéfiniment");
  assert.match(d.raison, /jamais décidé/);
});

test("périmé alors que quelqu'un avait commencé à décider : on lui redonne un plan frais", () => {
  const d = prochaine(bac({ decisions: ["prix-001"] }), PERIME);
  assert.strictEqual(d.action, "replanifier", "sa décision porte sur des données mortes");
  assert.match(d.raison, /données mortes/);
});

test("périmé et tout décidé : on replanifie plutôt que d'exécuter des montants morts", () => {
  const d = prochaine(bac({ decisions: ["prix-001", "prix-002"] }), PERIME);
  assert.strictEqual(d.action, "replanifier", "le chargement refuserait ce plan de toute façon");
});

test("une demande dont le plan gelé a disparu ne peut pas aboutir : on replanifie", () => {
  const d = prochaine(bac({ planAbsent: true }));
  assert.strictEqual(d.action, "planifier");
  assert.match(d.raison, /plan gelé introuvable/);
});

// --- La retenue après une planification stérile ---------------------------------------
//
// Une planification qui ne propose rien laisse la boîte vide, donc indiscernable d'une
// boîte vide de premier tour. Sans ces tests, la règle qui les distingue n'existe que dans
// un commentaire, et c'est celle qui décide si le cycle dépense.

// Le marqueur que le stage d'approbation dépose quand le plan est vide.
function marquerSterile(dir, dossier, quand) {
  fs.writeFileSync(
    path.join(dir, `${dossier}.retenue.json`),
    JSON.stringify({ dossier, le: new Date(quand).toISOString(), collecte_le: null })
  );
  return dir;
}

const DOSSIER = "ajustement-prix";
const avecDossier = (dir, maintenant = T0) =>
  cycle.prochaine({ approvalsDir: dir, pipelinesDir: PIPELINES, dossier: DOSSIER, maintenant });

test("une planification stérile récente retient le cycle au lieu de la repayer", () => {
  const dir = marquerSterile(bac({ vide: true }), DOSSIER, T0 - 2 * 3600 * 1000);
  const d = avecDossier(dir);
  assert.strictEqual(d.action, "attendre", "replanifier relirait le même marché pour le même rien");
  assert.match(d.raison, /n'a proposé aucune action/);
});

test("passé le délai, le cycle reprend : une retenue n'est pas un arrêt", () => {
  const dir = marquerSterile(bac({ vide: true }), DOSSIER, T0 - 7 * 3600 * 1000);
  assert.strictEqual(avecDossier(dir).action, "planifier");
});

test("une retenue ne s'applique qu'à son dossier", () => {
  const dir = marquerSterile(bac({ vide: true }), "un-autre-marche", T0 - 1 * 3600 * 1000);
  assert.strictEqual(avecDossier(dir).action, "planifier", "le marqueur d'un autre marché ne dit rien de celui-ci");
});

test("sans nom de dossier, le cycle planifie comme avant plutôt que de se taire", () => {
  // Une configuration incomplète doit dégrader vers le comportement d'origine. L'inverse
  // donnerait un cycle qui ne planifie plus jamais sans qu'aucune ligne ne le dise.
  const dir = marquerSterile(bac({ vide: true }), DOSSIER, T0 - 1 * 3600 * 1000);
  assert.strictEqual(prochaine(dir).action, "planifier");
});

test("un marqueur illisible ne retient rien : on ne devine pas ce qu'il disait", () => {
  const dir = bac({ vide: true });
  fs.writeFileSync(path.join(dir, `${DOSSIER}.retenue.json`), JSON.stringify({ dossier: DOSSIER }));
  assert.strictEqual(avecDossier(dir).action, "planifier", "sans date, la retenue n'a pas d'origine");
});

test("une demande en attente l'emporte sur la retenue : il y a mieux à faire que planifier", () => {
  // La retenue ne gouverne que la branche « rien n'attend ». Un dossier à décider doit
  // continuer d'être vu, sinon un marqueur oublié gèlerait une décision en cours.
  const dir = marquerSterile(bac({ decisions: ["prix-001"] }), DOSSIER, T0 - 1 * 3600 * 1000);
  const d = avecDossier(dir);
  assert.strictEqual(d.action, "attendre");
  assert.match(d.raison, /décidée\(s\) sur 2/);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✘ ${name}\n    ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests cycle OK`);
  process.exit(failed ? 1 : 0);
})();
