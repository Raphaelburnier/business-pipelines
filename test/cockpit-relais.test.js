const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { creerRelais } = require("../deploy/nas/cockpit-relais");

async function fixture(t, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relais-recette-"));
  const socketPath = path.join(dir, "cockpit.sock");
  const amont = http.createServer(handler);
  amont.listen(socketPath); await once(amont, "listening");
  const relais = creerRelais({ socketPath });
  relais.listen(0, "127.0.0.1"); await once(relais, "listening");
  t.after(async () => {
    amont.closeAllConnections(); relais.closeAllConnections();
    await Promise.all([new Promise(r => amont.close(r)), new Promise(r => relais.close(r))]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { url: `http://127.0.0.1:${relais.address().port}`, amont, socketPath };
}

test("le relais transmet méthode, identité, origine et corps au socket Unix", async t => {
  let recu;
  const f = await fixture(t, (q, r) => {
    let corps = "";
    q.on("data", b => { corps += b; });
    q.on("end", () => { recu = { methode: q.method, url: q.url, entetes: q.headers, corps, adresse: q.socket.remoteAddress }; r.writeHead(201, { "content-type": "application/json", "set-cookie": "recette=1" }); r.end('{"ok":true}'); });
  });
  const r = await new Promise((resolve, reject) => {
    const q = http.request(`${f.url}/api/recette?x=1`, { method: "POST", headers: { Host: "cockpit.example.invalid", Origin: "https://cockpit.example.invalid", "Tailscale-User-Login": "operator@example.invalid", "Content-Type": "application/json" } }, retour => {
      let corps = ""; retour.on("data", b => { corps += b; }); retour.on("end", () => resolve({ status: retour.statusCode, headers: retour.headers, corps }));
    });
    q.on("error", reject); q.end('{"decision":"approuve"}');
  });
  assert.equal(r.status, 201); assert.deepEqual(r.headers["set-cookie"], ["recette=1"]); assert.deepEqual(JSON.parse(r.corps), { ok: true });
  assert.equal(recu.adresse, undefined); assert.equal(recu.methode, "POST"); assert.equal(recu.url, "/api/recette?x=1");
  assert.equal(recu.entetes["tailscale-user-login"], "operator@example.invalid"); assert.equal(recu.entetes.origin, "https://cockpit.example.invalid");
  assert.equal(recu.entetes.host, "cockpit.example.invalid");
  assert.equal(recu.corps, '{"decision":"approuve"}');
});

test("un flux SSE arrive avant sa clôture et la déconnexion ferme l'amont", async t => {
  let fermer;
  const ferme = new Promise(r => { fermer = r; });
  const f = await fixture(t, (q, r) => {
    assert.equal(q.headers["last-event-id"], "42");
    r.writeHead(200, { "content-type": "text/event-stream" });
    r.write("id: 43\ndata: recette\n\n");
    q.on("close", fermer);
  });
  const controller = new AbortController();
  const r = await fetch(`${f.url}/api/stream`, { headers: { "Last-Event-ID": "42" }, signal: controller.signal });
  const lecteur = r.body.getReader();
  const b = await lecteur.read();
  assert.match(Buffer.from(b.value).toString(), /id: 43/);
  controller.abort();
  await Promise.race([ferme, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("socket SSE non libéré")), 1000); timer.unref(); })]);
});

test("le relais échoue fermé quand le socket est absent", async t => {
  const f = await fixture(t, (_q, r) => r.end("ok"));
  await new Promise(r => f.amont.close(r));
  const r = await fetch(f.url);
  assert.equal(r.status, 502); assert.deepEqual(await r.json(), { erreur: "cockpit indisponible" });
});
