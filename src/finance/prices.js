const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const {
  PROVIDER,
  CATALOG,
  DAY,
  periodFor,
  validDate,
  requestUrl,
  parseResponse,
  collect,
} = require("./eodhd");
const LIMIT = 20;
const MAX_CACHE = 6_000_000;
const emptyCache = () => ({
  version: 1,
  revision: 0,
  watchlist: CATALOG.filter((i) => i.demo).map((i) => i.id),
  entries: {},
  budget: { day: null, used: 0 },
  lastAttempt: null,
});
function validateWatchlist(ids) {
  if (
    !Array.isArray(ids) ||
    ids.length > CATALOG.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !CATALOG.some((i) => i.id === id))
  )
    throw new Error(
      "Choisir des instruments distincts dans le catalogue de suivi.",
    );
}
function validAttempt(a, aggregate = false) {
  const statuses = [
    "pending",
    "ok",
    "needs-key",
    "access-denied",
    "not-found",
    "quota",
    "network",
    "invalid-response",
    "authentication",
    "timeout",
    "empty",
    "skipped",
  ];
  return (
    a === null ||
    (a &&
      Number.isFinite(Date.parse(a.at)) &&
      typeof a.message === "string" &&
      a.message.length < 250 &&
      Number.isFinite(a.durationMs) &&
      a.durationMs >= 0 &&
      (aggregate
        ? typeof a.ok === "boolean" &&
          [a.requests, a.successes, a.failures].every(
            (n) => Number.isInteger(n) && n >= 0 && n <= 5,
          )
        : statuses.includes(a.status)))
  );
}
function view(cache, now, personal) {
  const today = new Date(now).toISOString().slice(0, 10);
  const used = cache.budget.day === today ? cache.budget.used : 0;
  return {
    provider: PROVIDER,
    mode: personal ? "personal" : "demo",
    period: periodFor(now),
    revision: cache.revision,
    watchlist: cache.watchlist,
    catalog: CATALOG,
    instruments: CATALOG.map((i) => {
      const entry = cache.entries[i.id];
      const c = entry?.capture;
      const points = c?.points || [];
      const latest = points.at(-1) || null;
      const ageDays = latest
        ? Math.max(
            0,
            Math.floor((Date.parse(today) - Date.parse(latest.date)) / DAY),
          )
        : null;
      return {
        ...i,
        followed: cache.watchlist.includes(i.id),
        collectionAllowed: personal || i.demo,
        status:
          entry?.attempt?.status ||
          (!personal && !i.demo ? "needs-key" : "uncollected"),
        lastAttempt: entry?.attempt || null,
        points,
        latest,
        collectedAt: c?.collectedAt || null,
        period: c?.period || null,
        ageDays,
        dateNeedsCheck: ageDays !== null && ageDays > 5,
        cacheStale: !c || now - Date.parse(c.collectedAt) >= 7 * DAY,
        coverageVerified: !!c,
        sha256: c?.sha256 || null,
      };
    }),
    budget: {
      day: today,
      used,
      limit: LIMIT,
      remaining: LIMIT - used,
      resetsAt: new Date(Date.parse(today) + DAY).toISOString(),
    },
    lastAttempt: cache.lastAttempt,
    nextRefreshAt: cache.lastAttempt
      ? new Date(Date.parse(cache.lastAttempt.at) + 60_000).toISOString()
      : null,
  };
}
class PriceSourceService {
  constructor({
    storageRoot,
    token = "",
    fetchImpl = fetch,
    now = Date.now,
    timeoutMs = 20_000,
  }) {
    this.root = storageRoot;
    this.file = path.join(storageRoot, "cours.json");
    this.token = String(token).trim() || "demo";
    this.personal = this.token !== "demo";
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.inFlight = null;
    this.cache = emptyCache();
    if (fs.existsSync(this.file)) {
      if (fs.statSync(this.file).size > MAX_CACHE)
        throw new Error("Cache cours trop volumineux.");
      const stored = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (
        stored.version !== 1 ||
        !Number.isSafeInteger(stored.revision) ||
        stored.revision < 0 ||
        !stored.entries ||
        typeof stored.entries !== "object" ||
        Array.isArray(stored.entries) ||
        !stored.budget ||
        !(stored.budget.day === null || validDate(stored.budget.day)) ||
        !Number.isInteger(stored.budget.used) ||
        stored.budget.used < 0 ||
        stored.budget.used > LIMIT ||
        !validAttempt(stored.lastAttempt, true)
      )
        throw new Error("Cache cours invalide.");
      validateWatchlist(stored.watchlist);
      for (const [id, entry] of Object.entries(stored.entries)) {
        const instrument = CATALOG.find((i) => i.id === id);
        if (!instrument || !entry || !validAttempt(entry.attempt))
          throw new Error("Entrée cours invalide.");
        if (entry.capture !== null) {
          const c = entry.capture;
          if (
            !c ||
            typeof c.raw !== "string" ||
            !Number.isFinite(Date.parse(c.collectedAt)) ||
            createHash("sha256").update(c.raw).digest("hex") !== c.sha256
          )
            throw new Error("Empreinte ou date du cache cours invalide.");
          const points = parseResponse(c.raw, instrument, c.period);
          if (!points.length) throw new Error("Historique cours vide.");
          entry.capture = {
            ...c,
            points,
            url: requestUrl(instrument, c.period),
          };
        }
      }
      this.cache = stored;
    }
  }
  snapshot() {
    return view(this.cache, this.now(), this.personal);
  }
  original(id) {
    const instrument = CATALOG.find((i) => i.id === id);
    const c = instrument && this.cache.entries[id]?.capture;
    if (!c)
      throw Object.assign(
        new Error("Aucun cours collecté pour cet instrument."),
        { status: 404 },
      );
    return {
      provider: PROVIDER,
      instrument,
      period: c.period,
      collectedAt: c.collectedAt,
      url: c.url,
      sha256: c.sha256,
      response: JSON.parse(c.raw),
    };
  }
  save(next) {
    const serialized = JSON.stringify(next);
    if (Buffer.byteLength(serialized) > MAX_CACHE)
      throw new Error("Cache cours trop volumineux.");
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
  setWatchlist(ids) {
    validateWatchlist(ids);
    if (this.inFlight)
      throw Object.assign(
        new Error("Attendre la fin de la collecte avant de modifier le suivi."),
        { status: 409 },
      );
    if (JSON.stringify(ids) !== JSON.stringify(this.cache.watchlist))
      this.save({
        ...this.cache,
        watchlist: [...ids],
        revision: this.cache.revision + 1,
      });
    return this.snapshot();
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
    const period = periodFor(start);
    let requests = 0,
      successes = 0,
      failures = 0,
      stop = null;
    let added = 0,
      revised = 0,
      removed = 0;
    this.save({
      ...this.cache,
      lastAttempt: {
        at: new Date(start).toISOString(),
        ok: false,
        message: "Collecte lancée ; résultat non enregistré.",
        requests: 0,
        successes: 0,
        failures: 0,
        durationMs: 0,
      },
    });
    for (const id of this.cache.watchlist) {
      const instrument = CATALOG.find((i) => i.id === id);
      const previous = this.cache.entries[id] || {
        capture: null,
        attempt: null,
      };
      const at = new Date(this.now()).toISOString();
      const used =
        this.cache.budget.day === at.slice(0, 10) ? this.cache.budget.used : 0;
      let status,
        message,
        capture = previous.capture;
      if (!this.personal && !instrument.demo) {
        status = "needs-key";
        message =
          "Clé personnelle nécessaire ; aucun appel public pour cet instrument.";
      } else if (stop) {
        status = "skipped";
        message = stop;
      } else if (used >= LIMIT) {
        status = "quota";
        message = "Plafond local de 20 appels par jour UTC atteint.";
      }
      if (status) {
        failures++;
        this.save({
          ...this.cache,
          entries: {
            ...this.cache.entries,
            [id]: {
              ...previous,
              attempt: { at, status, message, durationMs: 0 },
            },
          },
        });
        continue;
      }
      // Réserver durablement avant l'appel, même si le processus est interrompu ensuite.
      this.save({
        ...this.cache,
        budget: { day: at.slice(0, 10), used: used + 1 },
        entries: {
          ...this.cache.entries,
          [id]: {
            ...previous,
            attempt: {
              at,
              status: "pending",
              message: "Tentative lancée ; résultat non enregistré.",
              durationMs: 0,
            },
          },
        },
      });
      requests++;
      const began = this.now();
      try {
        const result = await collect({
          instrument,
          period,
          token: this.token,
          fetchImpl: this.fetchImpl,
          timeoutMs: this.timeoutMs,
        });
        const prior = new Map(
          (previous.capture?.points || []).map((p) => [p.id, p]),
        );
        for (const p of result.points) {
          if (!prior.has(p.id)) added++;
          else if (JSON.stringify(p) !== JSON.stringify(prior.get(p.id)))
            revised++;
          prior.delete(p.id);
        }
        removed += prior.size;
        capture = {
          ...result,
          collectedAt: new Date(this.now()).toISOString(),
        };
        status = "ok";
        message = "Historique collecté.";
        successes++;
      } catch (error) {
        status = error.kind;
        message = error.message;
        failures++;
        if (status === "quota" || status === "authentication")
          stop = "Collecte arrêtée après un refus global du fournisseur.";
      }
      this.save({
        ...this.cache,
        entries: {
          ...this.cache.entries,
          [id]: {
            capture,
            attempt: {
              at: new Date(this.now()).toISOString(),
              status,
              message,
              durationMs: this.now() - began,
            },
          },
        },
      });
    }
    this.save({
      ...this.cache,
      revision: this.cache.revision + Number(added + revised + removed > 0),
      lastAttempt: {
        at: new Date(this.now()).toISOString(),
        ok: failures === 0,
        message: this.cache.watchlist.length
          ? `${successes} instrument(s) collecté(s), ${failures} indisponible(s).`
          : "Liste de suivi vide ; aucun appel.",
        requests,
        successes,
        failures,
        added,
        revised,
        removed,
        durationMs: this.now() - start,
      },
    });
    return this.snapshot();
  }
}
function pricesExample() {
  const cache = emptyCache();
  const now = Date.UTC(2026, 9, 13, 10);
  const period = periodFor(now);
  cache.watchlist = CATALOG.map((i) => i.id);
  CATALOG.forEach((i, index) => {
    const rows = Array.from({ length: 30 }, (_, n) => {
      const date = new Date(Date.UTC(2026, 8, 1 + n));
      const close =
        Math.round((100 + index * 20 + Math.sin(n / 5) * 10) * 100) / 100;
      return {
        date: date.toISOString().slice(0, 10),
        open: close,
        high: close + 1,
        low: close - 1,
        close,
        adjusted_close: close * 0.99,
        volume: 1000,
      };
    }).filter((r) => ![0, 6].includes(new Date(r.date).getUTCDay()));
    cache.entries[i.id] = {
      capture: {
        period,
        points: parseResponse(JSON.stringify(rows), i, period),
        collectedAt: new Date(now).toISOString(),
      },
      attempt: null,
    };
  });
  return { ...view(cache, now, true), synthetic: true };
}
module.exports = { PriceSourceService, pricesExample };
