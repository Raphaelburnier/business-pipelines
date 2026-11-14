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
const route = args[0] === "run" ? "run " + args[1] : args.find((a) => a === "graphql" || a.startsWith("repos/"));
const compte = JSON.parse(fs.readFileSync(process.env.FAKE_GH_CALLS, "utf8"));
compte.push({route,args});
fs.writeFileSync(process.env.FAKE_GH_CALLS, JSON.stringify(compte));
const nombre = compte.filter((c) => c.route === route).length;
const echouer = (message) => { process.stderr.write(message + "\\n"); process.exit(1); };
let r;
if (route === "run download") {
  const verdict = (cfg.verdicts || {})[args[args.indexOf("-n") + 1]];
  if (!verdict || args[args.indexOf("-R") + 1] !== "r/p" || args[2] !== String(cfg.revue.run.id)) echouer("no artifact matches any of the names or patterns provided");
  fs.writeFileSync(require("node:path").join(args[args.indexOf("-D") + 1], "verdict.json"), JSON.stringify(verdict));
  process.exit(0);
}
if (route.startsWith("repos/r/p/contents/.github/workflows/claude-code-review.yml?ref=")) {
  if (cfg.revue === null) echouer("gh: Not Found (HTTP 404)");
  if (cfg.presenceIllisible) echouer("gh: Server Error (HTTP 502)");
  if (!route.endsWith("?ref=" + cfg.base)) echouer("unexpected review presence ref " + route);
  r = {type:"file"};
}
else if (route === "repos/r/p") r = {default_branch:"main"};
else if (route.startsWith("repos/r/p/commits/" + "${HEAD}" + "/check-runs?check_name=claude-review")) r = {total_count: cfg.revue.checks.length, check_runs: cfg.lateReview && nombre > 1 ? [...cfg.revue.checks, {...cfg.revue.checks.at(-1), id: 999}] : cfg.revue.checks};
else if (route === "repos/r/p/actions/runs/" + cfg.revue?.run?.id) r = cfg.revue.run;
else if (route === "repos/r/p/pulls") r = cfg.candidats || [];
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
  // Revue approuvée par défaut (lot 6.2) : check du job claude-review, run pull_request_target
  // du workflow de la branche par défaut, et verdict de son artefact.
  const revue = {
    checks: [{ id: 500, head_sha: HEAD, status: "completed", conclusion: "success", app: { slug: "github-actions" }, details_url: "https://github.com/r/p/actions/runs/700/job/800" }],
    run: { id: 700, path: ".github/workflows/claude-code-review.yml", event: "pull_request_target", head_sha: HEAD, repository: { full_name: "r/p" }, head_repository: { full_name: "r/p" }, status: "completed", conclusion: "success", run_attempt: 1 },
  };
  const verdict = { schema_version: 1, repository: "r/p", pr: 60, head_sha: HEAD, base_sha: BASE, run_id: "700", run_attempt: "1", relecteur: "claude", status: "reviewed", verdict: "approved", summary: "Revue complète.", reviewed_files: ["src/app.js"], findings: [] };
  const config = { ci, jobs, files, pr, base: BASE, merge: MERGE, parents: [BASE, HEAD], revue, verdicts: { "github-review-verdict-1": verdict }, ...options };
  options.modifier?.(config);
  fs.writeFileSync(path.join(dir, "gh"), fauxGh, { mode: 0o755 });
  const cfg = path.join(dir, "config.json"), appels = path.join(dir, "calls.json"), resume = path.join(dir, "summary.md"), event = path.join(dir, "event.json");
  fs.writeFileSync(cfg, JSON.stringify(config));
  fs.writeFileSync(appels, "[]");
  fs.writeFileSync(resume, "");
  fs.writeFileSync(event, JSON.stringify(options.evenement || {}));
  const resultat = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, REPOSITORY: "r/p", EVENT_NAME: options.evenement ? "workflow_run" : "workflow_dispatch", DISPATCH_PR: "60", GH_TOKEN: "factice", GITHUB_STEP_SUMMARY: resume, GITHUB_EVENT_PATH: event, FAKE_GH_CONFIG: cfg, FAKE_GH_CALLS: appels } });
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

// Lot 6.2 : la fusion exige l'approbation de la revue (Claude ou son relais Codex) sur la tête.
const finRevue = (changements = {}) => ({ workflow_run: { name: "Claude Code Review", path: ".github/workflows/claude-code-review.yml", event: "pull_request_target", head_branch: "codex/test", head_sha: HEAD, head_repository: { full_name: "r/p" }, pull_requests: [], ...changements } });
const verdictModifie = (champs) => (c) => Object.assign(c.verdicts["github-review-verdict-1"], champs);

test("le gate fusionne une approbation Claude ou du relais Codex et la consigne", () => {
  assert.match(lancer().resume, /\*\*Review:\*\* approved by claude \(run 700 attempt 1\)/);
  const r = lancer({ modifier: verdictModifie({ relecteur: "codex" }) });
  assert.match(r.resume, /decision: merged/);
  assert.match(r.resume, /\*\*Review:\*\* approved by codex \(run 700 attempt 1\)/);
  const telechargement = r.appels.find((a) => a.route === "run download");
  assert.deepEqual(telechargement.args.slice(0, 7), ["run", "download", "700", "-R", "r/p", "-n", "github-review-verdict-1"]);
});

test("sans workflow de revue sur la base, l'exigence reste inactive", () => {
  const r = lancer({ revue: null });
  assert.match(r.resume, /decision: merged/);
  assert.match(r.resume, /\*\*Review:\*\* not configured/);
  assert.ok(!r.appels.some((a) => a.route?.includes("check-runs")));
});

test("la fin de la revue relance le gate et retrouve la PR par sa branche et sa tête", () => {
  const r = lancer({ evenement: finRevue(), candidats: [{ number: 60, head: { sha: HEAD } }, { number: 61, head: { sha: "d".repeat(40) } }] });
  assert.match(r.resume, /decision: merged/);
  assert.ok(r.appels.find((a) => a.route === "repos/r/p/pulls").args.includes("head=r:codex/test"));
});

for (const [nom, options, attendue] of [
  ["aucune revue sur la tête", { modifier: (c) => { c.revue.checks = []; } }, "review"],
  ["revue indisponible (quota ou panne)", { modifier: (c) => { c.revue.checks[0].conclusion = "failure"; } }, "review"],
  ["revue encore en cours", { modifier: (c) => { Object.assign(c.revue.checks[0], { status: "in_progress", conclusion: null }); } }, "review"],
  ["check publié par une autre application", { modifier: (c) => { c.revue.checks[0].app.slug = "autre-app"; } }, "review"],
  ["présence du workflow de revue illisible", { presenceIllisible: true }, "review"],
  ["run de revue déclenché par une branche", { modifier: (c) => { c.revue.run.event = "pull_request"; } }, "review provenance"],
  ["autre workflow sous le même nom de job", { modifier: (c) => { c.revue.run.path = ".github/workflows/faux.yml"; } }, "review provenance"],
  ["run de revue sur une autre tête", { modifier: (c) => { c.revue.run.head_sha = "d".repeat(40); } }, "review provenance"],
  ["artefact de verdict absent", { verdicts: {} }, "review verdict"],
  ["corrections demandées", { modifier: verdictModifie({ verdict: "changes_requested", findings: [{ path: "src/app.js" }] }) }, "review verdict"],
  ["revue incomplète", { modifier: verdictModifie({ status: "unavailable", verdict: null, reason: "incomplete" }) }, "review verdict"],
  ["verdict d'un autre commit", { modifier: verdictModifie({ head_sha: "d".repeat(40) }) }, "review verdict"],
  ["verdict d'une autre PR", { modifier: verdictModifie({ pr: 61 }) }, "review verdict"],
  ["verdict d'une autre tentative", { modifier: verdictModifie({ run_attempt: "2" }) }, "review verdict"],
  ["relecteur inconnu", { modifier: verdictModifie({ relecteur: "autre" }) }, "review verdict"],
  ["nouvelle revue lancée après validation", { lateReview: true }, "final review"],
  ["fin de revue d'un workflow de branche", { evenement: finRevue({ event: "pull_request" }), candidats: [{ number: 60, head: { sha: HEAD } }] }, "workflow identity"],
  ["fin de revue sans PR ouverte sur cette tête", { evenement: finRevue(), candidats: [{ number: 61, head: { sha: "d".repeat(40) } }] }, "PR resolution"],
]) {
  test(`le gate refuse sans approbation valide : ${nom}`, () => {
    const r = lancer(options);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.resume, /decision: refused/);
    assert.ok(r.resume.includes(`**Gate:** ${attendue}\n`), r.resume);
    assert.ok(!r.appels.some((a) => a.route?.endsWith("/merge")));
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
