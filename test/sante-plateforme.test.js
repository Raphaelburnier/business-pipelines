const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventStore } = require("agent-orchestrator");
const { COEUR, CONTENEURS, DUREE_SIGNAL_MS, dossierSante, sonderBase, lireSignal, surveillerService, sonderPlateforme, projeterDocker, inspecterDocker } = require("../src/sante-plateforme");
const pause = ms => new Promise(r => setTimeout(r, ms));
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const http = require("node:http");
const net = require("node:net");
const { verifier, demander } = require("../bin/verifier-sante");
async function jusqua(f) { for (let i = 0; i < 200; i++) { if (f()) return; await pause(10); } assert.fail("signal attendu absent"); }
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sante-")), fichier = path.join(dir, "events.sqlite");
  const store = new EventStore(fichier); store.creerRun({ pipelineRef: "recette@1" }); store.fermer();
  const signaux = [];
  return { dir, fichier, lancer(service, options = {}) { const s = surveillerService(service, { fichier, journal() {}, ...options }); signaux.push(s); return s; }, fermer() { signaux.forEach(s => s.arreter()); fs.rmSync(dir, { recursive: true, force: true }); } };
}
const dockerSain = () => Object.fromEntries(Object.keys(CONTENEURS).map(id => [id, { ok: true, code: "DISPONIBLE" }]));

test("la sonde lit la base existante et ne crée ni ne répare une base absente ou corrompue", () => {
  const f = fixture();
  try {
    const avant = fs.readFileSync(f.fichier);
    assert.equal(sonderBase(f.fichier).ok, true);
    assert.deepEqual(fs.readFileSync(f.fichier), avant);
    const absente = path.join(f.dir, "n-existe-pas.sqlite");
    assert.equal(sonderBase(absente).ok, false); assert.equal(fs.existsSync(absente), false);
    fs.writeFileSync(absente, "témoin de confidentialité");
    assert.deepEqual(sonderBase(absente), { ok: false, code: "ETAT_ILLISIBLE" });
    assert.equal(fs.readFileSync(absente, "utf8"), "témoin de confidentialité");
  } finally { f.fermer(); }
});

test("signaux privés, périmés ou d'une ancienne incarnation du PID", () => {
  const f = fixture();
  try {
    const maintenant = Date.now(); f.lancer("runner", { maintenant: () => maintenant });
    assert.equal(fs.statSync(dossierSante(f.fichier)).mode & 0o777, 0o700);
    const file = path.join(dossierSante(f.fichier), "runner.json");
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(lireSignal(f.fichier, "runner", { maintenant, verifierProcessus: true }).ok, true);
    assert.equal(lireSignal(f.fichier, "runner", { maintenant: maintenant + DUREE_SIGNAL_MS + 1 }).code, "SIGNAL_PERIME");
    assert.equal(lireSignal(f.fichier, "runner", { maintenant: maintenant - 6000 }).code, "SIGNAL_PERIME");
    const s = JSON.parse(fs.readFileSync(file)); s.debut = String(BigInt(s.debut) + 1n); fs.writeFileSync(file, JSON.stringify(s));
    assert.equal(lireSignal(f.fichier, "runner", { maintenant, verifierProcessus: true }).code, "INSTANCE_REMPLACEE");
  } finally { f.fermer(); }
});

test("une exécution longue reste disponible tant que son signal est frais", async () => {
  const f = fixture(); let maintenant = Date.now();
  try {
    f.lancer("runner", { maintenant: () => maintenant, intervalleMs: 10 });
    maintenant += 6 * 60 * 60 * 1000;
    await jusqua(() => lireSignal(f.fichier, "runner", { maintenant }).ok);
    assert.equal(lireSignal(f.fichier, "runner", { maintenant }).ageMs, 0);
  } finally { f.fermer(); }
});

test("l'arrêt d'une ancienne instance ne supprime pas le signal de sa remplaçante", () => {
  const f = fixture();
  try {
    const a = f.lancer("publieur"), b = f.lancer("publieur"); a.arreter();
    assert.equal(lireSignal(f.fichier, "publieur").instance, b.instance);
    b.arreter(); assert.equal(lireSignal(f.fichier, "publieur").ok, false);
  } finally { f.fermer(); }
});

test("la projection Docker garde des états bornés, sans environnement ni diagnostic brut", () => {
  const lignes = Object.values(CONTENEURS).map(n => "/" + n + " " + JSON.stringify({ Running: true, Health: { Status: "healthy", Log: ["secret-transport"] }, Error: "private/path", Env: ["PASSWORD=secret-transport"] }));
  const s = projeterDocker(lignes.join("\n"));
  assert.deepEqual(s, dockerSain()); assert.equal(JSON.stringify(s).includes("secret-transport"), false);
  assert.equal(projeterDocker('/business_runner {"Running":false}').runner.code, "CONTENEUR_ARRETE");
  assert.equal(projeterDocker('/business_runner {"Running":true}').runner.code, "SONDE_ABSENTE");
  assert.equal(projeterDocker('/business_runner {"Running":true,"Health":{"Status":"unhealthy"}}').runner.ok, false);
  assert.equal(projeterDocker("").maitre.code, "CONTENEUR_ABSENT");
});

test("l'appel au client Docker est borné par une échéance", async () => {
  const f = fixture(), avant = process.env.DOCKER;
  try {
    const cli = path.join(f.dir, "docker");
    fs.writeFileSync(cli, '#!/bin/sh\n[ "$1" = inspect ] || exit 2\nprintf \'/business_runner {"Running":true,"Health":{"Status":"healthy"}}\\n\'\n', { mode: 0o700 });
    process.env.DOCKER = cli;
    assert.equal((await inspecterDocker()).runner.ok, true);
    fs.appendFileSync(cli, "exit 1\n");
    const partiel = await inspecterDocker();
    assert.equal(partiel.runner.ok, true); assert.equal(partiel.maitre.code, "CONTENEUR_ABSENT");
    fs.writeFileSync(cli, '#!/bin/sh\nprintf \'/business_runner {"Running":true,"Health":{"Status":"healthy"}}\\n\'\nexec sleep 30\n');
    const debut = performance.now(); await assert.rejects(inspecterDocker());
    assert.ok(performance.now() - debut < 4000);
  } finally { if (avant === undefined) delete process.env.DOCKER; else process.env.DOCKER = avant; f.fermer(); }
});

test("la santé globale exige des signaux et un snapshot de la même instance, pas un PC allumé", async () => {
  const f = fixture();
  try {
    for (const id of COEUR) f.lancer(id, { docker: id === "livreur" ? async () => dockerSain() : null });
    await jusqua(() => sonderPlateforme({ fichier: f.fichier, plateforme: true }).ok);
    assert.equal(sonderPlateforme({ fichier: f.fichier, plateforme: true }).portee, "plateforme");
    assert.equal(sonderPlateforme({ fichier: f.fichier, plateforme: true, maintenant: Date.now() + DUREE_SIGNAL_MS + 100 }).ok, false);
    // Le snapshot de l'ancienne instance ne prouve pas la santé après redémarrage.
    f.lancer("livreur");
    const s = sonderPlateforme({ fichier: f.fichier, plateforme: true });
    assert.equal(s.ok, false); assert.equal(s.composants.docker.code, "DOCKER_NON_CONFIRME");
  } finally { f.fermer(); }
});

test("une panne Docker reste visible et ne publie pas les détails de l'exception", async () => {
  const f = fixture(), logs = [];
  try {
    for (const id of COEUR) f.lancer(id, { intervalleMs: 10, journal: l => logs.push(l), docker: id === "livreur" ? async () => { throw new Error("PASSWORD=secret-transport"); } : null });
    await jusqua(() => fs.existsSync(path.join(dossierSante(f.fichier), "docker.json")));
    await pause(40);
    assert.equal(sonderPlateforme({ fichier: f.fichier, plateforme: true }).ok, false);
    assert.equal(logs.filter(l => JSON.parse(l).event === "docker.sante").length, 1);
    assert.equal(logs.join(" ").includes("secret-transport"), false);
    assert.equal(fs.readFileSync(path.join(dossierSante(f.fichier), "docker.json"), "utf8").includes("secret-transport"), false);
  } finally { f.fermer(); }
});

test("le compose borne les journaux sans ouvrir de montage Docker aux agents", () => {
  const { createRequire } = require("node:module");
  const { parse } = createRequire(require.resolve("agent-orchestrator"))("yaml");
  const s = parse(fs.readFileSync(path.join(__dirname, "../docker-compose.yaml"), "utf8")).services;
  for (const [id, c] of Object.entries(s)) {
    assert.equal(c.logging.driver, "json-file", id); assert.deepEqual(c.logging.options, { "max-size": "10m", "max-file": "3" });
    if (id !== "marketing") { assert.ok(c.healthcheck.test.includes("bin/verifier-sante.js"), id); assert.equal(c.healthcheck.timeout, "4s"); }
  }
  assert.equal(s.runner.volumes.some(v => v.includes("docker.sock")), false);
  assert.equal(s.cockpit.volumes.some(v => v.includes("docker.sock")), false);
  assert.deepEqual(s["cockpit-relais"].cap_drop, ["ALL"]);
});

test("les sondes de processus restent locales et refusent un signal absent", async () => {
  const f = fixture();
  try {
    await assert.rejects(verifier("runner", { ORCH_EVENT_STORE: f.fichier }));
    f.lancer("runner"); await verifier("runner", { ORCH_EVENT_STORE: f.fichier });
    await assert.rejects(verifier("inconnu", {}));
  } finally { f.fermer(); }
});

test("la sonde du vrai maître répond sans worker connecté et détecte son arrêt", async () => {
  const { Maitre } = require("agent-orchestrator");
  const f = fixture(), store = new EventStore(f.fichier);
  const maitre = new Maitre({ store, workers: new Map(), port: 0, hote: "127.0.0.1", journal() {} });
  try {
    await maitre.demarrer(); f.lancer("maitre");
    const env = { ORCH_EVENT_STORE: f.fichier, ORCH_MAITRE_HOTE: "127.0.0.1", ORCH_MAITRE_PORT: String(maitre.serveur.address().port) };
    await verifier("maitre", env);
    await maitre.arreter(); await assert.rejects(verifier("maitre", env));
  } finally { await maitre.arreter(); store.fermer(); f.fermer(); }
});

test("la sonde HTTP impose une échéance même quand le serveur garde le silence", async t => {
  const serveur = http.createServer(() => {});
  serveur.listen(0, "127.0.0.1"); await once(serveur, "listening");
  t.after(() => { serveur.closeAllConnections(); serveur.close(); });
  const debut = performance.now();
  await assert.rejects(demander({ host: "127.0.0.1", port: serveur.address().port, path: "/sante" }));
  assert.ok(performance.now() - debut < 3000);
});

test("le vrai cockpit protège le détail, révèle les pannes et ne crée aucune base", async t => {
  const f = fixture(), socketPath = path.join(f.dir, "cockpit.sock");
  const reservation = net.createServer(); reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port; await new Promise(r => reservation.close(r));
  const enfant = spawn(process.execPath, [path.join(__dirname, "../bin/cockpit.js")], {
    env: { ...process.env, COCKPIT_PORT: String(port), COCKPIT_HOTE: "127.0.0.1", COCKPIT_SOCKET: socketPath,
      COCKPIT_IDENTITE_SOCKET_SEULE: "1", COCKPIT_SANTE_PLATEFORME: "1", COCKPIT_TAILNET: "cockpit.example.invalid",
      COCKPIT_OPERATEUR_LOCAL: "recette", ORCH_EVENT_STORE: f.fichier, APPROVALS_DIR: path.join(f.dir, "approvals") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  enfant.stdout.on("data", b => { logs += b; }); enfant.stderr.on("data", b => { logs += b; });
  t.after(async () => { if (enfant.exitCode === null) { enfant.kill(); await once(enfant, "exit"); } f.fermer(); });
  for (let i = 0; !logs.includes("Cockpit sur") && i < 400; i++) {
    assert.equal(enfant.exitCode, null, "cockpit interrompu avant écoute"); await pause(20);
  }
  assert.ok(logs.includes("Cockpit sur"), "cockpit prêt");
  async function get(chemin, { tcp = false, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const q = http.get({ ...(tcp ? { host: "127.0.0.1", port } : { socketPath }), path: chemin,
        headers: { Host: "cockpit.example.invalid", "Tailscale-User-Login": "operator@example.invalid", ...headers } }, r => {
        let body = ""; r.on("data", b => { body += b; });
        r.on("end", () => resolve({ status: r.statusCode, headers: r.headers, body: JSON.parse(body) }));
      });
      q.setTimeout(3000, () => q.destroy(new Error("réponse santé absente"))); q.on("error", reject);
    });
  }
  assert.equal((await get("/api/sante", { tcp: true })).status, 403);
  assert.equal((await get("/api/sante", { headers: { "Tailscale-User-Login": "" } })).status, 403);
  assert.equal((await get("/api/sante", { headers: { Host: "refuse.example.invalid" } })).status, 403);
  assert.equal((await get("/api/sante")).status, 503);
  for (const id of COEUR) f.lancer(id, { docker: id === "livreur" ? async () => dockerSain() : null });
  await jusqua(() => sonderPlateforme({ fichier: f.fichier, plateforme: true }).ok);
  const sain = await get("/api/sante");
  assert.equal(sain.status, 200); assert.equal(sain.body.ok, true); assert.equal(sain.headers["cache-control"], "no-store");
  assert.ok(sain.headers["x-request-id"]); assert.equal(JSON.stringify(sain.body).includes(f.dir), false);
  // Le signal ne dépend ni de l'état d'un worker ni de l'âge d'un run.
  const local = await get("/sante", { headers: { Host: "localhost", "Tailscale-User-Login": "" } });
  assert.equal(local.status, 200); assert.deepEqual(local.body, { ok: true });
  fs.rmSync(f.fichier);
  assert.equal((await get("/api/sante")).status, 503); assert.equal(fs.existsSync(f.fichier), false);
  assert.deepEqual((await get("/sante", { headers: { Host: "localhost" } })).body, { ok: false });
  fs.writeFileSync(f.fichier, "secret-transport base corrompue");
  const panne = await get("/api/sante"); assert.equal(panne.status, 503);
  assert.equal(JSON.stringify(panne.body).includes("secret-transport"), false);
  assert.equal(fs.readFileSync(f.fichier, "utf8"), "secret-transport base corrompue");
});
