const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { PriceSourceService, pricesExample } = require("../src/finance/prices");
const {
  CATALOG,
  DAY,
  MAX_BODY,
  periodFor,
  parseResponse,
  collect,
} = require("../src/finance/eodhd");
const ids = CATALOG.map((i) => i.id);
const rows = () => [
  {
    date: "2026-10-09",
    open: 102,
    high: 104,
    low: 99,
    close: 100.125,
    adjusted_close: 99.5,
    volume: 4000,
  },
  {
    date: "2026-10-12",
    open: 100,
    high: 105,
    low: 99,
    close: 103.2345,
    adjusted_close: null,
    volume: 5000,
  },
];
function setup(t, fetchImpl = async () => Response.json(rows()), token = "") {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "finance-prices-"));
  t.after(() => fs.rmSync(scratch, { force: true, recursive: true }));
  let now = Date.UTC(2026, 9, 13, 10);
  const service = new PriceSourceService({
    storageRoot: path.join(scratch, "finance"),
    fetchImpl,
    token,
    now: () => now,
  });
  return { service, advance: (ms = 60_001) => (now += ms) };
}
test("lectures et maquette sans écriture/appel, suivi catalogue valide uniquement", (t) => {
  const { service } = setup(t, () => {
    throw new Error("appel interdit");
  });
  const d = service.snapshot();
  assert.equal(d.mode, "demo");
  assert.deepEqual(d.watchlist, ids.slice(0, 2));
  assert.equal(d.instruments[2].status, "needs-key");
  assert.equal(d.instruments[2].latest, null);
  assert.equal(pricesExample().synthetic, true);
  assert.equal(fs.existsSync(service.root), false);
  for (const bad of [
    null,
    [ids[0], ids[0]],
    ["https://intrus.example"],
    ["AAPL"],
  ])
    assert.throws(() => service.setWatchlist(bad), /catalogue/);
  assert.throws(() => service.original(ids[0]), /Aucun/);
  service.setWatchlist([]);
  assert.deepEqual(service.snapshot().watchlist, []);
});
test("identité complète distingue les homonymes de places, fenêtre et décimales JPY", () => {
  const now = Date.UTC(2026, 9, 13);
  const period = periodFor(now);
  assert.deepEqual(period, { from: "2025-10-14", to: "2026-10-13" });
  const a = parseResponse(
    JSON.stringify(rows()),
    { id: "eodhd:US:ABC" },
    period,
  );
  const b = parseResponse(
    JSON.stringify(rows()),
    { id: "eodhd:AS:ABC" },
    period,
  );
  assert.notEqual(a[0].id, b[0].id);
  assert.deepEqual(
    a.map((p) => p.date),
    ["2026-10-09", "2026-10-12"],
  );
  assert.equal(a[1].adjustedClose, null);
  const yen = parseResponse(JSON.stringify(rows()), CATALOG[4], period);
  assert.equal(CATALOG[4].currency, "JPY");
  assert.equal(yen[1].close, 103.2345); // Pas de division par 100 d'un prix JPY.
});
test("jour férié absent et cotation JPY restent des observations, sans prix interpolé", async (t) => {
  const response = rows().map((r, n) => ({
    ...r,
    date: n ? "2026-01-02" : "2025-12-31",
    close: 3000 + n,
    open: 3000 + n,
    high: 3005,
    low: 2995,
    adjusted_close: 2980 + n,
  }));
  const { service } = setup(
    t,
    async () => Response.json(response),
    "cle-fictive",
  );
  service.setWatchlist([ids[4]]);
  const d = await service.refresh();
  assert.equal(d.instruments[4].currency, "JPY");
  assert.equal(d.instruments[4].latest.close, 3001);
  assert.deepEqual(
    d.instruments[4].points.map((p) => p.date),
    ["2025-12-31", "2026-01-02"],
  );
  assert.equal(
    d.instruments[4].points.some((p) => p.date === "2026-01-01"),
    false,
  );
});
test("dates, OHLC, doublons, formats et valeurs non numériques bloquent toute réponse", () => {
  const period = periodFor(Date.UTC(2026, 9, 13));
  for (const change of [
    { date: "2026-02-30" },
    { date: "2027-01-01" },
    { close: "103" },
    { close: null },
    { adjusted_close: 0 },
    { volume: -1 },
    { volume: 1.2 },
    { high: 80 },
    { low: 104 },
  ]) {
    const bad = rows();
    bad[0] = { ...bad[0], ...change };
    assert.throws(
      () => parseResponse(JSON.stringify(bad), CATALOG[0], period),
      /invalide/,
    );
  }
  assert.throws(
    () =>
      parseResponse(JSON.stringify([rows()[0], rows()[0]]), CATALOG[0], period),
    /invalide/,
  );
  assert.throws(() => parseResponse("{}", CATALOG[0], period), /invalide/);
  assert.throws(() => parseResponse("[", CATALOG[0], period), /illisible/);
});
test("collecte publique limitée, provenance sans jeton, cache privé et reconstitution", async (t) => {
  const calls = [];
  const { service } = setup(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json(rows());
  });
  service.setWatchlist(ids);
  const d = await service.refresh();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(new URL(calls[0].url).searchParams.get("api_token"), "demo");
  assert.equal(d.budget.used, 2);
  assert.equal(d.lastAttempt.successes, 2);
  assert.equal(d.lastAttempt.failures, 3);
  assert.equal(d.instruments[0].latest.date, "2026-10-12");
  assert.equal(d.instruments[0].ageDays, 1);
  assert.equal(d.instruments[0].coverageVerified, true);
  assert.equal(d.instruments[2].coverageVerified, false);
  assert.equal(fs.statSync(service.file).mode & 0o777, 0o600);
  const original = service.original(ids[0]);
  assert.equal(original.sha256.length, 64);
  assert.equal(original.url.includes("api_token"), false);
  assert.deepEqual(original.response, rows());
  const stored = JSON.parse(fs.readFileSync(service.file));
  stored.entries[ids[0]].capture.points = [];
  stored.entries[ids[0]].capture.url = "javascript:alert(1)";
  fs.writeFileSync(service.file, JSON.stringify(stored));
  const restarted = new PriceSourceService({
    storageRoot: service.root,
    now: service.now,
  });
  assert.deepEqual(restarted.snapshot(), d);
  assert.equal(fs.existsSync(path.join(service.root, "finance.json")), false);
  assert.equal(fs.existsSync(path.join(service.root, "macro.json")), false);
});
test("révision rétroactive ajustée, récollecte complète, aucune duplication", async (t) => {
  let response = rows();
  const urls = [];
  const { service, advance } = setup(t, async (url) => {
    urls.push(url);
    return Response.json(response);
  });
  service.setWatchlist([ids[0]]);
  const first = await service.refresh();
  advance();
  const same = await service.refresh();
  assert.equal(same.revision, first.revision);
  assert.equal(same.lastAttempt.revised, 0);
  response[0].adjusted_close = 98.1;
  advance();
  const revised = await service.refresh();
  assert.equal(revised.revision, first.revision + 1);
  assert.equal(revised.lastAttempt.revised, 1);
  assert.equal(revised.instruments[0].points.length, 2);
  assert.equal(revised.instruments[0].points[0].adjustedClose, 98.1);
  assert.equal(urls[0], urls[2]);
});
test("panne, réponse vide et format invalide gardent le dernier succès et ses dates", async (t) => {
  let response = () => Response.json(rows());
  const { service, advance } = setup(t, () => response());
  service.setWatchlist([ids[0]]);
  const before = await service.refresh();
  for (const bad of [
    () => new Response("serveur", { status: 503 }),
    () => Response.json([]),
    () => Response.json({ error: "refus" }),
  ]) {
    response = bad;
    advance();
    const after = await service.refresh();
    assert.equal(after.lastAttempt.ok, false);
    assert.equal(
      after.instruments[0].collectedAt,
      before.instruments[0].collectedAt,
    );
    assert.deepEqual(after.instruments[0].points, before.instruments[0].points);
    assert.equal(after.revision, before.revision);
  }
  advance(8 * DAY);
  assert.equal(service.snapshot().instruments[0].cacheStale, true);
  assert.equal(service.snapshot().instruments[0].dateNeedsCheck, true);
});
test("403 n'est pas 404, 401/429 arrêtent les appels suivants, aucun secret persistant", async (t) => {
  const secret = "cle-fictive-confidentielle";
  const { service, advance } = setup(
    t,
    async () => new Response(secret, { status: 403 }),
    secret,
  );
  service.setWatchlist(ids);
  let d = await service.refresh();
  assert.equal(d.mode, "personal");
  assert.equal(d.budget.used, 5);
  assert.equal(d.instruments[0].status, "access-denied");
  assert.equal(d.instruments[0].coverageVerified, false);
  service.fetchImpl = async () => new Response("404", { status: 404 });
  advance();
  d = await service.refresh();
  assert.equal(d.instruments[0].status, "not-found");
  for (const status of [401, 429]) {
    let calls = 0;
    service.fetchImpl = async () => {
      calls++;
      return new Response(secret, { status });
    };
    advance();
    d = await service.refresh();
    assert.equal(calls, 1);
    assert.equal(d.instruments[1].status, "skipped");
  }
  assert.equal(fs.readFileSync(service.file, "utf8").includes(secret), false);
  assert.equal(JSON.stringify(service.snapshot()).includes(secret), false);
});
test("quota de 20 durable même avant réponse, redémarrage et réinitialisation UTC", async (t) => {
  let calls = 0;
  const { service, advance } = setup(
    t,
    async () => {
      calls++;
      const reserved = JSON.parse(fs.readFileSync(service.file));
      assert.equal(reserved.budget.used, calls);
      return Response.json(rows());
    },
    "cle-fictive",
  );
  service.setWatchlist(ids);
  for (let n = 0; n < 4; n++) {
    await service.refresh();
    advance();
  }
  assert.equal(calls, 20);
  const restarted = new PriceSourceService({
    storageRoot: service.root,
    token: "cle-fictive",
    fetchImpl: async () => {
      throw new Error("quota doit bloquer");
    },
    now: service.now,
  });
  const blocked = await restarted.refresh();
  assert.equal(blocked.budget.remaining, 0);
  assert.equal(blocked.lastAttempt.requests, 0);
  advance(DAY);
  assert.equal(restarted.snapshot().budget.used, 0);
  restarted.fetchImpl = async () => Response.json(rows());
  assert.equal((await restarted.refresh()).budget.used, 5);
});
test("collectes concurrentes regroupées, suivi verrouillé et intervalle 60 secondes", async (t) => {
  let resolve,
    calls = 0;
  const pending = new Promise((r) => (resolve = r));
  const { service } = setup(t, () => {
    calls++;
    return pending;
  });
  service.setWatchlist([ids[0]]);
  const a = service.refresh(),
    b = service.refresh();
  assert.equal(a, b);
  assert.throws(() => service.setWatchlist([]), { status: 409 });
  resolve(Response.json(rows()));
  await a;
  await b;
  assert.equal(calls, 1);
  assert.equal((await service.refresh()).refreshSkipped, true);
  assert.equal(calls, 1);
});
test("délai et taille bornés, erreurs réseau assainies même avec un jeton dans l'URL", async (t) => {
  const period = periodFor(Date.UTC(2026, 9, 13));
  const options = { instrument: CATALOG[0], token: "secret-fictif", period };
  await assert.rejects(
    collect({
      ...options,
      fetchImpl: async (url) => {
        throw new Error(url);
      },
    }),
    {
      kind: "network",
      message: "Connexion à EODHD impossible ; dernier historique conservé.",
    },
  );
  await assert.rejects(
    collect({
      ...options,
      fetchImpl: async () => new Response("x".repeat(MAX_BODY + 1)),
    }),
    { kind: "invalid-response" },
  );
  const server = http.createServer((_req, res) =>
    setTimeout(() => res.end("[]"), 80),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await assert.rejects(
    collect({
      ...options,
      timeoutMs: 5,
      fetchImpl: (_url, opts) =>
        fetch(`http://127.0.0.1:${server.address().port}`, opts),
    }),
    { kind: "timeout" },
  );
});
test("cache corrompu ou écriture impossible : aucune réinitialisation ni appel", async (t) => {
  const { service } = setup(t);
  service.setWatchlist([ids[0]]);
  await service.refresh();
  const stored = JSON.parse(fs.readFileSync(service.file));
  stored.entries[ids[0]].capture.raw += " ";
  fs.writeFileSync(service.file, JSON.stringify(stored));
  assert.throws(
    () => new PriceSourceService({ storageRoot: service.root }),
    /Empreinte/,
  );
  assert.equal(fs.readFileSync(service.file, "utf8"), JSON.stringify(stored));
  const blockedPath = path.join(path.dirname(service.root), "fichier");
  fs.writeFileSync(blockedPath, "occupe");
  let calls = 0;
  const blocked = new PriceSourceService({
    storageRoot: blockedPath,
    fetchImpl: async () => {
      calls++;
      return Response.json(rows());
    },
  });
  await assert.rejects(blocked.refresh());
  assert.equal(calls, 0);
});
