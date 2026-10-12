const fs = require("node:fs");
const path = require("node:path");
const { SCHEMAS } = require("./imports");
const { emptyState } = require("./service");
const { validateImport } = require("./imports");
const { summarize } = require("./metrics");
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
function creerRouteurFinance({ service, json, corpsJson, durcissement }) {
  return async function (req, res) {
    const url = new URL(req.url, "http://localhost");
    if (
      url.pathname !== "/api/finance" &&
      !url.pathname.startsWith("/api/finance/")
    )
      return false;
    try {
      if (req.method === "GET" && url.pathname === "/api/finance/summary")
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
          ? "Stockage Finance indisponible. Aucun import confirmé ; consulter les logs serveur."
          : error.message,
      });
      if (operational) console.error("Finance:", error.message);
    }
    return true;
  };
}
module.exports = { creerRouteurFinance, exampleState };
