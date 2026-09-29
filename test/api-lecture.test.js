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
const { cockpit } = require("agent-orchestrator/packages/schemas/cockpit");
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

test("les runs se filtrent par projet et par statut", () => {
  const { store } = bac();
  const fini = runComplet(store);
  store.statutRun(fini, "succeeded");
  runComplet(store, { projet: "tcg" });

  assert.strictEqual(api.runs(store, { statut: "succeeded" }).length, 1);
  assert.strictEqual(api.runs(store, { projet: "tcg", statut: "waiting_approval" }).length, 1);
  assert.throws(() => api.runs(store, { statut: "fini" }), /statut de run inconnu/);
});

// Une fiche projet écrite comme dans `projects/<id>/project.json`.
function fiche(dir, id, contenu) {
  fs.mkdirSync(path.join(dir, id), { recursive: true });
  fs.writeFileSync(path.join(dir, id, "project.json"), typeof contenu === "string" ? contenu : JSON.stringify(contenu));
}

test("la topologie range les projets par catégorie, avec leurs machines réelles", () => {
  const { dir, store } = bac();
  const projets = path.join(dir, "projects");
  fiche(projets, "marketing", {
    id: "marketing",
    name: "Plan marketing",
    business: "marketing",
    homeMachine: "nas",
    repo: "ssh://nas/marketing.git",
    pipelines: [{ extends: "marketing@1" }],
  });
  fiche(projets, "casse", "{ ce n'est pas du JSON");
  runComplet(store); // projet « marketing », une étape sur le NAS et une sur le PC
  runComplet(store, { projet: "orphelin" }); // des runs, pas de fiche

  const topo = api.topologie(store, { projetsDir: projets });
  const marketing = topo.projets.find((p) => p.id === "marketing");
  assert.strictEqual(marketing.categorie, "marketing");
  assert.strictEqual(marketing.homeMachine, "nas");
  // Une étape a tourné sur le PC : c'est l'arête en pointillés du projet multi-machine.
  assert.ok(marketing.machines.includes("pc"), `machines : ${marketing.machines}`);
  assert.strictEqual(marketing.etat, "attente", "un run en attente de décision colore le projet");
  assert.strictEqual(marketing.approbationsEnAttente, 1);
  assert.strictEqual(marketing.aFiche, true);
  assert.strictEqual(marketing.url, null, "sans url dans la fiche, pas de lien vers une app");

  // Un projet connu par ses runs seulement apparaît quand même, marqué comme tel.
  const orphelin = topo.projets.find((p) => p.id === "orphelin");
  assert.strictEqual(orphelin.aFiche, false);
  assert.strictEqual(orphelin.url, null);
  assert.strictEqual(orphelin.categorie, "sans fiche");

  // Une fiche illisible est nommée, elle ne fait pas tomber la vue.
  assert.strictEqual(topo.anomalies.length, 1);
  assert.match(topo.anomalies[0], /projects\/casse\/project.json/);
  assert.deepStrictEqual(topo.categories.map((c) => c.id), ["marketing", "sans fiche"]);
});

test("l'usage compte les runs actifs et le coût équivalent, sans inventer de jauge", () => {
  const { store } = bac();
  const fini = runComplet(store);
  store.statutRun(fini, "succeeded");
  runComplet(store, { projet: "tcg" });

  const u = api.usage(store);
  assert.strictEqual(u.runsActifs, 1);
  assert.strictEqual(u.coutEquivalentJourUsd, 0.84);
  assert.strictEqual(u.coutEquivalentMoisUsd, 0.84);
  // Le quota vient de `getUsage()` du SDK, lu par le maître en phase 5 : pas avant.
  assert.strictEqual(u.quota, null);
});

test("chaque réponse respecte le schéma que le front et les fixtures partagent", () => {
  const { dir, store } = bac();
  const runId = runComplet(store);
  // Ce que l'API rend et ce que décrit `packages/schemas/cockpit.js` ne doivent pas diverger :
  // le front en tire ses types, les fixtures de la maquette aussi.
  cockpit.run.array().parse(api.runs(store));
  cockpit.runDetaille.parse(api.run(store, runId));
  cockpit.machine.array().parse(api.machines(store));
  cockpit.evenement.array().parse(api.evenements(store, { runId }));
  cockpit.topologie.parse(api.topologie(store, { projetsDir: path.join(dir, "rien") }));
  cockpit.usage.parse(api.usage(store));
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
  const requete = http.get({ host: "127.0.0.1", port, path: "/api/stream", headers: entetes }, (res) => {
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

// Attendre une condition plutôt qu'une durée. Une attente fixe de 120 ms passait sur le poste
// et dans la CI, mais pas dans le build de l'image sur le NAS, sous charge (le 2026-09-29) :
// « reçu 0 ». Le plafond est large ; un test qui passe n'attend que le nécessaire.
async function attendreQue(condition, plafondMs = 5000) {
  const fin = Date.now() + plafondMs;
  while (!condition() && Date.now() < fin) await attendre(20);
}
// Après la condition, le temps de voir arriver un doublon s'il y en avait un.
const MARGE_DOUBLON = 150;

test("le flux envoie l'historique puis ce qui arrive ensuite", async () => {
  const { store } = bac();
  const runId = runComplet(store);
  const historique = store.evenements({ runId }).length;
  const serveur = await serveurDeFlux(store, { runId });
  const { recu, requete } = ecouter(serveur.address().port);

  await attendreQue(() => recu.length >= historique);
  const avant = recu.length;
  store.emettre({ type: "step.progress", runId, payload: { texte: "pendant l'écoute" } });
  await attendreQue(() => recu.length > avant);
  await attendre(MARGE_DOUBLON);

  assert.ok(historique >= 2 && avant === historique, `l'historique du run devait arriver (${historique}), reçu ${avant}`);
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
  const historique = store.evenements({ runId }).length;
  const serveur = await serveurDeFlux(store, { runId });
  const port = serveur.address().port;

  const premier = ecouter(port);
  await attendreQue(() => premier.recu.length >= historique);
  const dernierId = premier.recu[premier.recu.length - 1].id;
  premier.requete.destroy();

  // Ce qui s'écrit pendant que personne n'écoute ne doit pas se perdre.
  store.emettre({ type: "step.finished", runId, payload: { pendant: "la coupure" } });

  const second = ecouter(port, { "Last-Event-ID": String(dernierId) });
  await attendreQue(() => second.recu.length >= 1);
  await attendre(MARGE_DOUBLON);

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
