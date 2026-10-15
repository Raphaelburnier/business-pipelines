// Le suivi d'une livraison jusqu'au résultat GitHub : run → branche → PR → SHA → CI → fusion.
// Vrais dépôts git (NAS et « GitHub »), vrai event store, fausse API GitHub dont l'état change
// au fil du scénario. Un redémarrage du publieur est une nouvelle instance de l'event store
// sur le même fichier, avec un fichier d'état de publication perdu.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { EventStore } = require("agent-orchestrator");
const { cockpit } = require("agent-orchestrator/packages/schemas/cockpit");
const checkpoints = require("agent-orchestrator/src/checkpoints");
const publieur = require("../src/publieur");
const pullRequests = require("../src/pull-requests");
const suivi = require("../src/suivi-livraisons");
const lecture = require("../src/api-lecture");

const DEPOT = "Raphaelburnier/steam_tierList";
const BASE = "a".repeat(40);
const BASE_AVANCEE = "c".repeat(40);
const MERGE = "b".repeat(40);
const FUSION = "f".repeat(40);
const g = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();

// Un run du cockpit livré comme le moteur le fait : commande, run, branche agent/…, ligne de livraison.
function monter() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "suivi-livraisons-"));
  const chemin = path.join(racine, "events.sqlite");
  const store = new EventStore(chemin);
  const commande = store.creerCommande({ kind: "run.start", payload: { projectId: "steam-tierlist", pipelineIndex: 0 }, par: "raphael" });
  store.prendreCommande({ kinds: ["run.start"] });
  const { run } = store.ouvrirRunCommande(commande.id, { pipelineRef: "improve-app@5", projectId: "steam-tierlist" });
  const runId = run.id;
  const nas = path.join(racine, "nas.git");
  const github = path.join(racine, "github.git");
  for (const d of [nas, github]) execFileSync("git", ["init", "-q", "--bare", "-b", "main", d]);
  const travail = path.join(racine, "travail");
  execFileSync("git", ["clone", "-q", nas, travail]);
  g(travail, "config", "user.email", "t@l");
  g(travail, "config", "user.name", "t");
  fs.writeFileSync(path.join(travail, "app.txt"), "v1\n");
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", "v1");
  g(travail, "push", "-q", "origin", "HEAD:main");
  g(travail, "push", "-q", github, "HEAD:main");
  g(travail, "checkout", "-q", "-b", `run/${runId}`);
  fs.writeFileSync(path.join(travail, "app.txt"), "v2\n");
  fs.writeFileSync(path.join(travail, "improvement-plan.json"), JSON.stringify({ objective: "Chercher dans le catalogue" }));
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", `[run ${runId}] step implement`);
  const livraison = checkpoints.livrer({ dir: travail, runId, projetId: "steam-tierlist", fichiers: ["improvement-plan.json"] });
  store.statutRun(runId, "succeeded");
  store.ouvrirLivraison({ runId, branche: livraison.branche, sha: livraison.sha, repo: DEPOT, erreurPush: livraison.pousse });
  const projet = { id: "steam-tierlist", repo: nas, github: DEPOT };
  return { racine, chemin, store, runId, commandId: commande.id, projet, github, livraison };
}

// GitHub tel que le scénario le fait évoluer : une PR, sa CI, ses commentaires et ses commits.
function monde() {
  const m = {
    pr: null,
    base: BASE,
    ci: null, // { conclusion: "success"|"failure"|null, base }
    commentaires: [],
    commits: [],
    appels: [],
    arbres: {},
  };
  const page = (liste, url) => {
    const n = Number(url.searchParams.get("page") || 1);
    return liste.slice((n - 1) * 100, n * 100);
  };
  m.api = async (methode, chemin, corps) => {
    m.appels.push({ methode, chemin });
    const url = new URL(chemin, "https://api.github.com");
    const route = url.pathname;
    if (methode === "GET" && route === `/repos/${DEPOT}`) return { default_branch: "main" };
    if (methode === "GET" && route === `/repos/${DEPOT}/commits/main`) return { sha: m.base };
    if (methode === "GET" && route === `/repos/${DEPOT}/pulls` && url.searchParams.get("head")) {
      const etat = url.searchParams.get("state");
      const prs = m.pr && (etat === "all" || m.pr.state === etat) && `Raphaelburnier:${m.pr.head.ref}` === url.searchParams.get("head") ? [structuredClone(m.pr)] : [];
      return prs;
    }
    if (methode === "POST" && route === `/repos/${DEPOT}/pulls`) {
      assert.strictEqual(m.pr, null, "une seule PR par livraison");
      m.pr = { number: 7, state: "open", merged_at: null, merge_commit_sha: null, title: corps.title, html_url: `https://github.com/${DEPOT}/pull/7`, user: { login: "publieur" }, head: { ref: corps.head, sha: m.tete, repo: { full_name: DEPOT } }, base: { ref: "main" }, draft: false, body: corps.body, created_at: "2026-10-06T17:00:00Z", mergeable: true, mergeable_state: "clean", changed_files: 1 };
      return structuredClone(m.pr);
    }
    if (methode === "GET" && route === `/repos/${DEPOT}/pulls/7`) return structuredClone(m.pr);
    if (methode === "GET" && route === `/repos/${DEPOT}/pulls/7/files`) return page([{ filename: "app.txt" }], url);
    if (methode === "GET" && route === `/repos/${DEPOT}/pulls/7/commits`) return page(m.commits, url);
    if (methode === "GET" && route === `/repos/${DEPOT}/issues/7/comments`) return page(m.commentaires, url);
    if (methode === "GET" && route === `/repos/${DEPOT}/actions/workflows/ci.yml`) return { id: 1, name: "CI", path: ".github/workflows/ci.yml" };
    if (methode === "GET" && route === `/repos/${DEPOT}/actions/workflows/ci.yml/runs`) {
      const tete = m.pr.head.sha;
      const runs = m.ci
        ? [{ id: 100, html_url: `https://github.com/${DEPOT}/actions/runs/100`, workflow_id: 1, run_number: 10, run_attempt: 1, name: "CI", event: "pull_request", head_sha: tete, status: m.ci.conclusion ? "completed" : "in_progress", conclusion: m.ci.conclusion, pull_requests: [{ number: 7, head: { sha: tete }, base: { ref: "main", sha: m.ci.base } }] }]
        : [];
      return { total_count: runs.length, workflow_runs: page(runs, url) };
    }
    if (methode === "GET" && /\/actions\/runs\/100\/attempts\/1\/jobs$/.test(route)) {
      const tete = m.pr.head.sha;
      const jobs = [{ id: 200, head_sha: tete, status: "completed", conclusion: "success", steps: [{ name: `Verify tested merge (merge=${MERGE}, head=${tete}, base=${m.ci.base})`, status: "completed", conclusion: "success" }] }];
      return { total_count: 1, jobs: page(jobs, url) };
    }
    if (methode === "GET" && route === `/repos/${DEPOT}/git/commits/${MERGE}`) return { sha: MERGE, parents: [{ sha: m.ci.base }, { sha: m.pr.head.sha }] };
    if (methode === "GET" && route.startsWith(`/repos/${DEPOT}/git/commits/`)) {
      const sha = route.split("/").at(-1);
      if (!m.arbres[sha]) throw new Error(`GitHub GET ${chemin} : 404`);
      return { sha, tree: { sha: m.arbres[sha] } };
    }
    if (methode === "PUT" && route === `/repos/${DEPOT}/pulls/7/merge`) {
      assert.strictEqual(corps.sha, m.pr.head.sha);
      Object.assign(m.pr, { state: "closed", merged_at: "2026-10-07T12:00:00Z", merge_commit_sha: FUSION });
      return { merged: true, sha: FUSION };
    }
    if (methode === "POST" && route === "/graphql") return { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } };
    throw new Error(`appel inattendu : ${methode} ${chemin}`);
  };
  return m;
}

const git = publieur.gitAvec({ jeton: null });
const evenements = (store, runId) => store.evenements({ runId }).filter((e) => e.type.startsWith("delivery."));

test("critère de réussite : une livraison suivie jusqu'à la fusion, à travers un redémarrage", async () => {
  const f = monter();
  const gh = monde();
  gh.tete = f.livraison.sha;
  gh.commits.push({ sha: f.livraison.sha, html_url: "c1", commit: { message: `[run ${f.runId}] step implement` } });

  // Publication : la PR est rattachée au run, à sa commande et au SHA livré.
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: f.store });
  let l = f.store.livraison(f.runId);
  assert.deepStrictEqual([l.statut, l.pr, l.headSha, l.commandId, l.branche], ["pr_open", 7, f.livraison.sha, f.commandId, f.livraison.branche]);

  // CI en cours.
  gh.ci = { conclusion: null, base: BASE };
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet] });
  assert.strictEqual(f.store.livraison(f.runId).statut, "ci_running");
  assert.strictEqual(f.store.livraison(f.runId).ciUrl, `https://github.com/${DEPOT}/actions/runs/100`);
  f.store.fermer();

  // Redémarrage : nouveau store sur le même fichier, état de publication perdu. La PR est
  // retrouvée, aucune seconde PR n'est ouverte, et l'état réel (CI rouge) est relu.
  const store = new EventStore(f.chemin);
  gh.ci = { conclusion: "failure", base: BASE };
  gh.commentaires.push({ body: `<!-- ci-autofix:${f.livraison.sha} -->\nCI en échec : Claude reprend la branche.`, html_url: "https://github.com/x/1" });
  const etatPerdu = {};
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: etatPerdu, store });
  await suivi.suivreLivraisons({ api: gh.api, store, projets: [f.projet] });
  assert.strictEqual(gh.appels.filter((a) => a.methode === "POST" && a.chemin.endsWith("/pulls")).length, 1);
  l = store.livraison(f.runId);
  assert.strictEqual(l.pr, 7);
  assert.strictEqual(l.statut, "merge_blocked");
  assert.match(l.raison, /CI rouge sur .* correction automatique transmise/);
  assert.deepStrictEqual(l.correction, { etat: "transmise", echecSha: f.livraison.sha, correctionSha: null, url: "https://github.com/x/1" });

  // La correction automatique pousse, la CI échoue encore : le workflow escalade.
  const correction = "d".repeat(40);
  gh.commits.push({ sha: correction, html_url: "c2", commit: { message: "fix: test [ci-autofix]" } });
  gh.pr.head.sha = correction;
  gh.commentaires.push({ body: "La CI échoue encore après la correction automatique ([run 101](u)). Pas de seconde tentative.", html_url: "https://github.com/x/2" });
  await suivi.suivreLivraisons({ api: gh.api, store, projets: [f.projet] });
  l = store.livraison(f.runId);
  assert.strictEqual(l.statut, "failed");
  assert.strictEqual(l.finishedAt, null, "une CI rouge reste suivie : une reprise à la main peut la rendre verte");
  assert.match(l.raison, /reprise à la main/);
  assert.strictEqual(l.correction.etat, "escaladee");

  // Reprise à la main : CI verte, mais testée sur une base qui a avancé depuis.
  const reprise = "e".repeat(40);
  gh.commits.push({ sha: reprise, html_url: "c3", commit: { message: "fix: reprise" } });
  gh.pr.head.sha = reprise;
  gh.ci = { conclusion: "success", base: BASE };
  gh.base = BASE_AVANCEE;
  await suivi.suivreLivraisons({ api: gh.api, store, projets: [f.projet] });
  l = store.livraison(f.runId);
  assert.strictEqual(l.statut, "merge_blocked");
  assert.match(l.raison, /CI verte sur une base dépassée : branche à mettre à jour/);
  await assert.rejects(() => pullRequests.fusionner({ api: gh.api, demande: { depot: DEPOT, numero: 7, sha: reprise, baseSha: BASE } }), /base a bougé/);
  assert.ok(!gh.appels.some((a) => a.methode === "PUT"), "aucune fusion tentée");

  // Nouvelle CI sur la base courante : les gates passent, mais ce run n'a ni tests ni revue
  // attestés par le superviseur. Il attend un clic.
  gh.ci = { conclusion: "success", base: BASE_AVANCEE };
  await suivi.suivreLivraisons({ api: gh.api, store, projets: [f.projet] });
  l = store.livraison(f.runId);
  assert.strictEqual(l.statut, "merge_blocked");
  assert.match(l.raison, /aucune preuve de tests ni de revue attestée : fusion explicite requise/);
  assert.strictEqual(l.baseSha, BASE_AVANCEE);

  // Fusion confirmée par GitHub : elle remonte au run.
  Object.assign(gh.pr, { state: "closed", merged_at: "2026-10-06T18:00:00Z", merge_commit_sha: FUSION });
  await suivi.suivreLivraisons({ api: gh.api, store, projets: [f.projet] });
  l = store.livraison(f.runId);
  assert.deepStrictEqual([l.statut, l.mergeSha, Boolean(l.finishedAt)], ["merged", FUSION, true]);
  assert.strictEqual(store.run(f.runId).status, "succeeded", "l'exécution et la livraison restent deux états distincts");
  const fusion = evenements(store, f.runId).at(-1);
  assert.strictEqual(fusion.type, "delivery.merged");
  assert.strictEqual(fusion.payload.mergeSha, FUSION);
  assert.deepStrictEqual(
    evenements(store, f.runId).map((e) => e.type),
    ["delivery.pending", "delivery.pr_open", "delivery.ci_running", "delivery.merge_blocked", "delivery.failed", "delivery.merge_blocked", "delivery.merge_blocked", "delivery.merged"]
  );

  // L'API du cockpit montre la livraison, dans la forme décrite par le moteur.
  const vue = lecture.run(store, f.runId);
  cockpit.runDetaille.parse(vue);
  assert.deepStrictEqual([vue.statut, vue.livraison.statut, vue.livraison.pr, vue.livraison.mergeSha], ["succeeded", "merged", 7, FUSION]);

  // Encore un redémarrage avec l'état perdu : une livraison fusionnée n'est ni republiée ni relue.
  const store2 = new EventStore(f.chemin);
  const avant = gh.appels.length;
  const r = await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: store2 });
  assert.strictEqual(r.publiees.length, 0);
  assert.strictEqual(store2.livraisons({ enCours: true }).length, 0);
  await suivi.suivreLivraisons({ api: gh.api, store: store2, projets: [f.projet] });
  assert.ok(!gh.appels.slice(avant).some((a) => a.chemin.includes("/pulls/7")), "plus aucun relevé de la PR fusionnée");
});

test("une PR fermée sans fusion termine la livraison en échec", async () => {
  const f = monter();
  const gh = monde();
  gh.tete = f.livraison.sha;
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: f.store });
  gh.pr.state = "closed";
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet] });
  const l = f.store.livraison(f.runId);
  assert.deepStrictEqual([l.statut, l.raison, Boolean(l.finishedAt)], ["failed", "PR fermée sans fusion", true]);
});

test("un push refusé par GitHub reste un échec visible, puis la publication reprend", async () => {
  const f = monter();
  const gh = monde();
  gh.tete = f.livraison.sha;
  const etat = {};
  const hook = path.join(f.github, "hooks", "pre-receive");
  fs.writeFileSync(hook, "#!/bin/sh\necho 'protected branch' >&2\nexit 1\n", { mode: 0o755 });
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat, store: f.store });
  let l = f.store.livraison(f.runId);
  assert.strictEqual(l.statut, "failed");
  assert.match(l.raison, /push vers GitHub refusé/);
  assert.strictEqual(l.finishedAt, null);
  assert.strictEqual(gh.pr, null, "aucune PR sans branche publiée");
  fs.rmSync(hook);
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat, store: f.store });
  l = f.store.livraison(f.runId);
  assert.deepStrictEqual([l.statut, l.pr], ["pr_open", 7]);
});

test("un run livré avant ce suivi est rattaché à sa PR par sa branche", async () => {
  const f = monter();
  // Base d'avant : seul l'événement run.delivered existe.
  f.store.db.prepare("DELETE FROM deliveries").run();
  f.store.emettre({ type: "run.delivered", runId: f.runId, payload: { branche: f.livraison.branche, sha: f.livraison.sha } });
  const gh = monde();
  gh.tete = f.livraison.sha;
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: null });
  Object.assign(gh.pr, { state: "closed", merged_at: "2026-10-06T18:00:00Z", merge_commit_sha: FUSION });
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet] });
  const l = f.store.livraison(f.runId);
  assert.deepStrictEqual([l.statut, l.pr, l.mergeSha, l.repo], ["merged", 7, FUSION, DEPOT]);
});

test("les marqueurs ci-autofix : transmise, poussée, escaladée", () => {
  const echec = "1".repeat(40);
  const fix = "2".repeat(40);
  const commits = [{ sha: echec, commit: { message: "feat: x" } }];
  const transmis = [{ body: `<!-- ci-autofix:${echec} -->`, html_url: "t" }];
  assert.strictEqual(suivi.correctionDe({ commentaires: [], commits, tete: echec }), null);
  assert.strictEqual(suivi.correctionDe({ commentaires: transmis, commits, tete: echec }).etat, "transmise");
  const avecFix = [...commits, { sha: fix, html_url: "f", commit: { message: "fix: y [ci-autofix]" } }];
  assert.deepStrictEqual(suivi.correctionDe({ commentaires: transmis, commits: avecFix, tete: fix }), { etat: "poussee", echecSha: echec, correctionSha: fix, url: "f" });
  const escalade = [...transmis, { body: "La CI échoue encore après la correction automatique (run).", html_url: "e" }];
  assert.strictEqual(suivi.correctionDe({ commentaires: escalade, commits: avecFix, tete: fix }).etat, "escaladee");
});


// Une livraison attestée comme le moteur la fait : l'arbre du commit livré a été testé et revu.
function attester(f, store, sha, dir) {
  const treeSha = g(dir, "rev-parse", `${sha}^{tree}`);
  store.ouvrirLivraison({ runId: f.runId, branche: f.livraison.branche, sha, repo: DEPOT, attestation: {
    version: 1, treeSha, deliverySha: sha, tests: { sourceSha: sha, nodes: [{ node: "verify" }] },
    reviews: [{ node: "review", agentRef: "code-reviewer@1", via: "claude", model: "opus", sessionId: "rev-1", verdict: "PASS" }], reviewRequired: true } });
  return treeSha;
}

test("preuves jusqu'à la fusion : correction de CI, revérification, puis fusion automatique", async () => {
  const f = monter();
  const travail = path.join(f.racine, "travail");
  const gh = monde();
  gh.tete = f.livraison.sha;
  gh.arbres[f.livraison.sha] = attester(f, f.store, f.livraison.sha, travail);
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: f.store });

  // La CI échoue, ci-autofix pousse une correction sur la branche agent/ de GitHub.
  const clone = path.join(f.racine, "autofix");
  execFileSync("git", ["clone", "-q", "-b", f.livraison.branche, f.github, clone]);
  g(clone, "config", "user.email", "ci@l"); g(clone, "config", "user.name", "ci");
  fs.writeFileSync(path.join(clone, "app.txt"), "v2 corrigé\n");
  g(clone, "commit", "-qam", "fix: test [ci-autofix]");
  g(clone, "push", "-q", "origin", f.livraison.branche);
  const tete = g(clone, "rev-parse", "HEAD");
  gh.pr.head.sha = tete;
  gh.arbres[tete] = g(clone, "rev-parse", "HEAD^{tree}");
  gh.ci = { conclusion: "success", base: BASE };

  const demandes = [];
  const fusions = [];
  const reverifier = async ({ livraison, headSha }) => demandes.push(publieur.demanderReverification({ git, store: f.store, projet: f.projet, urlDepot: f.github, livraison, headSha }));
  const fusionnerAuto = async (a) => fusions.push(a);
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet], reverifier, fusionnerAuto });
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet], reverifier, fusionnerAuto });
  let l = f.store.livraison(f.runId);
  assert.strictEqual(l.statut, "merge_blocked");
  assert.match(l.raison, /preuves périmées .* revérification nécessaire/);
  assert.strictEqual(fusions.length, 0, "aucune fusion automatique sur une tête non revue");
  assert.strictEqual(demandes.length, 2);
  assert.strictEqual(demandes[0].id, demandes[1].id, "une seule commande par tête");
  assert.deepStrictEqual(demandes[0].payload, { runId: f.runId, headSha: tete });
  assert.strictEqual(g(f.projet.repo, "rev-parse", `refs/orch/pr-heads/${f.runId}`), tete, "la tête est déposée sur le NAS pour le runner");

  // Un clic du cockpit sur cette tête est refusé avant tout PUT.
  const verifier = (strict) => async ({ depot, numero, sha }) => {
    const p = await suivi.preuvesDe({ api: gh.api, depot, livraison: f.store.livraisons({ enCours: true }).find((x) => x.pr === numero), sha });
    return p && (strict || !p.expliciteAutorise) ? p.raison : null;
  };
  await assert.rejects(() => pullRequests.fusionner({ api: gh.api, demande: { depot: DEPOT, numero: 7, sha: tete, baseSha: BASE }, verifierPreuves: verifier(false) }), /preuves périmées/);
  assert.ok(!gh.appels.some((a) => a.methode === "PUT"));

  // Le moteur rejoue tests et revues sur la tête importée ; sans changement, il la livre telle quelle.
  checkpoints.importerTete({ dir: travail, runId: f.runId, sha: tete, livre: f.livraison.sha, fichiers: ["improvement-plan.json"] });
  const relivree = checkpoints.livrer({ dir: travail, runId: f.runId, projetId: "steam-tierlist", fichiers: ["improvement-plan.json"], tete });
  assert.strictEqual(relivree.sha, tete);
  attester(f, f.store, tete, travail);
  const pousses = gh.appels.length;
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: f.store });
  assert.strictEqual(g(f.github, "rev-parse", `refs/heads/${f.livraison.branche}`), tete, "la correction reste la tête de la PR");
  assert.ok(!gh.appels.slice(pousses).some((a) => a.methode === "POST"), "aucune seconde PR");
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet], reverifier, fusionnerAuto });
  l = f.store.livraison(f.runId);
  assert.strictEqual(l.statut, "pr_open");
  assert.match(l.raison, /prête à fusionner .* tests et revues sur cet arbre/);
  assert.strictEqual(fusions.length, 1);
  assert.strictEqual(fusions[0].detail.sha, tete);
  const fusion = await pullRequests.fusionner({ api: gh.api, demande: { depot: DEPOT, numero: 7, sha: tete, baseSha: BASE }, verifierPreuves: verifier(true) });
  assert.strictEqual(fusion.fusionnee, true);
  await suivi.suivreLivraisons({ api: gh.api, store: f.store, projets: [f.projet] });
  l = f.store.livraison(f.runId);
  assert.deepStrictEqual([l.statut, l.mergeSha], ["merged", FUSION]);
  const vue = lecture.run(f.store, f.runId);
  cockpit.runDetaille.parse(vue);
  assert.strictEqual(vue.livraison.attestation.arbre, gh.arbres[tete]);
  assert.deepStrictEqual(vue.livraison.attestation.revues[0].llm, { via: "claude", model: "opus" });
});

test("une revérification qui corrige encore part en avance rapide, sans écraser la correction de CI", async () => {
  const f = monter();
  const travail = path.join(f.racine, "travail");
  const gh = monde();
  gh.tete = f.livraison.sha;
  attester(f, f.store, f.livraison.sha, travail);
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: f.store });
  const clone = path.join(f.racine, "autofix");
  execFileSync("git", ["clone", "-q", "-b", f.livraison.branche, f.github, clone]);
  g(clone, "config", "user.email", "ci@l"); g(clone, "config", "user.name", "ci");
  fs.writeFileSync(path.join(clone, "app.txt"), "v2 corrigé\n");
  g(clone, "commit", "-qam", "fix [ci-autofix]");
  g(clone, "push", "-q", "origin", f.livraison.branche);
  const tete = g(clone, "rev-parse", "HEAD");
  gh.pr.head.sha = tete;
  f.store.majLivraison(f.runId, { headSha: tete });
  publieur.demanderReverification({ git, store: f.store, projet: f.projet, urlDepot: f.github, livraison: f.store.livraison(f.runId), headSha: tete });
  // Revue FAIL puis correction dans le run : un nouveau commit au-dessus de la tête importée.
  checkpoints.importerTete({ dir: travail, runId: f.runId, sha: tete, livre: f.livraison.sha, fichiers: ["improvement-plan.json"] });
  fs.writeFileSync(path.join(travail, "app.txt"), "v3 revu\n");
  g(travail, "commit", "-qam", `[run ${f.runId}] step implement`);
  const nouvelle = checkpoints.livrer({ dir: travail, runId: f.runId, projetId: "steam-tierlist", fichiers: ["improvement-plan.json"], tete });
  assert.notStrictEqual(nouvelle.sha, tete);
  attester(f, f.store, nouvelle.sha, travail);
  await publieur.publierProjet({ projet: f.projet, git, api: gh.api, urlDepot: f.github, etat: {}, store: f.store });
  assert.strictEqual(g(f.github, "rev-parse", `refs/heads/${f.livraison.branche}`), nouvelle.sha);
  execFileSync("git", ["merge-base", "--is-ancestor", tete, nouvelle.sha], { cwd: f.github });
  assert.strictEqual(f.store.livraison(f.runId).headSha, nouvelle.sha);
});
