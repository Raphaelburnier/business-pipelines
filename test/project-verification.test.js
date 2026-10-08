const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { schemas } = require("agent-orchestrator/packages/schemas");
const { resoudreProjet } = require("agent-orchestrator/src/registre");

const fiche = path.join(__dirname, "../projects/steam-tierlist/project.json");
const projet = schemas.projet.parse(JSON.parse(fs.readFileSync(fiche, "utf8")));
assert.equal(projet.pipelines[0].extends, "improve-app@7");
assert.equal(projet.verification.prepareNetwork, true);
assert.deepEqual(projet.verification.prepare[0].args, ["run", "prepare:run"]);
assert.deepEqual(projet.verification.checks[0].args, ["test"]);
assert.equal(projet.verification.checks[0].kind, "test");
assert.match(projet.repoWorkers, /:\/volume1\/docker\/git\/steam-tierlist\.git$/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "profil-projet-"));
try {
  const d = path.join(root, "pipelines/improve-app/v7"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "pipeline.json"), JSON.stringify({ name: "improve-app", version: 7, nodes: [
    { id: "verify", type: "script", handler: "verify-project", runsOn: "pc", params: { verification: { checks: [{ command: "false", kind: "test" }] } },
      outcomeFrom: { report: "test-report.json", field: "verdict", items: "failures" } }], edges: [] }));
  const { pipeline } = resoudreProjet(fiche, { registre: root });
  assert.deepEqual(pipeline.nodes[0].params.verification, projet.verification);
  assert.ok(pipeline.nodes[0].params.exchangeFiles.includes("test-report.json"));
  const sansProfil = path.join(root, "project.json"); const p = { ...projet }; delete p.verification;
  fs.writeFileSync(sansProfil, JSON.stringify(p));
  assert.throws(() => resoudreProjet(sansProfil, { registre: root }), /verification requise/);
  console.log("Profil Steam : schema, placement, commandes operateur et refus sans profil OK");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
