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
