const fs = require("node:fs");
const path = require("node:path");
const { SCHEMAS } = require("./imports");
const { emptyState } = require("./service");
const { validateImport } = require("./imports");
const { summarize } = require("./metrics");
const { macroExample } = require("./sources");
const { pricesExample } = require("./prices");
function exampleState() {
  const state = emptyState();
  for (const kind of Object.keys(SCHEMAS)) {
    const fileName = `${kind}.csv`;
    const csv = fs.readFileSync(
      path.join(__dirname, "../../docs/finance/exemples", fileName),
      "utf8",
    );
    const checked = validateImport({ kind, fileName, csv }, []);
    if (checked.issues.length) throw new Error("Fixture Finance invalide.");
    const id = `exemple-${kind}`;
    state[kind] = checked.records.map((r) => ({ ...r, importId: id }));
    state.imports.push({
      id,
      kind,
      fileName,
      importedAt: "2026-10-12T00:00:00Z",
      added: checked.records.length,
      synthetic: true,
    });
  }
  return state;
}
function creerRouteurFinance({
  service,
  macro,
  prices,
  reports = null,
  json,
  corpsJson,
  durcissement,
}) {
  return async function (req, res) {
    const url = new URL(req.url, "http://localhost");
    if (
      url.pathname !== "/api/finance" &&
      !url.pathname.startsWith("/api/finance/")
    )
      return false;
    try {
      if (url.pathname === "/api/finance/reports" && req.method === "GET") {
        if (!reports) json(res, 503, { erreur: "Archive des rapports Finance indisponible." });
        else json(res, 200, { reports: reports.lister({ projectId: url.searchParams.get("projectId") || undefined }) });
      } else if (/^\/api\/finance\/reports\/[^/]+$/.test(url.pathname) && req.method === "GET") {
        if (!reports) json(res, 503, { erreur: "Archive des rapports Finance indisponible." });
        else json(res, 200, reports.lire(decodeURIComponent(url.pathname.split("/").at(-1))));
      } else if (
        url.pathname === "/api/finance/prices/example" &&
        req.method === "GET"
      )
        json(res, 200, pricesExample());
      else if (
        url.pathname === "/api/finance/prices" ||
        url.pathname.startsWith("/api/finance/prices/")
      ) {
        if (!prices)
          json(res, 503, {
            erreur: "Cache des cours indisponible. Consulter les logs serveur.",
          });
        else if (req.method === "GET" && url.pathname === "/api/finance/prices")
          json(res, 200, prices.snapshot());
        else if (
          req.method === "GET" &&
          url.pathname === "/api/finance/prices/original"
        )
          json(res, 200, prices.original(url.searchParams.get("id")));
        else if (
          req.method === "POST" &&
          url.pathname === "/api/finance/prices/watchlist"
        ) {
          const body = await corpsJson(req, res);
          if (body) {
            if (Object.keys(body).some((k) => k !== "ids"))
              throw new Error(
                "Envoyer uniquement la liste d’identifiants du catalogue.",
              );
            json(res, 200, prices.setWatchlist(body.ids));
          }
        } else if (
          req.method === "POST" &&
          url.pathname === "/api/finance/prices/refresh"
        ) {
          const body = await corpsJson(req, res);
          if (body) {
            if (Object.keys(body).length)
              throw new Error(
                "La collecte utilise la liste de suivi ; envoyer un objet vide.",
              );
            json(res, 200, await prices.refresh());
          }
        } else json(res, 404, { erreur: "Route des cours inconnue." });
      } else if (
        url.pathname === "/api/finance/macro/example" &&
        req.method === "GET"
      )
        json(res, 200, macroExample());
      else if (
        url.pathname === "/api/finance/macro" ||
        url.pathname.startsWith("/api/finance/macro/")
      ) {
        if (!macro)
          json(res, 503, {
            erreur: "Cache macro indisponible. Consulter les logs serveur.",
          });
        else if (req.method === "GET" && url.pathname === "/api/finance/macro")
          json(res, 200, macro.snapshot());
        else if (
          req.method === "GET" &&
          url.pathname === "/api/finance/macro/original"
        )
          json(res, 200, macro.original());
        else if (
          req.method === "POST" &&
          url.pathname === "/api/finance/macro/refresh"
        ) {
          const body = await corpsJson(req, res);
          if (body) {
            if (Object.keys(body).length)
              throw new Error(
                "La collecte utilise uniquement le catalogue macro fixe ; envoyer un objet vide.",
              );
            json(res, 200, await macro.refresh());
          }
        } else json(res, 404, { erreur: "Route macro inconnue." });
      } else if (
        req.method === "GET" &&
        url.pathname === "/api/finance/summary"
      )
        json(res, 200, service.summary(Object.fromEntries(url.searchParams)));
      else if (req.method === "GET" && url.pathname === "/api/finance/example")
        json(res, 200, {
          ...summarize(exampleState(), Object.fromEntries(url.searchParams)),
          synthetic: true,
        });
      else if (
        req.method === "GET" &&
        /^\/api\/finance\/templates\/(mouvements|soldes|factures)$/.test(
          url.pathname,
        )
      ) {
        const kind = url.pathname.split("/").at(-1);
        const csv = SCHEMAS[kind].join(",") + "\n";
        res.writeHead(200, {
          ...durcissement,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${kind}.csv"`,
        });
        res.end(csv);
      } else if (
        req.method === "GET" &&
        /^\/api\/finance\/imports\/[^/]+$/.test(url.pathname)
      ) {
        const entry = service.original(url.pathname.split("/").at(-1));
        res.writeHead(200, {
          ...durcissement,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="import-finance.csv"',
        });
        res.end(entry.csv);
      } else if (
        req.method === "POST" &&
        url.pathname === "/api/finance/imports/preview"
      ) {
        const body = await corpsJson(req, res, 2_100_000);
        if (body) json(res, 200, service.preview(body));
      } else if (
        req.method === "POST" &&
        url.pathname === "/api/finance/imports/confirm"
      ) {
        const body = await corpsJson(req, res);
        if (body) json(res, 200, service.confirm(body.token));
      } else if (
        req.method === "POST" &&
        url.pathname === "/api/finance/accounts/scope"
      ) {
        const body = await corpsJson(req, res);
        if (body) json(res, 200, service.setAccountScope(body));
      } else json(res, 404, { erreur: "Route Finance inconnue." });
    } catch (error) {
      const operational = error.code || error instanceof SyntaxError;
      json(res, error.status || (operational ? 503 : 400), {
        erreur: operational
          ? url.pathname.startsWith("/api/finance/prices")
            ? "Stockage des cours indisponible. Consulter les logs serveur."
            : url.pathname.startsWith("/api/finance/macro")
              ? "Stockage macro indisponible. Consulter les logs serveur."
              : "Stockage Finance indisponible. Aucun import confirmé ; consulter les logs serveur."
          : error.message,
      });
      if (operational) console.error("Finance:", error.message);
    }
    return true;
  };
}
module.exports = { creerRouteurFinance, exampleState };
