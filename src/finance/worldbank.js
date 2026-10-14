const { createHash } = require("node:crypto");
const COUNTRIES = [
  { id: "CHE", query: "CH", name: "Suisse" },
  { id: "USA", query: "US", name: "États-Unis" },
  { id: "EUU", query: "EU", name: "Union européenne" },
  { id: "CHN", query: "CN", name: "Chine" },
  { id: "JPN", query: "JP", name: "Japon" },
  { id: "WLD", query: "WLD", name: "Monde" },
];
const INDICATORS = [
  {
    id: "NY.GDP.MKTP.KD.ZG",
    name: "Croissance du PIB réel",
    unit: "% par an",
    definition: "Variation annuelle du PIB à prix constants.",
    attribution: "Statistiques nationales, OCDE et Banque mondiale",
    url: "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG",
  },
  {
    id: "FP.CPI.TOTL.ZG",
    name: "Inflation des prix à la consommation",
    unit: "% par an",
    definition: "Variation annuelle des prix du panier de consommation.",
    attribution: "FMI — International Financial Statistics",
    url: "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG",
  },
];
const PROVIDER = {
  id: "worldbank-wdi",
  name: "Banque mondiale · World Development Indicators",
  url: "https://data.worldbank.org",
  license: "CC BY 4.0",
  termsUrl: "https://data.worldbank.org/summary-terms-of-use",
  frequency: "annuelle",
};
const MAX_BODY = 512_000;
function periodFor(now) {
  const year = new Date(now).getUTCFullYear();
  return { from: year - 10, to: year - 1 };
}
function requestUrl(period) {
  return `https://api.worldbank.org/v2/country/${COUNTRIES.map((c) => c.query).join(";")}/indicator/${INDICATORS.map((i) => i.id).join(";")}?source=2&format=json&date=${period.from}:${period.to}&per_page=1000&page=1`;
}
function parseResponse(raw, period) {
  let response;
  try {
    response = JSON.parse(raw);
  } catch {
    throw new Error("Réponse Banque mondiale illisible.");
  }
  const [meta, rows] = Array.isArray(response) ? response : [];
  const expected =
    COUNTRIES.length * INDICATORS.length * (period.to - period.from + 1);
  if (
    !meta ||
    meta.page !== 1 ||
    meta.pages !== 1 ||
    Number(meta.total) !== expected ||
    !Array.isArray(rows) ||
    rows.length !== expected
  )
    throw new Error(
      "Réponse Banque mondiale incomplète ou pagination inattendue.",
    );
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(meta.lastupdated) ||
    !Number.isFinite(Date.parse(meta.lastupdated)) ||
    new Date(meta.lastupdated).toISOString().slice(0, 10) !== meta.lastupdated
  )
    throw new Error("Date de mise à jour de la source invalide.");
  const points = new Map();
  for (const row of rows) {
    const countryId = row?.countryiso3code;
    const indicatorId = row?.indicator?.id;
    const year = Number(row?.date);
    if (
      !COUNTRIES.some((c) => c.id === countryId) ||
      !INDICATORS.some((i) => i.id === indicatorId) ||
      !/^\d{4}$/.test(row.date) ||
      year < period.from ||
      year > period.to ||
      (row.value !== null &&
        (typeof row.value !== "number" || !Number.isFinite(row.value)))
    )
      throw new Error(
        "Point macro invalide : pays, période, série ou valeur inattendus.",
      );
    const id = `${countryId}:${indicatorId}:${year}`;
    if (points.has(id))
      throw new Error("Réponse Banque mondiale avec un point en double.");
    points.set(id, { id, countryId, indicatorId, year, value: row.value });
  }
  return {
    sourceUpdatedAt: meta.lastupdated,
    observations: [...points.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
async function collect({
  fetchImpl = fetch,
  now = Date.now(),
  timeoutMs = 20_000,
} = {}) {
  const period = periodFor(now);
  const url = requestUrl(period);
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Banque mondiale indisponible (HTTP ${response.status}).`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY)
        throw new Error("Réponse Banque mondiale trop volumineuse.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return {
    period,
    url,
    ...parseResponse(raw, period),
    raw,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
}
module.exports = {
  COUNTRIES,
  INDICATORS,
  PROVIDER,
  MAX_BODY,
  periodFor,
  requestUrl,
  parseResponse,
  collect,
};
