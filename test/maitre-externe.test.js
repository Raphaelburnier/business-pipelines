const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MaitreExterne } = require("../src/maitre-externe");
const { MaitrePermanent } = require("../src/maitre-permanent");
const { EventStore } = require("agent-orchestrator");
const worker = { machine: "pc", etat: "online", connectee: true, disponible: true, concurrence: 3 };

test("une sonde récente conserve la capacité et la disponibilité ; une sonde périmée les retire", async () => {
  let maintenant = 1000;
  const m = new MaitreExterne({ url: "http://master.example.invalid:650/sante", maintenant: () => maintenant,
    fetcher: async () => Response.json({ ok: true, machines: [worker] }) });
  assert.equal(m.pret, false); assert.equal(await m.sonder(), true);
  assert.equal(m.machineDisponible("pc"), true); assert.equal(m.connexions.get("pc").capacites.concurrence, 3);
  maintenant += 5000;
  assert.equal(m.pret, false); assert.equal(m.machineDisponible("pc"), false); assert.equal(m.connexions.size, 0);
});

test("un maître indisponible ou une réponse incompatible invalide immédiatement la sonde", async () => {
  for (const reponse of [null, { ok: true, machines: [{ ...worker, disponible: undefined }] }, { ok: false, machines: [] }]) {
    let panne = false;
    const m = new MaitreExterne({ url: "http://master.example.invalid:650/sante", fetcher: async () => {
      if (!panne) return Response.json({ ok: true, machines: [worker] });
      if (!reponse) throw new Error("hors ligne");
      return Response.json(reponse);
    } });
    await m.sonder(); panne = true;
    assert.equal(await m.sonder(), false); assert.equal(m.pret, false); assert.equal(m.machineDisponible("pc"), false);
  }
});

test("un worker occupé conserve sa capacité parallèle sans devenir disponible pour une reprise", async () => {
  const m = new MaitreExterne({ url: "http://master.example.invalid:650/sante",
    fetcher: async () => Response.json({ ok: true, machines: [{ ...worker, etat: "busy", disponible: false }] }) });
  await m.sonder();
  assert.equal(m.connexions.get("pc").capacites.concurrence, 3);
  assert.equal(m.machineDisponible("pc"), false);
});

test("la santé du vrai maître refuse une connexion non prête et les étapes encore annoncées", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maitre-separe-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const maitre = new MaitrePermanent({ store, port: 0, hote: "127.0.0.1", workers: new Map(), journal() {} });
  t.after(async () => { await maitre.arreter(); store.fermer(); fs.rmSync(dir, { recursive: true, force: true }); });
  store.majMachine({ id: "pc", state: "online", heartbeat: true });
  const connexion = { pret: false, socket: { readyState: 1, close() {} }, etapesAnnoncees: new Set(), capacites: { concurrence: 2 } };
  maitre.connexions.set("pc", connexion);
  const { port } = await maitre.demarrer();
  const client = new MaitreExterne({ url: `http://127.0.0.1:${port}/sante` });
  await client.sonder(); assert.equal(client.machineDisponible("pc"), false);
  connexion.pret = true;
  await client.sonder(); assert.equal(client.machineDisponible("pc"), true); assert.equal(client.connexions.get("pc").capacites.concurrence, 2);
  connexion.etapesAnnoncees.add("en-cours");
  await client.sonder(); assert.equal(client.machineDisponible("pc"), false);
  connexion.etapesAnnoncees.clear(); maitre.connexions.delete("pc");
  await client.sonder(); assert.equal(client.machineDisponible("pc"), false); assert.equal(client.connexions.size, 0);
});

test("le compose sépare le code d'agent des chemins d'identité et n'expose pas le cockpit", () => {
  const { createRequire } = require("node:module");
  const { parse } = createRequire(require.resolve("agent-orchestrator"))("yaml");
  const s = parse(fs.readFileSync(path.join(__dirname, "../docker-compose.yaml"), "utf8")).services;
  assert.equal(s.runner.network_mode, undefined); assert.deepEqual(s.runner.networks, ["execution"]);
  assert.equal(s.runner.ports, undefined); assert.equal(s.cockpit.ports, undefined);
  assert.ok(!s.runner.volumes.some(v => /run-cockpit|tailscaled\.sock|docker\.sock|workers\.json/.test(v)));
  assert.ok(s.runner.environment.includes("ORCH_MAITRE_EXTERNE=1"));
  assert.ok(s.cockpit.environment.includes("COCKPIT_IDENTITE_SOCKET_SEULE=1"));
  assert.deepEqual(s.maitre.command, ["node", "bin/maitre-permanent.js"]); assert.equal(s.maitre.network_mode, "host");
  assert.deepEqual(s["cockpit-relais"].volumes, ["./run-cockpit:/run/cockpit:ro"]);
  assert.equal(s["cockpit-relais"].read_only, true); assert.deepEqual(s["cockpit-relais"].cap_drop, ["ALL"]);
});

test("le processus maître séparé reçoit une étape SQLite et la fait exécuter par un vrai worker", { timeout: 10000 }, async t => {
  const { spawn } = require("node:child_process");
  const http = require("node:http");
  const { once } = require("node:events");
  const { Worker } = require("agent-orchestrator/src/worker");
  const { MaitreDistant } = require("agent-orchestrator/src/maitre-distant");
  const { empreinteJeton } = require("agent-orchestrator/src/workers");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maitre-processus-"));
  const storePath = path.join(dir, "events.sqlite");
  const store = new EventStore(storePath);
  const workers = path.join(dir, "workers.json");
  const envFile = path.join(dir, "recette.env");
  fs.writeFileSync(workers, JSON.stringify([{ machine: "pc", actif: true, nomTailscale: "pc", hashJeton: empreinteJeton("jeton-recette") }]));
  fs.writeFileSync(envFile, "AUTORITE_RECETTE=maitre\n");
  const reserver = http.createServer(); reserver.listen(0, "127.0.0.1"); await once(reserver, "listening");
  const port = reserver.address().port; await new Promise(r => reserver.close(r));
  const processus = spawn(process.execPath, [path.join(__dirname, "../bin/maitre-permanent.js")], {
    env: { ...process.env, ORCH_EVENT_STORE: storePath, ORCH_WORKERS: workers, ORCH_MAITRE_HOTE: "127.0.0.1", ORCH_MAITRE_PORT: String(port), ORCH_TAILNET_LOCAL: "pc", ENV_FILE: envFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let sortie = ""; processus.stdout.on("data", b => { sortie += b; }); processus.stderr.on("data", b => { sortie += b; });
  let recu;
  const worker = new Worker({ url: `ws://127.0.0.1:${port}`, machine: "pc", jeton: "jeton-recette", journalPath: path.join(dir, "worker.jsonl"), heartbeatMs: 50, reconnexionMaxMs: 50,
    journal() {}, executerEtape: async etape => { recu = etape; return { statut: "succeeded", outcome: "recette" }; } });
  t.after(async () => {
    worker.arreter();
    if (processus.exitCode === null) { const fin = once(processus, "exit"); processus.kill("SIGTERM"); await fin; }
    store.fermer(); fs.rmSync(dir, { recursive: true, force: true });
  });
  const client = new MaitreExterne({ url: `http://127.0.0.1:${port}/sante` });
  worker.connecter();
  const jusqua = async condition => {
    for (let i = 0; i < 200; i++) { if (await condition()) return; await new Promise(r => setTimeout(r, 20)); }
    assert.fail(`maître ou worker indisponible : ${sortie}`);
  };
  await jusqua(async () => { await client.sonder(); return client.machineDisponible("pc"); });
  const runId = store.creerRun({ pipelineRef: "recette@1", projectId: "recette", trigger: "test" });
  const resultat = await new MaitreDistant({ store, sondeMs: 10, delaiMaxMs: 3000 }).executer("pc", { runId, stepId: "s1", noeud: { id: "script", type: "script" }, env: { AUTORITE_RECETTE: "run" } });
  assert.equal(resultat.statut, "succeeded"); assert.equal(resultat.outcome, "recette");
  assert.equal(recu.env.AUTORITE_RECETTE, "maitre");
  assert.ok(!JSON.stringify(store.commandes({ limite: 10 })).includes("AUTORITE_RECETTE"));
  worker.arreter();
  await jusqua(async () => { await client.sonder(); return !client.machineDisponible("pc"); });
});
