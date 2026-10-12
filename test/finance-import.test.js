const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { FinanceService } = require("../src/finance/service");
const { parseCsv, SCHEMAS } = require("../src/finance/imports");
const root = path.resolve(__dirname, "..");
const fixture = (kind) => ({ kind, fileName: `${kind}.csv`, csv: fs.readFileSync(path.join(root, "docs/finance/exemples", `${kind}.csv`), "utf8") });
function service(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-import-")); t.after(() => fs.rmSync(dir, { force: true, recursive: true })); return new FinanceService({ storageRoot: path.join(dir, "data") }); }

test("aperçu sans écriture ; confirmation, réimport et redémarrage gardent provenance et original", (t) => {
  const s = service(t); const original = fixture("mouvements"); const p = s.preview(original);
  assert.equal(p.newCount, 8); assert.equal(p.canConfirm, true); assert.equal(fs.existsSync(s.root), false); assert.equal(s.summary().empty, true);
  const receipt = s.confirm(p.token); assert.equal(receipt.added, 8); assert.deepEqual(s.confirm(p.token), receipt);
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600); assert.equal(fs.statSync(s.root).mode & 0o777, 0o700);
  const restarted = new FinanceService({ storageRoot: s.root });
  assert.equal(restarted.original(receipt.importId).csv, original.csv); assert.equal(restarted.summary().movements[0].line, 2);
  assert.equal(restarted.summary().movements[0].importId, receipt.importId); assert.equal(restarted.original(receipt.importId).sha256.length, 64);
  const duplicate = restarted.preview(original); assert.equal(duplicate.newCount, 0); assert.equal(duplicate.duplicateCount, 8); restarted.confirm(duplicate.token);
  assert.equal(restarted.summary().revision, 1); assert.equal(restarted.summary().movements.length, 8); assert.equal(restarted.summary().imports.length, 1);
});
test("conflit d’identifiant bloqué, sans import partiel ni remplacement", (t) => {
  const s = service(t); const input = fixture("mouvements"); s.confirm(s.preview(input).token);
  const p = s.preview({ ...input, csv: input.csv.replace("120000", "130000") });
  assert.equal(p.canConfirm, false); assert.match(p.issues[0].message, /Conflit/); assert.throws(() => s.confirm(p.token));
  assert.equal(s.summary().movements[0].data.amount_minor, 120000);
});
test("un aperçu devient périmé après un autre import ; les tokens expirent", (t) => {
  const s = service(t); const p1 = s.preview(fixture("mouvements")); const p2 = s.preview(fixture("soldes"));
  s.confirm(p2.token); assert.throws(() => s.confirm(p1.token), /changé/);
  let now = 0; const timed = new FinanceService({ storageRoot: s.root, now: () => now }); const p = timed.preview(fixture("mouvements")); now += 16 * 60_000;
  assert.throws(() => timed.confirm(p.token), /expiré/);
});
test("mapping explicite, séparateur point-virgule, BOM, cellules citées et lignes physiques", (t) => {
  const s = service(t); const input = fixture("mouvements");
  const mapped = input.csv.replace("amount_minor", "centimes").replace(/,/g, ";");
  const p = s.preview({ ...input, csv: "\uFEFF" + mapped, mapping: { amount_minor: "centimes" } }); assert.equal(p.canConfirm, true); assert.equal(p.newCount, 8);
  const csv = 'a,b\r\n"bonjour, \"\"toi\"\"\nencore",2\r\nx,3\r\n'; const parsed = parseCsv(csv);
  assert.equal(parsed.rows[0].cells[0], 'bonjour, "toi"\nencore'); assert.equal(parsed.rows[1].line, 4);
  assert.throws(() => parseCsv('a,b\n"non fermé,2'), /non fermé/);
  assert.throws(() => parseCsv('a,a\n1,2'), /uniques/);
});
test("montants décimaux, signes, dates impossibles et devises non couvertes sont refusés", (t) => {
  const s = service(t); const original = fixture("mouvements");
  for (const [old, replacement] of [["120000", "1200.25"], ["120000", "-120000"], ["2026-10-02", "2026-02-30"], ["CHF", "JPY"], ["internal_transfer,t1", "internal_transfer,"]]) {
    const p = s.preview({ ...original, csv: original.csv.replace(old, replacement) }); assert.equal(p.canConfirm, false, replacement); assert.throws(() => s.confirm(p.token));
  }
  assert.equal(s.summary().empty, true);
});
test("deux soldes contradictoires au même jour sont bloqués même avec identifiants différents", (t) => {
  const s = service(t); const input = fixture("soldes"); s.confirm(s.preview(input).token);
  const p = s.preview({ ...input, csv: SCHEMAS.soldes.join(",") + "\na,CHF,2026-10-01,100,new\na,CHF,2026-10-01,101,other\n" });
  assert.equal(p.canConfirm, false); assert.match(p.issues[0].message, /Deux soldes/);
});
test("un stockage tronqué n’est jamais remplacé par une trésorerie vide", (t) => {
  const s = service(t); fs.mkdirSync(s.root); fs.writeFileSync(s.file, '{"version":');
  assert.throws(() => new FinanceService({ storageRoot: s.root })); assert.equal(fs.readFileSync(s.file, "utf8"), '{"version":');
});
test("attributions explicites persistées, aucun business implicite ; échec disque sans mutation", (t) => {
  const s = service(t); s.confirm(s.preview(fixture("mouvements")).token);
  assert.throws(() => s.setAccountScope({ accountId: "absent", ownership: "dedicated", businessId: "demo-business" }));
  assert.throws(() => s.setAccountScope({ accountId: "demo-courant", ownership: "dedicated" }));
  s.setAccountScope({ accountId: "demo-courant", ownership: "dedicated", businessId: "demo-business" });
  assert.equal(new FinanceService({ storageRoot: s.root }).summary().accountScopes[0].businessId, "demo-business");
  s.setAccountScope({ accountId: "demo-courant", ownership: "shared", businessId: "ignoré" }); assert.equal(s.summary().accountScopes[0].businessId, "");
  const broken = service(t); fs.writeFileSync(broken.root, "un fichier, pas un dossier");
  assert.throws(() => broken.confirm(broken.preview(fixture("mouvements")).token)); assert.equal(broken.summary().empty, true); assert.equal(broken.summary().revision, 0);
});

test("routes Finance réelles : identité, origine, JSON, tailles et exemple séparé", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "finance-http-"));
  const reserve = http.createServer(); await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve)); const port = reserve.address().port; await new Promise((resolve) => reserve.close(resolve));
  const child = spawn(process.execPath, [path.join(root, "bin/cockpit.js")], { cwd: root, env: { ...process.env, COCKPIT_PORT: String(port), COCKPIT_TAILNET: "finance.test.ts.net", COCKPIT_OPERATEUR_LOCAL: "", FINANCE_STORAGE_ROOT: path.join(dir, "finance"), AI_STUDIO_STORAGE_ROOT: path.join(dir, "studio"), AI_STUDIO_ARCHIVE_ROOT: path.join(dir, "archive"), ORCH_EVENT_STORE: path.join(dir, "events.sqlite") }, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once("exit", r)); } fs.rmSync(dir, { force: true, recursive: true }); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Démarrage cockpit expiré")), 8000); child.stdout.on("data", (d) => { if (String(d).includes("Cockpit sur")) { clearTimeout(timer); resolve(); } }); child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`cockpit exit ${code}`)); }); });
  const identity = { "tailscale-user-login": "finance-test" };
  function request(route, body, headers = identity) {
    return new Promise((resolve, reject) => {
      const raw = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ host: "127.0.0.1", port, path: `/api/finance/${route}`, method: raw === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(raw ? { "content-length": Buffer.byteLength(raw) } : {}), ...headers } }, (res) => {
        let text = ""; res.setEncoding("utf8"); res.on("data", (chunk) => text += chunk); res.on("end", () => resolve({ status: res.statusCode, headers: { get: (name) => res.headers[name] }, json: async () => JSON.parse(text), text: async () => text }));
      });
      req.on("error", reject); req.end(raw);
    });
  }
  assert.equal((await request("summary", undefined, { host: "finance.test.ts.net" })).status, 403);
  assert.equal((await request("summary", undefined, { host: "intrus.example" })).status, 403);
  const empty = await request("summary"); assert.equal(empty.headers.get("cache-control"), "no-store"); assert.equal((await empty.json()).empty, true);
  assert.equal((await request("imports/preview", fixture("mouvements"), { ...identity, origin: "https://intrus.example" })).status, 403);
  assert.equal((await request("imports/preview", fixture("mouvements"), { ...identity, "content-type": "text/plain" })).status, 415);
  assert.equal((await request("imports/preview", { ...fixture("mouvements"), csv: "x".repeat(2_100_001) })).status, 413);
  const example = await (await request("example?from=2026-10-01&to=2026-11-01")).json(); assert.equal(example.synthetic, true); assert.equal(example.buckets.find((b) => b.currency === "CHF").closing, 210000);
  assert.equal((await (await request("summary")).json()).empty, true); assert.equal(fs.existsSync(path.join(dir, "finance")), false);
  const p = await (await request("imports/preview", fixture("mouvements"))).json(); assert.equal(p.canConfirm, true);
  const receipt = await (await request("imports/confirm", { token: p.token })).json(); assert.equal(receipt.added, 8);
  assert.equal((await (await request("summary")).json()).movements.length, 8);
  assert.equal(await (await request(`imports/${receipt.importId}`)).text(), fixture("mouvements").csv);
  assert.equal((await request("imports/not-found")).status, 404);
  assert.equal((await request("templates/soldes")).headers.get("content-type"), "text/csv; charset=utf-8");
});
test("limite de lignes contrôlée même sans saut final ; types d’import non autorisés refusés", (t) => {
  const s = service(t);
  assert.throws(() => parseCsv("a\n" + Array.from({ length: 10001 }, () => "x").join("\n")), /10 000/);
  assert.throws(() => s.preview({ kind: "constructor", fileName: "x.csv", csv: "a\n1" }), /inconnu/);
});
