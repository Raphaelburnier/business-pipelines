const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { schemas } = require("agent-orchestrator/packages/schemas");
const { resoudreProjet } = require("agent-orchestrator/src/registre");

const fiche = path.join(__dirname, "../projects/steam-tierlist/project.json");
const projet = schemas.projet.parse(JSON.parse(fs.readFileSync(fiche, "utf8")));
assert.equal(projet.pipelines[0].extends, "improve-app@8");
assert.equal(projet.verification.prepareNetwork, true);
assert.deepEqual(projet.verification.prepare[0].args, ["run", "prepare:run"]);
assert.deepEqual(projet.verification.checks[0].args, ["test"]);
assert.equal(projet.verification.checks[0].kind, "test");
assert.match(projet.repoWorkers, /:\/volume1\/docker\/git\/steam-tierlist\.git$/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "profil-projet-"));
try {
  const d = path.join(root, "pipelines/improve-app/v8"); fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "pipeline.json"), JSON.stringify({ name: "improve-app", version: 8, nodes: [
    { id: "verify", type: "script", handler: "verify-project", runsOn: "pc", params: { verification: { checks: [{ command: "false", kind: "test" }] } },
      outcomeFrom: { report: "test-report.json", field: "verdict", items: "failures" } }], edges: [] }));
  const { pipeline } = resoudreProjet(fiche, { registre: root });
  assert.deepEqual(pipeline.nodes[0].params.verification, projet.verification);
  assert.ok(pipeline.nodes[0].params.exchangeFiles.includes("test-report.json"));
  const yaml = require("node:module").createRequire(require.resolve("agent-orchestrator"))("yaml");
  const compose = yaml.parse(fs.readFileSync(path.join(__dirname, "../docker-compose.yaml"), "utf8"));
  const runner = compose.services.runner;
  const env = Object.fromEntries(runner.environment.map(v => {
    const i = v.indexOf("="); return [v.slice(0, i), v.slice(i + 1)];
  }));
  const autorises = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => {
    assert.equal(env[`GIT_CONFIG_KEY_${i}`], "safe.directory");
    return env[`GIT_CONFIG_VALUE_${i}`];
  });
  for (const id of ["agent-registry", "agent-secrets"]) {
    const fichier = path.join(__dirname, `../projects/${id}/project.json`);
    const p = schemas.projet.parse(JSON.parse(fs.readFileSync(fichier, "utf8")));
    const { pipeline } = resoudreProjet(fichier, { registre: root });
    assert.equal(p.homeMachine, "pc");
    assert.equal(p.publier, true);
    assert.equal(p.pipelines[0].overrides.nodes["review-security"].enabled, true);
    assert.deepEqual(pipeline.nodes[0].params.verification, p.verification);
    assert.ok(p.verification.checks.some(c => c.kind === "test"));
    assert.ok(runner.volumes.includes(`/volume1/docker/git/${id}.git:${p.repo}`),
      `${id} exige une copie de travail montée en écriture pour les checkpoints`);
    assert.ok(autorises.includes(p.repo), `${id} doit être clonable malgré son propriétaire hôte`);
  }
  assert.ok(runner.volumes.includes("./agent-registry:/app/agent-registry:ro"));
  const montagesGit = runner.volumes.filter(v => v.split(":")[1]?.startsWith("/git"));
  assert.ok(montagesGit.every(v => /^\/volume1\/docker\/git\/[^/:]+\.git:\/git\/[^/:]+\.git$/.test(v)),
    "seuls les dépôts de travail individuels sont accessibles, jamais /git entier ni /git/systeme");
  assert.equal(autorises.length, montagesGit.length);
  assert.equal(new Set(autorises).size, autorises.length);
  console.log("Projets système : profils résolus et copies de travail isolées des miroirs de confiance OK");
  const sansProfil = path.join(root, "project.json"); const p = { ...projet }; delete p.verification;
  fs.writeFileSync(sansProfil, JSON.stringify(p));
  assert.throws(() => resoudreProjet(sansProfil, { registre: root }), /verification requise/);
  console.log("Profil Steam : schema, placement, commandes operateur et refus sans profil OK");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
