const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const {
  COUNTRIES,
  INDICATORS,
  PROVIDER,
  collect,
  parseResponse,
  periodFor,
  requestUrl,
} = require("./worldbank");
const DAY = 86_400_000;
const emptyCache = () => ({
  version: 1,
  revision: 0,
  capture: null,
  lastAttempt: null,
});
function view(cache, now) {
  const capture = cache.capture;
  const period = capture?.period || periodFor(now);
  const series = COUNTRIES.flatMap((country) =>
    INDICATORS.map((indicator) => {
      const points = (capture?.observations || [])
        .filter(
          (p) => p.countryId === country.id && p.indicatorId === indicator.id,
        )
        .sort((a, b) => a.year - b.year)
        .map(({ year, value }) => ({ year, value }));
      const latest = points.filter((p) => p.value !== null).at(-1) || null;
      return {
        id: `${country.id}:${indicator.id}`,
        countryId: country.id,
        indicatorId: indicator.id,
        points,
        latest,
        lastYearMissing: !points.some(
          (p) => p.year === period.to && p.value !== null,
        ),
        lagging: latest ? latest.year < periodFor(now).to - 1 : false,
      };
    }),
  );
  const cacheAgeDays = capture
    ? Math.max(0, Math.floor((now - Date.parse(capture.collectedAt)) / DAY))
    : null;
  return {
    provider: PROVIDER,
    countries: COUNTRIES.map(({ id, name }) => ({ id, name })),
    indicators: INDICATORS,
    period,
    series,
    revision: cache.revision,
    collectedAt: capture?.collectedAt || null,
    sourceUpdatedAt: capture?.sourceUpdatedAt || null,
    publicationDate: null,
    requestUrl: capture?.url || null,
    sha256: capture?.sha256 || null,
    lastAttempt: cache.lastAttempt,
    cacheAgeDays,
    cacheStale: !capture || now - Date.parse(capture.collectedAt) >= 7 * DAY,
    nextRefreshAt: cache.lastAttempt
      ? new Date(Date.parse(cache.lastAttempt.at) + 60_000).toISOString()
      : null,
    empty: !capture,
  };
}
class MacroSourceService {
  constructor({
    storageRoot,
    fetchImpl = fetch,
    now = Date.now,
    timeoutMs = 20_000,
  }) {
    this.root = storageRoot;
    this.file = path.join(storageRoot, "macro.json");
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.inFlight = null;
    this.cache = emptyCache();
    if (fs.existsSync(this.file)) {
      if (fs.statSync(this.file).size > 2_000_000)
        throw new Error("Cache macro trop volumineux.");
      const stored = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (
        stored.version !== 1 ||
        !Number.isSafeInteger(stored.revision) ||
        stored.revision < 0 ||
        (stored.lastAttempt !== null &&
          (typeof stored.lastAttempt?.ok !== "boolean" ||
            !Number.isFinite(Date.parse(stored.lastAttempt.at))))
      )
        throw new Error("Cache macro invalide.");
      if (stored.capture !== null) {
        const c = stored.capture;
        if (
          !c ||
          !Number.isInteger(c.period?.from) ||
          c.period.to !== c.period.from + 9 ||
          !Number.isFinite(Date.parse(c.collectedAt)) ||
          typeof c.raw !== "string"
        )
          throw new Error("Instantané macro invalide.");
        const parsed = parseResponse(c.raw, c.period);
        // Reconstituer depuis la réponse source, jamais depuis des points modifiés à la main.
        if (createHash("sha256").update(c.raw).digest("hex") !== c.sha256)
          throw new Error("Empreinte du cache macro invalide.");
        stored.capture = { ...c, ...parsed, url: requestUrl(c.period) };
      }
      this.cache = stored;
    }
  }
  snapshot() {
    return view(this.cache, this.now());
  }
  original() {
    const c = this.cache.capture;
    if (!c)
      throw Object.assign(new Error("Aucun instantané macro collecté."), {
        status: 404,
      });
    return {
      provider: PROVIDER,
      revision: this.cache.revision,
      collectedAt: c.collectedAt,
      sourceUpdatedAt: c.sourceUpdatedAt,
      url: c.url,
      sha256: c.sha256,
      response: JSON.parse(c.raw),
    };
  }
  save(next) {
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > 2_000_000)
      throw new Error("Cache macro trop volumineux.");
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, serialized, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, this.file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    this.cache = next;
  }
  refresh() {
    if (this.inFlight) return this.inFlight;
    if (
      this.cache.lastAttempt &&
      this.now() - Date.parse(this.cache.lastAttempt.at) < 60_000
    )
      return Promise.resolve({ ...this.snapshot(), refreshSkipped: true });
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  async performRefresh() {
    const start = this.now();
    let result, failure;
    try {
      result = await collect({
        fetchImpl: this.fetchImpl,
        now: start,
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      failure =
        error.name === "TimeoutError" || error.name === "AbortError"
          ? "La source n’a pas répondu à temps."
          : error.message;
      if (
        !/^(Banque mondiale|Réponse Banque mondiale|Date de mise à jour|Point macro)/.test(
          failure,
        ) &&
        !failure.startsWith("La source")
      )
        failure = "Connexion à la Banque mondiale impossible.";
    }
    const at = new Date(this.now()).toISOString();
    if (failure) {
      this.save({
        ...this.cache,
        lastAttempt: {
          at,
          ok: false,
          message: failure,
          durationMs: this.now() - start,
        },
      });
    } else {
      const prior = new Map(
        (this.cache.capture?.observations || []).map((p) => [p.id, p.value]),
      );
      let added = 0,
        revised = 0,
        unchanged = 0;
      for (const p of result.observations) {
        if (!prior.has(p.id)) added++;
        else if (prior.get(p.id) !== p.value) revised++;
        else unchanged++;
      }
      this.save({
        version: 1,
        revision: this.cache.revision + Number(added > 0 || revised > 0),
        capture: { ...result, collectedAt: at },
        lastAttempt: {
          at,
          ok: true,
          message: "Instantané collecté.",
          durationMs: this.now() - start,
          added,
          revised,
          unchanged,
          observationCount: result.observations.length,
          availableCount: result.observations.filter((p) => p.value !== null)
            .length,
        },
      });
    }
    return this.snapshot();
  }
}
function macroExample() {
  const now = Date.UTC(2026, 9, 12);
  const period = periodFor(now);
  const observations = COUNTRIES.flatMap((country, ci) =>
    INDICATORS.flatMap((indicator, ii) =>
      Array.from({ length: 10 }, (_, n) => ({
        id: `${country.id}:${indicator.id}:${period.from + n}`,
        countryId: country.id,
        indicatorId: indicator.id,
        year: period.from + n,
        value:
          country.id === "USA" && ii === 1 && n === 9
            ? null
            : Math.round((1 + ci / 3 + ii + Math.sin(n) * 2) * 100) / 100,
      })),
    ),
  );
  return {
    ...view(
      {
        ...emptyCache(),
        capture: {
          period,
          observations,
          collectedAt: new Date(now).toISOString(),
          sourceUpdatedAt: "2026-10-01",
        },
      },
      now,
    ),
    synthetic: true,
  };
}
module.exports = { MacroSourceService, macroExample };
