// Le publieur, sur de vrais dépôts : un bare « NAS » où le moteur livre, un bare « GitHub »
// où il publie, et une API GitHub simulée.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const publieur = require("../src/publieur");
const checkpoints = require("agent-orchestrator/src/checkpoints");

const g = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
const gd = (depot, ...args) => execFileSync("git", ["--git-dir", depot, ...args], { encoding: "utf-8" }).trim();

function monter() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "publieur-"));
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
  // Un run livré, comme le moteur le laisse : run/<id> avec la trace, agent/… sans.
  const runId = "c560f64f-d39f-41c5-8444-b1bc85becd94";
  g(travail, "checkout", "-q", "-b", `run/${runId}`);
  fs.writeFileSync(path.join(travail, "app.txt"), "v2\n");
  fs.writeFileSync(path.join(travail, "improvement-plan.json"), JSON.stringify({ objective: "Chercher dans le catalogue" }));
  fs.writeFileSync(path.join(travail, "applied.json"), JSON.stringify({ changes_done: ["SearchBar interroge le catalogue"], changes_blocked: [] }));
  fs.writeFileSync(path.join(travail, "verdict.json"), JSON.stringify({ verdict: "PASS", failures: [] }));
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", `[run ${runId}] step implement`);
  checkpoints.livrer({
    dir: travail,
    runId,
    projetId: "steam-tierlist",
    fichiers: ["improvement-plan.json", "applied.json", "verdict.json"],
  });
  return { racine, nas, github, travail, runId };
}

function fausseApi() {
  const appels = [];
  const api = async (methode, chemin, corps) => {
    appels.push({ methode, chemin, corps });
    if (methode === "GET" && /^\/repos\/[^/]+\/[^/]+$/.test(chemin)) return { default_branch: "main" };
    if (methode === "GET" && chemin.includes("/pulls?")) return [];
    if (methode === "POST" && chemin.endsWith("/pulls")) return { number: 7 };
    throw new Error(`appel inattendu ${methode} ${chemin}`);
  };
  return { api, appels };
}

test("une branche agent/ est publiée avec sa PR, une seule fois", async () => {
  const { nas, github } = monter();
  const { api, appels } = fausseApi();
  const git = publieur.gitAvec({ jeton: null });
  const etat = {};
  const projet = { id: "steam-tierlist", repo: nas, github: "Raphaelburnier/steam_tierList" };

  const { publiees } = await publieur.publierProjet({ projet, git, api, urlDepot: github, etat });
  assert.deepStrictEqual(publiees.map((p) => [p.branche, p.pr]), [["agent/steam-tierlist-c560f64f", 7]]);
  assert.strictEqual(gd(github, "show", "agent/steam-tierlist-c560f64f:app.txt"), "v2");
  const creation = appels.find((a) => a.methode === "POST");
  assert.strictEqual(creation.corps.head, "agent/steam-tierlist-c560f64f");
  assert.strictEqual(creation.corps.base, "main");
  assert.match(creation.corps.title, /^agent\(steam-tierlist\): Chercher dans le catalogue/);
  assert.match(creation.corps.body, /SearchBar interroge le catalogue/);
  assert.match(creation.corps.body, /Verdict du pipeline : PASS/);
  assert.doesNotMatch(creation.corps.body, /Verdict du pipeline : inconnu/);
  assert.strictEqual(gd(github, "ls-tree", "-r", "--name-only", "agent/steam-tierlist-c560f64f"), "app.txt");

  // Deuxième passage : rien de nouveau, rien de republié.
  const second = await publieur.publierProjet({ projet, git, api, urlDepot: github, etat });
  assert.strictEqual(second.publiees.length, 0);
  assert.strictEqual(appels.filter((a) => a.methode === "POST").length, 1);
});

test("la branche par défaut de GitHub est ramenée sur le NAS en avance rapide", async () => {
  const { racine, nas, github } = monter();
  const autre = path.join(racine, "autre");
  execFileSync("git", ["clone", "-q", github, autre]);
  g(autre, "config", "user.email", "t@l");
  g(autre, "config", "user.name", "t");
  fs.writeFileSync(path.join(autre, "app.txt"), "fusionné sur GitHub\n");
  g(autre, "commit", "-q", "-am", "PR fusionnée");
  g(autre, "push", "-q", "origin", "HEAD:main");

  const git = publieur.gitAvec({ jeton: null });
  const retour = publieur.ramenerParDefaut({ git, depot: nas, url: github, branche: "main" });
  assert.strictEqual(retour.statut, "avance");
  assert.strictEqual(gd(nas, "show", "main:app.txt"), "fusionné sur GitHub");
  assert.strictEqual(publieur.ramenerParDefaut({ git, depot: nas, url: github, branche: "main" }).statut, "a-jour");
});

test("un main du NAS qui a divergé n'est pas écrasé", async () => {
  const { racine, nas, github, travail } = monter();
  g(travail, "checkout", "-q", "main");
  fs.writeFileSync(path.join(travail, "app.txt"), "commit seulement sur le NAS\n");
  g(travail, "commit", "-q", "-am", "divergence");
  g(travail, "push", "-q", "origin", "HEAD:main");
  const avant = gd(nas, "rev-parse", "main");
  const autre = path.join(racine, "autre2");
  execFileSync("git", ["clone", "-q", github, autre]);
  g(autre, "config", "user.email", "t@l");
  g(autre, "config", "user.name", "t");
  fs.writeFileSync(path.join(autre, "app.txt"), "autre chose sur GitHub\n");
  g(autre, "commit", "-q", "-am", "autre");
  g(autre, "push", "-q", "origin", "HEAD:main");

  const retour = publieur.ramenerParDefaut({ git: publieur.gitAvec({ jeton: null }), depot: nas, url: github, branche: "main" });
  assert.strictEqual(retour.statut, "diverge");
  assert.strictEqual(gd(nas, "rev-parse", "main"), avant);
});

test("seuls les projets qui demandent la publication, avec un dépôt GitHub valide", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publieur-projets-"));
  const fiche = (id, extra) => {
    fs.mkdirSync(path.join(dir, id));
    fs.writeFileSync(path.join(dir, id, "project.json"), JSON.stringify({ id, repo: `/git/${id}.git`, ...extra }));
  };
  fiche("oui", { publier: true, github: "Raphaelburnier/oui" });
  fiche("sans-github", { publier: true });
  fiche("github-invalide", { publier: true, github: "https://github.com/x/y" });
  fiche("marketing", { github: "Raphaelburnier/marketing" });
  assert.deepStrictEqual(publieur.projetsAPublier(dir).map((p) => p.id), ["oui"]);
});

test("le jeton passe par l'environnement de git, jamais par ses arguments", () => {
  const appels = [];
  const cp = require("child_process");
  const original = cp.execFileSync;
  cp.execFileSync = (cmd, args, opts) => {
    appels.push({ args, env: opts.env });
    return "";
  };
  try {
    // gitAvec a capturé execFileSync à son chargement : on recharge le module.
    delete require.cache[require.resolve("../src/publieur")];
    const frais = require("../src/publieur");
    frais.gitAvec({ jeton: "secret-123" })(["ls-remote", "https://github.com/x/y.git"]);
  } finally {
    cp.execFileSync = original;
    delete require.cache[require.resolve("../src/publieur")];
  }
  assert.ok(!appels[0].args.join(" ").includes("secret-123"));
  assert.match(appels[0].env.GIT_CONFIG_VALUE_0, /^AUTHORIZATION: basic /);
});
