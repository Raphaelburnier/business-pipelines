const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { MacroSourceService, macroExample } = require("../src/finance/sources");
const {
  COUNTRIES,
  INDICATORS,
  MAX_BODY,
  parseResponse,
  collect,
} = require("../src/finance/worldbank");
function knownResponse() {
  const rows = COUNTRIES.flatMap((c) =>
    INDICATORS.flatMap((i) =>
      Array.from({ length: 10 }, (_, n) => ({
        countryiso3code: c.id,
        indicator: { id: i.id },
        date: String(2016 + n),
        value:
          c.id === "USA" && i.id === "FP.CPI.TOTL.ZG" && n === 9 ? null : 2.5,
      })),
    ),
  );
  return [{ page: 1, pages: 1, total: 120, lastupdated: "2026-10-08" }, rows];
}
function setup(t, fetchImpl = async () => Response.json(knownResponse())) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "finance-sources-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  let now = Date.UTC(2026, 9, 13, 10);
  const service = new MacroSourceService({
    storageRoot: path.join(scratch, "finance"),
    fetchImpl,
    now: () => now,
  });
  return { service, advance: (ms = 60_001) => (now += ms) };
}
test("lecture sans collecte ni écriture, catalogue annuel et exemple isolé", (t) => {
  const { service } = setup(t, () => {
    throw new Error("aucune collecte attendue");
  });
  const d = service.snapshot();
  assert.equal(d.empty, true);
  assert.equal(d.series.length, 12);
  assert.deepEqual(d.period, { from: 2016, to: 2025 });
  assert.equal(d.collectedAt, null);
  assert.equal(fs.existsSync(service.root), false);
  assert.throws(() => service.original(), /Aucun/);
  assert.equal(macroExample().synthetic, true);
  assert.equal(fs.existsSync(service.root), false);
});
test("réponse connue : provenance, valeurs absentes, cache privé et redémarrage", async (t) => {
  let request;
  const { service } = setup(t, async (url, options) => {
    request = { url, options };
    return Response.json(knownResponse());
  });
  const d = await service.refresh();
  assert.match(
    request.url,
    /^https:\/\/api.worldbank.org\/v2\/country\/CH;US;EU;CN;JP;WLD\//,
  );
  assert.match(request.url, /date=2016:2025/);
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.signal.aborted, false);
  assert.equal(d.empty, false);
  assert.equal(d.revision, 1);
  assert.equal(d.sourceUpdatedAt, "2026-10-08");
  assert.equal(d.publicationDate, null);
  assert.equal(d.lastAttempt.added, 120);
  assert.equal(d.lastAttempt.availableCount, 119);
  const usa = d.series.find((s) => s.id === "USA:FP.CPI.TOTL.ZG");
  assert.deepEqual(usa.latest, { year: 2024, value: 2.5 });
  assert.equal(usa.lastYearMissing, true);
  assert.deepEqual(usa.points.at(-1), { year: 2025, value: null });
  assert.equal(fs.statSync(service.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(service.root).mode & 0o777, 0o700);
  const original = service.original();
  assert.equal(original.sha256.length, 64);
  assert.deepEqual(original.response, knownResponse());
  const stored = JSON.parse(fs.readFileSync(service.file));
  stored.capture.observations = [];
  stored.capture.url = "javascript:alert(1)";
  fs.writeFileSync(service.file, JSON.stringify(stored));
  const restarted = new MacroSourceService({
    storageRoot: service.root,
    now: service.now,
  });
  assert.deepEqual(restarted.snapshot(), d);
  assert.deepEqual(restarted.original(), original);
  assert.equal(fs.existsSync(path.join(service.root, "finance.json")), false);
});
test("collectes identiques sans doublon, révision officielle au même identifiant", async (t) => {
  let response = knownResponse();
  let calls = 0;
  const { service, advance } = setup(t, async () => {
    calls++;
    return Response.json(response);
  });
  await service.refresh();
  await service.refresh();
  assert.equal(calls, 1);
  advance();
  const d = await service.refresh();
  assert.equal(d.revision, 1);
  assert.equal(d.lastAttempt.added, 0);
  assert.equal(d.lastAttempt.revised, 0);
  assert.equal(d.lastAttempt.unchanged, 120);
  response[1][0].value = 3;
  advance();
  const revised = await service.refresh();
  assert.equal(revised.revision, 2);
  assert.equal(revised.lastAttempt.revised, 1);
  assert.equal(revised.lastAttempt.observationCount, 120);
  assert.equal(
    revised.series.find((s) => s.id === "CHE:NY.GDP.MKTP.KD.ZG").points[0]
      .value,
    3,
  );
});
test("collectes simultanées regroupées ; fraîcheur du cache distincte de l’année observée", async (t) => {
  let resolve;
  let calls = 0;
  const pending = new Promise((r) => (resolve = r));
  const { service, advance } = setup(t, () => {
    calls++;
    return pending;
  });
  const a = service.refresh(),
    b = service.refresh();
  assert.equal(a, b);
  assert.equal(calls, 1);
  resolve(Response.json(knownResponse()));
  await a;
  await b;
  assert.equal(service.snapshot().cacheStale, false);
  advance(8 * 86_400_000);
  assert.equal(service.snapshot().cacheStale, true);
  assert.equal(service.snapshot().cacheAgeDays, 8);
  assert.equal(service.snapshot().series[0].latest.year, 2025);
});
test("panne et réponse partielle conservent le dernier succès et ses dates après redémarrage", async (t) => {
  let fetchResponse = () => Response.json(knownResponse());
  const { service, advance } = setup(t, async () => fetchResponse());
  const before = await service.refresh();
  for (const bad of [
    () => new Response("panne", { status: 503 }),
    () => Response.json([{}, []]),
    () => {
      throw new Error("connect /some/private/path");
    },
  ]) {
    advance();
    fetchResponse = bad;
    const after = await service.refresh();
    assert.deepEqual(after.series, before.series);
    assert.equal(after.collectedAt, before.collectedAt);
    assert.equal(after.revision, before.revision);
    assert.equal(after.lastAttempt.ok, false);
    assert.doesNotMatch(after.lastAttempt.message, /private/);
  }
  const restarted = new MacroSourceService({
    storageRoot: service.root,
    now: service.now,
  });
  assert.equal(restarted.snapshot().lastAttempt.ok, false);
  assert.equal(restarted.snapshot().collectedAt, before.collectedAt);
});
test("première panne n'invente ni instantané ni valeur zéro", async (t) => {
  const { service } = setup(t, async () => new Response(null, { status: 429 }));
  const d = await service.refresh();
  assert.equal(d.empty, true);
  assert.equal(d.revision, 0);
  assert.equal(d.lastAttempt.ok, false);
  assert.equal(d.collectedAt, null);
  assert.equal(d.series[0].latest, null);
});
test("validation stricte : pagination, dates, séries et observations contradictoires", () => {
  for (const change of [
    (r) => (r[0].pages = 2),
    (r) => (r[0].lastupdated = "2026-02-30"),
    (r) => r[1].pop(),
    (r) => (r[1][0].date = "2026"),
    (r) => (r[1][0].value = "2.5"),
    (r) => (r[1][0].countryiso3code = "XXX"),
    (r) => (r[1][0].indicator.id = "other"),
    (r) => (r[1][1] = r[1][0]),
  ]) {
    const r = knownResponse();
    change(r);
    assert.throws(() =>
      parseResponse(JSON.stringify(r), { from: 2016, to: 2025 }),
    );
  }
  assert.throws(() => parseResponse("{}", { from: 2016, to: 2025 }));
});
test("absence totale et série ancienne restent signalées", async (t) => {
  const response = knownResponse();
  for (const r of response[1]) {
    if (r.countryiso3code === "CHE") r.value = null;
    if (r.countryiso3code === "USA" && Number(r.date) > 2022) r.value = null;
  }
  const { service } = setup(t, async () => Response.json(response));
  const d = await service.refresh();
  assert.equal(d.series[0].latest, null);
  assert.equal(d.series.find((s) => s.countryId === "USA").lagging, true);
});
test("timeout réel et limite de réponse interrompent la collecte", async (t) => {
  const server = http.createServer((req, res) =>
    setTimeout(() => res.end(JSON.stringify(knownResponse())), 150),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  await assert.rejects(
    collect({
      now: Date.UTC(2026, 9, 13),
      timeoutMs: 15,
      fetchImpl: (_, options) =>
        fetch(`http://127.0.0.1:${server.address().port}`, options),
    }),
    { name: "TimeoutError" },
  );
  await assert.rejects(
    collect({ fetchImpl: async () => new Response("x".repeat(MAX_BODY + 1)) }),
    /volumineuse/,
  );
});
test("cache corrompu ou empreinte erronée jamais écrasés ; échec disque sans mutation", async (t) => {
  const { service } = setup(t);
  await service.refresh();
  const saved = JSON.parse(fs.readFileSync(service.file));
  saved.capture.sha256 = "faux";
  fs.writeFileSync(service.file, JSON.stringify(saved));
  assert.throws(
    () => new MacroSourceService({ storageRoot: service.root }),
    /Empreinte/,
  );
  const invalid = fs.readFileSync(service.file, "utf8");
  assert.equal(fs.readFileSync(service.file, "utf8"), invalid);
  const broken = setup(t).service;
  fs.writeFileSync(broken.root, "un fichier, pas un dossier");
  await assert.rejects(broken.refresh());
  assert.equal(broken.snapshot().empty, true);
  assert.equal(broken.snapshot().lastAttempt, null);
});
