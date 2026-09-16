const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const store = require("../src/store");
const cockpit = require("../src/cockpit");
const { importer } = require("../src/import-approbations");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const dossierVide = (prefixe) => fs.mkdtempSync(path.join(os.tmpdir(), prefixe));

// ---------- le store ----------

test("un registre réécrit pour un autre plan garde l'historique du précédent", () => {
  const dir = dossierVide("store-");
  store.ecrireRegistre(dir, "m", { plan: "A", decisions: [{ action_id: "a1", decision: "approuve", par: "r" }] });
  store.ecrireRegistre(dir, "m", { plan: "B", decisions: [] });

  assert.deepStrictEqual(store.lireRegistre(dir, "m"), { plan: "B", decisions: [] }, "le juge ne lit que le plan courant");

  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(store.cheminBase(dir));
  const anciennes = db.prepare("SELECT action_id, decision FROM decisions WHERE dossier = 'm' AND plan = 'A'").all();
  db.close();
  assert.strictEqual(anciennes.length, 1, "la décision prise sur le plan A reste une trace");
});

test("réécrire le registre du même plan remplace ses décisions, sans doublon", () => {
  const dir = dossierVide("store-");
  store.ecrireRegistre(dir, "m", { plan: "A", decisions: [{ action_id: "a1", decision: "refuse" }] });
  store.ecrireRegistre(dir, "m", { plan: "A", decisions: [{ action_id: "a1", decision: "approuve", motif: "vu" }] });
  assert.deepStrictEqual(store.lireRegistre(dir, "m").decisions, [{ action_id: "a1", decision: "approuve", motif: "vu" }]);
});

test("déposer remplace la demande d'un dossier, null la retire", () => {
  const dir = dossierVide("store-");
  store.deposer(dir, "m", { empreinte: "A", actions: 2 });
  store.deposer(dir, "m", { empreinte: "B", actions: 3 });
  assert.deepStrictEqual(store.lireBoite(dir).en_attente.map((e) => [e.dossier, e.empreinte, e.actions]), [["m", "B", 3]]);
  store.deposer(dir, "m", null);
  assert.deepStrictEqual(store.lireBoite(dir).en_attente, []);
});

test("consigner deux fois la même alerte ne la double pas", () => {
  const dir = dossierVide("store-");
  store.consignerAlerte(dir, { cle: "m:A:inconnue", dossier: "m" });
  store.consignerAlerte(dir, { cle: "m:A:inconnue", dossier: "m" });
  assert.strictEqual(store.lireJournal(dir).envoyees.length, 1);
});

test("abandonner un plan retire plan, registre courant et demande, et garde les décisions", () => {
  const dir = dossierVide("store-");
  store.gelerPlan(dir, "m", { empreinte: "A", actions: [{ id: "a1" }] });
  store.ecrireRegistre(dir, "m", { plan: "A", decisions: [{ action_id: "a1", decision: "approuve" }] });
  store.deposer(dir, "m", { empreinte: "A", actions: 1 });

  assert.strictEqual(store.abandonnerPlan(dir, "m"), true);
  assert.strictEqual(store.lirePlan(dir, "m"), null);
  assert.strictEqual(store.lireRegistre(dir, "m"), null);
  assert.deepStrictEqual(store.lireBoite(dir).en_attente, []);
  assert.strictEqual(store.abandonnerPlan(dir, "m"), false, "abandonner un dossier inconnu ne ment pas");
});

test("une base illisible lève une erreur qui nomme le fichier", () => {
  const dir = dossierVide("store-");
  fs.writeFileSync(store.cheminBase(dir), "pas une base");
  assert.throws(
    () => store.lireBoite(dir),
    (err) => err instanceof store.StoreIllisible && err.message.includes(store.cheminBase(dir))
  );
});

test("en-attente --abandonner passe par le store et dit ce qu'il a fait", () => {
  const dir = dossierVide("store-");
  store.gelerPlan(dir, "marketing", { empreinte: "A", actions: [{ id: "a1" }] });
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "bin", "en-attente.js"), "--abandonner", "marketing"], {
    env: { ...process.env, APPROVALS_DIR: dir },
    encoding: "utf-8",
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Plan "marketing" abandonné/);
  assert.strictEqual(store.lirePlan(dir, "marketing"), null);
});

// ---------- l'import des fichiers ----------

// La forme des fichiers d'un vrai tour marketing arrêté sur ses arbitrages : une demande
// dont les chemins sont ceux du conteneur, un plan gelé à trois questions, deux décisions
// sur trois avec leurs notes, une réponse libre, et une alerte déjà partie.
function approbationsEnFichiers() {
  const dir = dossierVide("import-");
  const actions = [
    { id: "arb-01", type: "arbitrage", question: "Vendre sous un nom de boutique ?", rapport: "Deux voix en désaccord." },
    { id: "arb-02", type: "arbitrage", question: "Vendre au-dessus de la médiane ?", rapport: "La marge contre le volume." },
    { id: "arb-03", type: "arbitrage", question: "Viser dix ventes par mois au départ ?", rapport: "Hypothèse à vérifier." },
  ];
  const ecrire = (nom, contenu) => fs.writeFileSync(path.join(dir, nom), JSON.stringify(contenu, null, 2));
  ecrire("EN-ATTENTE.json", {
    en_attente: [
      {
        dossier: "marketing",
        empreinte: "e1f2a3b4c5d6e7f8",
        depuis: "2026-09-13T18:02:11.000Z",
        actions: 3,
        registre: "/app/approvals/marketing.decisions.json",
        plan_gele: "/app/approvals/marketing.plan.json",
        appliquer_avec: null,
      },
    ],
  });
  ecrire("marketing.plan.json", { empreinte: "e1f2a3b4c5d6e7f8", gele_le: "2026-09-13T18:02:11.000Z", collecte_le: null, actions });
  ecrire("marketing.decisions.json", {
    plan: "e1f2a3b4c5d6e7f8",
    decisions: [
      { action_id: "arb-01", decision: "approuve", par: "destrobi28@gmail.com", canal: "tailnet", le: "2026-09-14T08:00:00.000Z", motif: "oui, nom de boutique" },
      { action_id: "arb-02", decision: "refuse", par: "destrobi28@gmail.com", canal: "tailnet", le: "2026-09-14T08:00:00.000Z" },
    ],
    reponse: "Garde la médiane comme plafond.",
    reponse_par: "destrobi28@gmail.com",
    reponse_le: "2026-09-14T08:01:00.000Z",
    reponse_canal: "tailnet",
  });
  ecrire("EXEMPLE.decisions.json", { _lisez_moi: "gabarit", plan: "0000000000000000", decisions: [] });
  ecrire("ALERTES.json", { envoyees: [{ cle: "marketing:e1f2a3b4c5d6e7f8:inconnue", dossier: "marketing", empreinte: "e1f2a3b4c5d6e7f8", le: "2026-09-13T18:15:00.000Z" }] });
  return { dir, actions };
}

test("l'import ne perd aucun arbitrage, aucune décision, aucune note ni la réponse libre", () => {
  const { dir, actions } = approbationsEnFichiers();
  const { compte, ecarts } = importer({ approvalsDir: dir });

  assert.deepStrictEqual(ecarts, []);
  assert.deepStrictEqual(compte, { plans: 1, registres: 1, attentes: 1, alertes: 1 }, "le gabarit EXEMPLE n'est pas importé");

  const [d] = cockpit.etat({ approvalsDir: dir }).dossiers;
  assert.strictEqual(d.dossier, "marketing");
  assert.strictEqual(d.empreinte, "e1f2a3b4c5d6e7f8");
  assert.deepStrictEqual(d.actions.map((a) => [a.id, a.question, a.decision, a.note]), [
    ["arb-01", actions[0].question, "approuve", "oui, nom de boutique"],
    ["arb-02", actions[1].question, "refuse", null],
    ["arb-03", actions[2].question, null, null],
  ]);
  assert.strictEqual(d.reponse_posee.consigne, "Garde la médiane comme plafond.");
  assert.strictEqual(d.tranche, false, "une question reste à trancher");
  assert.strictEqual(store.lireRegistre(dir, "marketing").decisions[0].canal, "tailnet", "le canal de signature survit");
  assert.strictEqual(store.lireJournal(dir).envoyees.length, 1, "une alerte déjà partie ne repartira pas");
});

test("relancer l'import ne double rien et ne touche pas aux fichiers", () => {
  const { dir } = approbationsEnFichiers();
  const avant = fs.readFileSync(path.join(dir, "marketing.decisions.json"), "utf-8");
  importer({ approvalsDir: dir });
  const second = importer({ approvalsDir: dir });

  assert.deepStrictEqual(second.ecarts, []);
  assert.strictEqual(store.lireBoite(dir).en_attente.length, 1);
  assert.strictEqual(store.lireRegistre(dir, "marketing").decisions.length, 2);
  assert.strictEqual(store.lireJournal(dir).envoyees.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(dir, "marketing.decisions.json"), "utf-8"), avant, "l'import n'écrit pas dans les fichiers");
});

test("après import, décider dans le cockpit complète le registre importé au lieu de l'écraser", () => {
  const { dir } = approbationsEnFichiers();
  importer({ approvalsDir: dir });
  cockpit.enregistrer({
    approvalsDir: dir,
    dossier: "marketing",
    empreinte: "e1f2a3b4c5d6e7f8",
    decisions: [{ action_id: "arb-03", decision: "approuve" }],
    par: "destrobi28@gmail.com",
    canal: "tailnet",
  });
  const [d] = cockpit.etat({ approvalsDir: dir }).dossiers;
  assert.deepStrictEqual(d.actions.map((a) => a.decision), ["approuve", "refuse", "approuve"]);
});

test("un registre sans empreinte de plan est signalé, pas importé en silence", () => {
  const dir = dossierVide("import-");
  fs.writeFileSync(path.join(dir, "casse.decisions.json"), JSON.stringify({ decisions: [] }));
  const { ecarts, compte } = importer({ approvalsDir: dir });
  assert.strictEqual(compte.registres, 0);
  assert.match(ecarts.join("\n"), /casse.*sans empreinte/);
});

test("la commande d'import sort en 0 et récapitule ce qu'elle a relu", () => {
  const { dir } = approbationsEnFichiers();
  const r = spawnSync(process.execPath, [path.join(__dirname, "..", "bin", "importer-approbations.js"), dir], { encoding: "utf-8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /plans\s+1/);
  assert.match(r.stdout, /relu à l'identique/);
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests store OK`);
  process.exit(failed ? 1 : 0);
})();
