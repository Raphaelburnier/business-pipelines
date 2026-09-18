// Ce que le cockpit montre des runs, et ce qu'il ne montre pas.
//
// La base est remplie par le vrai event store, avec les mêmes appels que le moteur : ces
// tests lisent donc la forme de production, pas une fixture qui dériverait d'elle.
const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const api = require("../src/api-lecture");
const flux = require("../src/flux");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function bac() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-lecture-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  return { dir, store };
}

// Un run comme le moteur en écrit un : une étape déterministe sur le NAS, une étape
// d'agent sur le PC, des événements, et une décision qui attend.
function runComplet(store, { projet = "marketing" } = {}) {
  store.majMachine({ id: "pc", state: "online", heartbeat: true, meta: { mac: "aa:bb:cc:dd:ee:ff" } });
  const runId = store.creerRun({ pipelineRef: "marketing@1", projectId: projet, trigger: "cli" });
  const consigne = store.creerEtape({ runId, nodeId: "consigne", type: "script" });
  store.majEtape(consigne, { status: "succeeded", outcome: "ok" });
  const economie = store.creerEtape({
    runId,
    nodeId: "economie",
    type: "agent",
    llmVia: "claude",
    llmModel: "sonnet",
    machineId: "pc",
  });
  store.majEtape(economie, { status: "succeeded", estCostUsd: 0.42, tokensIn: 1200, tokensOut: 300 });
  store.emettre({ type: "run.start", runId, payload: { projet } });
  store.emettre({ type: "step.finished", runId, stepId: economie, payload: { costUsd: 0.42 } });
  store.ouvrirApprobation({
    runId,
    nodeId: "approbation",
    empreinte: "abc123",
    rapport: {
      question: "Lancer la campagne ?",
      resume: "deux voix d'accord",
      changements: ["publier la vitrine"],
      implications: ["budget engagé"],
      fichiers: [],
      cout: "0.42 USD",
      risques: ["saisonnalité"],
      recommandation: "lancer",
    },
    actions: [{ id: "a1" }, { id: "a2" }],
  });
  store.statutRun(runId, "waiting_approval");
  return runId;
}

test("la liste des runs dit l'essentiel sans ouvrir chaque run", () => {
  const { store } = bac();
  runComplet(store);
  runComplet(store, { projet: "tcg" });

  const liste = api.runs(store);
  assert.strictEqual(liste.length, 2);
  // Le plus récent d'abord : une page qui montre l'inverse fait chercher le run en cours.
  assert.strictEqual(liste[0].projet, "tcg");
  assert.strictEqual(liste[0].vivant, true, "un run en attente de décision est vivant");
  assert.strictEqual(liste[0].etapes.total, 2);
  assert.strictEqual(liste[0].etapes.parStatut.succeeded, 2);
  // Sur abonnement, ce n'est pas une dépense : le nom du champ doit le dire.
  assert.strictEqual(liste[0].coutEquivalentUsd, 0.42);
  assert.ok(!("coutUsd" in liste[0]), "aucun champ ne doit se lire comme de l'argent dépensé");

  assert.strictEqual(api.runs(store, { projet: "tcg" }).length, 1);
  assert.strictEqual(api.runs(store, { limite: 1 }).length, 1);
});

test("un run détaillé porte ses étapes, leur machine et la décision qui attend", () => {
  const { store } = bac();
  const runId = runComplet(store);

  const detail = api.run(store, runId);
  assert.deepStrictEqual(
    detail.etapes.map((e) => [e.noeud, e.statut, e.machine]),
    [
      ["consigne", "succeeded", store.machineId],
      ["economie", "succeeded", "pc"],
    ]
  );
  const agent = detail.etapes[1];
  assert.deepStrictEqual(agent.llm, { via: "claude", model: "sonnet" });
  assert.deepStrictEqual(agent.tokens, { entree: 1200, sortie: 300 });

  assert.strictEqual(detail.approbations.length, 1);
  assert.strictEqual(detail.approbations[0].question, "Lancer la campagne ?");
  assert.strictEqual(detail.approbations[0].actions, 2);
  // L'identifiant du dernier événement sert de point de reprise au flux.
  assert.ok(detail.dernierEvenementId > 0);

  assert.strictEqual(api.run(store, "run-inexistant"), null);
});

test("les machines portent leur état et l'âge de leur dernier signe de vie", () => {
  const { store } = bac();
  store.majMachine({ id: "pc", state: "sleeping", heartbeat: true, meta: { mac: "aa:bb:cc:dd:ee:ff" } });

  const [locale, pc] = api.machines(store, { maintenant: Date.now() + 90_000 }).sort((a, b) =>
    a.machine === "pc" ? 1 : -1
  );
  assert.ok(locale);
  assert.strictEqual(pc.etat, "sleeping");
  // Un état « en ligne » vieux de deux heures ne veut rien dire : l'âge doit être lisible.
  assert.ok(pc.depuisSecondes >= 90, `heartbeat vieux de ${pc.depuisSecondes} s`);
  assert.strictEqual(pc.meta.mac, "aa:bb:cc:dd:ee:ff");
});

test("le tableau de bord réunit ce qu'on vient chercher : runs vivants, machines, décisions", () => {
  const { store } = bac();
  const runId = runComplet(store);
  store.statutRun(runId, "succeeded");
  const enCours = runComplet(store, { projet: "tcg" });

  const tb = api.tableauDeBord(store);
  assert.strictEqual(tb.runs.length, 2);
  assert.strictEqual(tb.vivants, 1, "un run terminé n'est plus vivant");
  assert.strictEqual(tb.approbations.length, 1, "seules les décisions des runs vivants sont remontées");
  assert.strictEqual(tb.approbations[0].run, enCours);
  assert.strictEqual(tb.coutDuJourUsd, 0.84);
});

// ---- le flux ----

function serveurDeFlux(store, options = {}) {
  const serveur = http.createServer((req, res) =>
    flux.ouvrir({ req, res, store, intervalleMs: 50, battementMs: 500, ...options })
  );
  return new Promise((resoudre) => serveur.listen(0, "127.0.0.1", () => resoudre(serveur)));
}

function ecouter(port, entetes = {}) {
  const recu = [];
  const requete = http.get({ host: "127.0.0.1", port, path: "/api/flux", headers: entetes }, (res) => {
    res.setEncoding("utf-8");
    res.on("data", (morceau) => {
      for (const ligne of morceau.split("\n")) {
        if (ligne.startsWith("data: ")) recu.push(JSON.parse(ligne.slice(6)));
      }
    });
  });
  return { recu, requete };
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test("le flux envoie l'historique puis ce qui arrive ensuite", async () => {
  const { store } = bac();
  const runId = runComplet(store);
  const serveur = await serveurDeFlux(store, { runId });
  const { recu, requete } = ecouter(serveur.address().port);

  await attendre(120);
  const avant = recu.length;
  store.emettre({ type: "step.progress", runId, payload: { texte: "pendant l'écoute" } });
  await attendre(200);

  assert.ok(avant >= 2, `l'historique du run devait arriver, reçu ${avant}`);
  assert.strictEqual(recu.length, avant + 1, "l'événement écrit pendant l'écoute arrive, une seule fois");
  assert.strictEqual(recu[recu.length - 1].type, "step.progress");
  // Les identifiants sont ceux de la base : c'est ce qui rend la reprise exacte.
  assert.ok(recu.every((e, i) => i === 0 || e.id > recu[i - 1].id));

  requete.destroy();
  serveur.close();
});

test("une reconnexion reprend après le dernier événement reçu, sans trou ni doublon", async () => {
  const { store } = bac();
  const runId = runComplet(store);
  const serveur = await serveurDeFlux(store, { runId });
  const port = serveur.address().port;

  const premier = ecouter(port);
  await attendre(120);
  const dernierId = premier.recu[premier.recu.length - 1].id;
  premier.requete.destroy();

  // Ce qui s'écrit pendant que personne n'écoute ne doit pas se perdre.
  store.emettre({ type: "step.finished", runId, payload: { pendant: "la coupure" } });
  await attendre(50);

  const second = ecouter(port, { "Last-Event-ID": String(dernierId) });
  await attendre(200);

  assert.deepStrictEqual(
    second.recu.map((e) => e.type),
    ["step.finished"],
    "la reprise ne renvoie que ce qui a suivi le dernier événement reçu"
  );
  second.requete.destroy();
  serveur.close();
});

(async () => {
  let echecs = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      echecs += 1;
      console.error(`  ✘ ${name}\n    ${err.message}`);
    }
  }
  console.log(`\n${tests.length - echecs}/${tests.length} tests d'API de lecture OK`);
  process.exit(echecs ? 1 : 0);
})();
