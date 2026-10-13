const { createHash } = require("node:crypto");
const PROVIDER = {
  id: "eodhd",
  name: "EODHD · clôtures indicatives",
  url: "https://eodhd.com",
  termsUrl: "https://eodhd.com/financial-apis/terms-conditions",
  pricingUrl: "https://eodhd.com/pricing",
  frequency: "quotidienne, fin de journée",
};
const CATALOG = [
  {
    symbol: "AAPL",
    exchange: "US",
    name: "Apple",
    venue: "NASDAQ",
    currency: "USD",
    type: "Action",
    region: "États-Unis",
    demo: true,
    identityUrl: "https://investor.apple.com/stock-price/default.aspx",
  },
  {
    symbol: "VTI",
    exchange: "US",
    name: "Vanguard Total Stock Market ETF",
    venue: "NYSE Arca",
    currency: "USD",
    type: "ETF",
    region: "États-Unis",
    demo: true,
    identityUrl:
      "https://institutional.vanguard.com/assets/corp/fund_communications/pdf_publish/us-products/fact-sheet/F0970.pdf",
  },
  {
    symbol: "NESN",
    exchange: "SW",
    name: "Nestlé",
    venue: "SIX Swiss Exchange",
    currency: "CHF",
    type: "Action",
    region: "Suisse",
    demo: false,
    identityUrl:
      "https://www.six-group.com/en/market-data/shares/share-explorer/share-details.CH0038863350CHF4.html",
  },
  {
    symbol: "ASML",
    exchange: "AS",
    name: "ASML",
    venue: "Euronext Amsterdam",
    currency: "EUR",
    type: "Action",
    region: "Europe",
    demo: false,
    identityUrl:
      "https://live.euronext.com/en/product/equities/nl0010273215-xams",
  },
  {
    symbol: "7203",
    exchange: "TSE",
    name: "Toyota",
    venue: "Tokyo Stock Exchange",
    currency: "JPY",
    type: "Action",
    region: "Japon",
    demo: false,
    identityUrl: "https://global.toyota/en/ir/stock/",
  },
].map((i) => ({
  ...i,
  id: `eodhd:${i.exchange}:${i.symbol}`,
  code: `${i.symbol}.${i.exchange}`,
}));
const DAY = 86_400_000;
const MAX_BODY = 1_000_000;
function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function periodFor(now) {
  const to = new Date(now).toISOString().slice(0, 10);
  return {
    from: new Date(Date.parse(to) - 364 * DAY).toISOString().slice(0, 10),
    to,
  };
}
function requestUrl(instrument, period) {
  // Ce lien de provenance ne contient jamais le jeton, même en mode public.
  return `https://eodhd.com/api/eod/${instrument.code}?fmt=json&period=d&order=a&from=${period.from}&to=${period.to}`;
}
function parseResponse(raw, instrument, period) {
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    throw new Error("Réponse EODHD illisible.");
  }
  if (
    !validDate(period?.from) ||
    !validDate(period?.to) ||
    Date.parse(period.to) < Date.parse(period.from) ||
    Date.parse(period.to) - Date.parse(period.from) > 364 * DAY ||
    !Array.isArray(rows) ||
    rows.length > 365
  )
    throw new Error("Réponse EODHD invalide.");
  const seen = new Set();
  const positive = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
  return rows
    .map((r) => {
      if (
        !r ||
        !validDate(r.date) ||
        r.date < period.from ||
        r.date > period.to ||
        seen.has(r.date) ||
        ![r.open, r.high, r.low, r.close].every(positive) ||
        (r.adjusted_close != null && !positive(r.adjusted_close)) ||
        !Number.isSafeInteger(r.volume) ||
        r.volume < 0 ||
        r.high < Math.max(r.open, r.close, r.low) ||
        r.low > Math.min(r.open, r.close)
      )
        throw new Error(
          "Observation EODHD invalide : date, doublon, unité ou valeur.",
        );
      seen.add(r.date);
      return {
        id: `${instrument.id}:${r.date}`,
        date: r.date,
        close: r.close,
        adjustedClose: r.adjusted_close ?? null,
        volume: r.volume,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
const failures = {
  401: [
    "authentication",
    "Clé EODHD refusée. Vérifier la configuration serveur.",
  ],
  403: [
    "access-denied",
    "Accès refusé par EODHD pour cet instrument. Couverture non vérifiée.",
  ],
  404: ["not-found", "Instrument introuvable chez EODHD."],
  429: ["quota", "Limite EODHD atteinte. Les autres appels sont arrêtés."],
};
async function collect({
  instrument,
  token,
  period,
  fetchImpl = fetch,
  timeoutMs = 20_000,
}) {
  const url = requestUrl(instrument, period);
  const remote = new URL(url);
  remote.searchParams.set("api_token", token);
  let response;
  try {
    response = await fetchImpl(remote.href, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      const [kind, message] = failures[response.status] || [
        "network",
        `Source EODHD indisponible (HTTP ${response.status}).`,
      ];
      throw Object.assign(new Error(message), { kind });
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY)
          throw Object.assign(new Error("Réponse EODHD trop volumineuse."), {
            kind: "invalid-response",
          });
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let points;
    try {
      points = parseResponse(raw, instrument, period);
    } catch {
      throw Object.assign(
        new Error("Réponse EODHD invalide ; dernier historique conservé."),
        { kind: "invalid-response" },
      );
    }
    if (!points.length)
      throw Object.assign(
        new Error(
          "Aucun cours fourni pour cette période ; dernier historique conservé.",
        ),
        { kind: "empty" },
      );
    // Une réponse inhabituelle ne doit jamais enregistrer un jeton dans son corps.
    if (token !== "demo" && raw.includes(token))
      throw Object.assign(
        new Error("Réponse EODHD inattendue ; historique conservé."),
        { kind: "invalid-response" },
      );
    return {
      period,
      url,
      points,
      raw,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  } catch (error) {
    if (error.kind) throw error;
    if (error.name === "TimeoutError" || error.name === "AbortError")
      throw Object.assign(new Error("EODHD n’a pas répondu à temps."), {
        kind: "timeout",
      });
    // Ni erreur réseau brute ni corps HTTP distant : ils peuvent contenir le jeton.
    throw Object.assign(
      new Error("Connexion à EODHD impossible ; dernier historique conservé."),
      { kind: "network" },
    );
  }
}
module.exports = {
  PROVIDER,
  CATALOG,
  DAY,
  MAX_BODY,
  validDate,
  periodFor,
  requestUrl,
  parseResponse,
  collect,
};
