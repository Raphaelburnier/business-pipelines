// Le script de verdict d'improve-app : il valide le rapport du vérificateur et, avec une
// sortie, en recopie le verdict là où le moteur le lira.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", "bin", "valider-test-report.js");
const lancer = (dir, ...args) => execFileSync(process.execPath, [SCRIPT, ...args], { cwd: dir, stdio: "pipe" });
const dossier = (rapport) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verdict-"));
  if (rapport !== undefined) fs.writeFileSync(path.join(dir, "test-report.json"), JSON.stringify(rapport));
  return dir;
};

test("un rapport PASS est recopié dans verdict.json", () => {
  const dir = dossier({ verdict: "PASS", failures: [], notes: "28/28" });
  lancer(dir, "test-report.json", "verdict.json");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "verdict.json"), "utf-8")), { verdict: "PASS", failures: [] });
});

test("un rapport FAIL garde ses échecs", () => {
  const dir = dossier({ verdict: "FAIL", failures: [{ test: "x" }] });
  lancer(dir, "test-report.json", "verdict.json");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "verdict.json"), "utf-8")).failures, [{ test: "x" }]);
});

test("un rapport mal formé échoue sans écrire de verdict", () => {
  const dir = dossier({ verdict: "PEUT-ÊTRE", failures: [] });
  assert.throws(() => lancer(dir, "test-report.json", "verdict.json"));
  assert.ok(!fs.existsSync(path.join(dir, "verdict.json")));
});

test("sans sortie, le script valide seulement, comme pour improve-app@1 et @2", () => {
  const dir = dossier({ verdict: "PASS", failures: [] });
  lancer(dir, "test-report.json");
  assert.deepStrictEqual(fs.readdirSync(dir), ["test-report.json"]);
});
