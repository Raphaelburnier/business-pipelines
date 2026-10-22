// Exécute le vrai Bash de fusion contre un gh factice. Aucune requête réseau, aucun code de
// PR exécuté. Les preuves CI sont des métadonnées comme celles rendues par l'API GitHub.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const requireMoteur = require("node:module").createRequire(require.resolve("agent-orchestrator"));
const yaml = requireMoteur("yaml");
const fichier = path.join(__dirname, "../.github/workflows/agent-gated-merge.yml");
// L'image du NAS exclut `.github/` (.dockerignore) : ces tests du workflow tournent dans la
// CI GitHub, pas à l'étape « construire » d'une livraison (échec du 2026-10-06).
if (!fs.existsSync(fichier)) {
  test("workflow de fusion automatique", { skip: "pas de .github/ ici (image du NAS) : vérifié par la CI GitHub" }, () => {});
  return;
}
const workflow = yaml.parse(fs.readFileSync(fichier, "utf8"));
const script = workflow.jobs["gate-and-merge"].steps[0].run;
const HEAD = "a".repeat(40), BASE = "b".repeat(40), MERGE = "c".repeat(40);

const fauxGh = `#!/usr/bin/env node
const fs = require("node:fs");
const {execFileSync} = require("node:child_process");
const cfg = JSON.parse(fs.readFileSync(process.env.FAKE_GH_CONFIG, "utf8"));
const args = process.argv.slice(2);
const route = args.find((a) => a === "graphql" || a.startsWith("repos/"));
const compte = JSON.parse(fs.readFileSync(process.env.FAKE_GH_CALLS, "utf8"));
compte.push({route,args});
fs.writeFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(compte));
const nombre = compte.filter((c) => c.route === route).length;
let r;
if (route === "repos/r/p") r = {default_branch:"main"};
else if (route === "repos/r/p/commits/main") r = {sha: cfg.moveBase && nombre > 1 ? "d".repeat(40) : cfg.base};
else if (route === "repos/r/p/pulls/60") r = {...cfg.pr, ...(cfg.moveHead && nombre > 1 ? {head:{...cfg.pr.head,sha:"d".repeat(40)}} : {})};
else if (route.includes("/actions/workflows/ci.yml/runs?")) r = {total_count:cfg.total ?? 1,workflow_runs: [{...cfg.ci,...(cfg.retry && nombre > 1 ? {run_attempt:2,status:"in_progress",conclusion:null} : {})}]};
else if (route.includes("/attempts/")) r = {jobs:cfg.jobs};
else if (route.startsWith("repos/r/p/git/commits/")) r = {sha:cfg.merge,parents:cfg.parents.map(sha=>({sha}))};
else if (route === "graphql") r = {data:{repository:{pullRequest:{reviewThreads:{nodes:[{isResolved:!cfg.unresolved && !(cfg.lateThread && nombre > 1)}],pageInfo:{hasNextPage:false}}}}}};
else if (route.includes("/files?")) r = cfg.files;
else if (route.endsWith("/merge")) r = {merged:true,sha:"e".repeat(40)};
else throw new Error("unexpected route " + route);
const jq = args.indexOf("--jq");
process.stdout.write(jq >= 0 ? execFileSync("jq",["-r",args[jq+1]],{input:JSON.stringify(r),encoding:"utf8"}) : JSON.stringify(r));
`;

function lancer(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-bash-"));
  const ci = { id: 100, run_attempt: 1, run_number: 10, name: "CI", head_sha: HEAD, event: "pull_request", status: "completed", conclusion: "success", pull_requests: [{ number: 60, head: { sha: HEAD }, base: { ref: "main", sha: BASE } }] };
  const jobs = [{ head_sha: HEAD, status: "completed", conclusion: "success", steps: [{ name: `Verify tested merge (merge=${MERGE}, head=${HEAD}, base=${BASE})`, status: "completed", conclusion: "success" }] }];
  const files = [{ filename: "src/app.js" }];
  const pr = { state: "open", draft: false, head: { sha: HEAD, ref: "codex/test", repo: { full_name: "r/p" } }, base: { ref: "main" }, mergeable: true, mergeable_state: "clean", changed_files: 1 };
  const config = { ci, jobs, files, pr, base: BASE, merge: MERGE, parents: [BASE, HEAD], ...options };
  options.modifier?.(config);
  fs.writeFileSync(path.join(dir, "gh"), fauxGh, { mode: 0o755 });
  const cfg = path.join(dir, "config.json"), appels = path.join(dir, "calls.json"), resume = path.join(dir, "summary.md"), event = path.join(dir, "event.json");
  fs.writeFileSync(cfg, JSON.stringify(config));
  fs.writeFileSync(appels, "[]");
  fs.writeFileSync(resume, "");
  fs.writeFileSync(event, "{}");
  const resultat = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPOSITORY: "r/p", EVENT_NAME: "workflow_dispatch", DISPATCH_PR: "60", GH_TOKEN: "factice", GITHUB_STEP_SUMMARY: resume, GITHUB_EVENT_PATH: event, FAKE_GH_CONFIG: cfg, FAKE_GH_CALLS: appels } });
  return { ...resultat, resume: fs.readFileSync(resume, "utf8"), appels: JSON.parse(fs.readFileSync(appels, "utf8")) };
}

test("le workflow auto fusionne le triplet valide sans checkout et fixe le SHA", () => {
  const r = lancer();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.resume, /decision: merged/);
  const put = r.appels.find((a) => a.route.endsWith("/merge"));
  assert.ok(put.args.includes(`sha=${HEAD}`));
  assert.ok(put.args.includes("merge_method=squash"));
  assert.ok(!workflow.jobs["gate-and-merge"].steps.some((s) => s.uses?.includes("checkout")));
});

for (const [nom, options] of [
  ["ancienne base testée", { parents: ["d".repeat(40), HEAD] }],
  ["absence de preuve", { jobs: [] }],
  ["CI en échec", { modifier: (c) => { c.ci.conclusion = "failure"; } }],
  ["CI skipped", { modifier: (c) => { c.ci.conclusion = "skipped"; } }],
  ["liste CI incomplète", { total: 101 }],
  ["renommage d'un fichier sensible", { files: [{ filename: "src/config.txt", previous_filename: ".env.production" }] }],
  ["fichier sensible après la première page", { files: [...Array.from({ length: 100 }, (_, i) => ({ filename: `src/${i}.js` })), { filename: "Dockerfile" }], modifier: (c) => { c.pr.changed_files = 101; } }],
  ["liste de fichiers tronquée", { modifier: (c) => { c.pr.changed_files = 3001; } }],
  ["modification de la politique elle-même", { files: [{ filename: "src/github-merge-gates.js" }] }],
  ["politique partagée avec les badges", { files: [{ filename: "deploy/fichiers-sensibles.json" }] }],
  ["réglages d'agent", { files: [{ filename: ".claude/settings.json" }] }],
  ["serveur MCP", { files: [{ filename: "web/.mcp.json" }] }],
  ["dépendances", { files: [{ filename: "package-lock.json" }] }],
  ["code d'authentification", { files: [{ filename: "src/acces.js" }] }],
  ["exécution des agents", { files: [{ filename: "src/agent-runner.js" }] }],
  ["définition d'agent", { files: [{ filename: "agents/code-reviewer/v2/agent.md" }] }],
  ["conversation ouverte", { unresolved: true }],
  ["conversation ouverte tardivement", { lateThread: true }],
  ["nouvelle tentative CI", { retry: true }],
  ["base déplacée", { moveBase: true }],
  ["tête déplacée", { moveHead: true }],
]) {
  test(`le workflow auto refuse : ${nom}`, () => {
    const r = lancer(options);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.resume, /decision: refused/);
    const attendue = {
      "ancienne base testée": "CI merge parents", "absence de preuve": "CI merge proof",
      "CI en échec": "CI", "CI skipped": "CI", "liste CI incomplète": "CI pagination",
      "renommage d'un fichier sensible": "sensitive files", "fichier sensible après la première page": "sensitive files",
      "liste de fichiers tronquée": "changed files", "modification de la politique elle-même": "sensitive files",
      "politique partagée avec les badges": "sensitive files",
      "réglages d'agent": "sensitive files", "serveur MCP": "sensitive files", "dépendances": "sensitive files",
      "code d'authentification": "sensitive files", "exécution des agents": "sensitive files", "définition d'agent": "sensitive files",
      "conversation ouverte": "review threads", "conversation ouverte tardivement": "final review threads",
      "nouvelle tentative CI": "final CI", "base déplacée": "final base branch", "tête déplacée": "final HEAD",
    }[nom];
    assert.ok(r.resume.includes(`**Gate:** ${attendue}\n`), r.resume);
    assert.ok(!r.appels.some((a) => a.route.endsWith("/merge")));
  });
}

test("les trois workflows de fusion partagent le même script et passent bash -n", () => {
  for (const nom of ["business-pipelines", "agent-orchestrator", "agent-registry"]) {
    const f = path.join(__dirname, `../../${nom}/.github/workflows/agent-gated-merge.yml`);
    if (!fs.existsSync(f)) continue; // Le checkout CI du cockpit ne contient pas le registre.
    const autre = yaml.parse(fs.readFileSync(f, "utf8"));
    const code = autre.jobs["gate-and-merge"].steps[0].run;
    assert.equal(code, script);
    assert.equal(spawnSync("bash", ["-n"], { input: code }).status, 0);
  }
});
