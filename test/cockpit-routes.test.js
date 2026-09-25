// Le serveur du cockpit, monté pour de vrai, avec sa base et son front.
//
// Les tests voisins vérifient ce que chaque module décide ; celui-ci vérifie ce qui sort
// du socket. C'est là que se voit ce qu'aucun test unitaire ne montre : qu'une route de
// lecture est bien DERRIÈRE le contrôle d'identité, et qu'un hôte inconnu n'obtient rien.
const assert = require("assert");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const { modeles } = require("agent-orchestrator/packages/schemas/modeles");

const RACINE = path.resolve(__dirname, "..");
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function base({ avecPc = true, etatPc = "online" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "routes-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  if (avecPc) store.majMachine({ id: "pc", state: etatPc, heartbeat: true, meta: { mac: "aa:bb:cc:dd:ee:ff" } });
  const runId = store.creerRun({ pipelineRef: "marketing@1", projectId: "marketing", trigger: "test" });
  const etape = store.creerEtape({ runId, nodeId: "economie", type: "agent", machineId: "pc" });
  store.majEtape(etape, { status: "succeeded", estCostUsd: 0.2 });
  store.statutRun(runId, "succeeded");
  store.emettre({ type: "run.started", runId, payload: {} });
  store.fermer();
  return { dir, base: path.join(dir, "events.sqlite"), runId };
}

function releve(dir) {
  const chemin = path.join(dir, "modeles.json");
  const modele = {
    id: "omniroute:agentic-code",
    llm: { via: "omniroute", model: "agentic-code" },
    type: "combo",
    fournisseur: "combo",
    nom: "agentic-code",
    capacites: { outils: true, vision: false, raisonnement: true },
    contexte: 200000,
    etat: "inconnu",
    raison: "état de la chaîne non relevé",
    resetAt: null,
  };
  const catalogue = {
    version: 1,
    releveLe: "2026-01-01T00:00:00.000Z",
    machine: "pc",
    passerelle: { etat: "ok", detail: null },
    quotas: "scope_absent",
    connexions: [],
    modeles: [modele],
  };
  fs.writeFileSync(chemin, JSON.stringify(catalogue));
  return chemin;
}

function illisible(dir) {
  const chemin = path.join(dir, "tronquee.sqlite");
  fs.writeFileSync(chemin, "ceci n'est pas une base SQLite");
  return chemin;
}

function demarrer(env) {
  const enfant = spawn(process.execPath, [path.join(RACINE, "bin", "cockpit.js")], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resoudre, rejeter) => {
    const minuterie = setTimeout(() => rejeter(new Error("le cockpit n'a pas démarré")), 8000);
    enfant.stdout.on("data", (d) => {
      if (String(d).includes("Cockpit sur")) {
        clearTimeout(minuterie);
        resoudre(enfant);
      }
    });
    enfant.on("exit", (code) => rejeter(new Error(`cockpit arrêté avant d'écouter (code ${code})`)));
  });
}

function requete(port, chemin, entetes = {}) {
  return new Promise((resoudre, rejeter) => {
    const req = http.get({ host: "127.0.0.1", port, path: chemin, headers: entetes }, (res) => {
      let corps = "";
      res.setEncoding("utf-8");
      res.on("data", (d) => (corps += d));
      res.on("end", () => resoudre({ code: res.statusCode, entetes: res.headers, corps }));
    });
    req.on("error", rejeter);
  });
}

function poster(port, chemin, corps, entetes = {}) {
  const brut = JSON.stringify(corps);
  return new Promise((resoudre, rejeter) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: chemin,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(brut), ...entetes },
      },
      (res) => {
        let reponse = "";
        res.setEncoding("utf-8");
        res.on("data", (d) => (reponse += d));
        res.on("end", () => resoudre({ code: res.statusCode, entetes: res.headers, corps: reponse }));
      }
    );
    req.on("error", rejeter);
    req.end(brut);
  });
}

const PORT = 4699;

test("les routes de lecture servent les runs, les machines et le front", async () => {
  const bac = base();
  const cockpit = await demarrer({
    COCKPIT_PORT: String(PORT),
    APPROVALS_DIR: path.join(bac.dir, "approvals"),
    ORCH_EVENT_STORE: bac.base,
    COCKPIT_OPERATEUR_LOCAL: "test",
    COCKPIT_CATALOGUE_MODELES: releve(bac.dir),
  });
  try {
    const topo = await requete(PORT, "/api/topology");
    assert.strictEqual(topo.code, 200);
    const lu = JSON.parse(topo.corps);
    assert.strictEqual(lu.projets.some((projet) => projet.id === "marketing"), true);
    assert.strictEqual(lu.projets.some((projet) => projet.id === "steam-tierlist"), true);
    assert.strictEqual(lu.machines.length >= 1, true);
    // Rien de ce que sert le cockpit ne doit finir dans un cache partagé.
    assert.strictEqual(topo.entetes["cache-control"], "no-store");

    const liste = JSON.parse((await requete(PORT, "/api/runs?project=marketing&status=succeeded")).corps);
    assert.strictEqual(liste.runs.length, 1);
    assert.strictEqual((await requete(PORT, "/api/runs?status=fini")).code, 400, "un statut inconnu est une faute de requête");
    assert.strictEqual((await requete(PORT, "/api/usage")).code, 200);

    // Le relevé poussé par le PC est servi avec son âge, les backends par machine et leur état.
    const reponseModeles = JSON.parse((await requete(PORT, "/api/modeles")).corps);
    modeles.reponse.parse(reponseModeles);
    assert.strictEqual(reponseModeles.catalogue.modeles[0].id, "omniroute:agentic-code");
    assert.deepStrictEqual(reponseModeles.viaParMachine, { nas: ["claude"], pc: ["claude", "omniroute"] });
    assert.strictEqual(reponseModeles.machines.some((m) => m.machine === "pc" && m.etat === "online"), true);
    assert.strictEqual(reponseModeles.perime, true, "un relevé de 2026-01-01 est périmé");

    const run = await requete(PORT, `/api/runs/${bac.runId}`);
    assert.strictEqual(run.code, 200);
    assert.strictEqual(JSON.parse(run.corps).etapes.length, 1);

    assert.strictEqual((await requete(PORT, "/api/runs/inconnu")).code, 404);
    assert.strictEqual((await requete(PORT, "/api/machines")).code, 200);

    const lancement = await poster(PORT, "/api/runs", { projectId: "steam-tierlist" });
    assert.strictEqual(lancement.code, 202);
    const commandeLancee = JSON.parse(lancement.corps).commande;
    assert.strictEqual(commandeLancee.statut, "pending");
    const suivi = await requete(PORT, `/api/commands/${commandeLancee.id}`);
    assert.strictEqual(suivi.code, 200);
    assert.strictEqual(JSON.parse(suivi.corps).commande.projet, "steam-tierlist");
    assert.strictEqual((await requete(PORT, "/api/commands/inconnue")).code, 404);
    const verification = new EventStore(bac.base);
    assert.deepStrictEqual(verification.commandes({ statut: "pending" }).map((c) => c.payload.projectId), ["steam-tierlist"]);
    verification.fermer();

    assert.strictEqual(
      (await poster(PORT, "/api/runs", { projectId: "../secret" })).code,
      400,
      "un identifiant ne peut pas sortir du registre de projets"
    );
    assert.strictEqual(
      (await poster(PORT, "/api/runs", { projectId: "steam-tierlist", llmOverrides: { "*": { via: "omniroute", model: "agentic-code" } } })).code,
      202,
      "OmniRoute est accepté quand le PC qui le sert est en ligne"
    );

    // Une adresse du front avec paramètres reste servie : `/?v=2` est la même page.
    const avecQuery = await requete(PORT, "/?v=2");
    const attendu = fs.existsSync(path.join(RACINE, "web", "dist", "index.html")) ? 200 : 503;
    assert.strictEqual(avecQuery.code, attendu, "/?v=2 doit être traité comme /");

    // Le front : construit, il est servi à la racine et sur les pages de détail. L'ancien
    // /app redirige sans garder deux architectures concurrentes.
    const app = await requete(PORT, "/");
    if (fs.existsSync(path.join(RACINE, "web", "dist", "index.html"))) {
      assert.strictEqual(app.code, 200);
      assert.match(app.entetes["content-type"], /text\/html/);
      assert.strictEqual((await requete(PORT, "/projects/steam-tierlist")).code, 200);
    } else {
      assert.strictEqual(app.code, 503);
      assert.match(app.corps, /npm run web:build/);
    }
    const ancien = await requete(PORT, "/app");
    assert.strictEqual(ancien.code, 308);
    assert.strictEqual(ancien.entetes.location, "/");
    // Un ancien lien vers la maquette doit encore ouvrir la maquette.
    const maquette = await requete(PORT, "/app/?source=maquette");
    assert.strictEqual(maquette.entetes.location, "/?source=maquette");
    assert.strictEqual((await requete(PORT, "/decisions")).code, 200);
  } finally {
    cockpit.kill();
  }
});

test("un run OmniRoute est refusé avant la file quand le PC n'est pas enregistré", async () => {
  const bac = base({ avecPc: false });
  const cockpit = await demarrer({
    COCKPIT_PORT: String(PORT + 3),
    APPROVALS_DIR: path.join(bac.dir, "approvals"),
    ORCH_EVENT_STORE: bac.base,
    COCKPIT_OPERATEUR_LOCAL: "test",
    COCKPIT_CATALOGUE_MODELES: releve(bac.dir),
  });
  try {
    const lancement = await poster(PORT + 3, "/api/runs", {
      projectId: "steam-tierlist",
      llmOverrides: { "*": { via: "omniroute", model: "agentic-code" } },
    });
    assert.strictEqual(lancement.code, 400);
    assert.match(JSON.parse(lancement.corps).erreur, /pc.*non enregistrée/);
  } finally {
    cockpit.kill();
  }
});

test("un run OmniRoute est refusé avant la file quand le PC est en veille", async () => {
  const bac = base({ etatPc: "sleeping" });
  const cockpit = await demarrer({
    COCKPIT_PORT: String(PORT + 4),
    APPROVALS_DIR: path.join(bac.dir, "approvals"),
    ORCH_EVENT_STORE: bac.base,
    COCKPIT_OPERATEUR_LOCAL: "test",
    COCKPIT_CATALOGUE_MODELES: releve(bac.dir),
  });
  try {
    const lancement = await poster(PORT + 4, "/api/runs", {
      projectId: "steam-tierlist",
      llmOverrides: { "*": { via: "omniroute", model: "agentic-code" } },
    });
    assert.strictEqual(lancement.code, 400);
    assert.match(JSON.parse(lancement.corps).erreur, /pc en veille/);
  } finally {
    cockpit.kill();
  }
});

test("un hôte que le cockpit ne connaît pas n'obtient aucune donnée de run", async () => {
  const bac = base();
  const cockpit = await demarrer({
    COCKPIT_PORT: String(PORT + 1),
    APPROVALS_DIR: path.join(bac.dir, "approvals"),
    ORCH_EVENT_STORE: bac.base,
    COCKPIT_OPERATEUR_LOCAL: "test",
  });
  try {
    // La défense contre le rebinding DNS s'applique aussi aux routes de lecture : un nom
    // qui résout vers 127.0.0.1 ne suffit pas à parler au cockpit.
    for (const chemin of ["/api/topology", "/api/usage", "/api/modeles", "/api/runs", "/api/machines", "/api/stream", "/", "/app", "/decisions"]) {
      const refus = await requete(PORT + 1, chemin, { host: "cockpit.exemple.test" });
      assert.strictEqual(refus.code, 403, `${chemin} doit refuser un hôte inconnu`);
      assert.match(refus.corps, /hôte refusé/);
    }
  } finally {
    cockpit.kill();
  }
});

test("sans event store lisible, les décisions restent accessibles", async () => {
  const bac = base();
  const cockpit = await demarrer({
    COCKPIT_PORT: String(PORT + 2),
    APPROVALS_DIR: path.join(bac.dir, "approvals"),
    // Un fichier qui n'est pas une base, ce que laisse une copie interrompue : le cockpit
    // doit survivre et continuer à servir la page d'approbation, qui n'en dépend pas.
    ORCH_EVENT_STORE: illisible(bac.dir),
    COCKPIT_OPERATEUR_LOCAL: "test",
  });
  try {
    const etat = await requete(PORT + 2, "/api/etat");
    assert.strictEqual(etat.code, 200, "la page d'approbation ne dépend pas de l'event store");
    const runs = await requete(PORT + 2, "/api/runs");
    assert.strictEqual(runs.code, 503);
    assert.match(JSON.parse(runs.corps).erreur, /event store indisponible/);
  } finally {
    cockpit.kill();
  }
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
  console.log(`\n${tests.length - echecs}/${tests.length} tests de routes du cockpit OK`);
  process.exit(echecs ? 1 : 0);
})();
