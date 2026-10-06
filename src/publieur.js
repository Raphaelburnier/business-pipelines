// Le publieur : entre les dépôts de projets du NAS et GitHub (décision du 2026-09-27,
// option B).
//
// Le moteur livre un run réussi sur une branche `agent/…` du dépôt du NAS. Le publieur la
// pousse sur GitHub et ouvre la PR ; la CI du dépôt puis son auto-fusion décident. Dans
// l'autre sens, il ramène la branche par défaut de GitHub dans le dépôt du NAS, pour qu'un
// nouveau run parte du code fusionné.
//
// Il est le seul à détenir un jeton GitHub, et il tourne sans agent. Le runner, lui, fait
// tourner des agents qui ont Bash : il ne doit rien pouvoir publier.
//
// Le jeton ne passe jamais sur une ligne de commande : git le reçoit par son environnement
// (GIT_CONFIG_*), l'API par un en-tête.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const suivi = require("./suivi-livraisons");

const DEPOT_GITHUB = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * Les projets qui demandent la publication, lus dans leurs fiches brutes : les champs
 * `publier` et `github` ne dépendent pas de la version du schéma du moteur.
 * @param {string} projetsDir
 * @returns {{ id: string, repo: string, github: string }[]}
 */
function projetsAPublier(projetsDir) {
  const projets = [];
  if (!fs.existsSync(projetsDir)) return projets;
  for (const entree of fs.readdirSync(projetsDir, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const fichier = path.join(projetsDir, entree.name, "project.json");
    if (!fs.existsSync(fichier)) continue;
    let fiche;
    try {
      fiche = JSON.parse(fs.readFileSync(fichier, "utf-8"));
    } catch {
      continue;
    }
    if (fiche.publier !== true) continue;
    if (typeof fiche.github !== "string" || !DEPOT_GITHUB.test(fiche.github)) continue;
    if (typeof fiche.repo !== "string" || !fiche.repo) continue;
    projets.push({ id: String(fiche.id), repo: fiche.repo, github: fiche.github });
  }
  return projets;
}

/**
 * Un git qui parle à GitHub avec le jeton en en-tête, jamais dans l'URL ni dans les
 * arguments. `safe.directory=*` : les dépôts montés appartiennent à admindunas, le
 * publieur tourne en root, et il ne lance aucun code des dépôts.
 * @param {{ jeton: string|null, hote?: string }} options
 */
function gitAvec({ jeton, hote = "https://github.com/" }) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  if (jeton) {
    const base64 = Buffer.from(`x-access-token:${jeton}`).toString("base64");
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = `http.${hote}.extraheader`;
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${base64}`;
  }
  /** @param {string[]} args */
  return (args) => execFileSync("git", ["-c", "safe.directory=*", ...args], { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Ramène la branche par défaut de GitHub dans le dépôt du NAS, en avance rapide seulement.
 * Si le NAS a divergé, rien n'est écrasé : c'est signalé.
 * @returns {{ branche: string, avant: string|null, apres: string, statut: "a-jour"|"avance"|"diverge" }}
 */
function ramenerParDefaut({ git, depot, url, branche }) {
  git(["--git-dir", depot, "fetch", "-q", url, `refs/heads/${branche}:refs/publieur/${branche}`]);
  const distant = git(["--git-dir", depot, "rev-parse", `refs/publieur/${branche}`]);
  let local = null;
  try {
    local = git(["--git-dir", depot, "rev-parse", `refs/heads/${branche}`]);
  } catch {
    local = null;
  }
  if (local === distant) return { branche, avant: local, apres: distant, statut: "a-jour" };
  if (local) {
    try {
      git(["--git-dir", depot, "merge-base", "--is-ancestor", local, distant]);
    } catch {
      return { branche, avant: local, apres: local, statut: "diverge" };
    }
  }
  git(["--git-dir", depot, "update-ref", `refs/heads/${branche}`, distant, ...(local ? [local] : [])]);
  return { branche, avant: local, apres: distant, statut: "avance" };
}

/**
 * Les dépôts système dont le NAS tient un miroir : ce que le livreur a le droit de livrer
 * (docs/SPEC-livraison.md, §4.1). Lus dans `PUBLIEUR_MIROIRS`, sous la forme
 * `nom=proprietaire/depot,…`. Un nom sert de dossier : il est contrôlé comme tel.
 * @param {string|undefined} texte
 * @returns {{ nom: string, github: string }[]}
 */
function miroirsSysteme(texte) {
  const miroirs = [];
  for (const entree of String(texte || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [nom, github] = entree.split("=").map((x) => (x || "").trim());
    if (!/^[a-z0-9][a-z0-9-]*$/.test(nom) || !DEPOT_GITHUB.test(github || "")) {
      throw new Error(`PUBLIEUR_MIROIRS : entrée invalide « ${entree} » (attendu nom=proprietaire/depot)`);
    }
    miroirs.push({ nom, github });
  }
  return miroirs;
}

/**
 * Tient à jour le miroir d'un dépôt système : dépôt nu créé au besoin, branche par défaut de
 * GitHub ramenée en avance rapide, et HEAD pointé sur elle. Le livreur lit HEAD pour savoir
 * ce qu'est « la branche par défaut » sans avoir de jeton pour le demander à GitHub.
 */
async function tenirMiroir({ miroir, dossier, git, api, url = `https://github.com/${miroir.github}.git`, journal = () => {} }) {
  const depot = path.join(dossier, `${miroir.nom}.git`);
  if (!fs.existsSync(path.join(depot, "HEAD"))) {
    fs.mkdirSync(depot, { recursive: true });
    git(["init", "-q", "--bare", depot]);
    journal(`${miroir.nom} : miroir créé dans ${depot}`);
  }
  const infos = await api("GET", `/repos/${miroir.github}`);
  const branche = infos.default_branch;
  const retour = ramenerParDefaut({ git, depot, url, branche });
  git(["--git-dir", depot, "symbolic-ref", "HEAD", `refs/heads/${branche}`]);
  if (retour.statut === "avance") journal(`${miroir.nom} : ${branche} ramené à ${retour.apres.slice(0, 7)}`);
  if (retour.statut === "diverge") journal(`${miroir.nom} : le miroir a divergé de GitHub, rien n'est écrasé`);
  return retour;
}

/**
 * Le titre et le corps de la PR, tirés de ce que les agents ont écrit sur la branche du
 * run : l'objectif du plan, les changements faits, le verdict.
 */
function descriptionPR({ git, depot, projetId, branche, runId }) {
  const lire = (fichier) => {
    try {
      return JSON.parse(git(["--git-dir", depot, "show", `run/${runId}:${fichier}`]));
    } catch {
      return null;
    }
  };
  const plan = lire("improvement-plan.json");
  const applique = lire("applied.json");
  const verdict = lire("verdict.json") || lire("test-report.json");
  const objectif = plan && typeof plan.objective === "string" ? plan.objective.trim() : `run ${runId.slice(0, 8)}`;
  const titre = `agent(${projetId}): ${objectif}`.slice(0, 120);
  const puces = (liste) =>
    Array.isArray(liste) && liste.length
      ? liste.map((x) => `- ${typeof x === "string" ? x : JSON.stringify(x)}`).join("\n")
      : "- (rien)";
  const corps = [
    `Livré par le run \`${runId}\` du cockpit, sur \`${branche}\`.`,
    "",
    "## Objectif",
    objectif,
    "",
    "## Changements faits",
    puces(applique && applique.changes_done),
    "",
    "## Bloqués",
    puces(applique && applique.changes_blocked),
    "",
    `## Verdict du pipeline : ${verdict && verdict.verdict ? verdict.verdict : "inconnu"}`,
    "",
    `La trace complète (plan, rapports) reste sur la branche \`run/${runId}\` du dépôt du NAS.`,
  ].join("\n");
  return { titre, corps };
}

/**
 * Un appel à l'API GitHub.
 * @param {{ fetchImpl: typeof fetch, jeton: string, api?: string }} options
 */
function apiAvec({ fetchImpl, jeton, api = "https://api.github.com" }) {
  return async (methode, chemin, corps) => {
    const reponse = await fetchImpl(`${api}${chemin}`, {
      method: methode,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jeton}`,
        "x-github-api-version": "2022-11-28",
        ...(corps ? { "content-type": "application/json" } : {}),
      },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const lu = await reponse.json().catch(() => null);
    if (!reponse.ok) throw new Error(`GitHub ${methode} ${chemin} : ${reponse.status} ${lu && lu.message ? lu.message : ""}`.trim());
    return lu;
  };
}

/**
 * Un passage sur un projet : ramener la branche par défaut, publier les branches agent/
 * nouvelles ou déplacées, ouvrir leur PR. L'état (ce qui est déjà publié) est rendu, pas
 * écrit : l'appelant le garde.
 */
async function publierProjet({ projet, git, api, urlDepot, etat, store = null, journal = () => {} }) {
  const depot = projet.repo;
  const infos = await api("GET", `/repos/${projet.github}`);
  const parDefaut = infos.default_branch;
  const retour = ramenerParDefaut({ git, depot, url: urlDepot, branche: parDefaut });
  if (retour.statut === "avance") journal(`${projet.id} : ${parDefaut} ramené à ${retour.apres.slice(0, 7)}`);
  if (retour.statut === "diverge") journal(`${projet.id} : ${parDefaut} du NAS a divergé de GitHub, rien n'est écrasé`);

  const refs = git(["--git-dir", depot, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/agent/"]);
  const publiees = [];
  for (const ligne of refs ? refs.split("\n") : []) {
    const [branche, sha] = ligne.split(" ");
    const cle = `${projet.id}:${branche}`;
    const runId = extraireRunId(git, depot, sha);
    // Le suivi durable de l'event store prime sur `etat` : un fichier d'état perdu ne doit ni
    // rouvrir une PR fusionnée ou fermée, ni repousser en force une branche déjà publiée, ce
    // qui effacerait sur GitHub une correction poussée par ci-autofix.
    const livraison = store ? suivi.livraisonDeBranche({ store, projet, branche, sha, runId }) : null;
    if (livraison && livraison.deliverySha === sha && (livraison.finishedAt || livraison.pr)) {
      etat[cle] = { sha, pr: livraison.pr, le: new Date().toISOString() };
      continue;
    }
    if (etat[cle] && etat[cle].sha === sha) continue;
    // La branche est celle du moteur : une relivraison la remplace.
    try {
      git(["--git-dir", depot, "push", "-q", "-f", urlDepot, `refs/heads/${branche}:refs/heads/${branche}`]);
    } catch (err) {
      const raison = String(err.stderr || err.message).trim().split("\n")[0];
      if (livraison) store.majLivraison(livraison.runId, { statut: "failed", raison: `push vers GitHub refusé : ${raison}`, repo: projet.github });
      journal(`${projet.id} : push de ${branche} refusé, retenté au prochain passage (${raison})`);
      continue;
    }
    const proprietaire = projet.github.split("/")[0];
    const ouvertes = await api("GET", `/repos/${projet.github}/pulls?state=open&head=${encodeURIComponent(`${proprietaire}:${branche}`)}`);
    let pr = Array.isArray(ouvertes) && ouvertes[0] ? ouvertes[0] : null;
    if (!pr) {
      const { titre, corps } = descriptionPR({ git, depot, projetId: projet.id, branche, runId: runId || branche });
      pr = await api("POST", `/repos/${projet.github}/pulls`, { title: titre, head: branche, base: parDefaut, body: corps });
      journal(`${projet.id} : PR #${pr.number} ouverte pour ${branche}`);
    }
    if (livraison) {
      store.majLivraison(livraison.runId, {
        statut: "pr_open", raison: "PR ouverte, CI attendue", repo: projet.github,
        pr: pr.number, prUrl: pr.html_url || null, headSha: sha,
      });
    }
    etat[cle] = { sha, pr: pr.number, le: new Date().toISOString() };
    publiees.push({ branche, sha, pr: pr.number, runId: livraison ? livraison.runId : runId });
  }
  return { retour, publiees };
}

// Le run d'origine, lu dans les messages des commits du moteur : « [run <id>] … ».
function extraireRunId(git, depot, sha) {
  const messages = git(["--git-dir", depot, "log", "-20", "--format=%s", sha]);
  const trouve = messages.match(/\[run ([0-9a-f-]{8,})\]/);
  return trouve ? trouve[1] : null;
}

function lireEtat(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, "utf-8"));
  } catch {
    return {};
  }
}

function ecrireEtat(fichier, etat) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const temporaire = `${fichier}.${process.pid}.tmp`;
  fs.writeFileSync(temporaire, `${JSON.stringify(etat, null, 2)}\n`);
  fs.renameSync(temporaire, fichier);
}

module.exports = {
  projetsAPublier,
  gitAvec,
  apiAvec,
  ramenerParDefaut,
  miroirsSysteme,
  tenirMiroir,
  descriptionPR,
  publierProjet,
  lireEtat,
  ecrireEtat,
};
