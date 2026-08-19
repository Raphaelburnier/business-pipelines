const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cockpit = require("../src/cockpit");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const T0 = Date.parse("2026-08-19T12:00:00.000Z");

// Un dossier d'approbations jetable, avec la boîte et le plan gelé tels que le moteur les
// écrit vraiment. Les tests lisent donc la forme de production, pas une forme inventée.
function bac({ empreinteBoite = "abc123", empreintePlan = "abc123", collecteLe = "2026-08-19T11:00:00.000Z", actions, decisions } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-"));
  const registre = path.join(dir, "ajustement-prix.decisions.json");
  const planGele = path.join(dir, "ajustement-prix.plan.json");

  fs.writeFileSync(
    path.join(dir, "EN-ATTENTE.json"),
    JSON.stringify({
      en_attente: [
        {
          dossier: "ajustement-prix",
          empreinte: empreinteBoite,
          depuis: "2026-08-19T11:30:00.000Z",
          actions: 1,
          registre,
          plan_gele: planGele,
          appliquer_avec: null,
        },
      ],
    })
  );

  fs.writeFileSync(
    planGele,
    JSON.stringify({
      empreinte: empreintePlan,
      gele_le: "2026-08-19T11:30:00.000Z",
      collecte_le: collecteLe,
      actions: actions || [
        {
          id: "prix-001",
          type: "changement_prix",
          cible: "v1|110590223642|0",
          valeur: { de: 499.99, vers: 240.99, devise: "USD" },
          justification: "hors marché",
          sources: ["v1|1|0"],
        },
      ],
    })
  );

  if (decisions) fs.writeFileSync(registre, JSON.stringify(decisions));
  return { dir, registre, planGele };
}

test("l'état montre les actions du plan gelé, pas le compte de la boîte", () => {
  const { dir } = bac();
  const e = cockpit.etat({ approvalsDir: dir, maintenant: T0 });
  assert.strictEqual(e.dossiers.length, 1);
  assert.strictEqual(e.dossiers[0].actions.length, 1);
  assert.strictEqual(e.dossiers[0].actions[0].justification, "hors marché", "le détail vient du plan");
  assert.strictEqual(e.dossiers[0].actions[0].decision, null);
});

test("une décision prise sur un autre plan n'est pas montrée comme prise", () => {
  const { dir } = bac({
    decisions: { plan: "AUTRE", decisions: [{ action_id: "prix-001", decision: "approuve" }] },
  });
  const e = cockpit.etat({ approvalsDir: dir, maintenant: T0 });
  assert.strictEqual(e.dossiers[0].actions[0].decision, null, "sinon on croit le travail fait");

  const { dir: dir2 } = bac({
    decisions: { plan: "abc123", decisions: [{ action_id: "prix-001", decision: "refuse" }] },
  });
  const e2 = cockpit.etat({ approvalsDir: dir2, maintenant: T0 });
  assert.strictEqual(e2.dossiers[0].actions[0].decision, "refuse", "la bonne empreinte, elle, compte");
});

test("la fraîcheur se mesure depuis la collecte, comme le moteur", () => {
  const plan = { collecte_le: "2026-08-19T00:00:00.000Z", gele_le: "2026-08-19T11:59:00.000Z" };
  const f = cockpit.fraicheur(plan, 12, T0);
  assert.strictEqual(f.age_heures, 12, "12 h depuis la collecte, pas 0.02 depuis le gel");
  assert.strictEqual(f.verdict, "frais");
  assert.strictEqual(cockpit.fraicheur(plan, 11, T0).verdict, "perime");
});

test("sans maximum déclaré, aucun feu vert n'est affiché", () => {
  const f = cockpit.fraicheur({ collecte_le: "2026-08-19T11:00:00.000Z" }, null, T0);
  assert.strictEqual(f.verdict, "inconnue", "un vert qu'on ne peut pas justifier est pire que rien");
  assert.strictEqual(f.age_heures, 1, "l'âge reste montré");
});

test("un plan sans date rend la fraîcheur inconnue, jamais fraîche", () => {
  assert.strictEqual(cockpit.fraicheur({}, 12, T0).verdict, "inconnue");
  assert.strictEqual(cockpit.fraicheur(null, 12, T0).verdict, "inconnue");
});

test("un dossier hors de la boîte est refusé : le chemin d'écriture ne vient pas de la requête", () => {
  const { dir } = bac();
  assert.throws(
    () => cockpit.enregistrer({ approvalsDir: dir, dossier: "../../ailleurs", empreinte: "abc123", par: "r", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
    cockpit.Refus
  );
});

test("une empreinte qui ne correspond plus est refusée : le plan a changé sous la page", () => {
  const { dir, registre } = bac({ empreinteBoite: "abc123", empreintePlan: "NOUVELLE" });
  assert.throws(
    () => cockpit.enregistrer({ approvalsDir: dir, dossier: "ajustement-prix", empreinte: "abc123", par: "r", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
    (err) => {
      assert.ok(err instanceof cockpit.Refus);
      assert.match(err.message, /NOUVELLE/);
      return true;
    }
  );
  assert.ok(!fs.existsSync(registre), "rien ne doit être écrit");
});

test("une décision non signée est refusée : un audit anonyme ne dit pas qui a engagé l'argent", () => {
  const { dir, registre } = bac();
  for (const par of [undefined, "", "   "]) {
    assert.throws(
      () => cockpit.enregistrer({ approvalsDir: dir, dossier: "ajustement-prix", empreinte: "abc123", par, decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
      cockpit.Refus
    );
  }
  assert.ok(!fs.existsSync(registre));
});

test("une action absente du plan, ou un verbe inconnu, sont refusés", () => {
  const { dir, registre } = bac();
  assert.throws(
    () => cockpit.enregistrer({ approvalsDir: dir, dossier: "ajustement-prix", empreinte: "abc123", par: "r", decisions: [{ action_id: "inventee", decision: "approuve" }] }),
    cockpit.Refus
  );
  assert.throws(
    () => cockpit.enregistrer({ approvalsDir: dir, dossier: "ajustement-prix", empreinte: "abc123", par: "r", decisions: [{ action_id: "prix-001", decision: "peut-etre" }] }),
    cockpit.Refus
  );
  assert.ok(!fs.existsSync(registre), "une seule décision fautive n'écrit rien du tout");
});

test("une décision valide s'écrit signée et datée, au format que le moteur relit", () => {
  const { dir, registre } = bac();
  const r = cockpit.enregistrer({
    approvalsDir: dir,
    dossier: "ajustement-prix",
    empreinte: "abc123",
    par: "  raphael  ",
    decisions: [{ action_id: "prix-001", decision: "approuve", motif: "aligné" }],
    maintenant: T0,
  });
  assert.strictEqual(r.plan, "abc123");
  assert.deepStrictEqual(r.decisions, [
    { action_id: "prix-001", decision: "approuve", par: "raphael", le: "2026-08-19T12:00:00.000Z", motif: "aligné" },
  ]);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(registre, "utf-8")), r, "le fichier porte exactement ça");
});

test("le maximum de fraîcheur est lu dans le pipeline, pas recopié", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipelines-"));
  fs.writeFileSync(
    path.join(dir, "appliquer.json"),
    JSON.stringify({ stages: [{ id: "chargement", type: "charger", max_age_heures: 7 }] })
  );
  assert.strictEqual(cockpit.maxAgeDuPipeline(dir, "appliquer"), 7);
  assert.strictEqual(cockpit.maxAgeDuPipeline(dir, "absent"), null, "un pipeline inconnu ne rend pas une valeur inventée");
  assert.strictEqual(cockpit.maxAgeDuPipeline(null, "appliquer"), null);
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests cockpit OK`);
  process.exit(failed ? 1 : 0);
})();
