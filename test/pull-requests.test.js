// Les PR GitHub vues et fusionnées depuis le cockpit : le relevé du publieur (contre une
// fausse API GitHub), et la fusion demandée par la page, refusée tant qu'elle n'a aucune chance.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventStore } = require("agent-orchestrator");
const pullRequests = require("../src/pull-requests");
const apiPullRequests = require("../src/api-pull-requests");

const DEPOT = "Raphaelburnier/business-pipelines";
const SHA = "e".repeat(40);
const BASE = "a".repeat(40);
const MERGE = "b".repeat(40);
const gates = require("../src/github-merge-gates");
const CORPS = "## Pourquoi\n\nLe marketing n'était pas lançable depuis le cockpit. Le run a échoué.\n\n## Ce qui change\n\n- rien";

// Une fausse API GitHub : une PR ouverte (CI verte, touche le compose) et une fusionnée.
function faussesAPI({ ci = "success", mergeable = true, tete = SHA, base = BASE, fichiers = [{ filename: "docker-compose.yaml" }, { filename: "src/stage-handlers.js" }], threads = [], changer = () => undefined, detail = {}, runs = null, jobs = null, parents = [base, tete] } = {}) {
  const appels = [];
  const pr = { number: 60, state: "open", title: "feat: marketing", html_url: "u", user: { login: "r" }, head: { ref: "claude/m", sha: tete, repo: { full_name: DEPOT } }, base: { ref: "main", sha: base }, draft: false, body: CORPS, created_at: "2026-10-05T12:00:00Z", mergeable, mergeable_state: mergeable ? "clean" : "dirty", changed_files: fichiers.length, ...detail };
  const run = { id: 100, workflow_id: 1, run_number: 10, run_attempt: 1, name: "CI", event: "pull_request", head_sha: tete, status: ci === "pending" ? "in_progress" : "completed", conclusion: ci === "pending" ? null : ci, pull_requests: [{ number: 60, head: { sha: tete }, base: { ref: "main", sha: base } }] };
  const job = { id: 200, head_sha: tete, status: "completed", conclusion: "success", steps: [{ name: `Verify tested merge (merge=${MERGE}, head=${tete}, base=${base})`, status: "completed", conclusion: "success" }] };
  const collection = (liste, url) => liste.slice((Number(url.searchParams.get("page") || 1) - 1) * 100, Number(url.searchParams.get("page") || 1) * 100);
  const api = async (methode, chemin, corps) => {
    appels.push({ methode, chemin, corps });
    const override = changer({ methode, chemin, corps, appels, pr, run, job });
    if (override !== undefined) return override;
    const url = new URL(chemin, "https://api.github.com");
    const route = url.pathname;
    if (chemin === `/repos/${DEPOT}`) return { default_branch: "main" };
    if (route === `/repos/${DEPOT}/commits/main`) return { sha: base };
    if (chemin.startsWith(`/repos/${DEPOT}/pulls?state=open`)) return collection([pr], url);
    if (route === `/repos/${DEPOT}/pulls/60`) return structuredClone(pr);
    if (route === `/repos/${DEPOT}/actions/workflows/ci.yml`) return { id: 1, name: "CI", path: ".github/workflows/ci.yml" };
    if (route === `/repos/${DEPOT}/actions/workflows/ci.yml/runs`) {
      const liste = runs || [run, { ...run, id: 99, run_number: 9, conclusion: "failure" }];
      return { total_count: liste.length, workflow_runs: collection(liste, url) };
    }
    if (/\/actions\/runs\/\d+\/attempts\/\d+\/jobs$/.test(route)) {
      const liste = jobs || [job];
      return { total_count: liste.length, jobs: collection(liste, url) };
    }
    if (route === `/repos/${DEPOT}/git/commits/${MERGE}`) return { sha: MERGE, parents: parents.map((sha) => ({ sha })) };
    if (route === `/repos/${DEPOT}/pulls/60/files`) return collection(fichiers, url);
    if (chemin === "/graphql") {
      const debut = Number(corps.variables.after || 0);
      const nodes = threads.slice(debut, debut + 100);
      return { data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: { hasNextPage: debut + 100 < threads.length, endCursor: String(debut + 100) } } } } } };
    }
    if (chemin.startsWith(`/repos/${DEPOT}/pulls?state=closed`)) {
      return [
        { number: 59, title: "feat: run approvals", html_url: "u59", merged_at: "2026-10-05T11:00:00Z", merge_commit_sha: BASE, head: { sha: MERGE }, body: "## Pourquoi\n\nTrancher depuis Décisions." },
        { number: 58, title: "fermée sans fusion", html_url: "u58", merged_at: null, head: { sha: "c".repeat(40) }, body: "" },
      ];
    }
    if (methode === "PUT" && chemin === `/repos/${DEPOT}/pulls/60/merge`) return { merged: true, sha: "f".repeat(40), message: "Pull Request successfully merged" };
    throw new Error(`appel inattendu : ${methode} ${chemin}`);
  };
  return { api, appels, pr, run, job };
}

test("le relevé porte la CI, les fichiers sensibles et la phrase « Pourquoi »", async () => {
  const { api } = faussesAPI();
  const releve = await pullRequests.relever({ api, depots: [DEPOT] });
  const [d] = releve.depots;
  assert.strictEqual(d.ouvertes.length, 1);
  const pr = d.ouvertes[0];
  assert.strictEqual(pr.ci.etat, "verte");
  assert.deepStrictEqual(pr.sensibles, ["docker-compose.yaml"]);
  assert.strictEqual(pr.pourquoi, "Le marketing n'était pas lançable depuis le cockpit.");
  assert.strictEqual(pullRequests.raisonDeNePasFusionner(pr), null);
  // Seules les PR fusionnées comptent, retrouvables par leur commit de fusion ou leur tête.
  assert.deepStrictEqual(d.fusionnees.map((f) => [f.numero, f.shas.length, f.pourquoi]), [[59, 2, "Trancher depuis Décisions."]]);
});

test("un dépôt illisible est signalé sans priver les autres", async () => {
  const api = async () => {
    throw new Error("GitHub GET : 404 Not Found");
  };
  const releve = await pullRequests.relever({ api, depots: ["x/y"] });
  assert.match(releve.depots[0].erreur, /404/);
});

test("une CI rouge, en cours ou absente, un conflit : pas de fusion", () => {
  const base = { etat: "open", interne: true, sha: SHA, baseSha: BASE, fichiersComplets: true, conversations: { ouvertes: 0 }, brouillon: false, versDefaut: true, base: "main", fusionnable: true, etatFusion: "clean", ci: { etat: "verte", preuve: { headSha: SHA, baseSha: BASE, mergeSha: MERGE } } };
  assert.strictEqual(pullRequests.raisonDeNePasFusionner(base), null);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, ci: { etat: "rouge" } }), /CI rouge/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, ci: { etat: "en_cours" } }), /en cours/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, ci: { etat: "absente" } }), /aucune CI/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, fusionnable: false, etatFusion: "dirty" }), /conflit/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, brouillon: true }), /brouillon/);
});

test("la fusion relit la PR sur GitHub et refuse une tête qui a bougé", async () => {
  const { api, appels } = faussesAPI();
  await assert.rejects(() => pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: "1".repeat(40), baseSha: BASE } }), /a bougé/);
  assert.ok(!appels.some((a) => a.methode === "PUT"), "aucune fusion tentée");
  const fusion = await pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE } });
  assert.strictEqual(fusion.fusionnee, true);
  const put = appels.find((a) => a.methode === "PUT");
  assert.deepStrictEqual(put.corps, { sha: SHA, merge_method: "squash" });
});

test("la fusion refuse une CI qui n'est plus verte au moment de fusionner", async () => {
  const { api, appels } = faussesAPI({ ci: "failure" });
  await assert.rejects(() => pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE } }), /CI rouge/);
  assert.ok(!appels.some((a) => a.methode === "PUT"));
});

function bac({ autorises = ["raphael@example.com"], releve = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pull-requests-"));
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const instantaneFichier = path.join(dir, "pull-requests.json");
  const autorisesFichier = path.join(dir, "livraison.json");
  fs.writeFileSync(autorisesFichier, JSON.stringify({ autorises }));
  if (releve) pullRequests.ecrireInstantane(instantaneFichier, releve);
  return { store, instantaneFichier, autorisesFichier };
}

const RAPHAEL = { par: "raphael@example.com", canal: "tailnet" };

test("la page dépose une fusion signée, une seule à la fois", async () => {
  const { api } = faussesAPI();
  const b = bac({ releve: await pullRequests.relever({ api, depots: [DEPOT] }) });
  const commande = apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE, par: "usurpateur" } });
  assert.strictEqual(commande.kind, "github.merge");
  assert.strictEqual(commande.par, RAPHAEL.par);
  assert.deepStrictEqual(commande.payload, { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE });
  const vue = apiPullRequests.etat({ ...b, qui: RAPHAEL });
  assert.strictEqual(vue.depots[0].ouvertes[0].fusionEnCours, true);
  assert.throws(() => apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE } }), /déjà demandée/);
});

test("pas de fusion pour une identité non autorisée, un relevé périmé ou une tête différente", async () => {
  const { api } = faussesAPI();
  const releve = await pullRequests.relever({ api, depots: [DEPOT] });
  const b = bac({ releve });
  assert.throws(() => apiPullRequests.demander({ ...b, qui: { par: "inconnu@example.com", canal: "tailnet" }, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE } }), (e) => e.code === 403);
  assert.throws(() => apiPullRequests.demander({ ...b, qui: { ...RAPHAEL, canal: "local" }, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE } }), (e) => e.code === 403);
  assert.throws(() => apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: "1".repeat(40), baseSha: BASE } }), (e) => e.code === 409);
  const vieux = bac({ releve: { ...releve, releveLe: "2026-01-01T00:00:00Z" } });
  assert.throws(() => apiPullRequests.demander({ ...vieux, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE } }), (e) => e.code === 503);
});

test("les dépôts surveillés : la liste explicite, sinon système et projets", () => {
  assert.deepStrictEqual(pullRequests.depotsSurveilles({ texte: "a/b, c/d, pas-un-depot" }), ["a/b", "c/d"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projets-"));
  fs.mkdirSync(path.join(dir, "steam"));
  fs.writeFileSync(path.join(dir, "steam", "project.json"), JSON.stringify({ github: "Raphaelburnier/steam_tierList" }));
  assert.deepStrictEqual(pullRequests.depotsSurveilles({ miroirs: [{ github: DEPOT }], projetsDir: dir }), [DEPOT, "Raphaelburnier/steam_tierList"]);
});

const demande = { depot: DEPOT, numero: 60, sha: SHA, baseSha: BASE };

for (const [nom, opts, message] of [
  ["neutral n'est pas une réussite", { ci: "neutral" }, /CI rouge/],
  ["skipped n'est pas une réussite", { ci: "skipped" }, /CI rouge/],
  ["aucun run CI", { runs: [] }, /aucune CI/],
  ["job sans preuve du merge", { jobs: [] }, /ne prouve pas/],
  ["parents du merge inversés", { parents: [SHA, BASE] }, /ne prouve pas/],
  ["commit sans deux parents", { parents: [BASE] }, /ne prouve pas/],
  ["ancienne base testée", { parents: ["c".repeat(40), SHA] }, /ne prouve pas/],
  ["PR fermée", { detail: { state: "closed" } }, /fermée/],
  ["PR brouillon", { detail: { draft: true } }, /brouillon/],
  ["fork", { detail: { head: { sha: SHA, ref: "codex/x", repo: { full_name: "autre/fork" } } } }, /autre dépôt/],
  ["fichiers manquants", { detail: { changed_files: 3 } }, /incomplète/],
  ["conversation non résolue", { threads: [{ isResolved: false }] }, /non résolues/],
  ["conversation au-delà de la première page", { threads: [...Array.from({ length: 100 }, () => ({ isResolved: true })), { isResolved: false }] }, /non résolues/],
  ["GraphQL partiellement en erreur", { changer: ({ chemin }) => chemin === "/graphql" ? { errors: [{ message: "forbidden" }] } : undefined }, /illisibles/],
  ["GraphQL sans pull request", { changer: ({ chemin }) => chemin === "/graphql" ? { data: { repository: { pullRequest: null } } } : undefined }, /illisibles/],
  ["pagination des fichiers en erreur", { changer: ({ chemin }) => { if (chemin.includes("/files?")) throw new Error("403"); } }, /illisibles/],
  ["preuve CI d'un autre événement", { changer: ({ run }) => { run.event = "push"; } }, /aucune CI/],
  ["preuve CI d'une autre PR", { changer: ({ run }) => { run.pull_requests[0].number = 61; } }, /ne prouve pas/],
  ["preuve d'une autre tête", { changer: ({ job }) => { job.head_sha = "c".repeat(40); } }, /ne prouve pas/],
  ["preuve skipped", { changer: ({ job }) => { job.steps[0].conclusion = "skipped"; } }, /ne prouve pas/],
  ["preuve de l'ancien format", { changer: ({ job }) => { job.steps[0].name = "Verify tested merge uses the current base"; } }, /ne prouve pas/],
]) {
  test(`fusion refusée : ${nom}`, async () => {
    const { api, appels } = faussesAPI(opts);
    await assert.rejects(() => pullRequests.fusionner({ api, demande }), message);
    assert.ok(!appels.some((a) => a.methode === "PUT"));
  });
}

test("la preuve conservée relie CI, tentative, tête, base et merge", async () => {
  const { api, appels } = faussesAPI();
  const fusion = await pullRequests.fusionner({ api, demande });
  assert.deepStrictEqual(fusion.preuve, { runId: 100, tentative: 1, headSha: SHA, baseSha: BASE, mergeSha: MERGE });
  assert.ok(appels.some((a) => a.chemin.includes("/attempts/1/jobs")));
  assert.ok(!appels.some((a) => /check-runs|\/zip|\/contents\//.test(a.chemin)), "métadonnées seulement, sans droit Checks");
});

test("le dernier run CI est choisi même si la réponse est désordonnée", () => {
  const commun = { workflow_id: 1, name: "CI", head_sha: SHA, event: "pull_request" };
  const ancien = { ...commun, id: 10, run_number: 1, run_attempt: 1, conclusion: "success" };
  const nouveau = { ...commun, id: 20, run_number: 2, run_attempt: 1, conclusion: "failure" };
  const relance = { ...nouveau, run_attempt: 2, status: "in_progress" };
  assert.strictEqual(gates.derniereCI([ancien, { ...relance, workflow_id: 2 }, nouveau, relance], 1, SHA), relance);
});

test("un autre workflow vert ne remplace jamais CI", async () => {
  const { api, appels } = faussesAPI({ changer: ({ run }) => { run.name = "Lint"; } });
  await assert.rejects(() => pullRequests.fusionner({ api, demande }), /aucune CI/);
  assert.ok(!appels.some((a) => a.methode === "PUT"));
});

test("fichiers paginés et ancien nom sensible d'un renommage sont visibles", async () => {
  const fichiers = Array.from({ length: 100 }, (_, i) => ({ filename: `src/${i}.js` }));
  fichiers.push({ filename: "src/ancienne-config.txt", previous_filename: ".ENV.production" });
  fichiers.push({ filename: "MIGRATIONS/base.SQL" });
  const { api, appels } = faussesAPI({ fichiers });
  const pr = await pullRequests.releverPR({ api, depot: DEPOT, numero: 60, parDefaut: "main" });
  assert.strictEqual(pr.fichiers, 102);
  assert.strictEqual(pr.fichiersComplets, true);
  assert.deepStrictEqual(pr.sensibles, [".ENV.production", "MIGRATIONS/base.SQL"]);
  assert.ok(appels.some((a) => a.chemin.includes("/files?per_page=100&page=2")));
});

for (const [nom, changer, message] of [
  ["base différente de celle approuvée", ({ chemin }) => chemin.endsWith("/commits/main") ? { sha: "c".repeat(40) } : undefined, /base a bougé/],
  ["base déplacée pendant la validation", ({ chemin, appels }) => chemin.endsWith("/commits/main") && appels.filter((a) => a.chemin === chemin).length > 1 ? { sha: "c".repeat(40) } : undefined, /base a bougé pendant/],
  ["tête déplacée pendant la validation", ({ chemin, appels, pr }) => chemin.endsWith("/pulls/60") && appels.filter((a) => a.chemin === chemin).length > 1 ? { ...pr, head: { ...pr.head, sha: "c".repeat(40) } } : undefined, /PR a changé/],
  ["PR devenue brouillon", ({ chemin, appels, pr }) => chemin.endsWith("/pulls/60") && appels.filter((a) => a.chemin === chemin).length > 1 ? { ...pr, draft: true } : undefined, /PR a changé/],
  ["CI relancée pendant la validation", ({ chemin, appels, run }) => chemin.includes("/ci.yml/runs?") && appels.filter((a) => a.chemin === chemin).length > 1 ? { total_count: 1, workflow_runs: [{ ...run, run_attempt: 2, status: "in_progress", conclusion: null }] } : undefined, /CI a changé/],
  ["conversation ajoutée pendant la validation", ({ chemin, appels }) => chemin === "/graphql" && appels.filter((a) => a.chemin === chemin).length > 1 ? { data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }], pageInfo: { hasNextPage: false } } } } } } : undefined, /non résolues/],
  ["branche par défaut changée", ({ chemin, appels }) => chemin === `/repos/${DEPOT}` && appels.filter((a) => a.chemin === chemin).length > 1 ? { default_branch: "nouvelle" } : undefined, /branche par défaut a changé/],
]) {
  test(`course refusée : ${nom}`, async () => {
    const { api, appels } = faussesAPI({ changer });
    await assert.rejects(() => pullRequests.fusionner({ api, demande }), message);
    assert.ok(!appels.some((a) => a.methode === "PUT"));
  });
}

test("les anciennes demandes sans base et les anciens relevés sans preuve sont refusés", async () => {
  const { api } = faussesAPI();
  await assert.rejects(() => pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: SHA } }), /incomplète/);
  const b = bac({ releve: await pullRequests.relever({ api, depots: [DEPOT] }) });
  assert.throws(() => apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA } }), /base a bougé/);
  const pr = pullRequests.lireInstantane(b.instantaneFichier).depots[0].ouvertes[0];
  delete pr.ci.preuve;
  assert.match(pullRequests.raisonDeNePasFusionner(pr), /ne prouve pas/);
});

test("une date de relevé invalide ou future ne permet pas une fusion", async () => {
  const { api } = faussesAPI();
  const releve = await pullRequests.relever({ api, depots: [DEPOT] });
  for (const releveLe of ["pas-une-date", "2099-01-01T00:00:00Z"]) {
    const b = bac({ releve: { ...releve, releveLe } });
    assert.throws(() => apiPullRequests.demander({ ...b, qui: RAPHAEL, demande }), (e) => e.code === 503);
  }
});

test("la pagination CI refuse une réponse tronquée", async () => {
  await assert.rejects(() => gates.pages({ api: async () => ({ total_count: 2, workflow_runs: [{}] }), chemin: "/runs", cle: "workflow_runs" }), /incomplète/);
});

test("le script CI refuse une tête seule, de mauvais parents et une base devenue ancienne", () => {
  const { execFileSync, spawnSync } = require("node:child_process");
  const requireMoteur = require("node:module").createRequire(require.resolve("agent-orchestrator"));
  const yaml = requireMoteur("yaml");
  const ci = yaml.parse(fs.readFileSync(path.join(__dirname, "../.github/workflows/ci.yml"), "utf8"));
  const step = ci.jobs.test.steps.find((s) => s.name.startsWith("Verify tested merge ("));
  assert.ok(step?.name.includes("github.sha") && step.name.includes("github.event.pull_request.head.sha") && step.name.includes("github.event.pull_request.base.sha"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preuve-ci-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.com");
  fs.writeFileSync(path.join(dir, "app.txt"), "base\n");
  git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("remote", "add", "origin", dir);
  git("checkout", "-qb", "codex/test");
  fs.writeFileSync(path.join(dir, "app.txt"), "code\n");
  git("commit", "-qam", "code");
  const head = git("rev-parse", "HEAD");
  git("checkout", "-qb", "integration", "main");
  git("merge", "--no-ff", "--no-edit", "codex/test");
  const merge = git("rev-parse", "HEAD");
  const lancer = (env = {}) => spawnSync("bash", ["-c", step.run], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_BASE_REF: "main", EXPECTED_HEAD: head, EXPECTED_BASE: base, EXPECTED_MERGE: merge, ...env } });
  assert.strictEqual(lancer().status, 0, "le merge exact sur la base courante passe");
  assert.notStrictEqual(lancer({ EXPECTED_HEAD: BASE }).status, 0);
  assert.notStrictEqual(lancer({ EXPECTED_BASE: SHA }).status, 0);
  git("checkout", "--detach", head);
  assert.notStrictEqual(lancer({ EXPECTED_MERGE: head }).status, 0, "un checkout de la tête n'est pas une preuve");
  git("checkout", "-q", "main");
  fs.writeFileSync(path.join(dir, "autre.txt"), "base avance\n");
  git("add", "."); git("commit", "-qm", "base avance");
  git("checkout", "-q", "integration");
  assert.notStrictEqual(lancer().status, 0, "le merge devenu ancien échoue");
});
