// Les PR GitHub vues et fusionnées depuis le cockpit (décision du 2026-10-06).
//
// Le cockpit ne détient aucun jeton. Le publieur relève les PR de chaque dépôt surveillé et
// écrit l'instantané dans `etat/pull-requests.json`, que le cockpit lit ; une fusion part du
// cockpit en commande signée `github.merge`, que le publieur exécute avec GITHUB_TOKEN_FUSION
// après avoir tout revérifié. Le code d'une PR n'est jamais récupéré ni exécuté ici : seules
// ses métadonnées passent.
//
// Le même instantané nomme les livraisons : chaque PR fusionnée garde la première phrase de
// sa section « Pourquoi », que la carte Livraison affiche à côté des commits qu'elle livre.
const fs = require("fs");
const path = require("path");
const { SHA, pages, lireCI, lireConversations } = require("./github-merge-gates");

// Les fichiers dont une modification exige une fusion explicite (AGENTS.md, « Norme GitHub ») :
// la page le signale, et c'est le clic de Raphaël qui vaut fusion explicite.
const SENSIBLES = [
  /^\.github\//,
  /(^|\/)CODEOWNERS$/,
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /(^|\/)copilot-instructions\.md$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)[^/]*\.env(\.|$)/,
  /(^|\/)specs\/[^/]*\.env/,
  /secret|credential|token/,
  /\.(pem|key|crt|p12|pfx|cer)$/,
  /\.sql$/,
  /(^|\/)migrations?\//,
  /(^|\/)Dockerfile[^/]*$/,
  /\.Dockerfile$/,
  /(^|\/)(compose([.-][^/]*)?\.ya?ml|\.dockerignore)$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)vercel\.json$/,
  /\.tf(vars)?$/,
  /(^|\/)(terraform|infra|infrastructure)\//,
  /(^|\/)(deploy|deployment)\//,
  /(^|\/)[^/]*deploy[^/]*\.(sh|js|mjs|cjs|py)$/,
  /(^|\/)bin\/livrer\.sh$/,
  /^src\/(github-merge-gates|pull-requests|api-pull-requests)\.js$/,
  /^bin\/publieur\.js$/,
  /^packages\/schemas\/commandes\.js$/,
  /^specs\/livraison\.json$/,
  // Règles d'agents et dépendances : ci-autofix les refuse déjà dans ses propres correctifs.
  /(^|\/)\.claude\//,
  /(^|\/)\.mcp\.json$/,
  /(^|\/)CLAUDE\.local\.md$/,
  /(^|\/)(\.gitattributes|\.npmrc)$/,
  /(^|\/)(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/,
  // Le code qui décide qui signe, qui livre et ce qu'un agent peut faire.
  /^src\/(acces|api-livraison|livreur|chat-outils|conseiller|signature-commandes)\.js$/,
  /^bin\/(cockpit|livreur|commande-runner)\.js$/,
  /^bin\/tailnet-relais\.sh$/,
  /^src\/(agent-runner|codex-runner|cockpit-read|chat|workers|tailnet)\.js$/,
  /^src\/(worker|maitre)[^/]*\.js$/,
  /^agents\//,
];

const estSensible = (fichier) => SENSIBLES.some((re) => new RegExp(re.source, "i").test(String(fichier)));

/**
 * La première phrase de la section « Pourquoi » d'une description de PR, sans markdown. Rend
 * null quand la PR n'en a pas : la page affiche alors son titre.
 * @param {string|null|undefined} corps
 */
function pourquoiDe(corps) {
  // `(?![\s\S])` et non `$` pour la fin : avec le drapeau m, `$` s'arrête à la première ligne.
  const m = String(corps || "").match(/^#{1,3}\s*Pourquoi\s*\n+([\s\S]*?)(?=\n#{1,3}\s|(?![\s\S]))/im);
  if (!m) return null;
  const texte = m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!texte) return null;
  const phrase = texte.match(/^.+?[.!?](?=\s|$)/);
  const p = (phrase ? phrase[0] : texte).trim();
  return p.length > 280 ? `${p.slice(0, 279)}…` : p;
}

// Vue de compatibilité de l'ancien relevé, jamais une preuve autorisant la fusion.
function etatCI(actions) {
  const vus = new Set();
  const runs = [...((actions && actions.workflow_runs) || [])]
    .filter((r) => r.name === "CI")
    .sort((a, b) => (b.run_number - a.run_number) || (b.id - a.id) || (b.run_attempt - a.run_attempt))
    .filter((r) => {
      const cle = r.workflow_id ?? r.name;
      if (vus.has(cle)) return false;
      vus.add(cle);
      return true;
    });
  if (!runs.length) return { etat: "absente", details: [] };
  const details = runs.map((r) => ({ nom: r.name, statut: r.status, conclusion: r.conclusion || null }));
  if (runs.some((r) => r.status !== "completed")) return { etat: "en_cours", details };
  return { etat: runs.every((r) => r.conclusion === "success") ? "verte" : "rouge", details };
}

/** Lit une seule PR, toujours à partir de son détail courant, jamais du SHA d'une liste. */
async function releverPR({ api, depot, numero, parDefaut }) {
  const pr = await api("GET", `/repos/${depot}/pulls/${numero}`);
  const base = await api("GET", `/repos/${depot}/commits/${encodeURIComponent(parDefaut)}`);
  if (!SHA.test(pr.head?.sha) || !SHA.test(base?.sha)) throw new Error("SHA GitHub incomplets");
  let ci;
  let conversations;
  let fichiers = [];
  let fichiersComplets = false;
  let erreurValidation = null;
  try {
    ci = await lireCI({ api, depot, numero, sha: pr.head.sha, baseSha: base.sha, parDefaut });
  } catch (err) {
    ci = { etat: "absente", details: [], preuve: null, raison: `preuves CI illisibles : ${err.message}` };
  }
  try {
    conversations = await lireConversations({ api, depot, numero });
  } catch (err) {
    conversations = { ouvertes: null, erreur: err.message };
  }
  try {
    fichiers = await pages({ api, chemin: `/repos/${depot}/pulls/${numero}/files` });
    fichiersComplets = Number.isInteger(pr.changed_files) && fichiers.length === pr.changed_files && fichiers.every((f) => typeof f.filename === "string");
    if (!fichiersComplets) erreurValidation = "liste des fichiers modifiés incomplète";
  } catch (err) {
    erreurValidation = `fichiers modifiés illisibles : ${err.message}`;
  }
  return {
    numero, titre: pr.title, url: pr.html_url, auteur: pr.user?.login || null,
    branche: pr.head.ref, base: pr.base.ref, versDefaut: pr.base.ref === parDefaut,
    interne: pr.head.repo?.full_name?.toLowerCase() === depot.toLowerCase(),
    etat: pr.state, sha: pr.head.sha, baseSha: base.sha, brouillon: Boolean(pr.draft),
    fusionnable: pr.mergeable, etatFusion: pr.mergeable_state || null, ci, conversations,
    sensibles: [...new Set(fichiers.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)).filter(estSensible))],
    fichiers: pr.changed_files, fichiersComplets, erreurValidation,
    pourquoi: pourquoiDe(pr.body), creeeLe: pr.created_at,
  };
}

/**
 * Relève les PR d'un dépôt : les ouvertes, avec ce qu'il faut pour décider d'une fusion, et
 * les dernières fusionnées sur la branche par défaut, avec leur phrase « Pourquoi ».
 * @param {{ api: Function, depot: string }} opts `api(methode, chemin)` de src/publieur.js
 */
async function releverDepot({ api, depot }) {
  const infos = await api("GET", `/repos/${depot}`);
  const parDefaut = infos.default_branch;
  const ouvertesBrutes = await pages({ api, chemin: `/repos/${depot}/pulls?state=open`, limite: 1000 });
  const ouvertes = [];
  for (const pr of ouvertesBrutes) {
    ouvertes.push(await releverPR({ api, depot, numero: pr.number, parDefaut }));
  }
  const fermees = await api("GET", `/repos/${depot}/pulls?state=closed&base=${encodeURIComponent(parDefaut)}&sort=updated&direction=desc&per_page=30`);
  const fusionnees = fermees
    .filter((pr) => pr.merged_at)
    .map((pr) => ({
      numero: pr.number,
      titre: pr.title,
      url: pr.html_url,
      // Le commit de fusion (squash ou merge) et la tête de la PR : la carte Livraison retrouve
      // la PR par l'un ou l'autre parmi les commits qu'elle livre.
      shas: [pr.merge_commit_sha, pr.head && pr.head.sha].filter(Boolean),
      pourquoi: pourquoiDe(pr.body),
      fusionneeLe: pr.merged_at,
    }));
  return { depot, parDefaut, ouvertes, fusionnees };
}

/**
 * L'instantané de tous les dépôts surveillés. Un dépôt illisible (droits, réseau) est signalé
 * à sa place sans priver les autres.
 */
async function relever({ api, depots, maintenant = new Date() }) {
  const resultats = [];
  for (const depot of depots) {
    try {
      resultats.push(await releverDepot({ api, depot }));
    } catch (err) {
      resultats.push({ depot, erreur: String(err.message).split("\n")[0], ouvertes: [], fusionnees: [] });
    }
  }
  return { releveLe: maintenant.toISOString(), depots: resultats };
}

/** Pourquoi une PR relevée ne peut pas être fusionnée d'ici, ou null si elle le peut. */
function raisonDeNePasFusionner(pr) {
  if (pr.etat !== "open") return "PR fermée ou état inconnu";
  if (pr.brouillon) return "brouillon";
  if (!pr.versDefaut) return `vise ${pr.base}, pas la branche par défaut`;
  if (!pr.interne) return "PR issue d'un autre dépôt";
  if (pr.ci?.raison) return pr.ci.raison;
  if (pr.ci?.etat !== "verte") return pr.ci?.etat === "absente" ? "aucune CI sur ce commit" : `CI ${pr.ci?.etat === "en_cours" ? "en cours" : "rouge"}`;
  if (!SHA.test(pr.baseSha) || pr.ci.preuve?.headSha !== pr.sha || pr.ci.preuve?.baseSha !== pr.baseSha || !SHA.test(pr.ci.preuve?.mergeSha)) return "la CI ne prouve pas le merge testé sur la base courante";
  if (!pr.fichiersComplets) return pr.erreurValidation || "liste des fichiers modifiés incomplète";
  if (pr.conversations?.erreur || !Number.isInteger(pr.conversations?.ouvertes)) return pr.conversations?.erreur || "conversations de revue illisibles";
  if (pr.conversations.ouvertes > 0) return "conversations de revue non résolues";
  if (pr.fusionnable === false || pr.etatFusion === "dirty") return "conflit avec la branche par défaut";
  if (pr.fusionnable !== true) return "GitHub calcule encore si elle est fusionnable";
  if (pr.etatFusion === "blocked") return "bloquée par une règle du dépôt (revue ou conversation ouverte)";
  return null;
}

class RefusFusion extends Error {}

/**
 * Fusionne une PR, après avoir tout relu sur GitHub : l'instantané du cockpit peut dater de
 * deux minutes. Squash, avec le SHA lu à l'écran : GitHub refuse si la tête a bougé.
 * `verifierPreuves(pr)` rend la raison pour laquelle les preuves de tests et de revue ne couvrent
 * pas la tête `sha`, ou null ; il est appelé juste avant la fusion, sur ce SHA exact.
 * @param {{ api: Function, demande: { depot: string, numero: number, sha: string, baseSha: string },
 *   verifierPreuves?: ((pr: { depot: string, numero: number, sha: string }) => Promise<string|null>)|null }} opts
 */
async function fusionner({ api, demande, verifierPreuves = null }) {
  const { depot, numero, sha, baseSha } = demande;
  if (!DEPOT.test(depot) || !Number.isInteger(numero) || numero < 1 || !SHA.test(sha) || !SHA.test(baseSha)) throw new RefusFusion("demande de fusion incomplète : tête et base exactes requises");
  const infos = await api("GET", `/repos/${depot}`);
  const pr = await releverPR({ api, depot, numero, parDefaut: infos.default_branch });
  if (pr.sha !== sha) throw new RefusFusion(`la PR #${numero} a bougé depuis l'affichage (${pr.sha.slice(0, 7)} au lieu de ${sha.slice(0, 7)})`);
  if (pr.baseSha !== baseSha) throw new RefusFusion("la base a bougé depuis l'affichage : attendre une CI sur la nouvelle base");
  const raison = raisonDeNePasFusionner(pr);
  if (raison) throw new RefusFusion(`PR #${numero} non fusionnable : ${raison}`);
  // Après les lectures potentiellement longues : détecter une nouvelle tentative CI, une
  // conversation ouverte ou un changement de PR/base. Le PUT fixe atomiquement la tête ;
  // l'API REST GitHub ne propose pas de précondition atomique sur la base (limite documentée).
  const ci = await lireCI({ api, depot, numero, sha, baseSha, parDefaut: infos.default_branch });
  if (ci.raison || ci.preuve?.runId !== pr.ci.preuve.runId || ci.preuve?.tentative !== pr.ci.preuve.tentative) throw new RefusFusion("la CI a changé pendant la validation : recharger");
  const conversations = await lireConversations({ api, depot, numero });
  if (conversations.ouvertes) throw new RefusFusion("conversations de revue non résolues");
  const courant = await api("GET", `/repos/${depot}/pulls/${numero}`);
  if (courant.head?.sha !== sha || courant.base?.ref !== infos.default_branch || courant.state !== "open" || courant.draft || courant.head.repo?.full_name?.toLowerCase() !== depot.toLowerCase() || courant.mergeable !== true || courant.mergeable_state === "blocked" || courant.mergeable_state === "dirty") throw new RefusFusion("la PR a changé ou n'est plus fusionnable pendant la validation");
  const actuel = await api("GET", `/repos/${depot}`);
  if (actuel.default_branch !== infos.default_branch) throw new RefusFusion("la branche par défaut a changé pendant la validation");
  const base = await api("GET", `/repos/${depot}/commits/${encodeURIComponent(actuel.default_branch)}`);
  if (base.sha !== baseSha) throw new RefusFusion("la base a bougé pendant la validation : attendre une nouvelle CI");
  // Le PUT fixe la tête : des preuves qui couvrent ce SHA couvrent ce qui sera fusionné.
  const preuves = verifierPreuves ? await verifierPreuves({ depot, numero, sha }) : null;
  if (preuves) throw new RefusFusion(`PR #${numero} non fusionnable : ${preuves}`);
  const r = await api("PUT", `/repos/${depot}/pulls/${numero}/merge`, { sha, merge_method: "squash" });
  return { fusionnee: Boolean(r && r.merged), sha: r && r.sha, message: r && r.message, preuve: ci.preuve };
}

/**
 * Relance la CI rouge d'une PR depuis le cockpit. Relancer les jobs réutilise le merge déjà
 * testé : si la branche par défaut a avancé depuis, « Verify tested merge » échoue à nouveau.
 * Dans ce cas la branche est mise à jour (nouveau commit de merge, donc nouvelle CI), sinon
 * seuls les jobs échoués repartent.
 * @returns {Promise<{ depot: string, numero: number, sha: string, runId: number, tentative: number, statut: "relancee"|"branche_mise_a_jour" }>}
 */
async function relancerCI({ api, demande }) {
  const { depot, numero, sha, runId, tentative } = demande || {};
  if (!DEPOT.test(String(depot)) || !Number.isInteger(numero) || numero < 1 || !SHA.test(String(sha)) || !Number.isInteger(runId) || !Number.isInteger(tentative)) {
    throw new RefusFusion("demande de relance incomplète");
  }
  const pr = await api("GET", `/repos/${depot}/pulls/${numero}`);
  if (pr.state !== "open" || pr.head?.sha !== sha) throw new RefusFusion("la PR est fermée ou sa tête a changé");
  const run = await api("GET", `/repos/${depot}/actions/runs/${runId}`);
  const association = run.pull_requests?.find((a) => a.number === numero && a.head?.sha === sha);
  if (run.name !== "CI" || run.event !== "pull_request" || run.head_sha !== sha || !association ||
      run.status !== "completed" || run.run_attempt !== tentative) {
    throw new RefusFusion("la dernière CI n'est plus celle affichée sur cette tête");
  }
  const infos = await api("GET", `/repos/${depot}`);
  const base = await api("GET", `/repos/${depot}/commits/${encodeURIComponent(infos.default_branch)}`);
  const basePerimee = pr.base?.ref === infos.default_branch && SHA.test(String(base?.sha)) &&
    SHA.test(String(association.base?.sha)) && association.base.sha !== base.sha;
  // Une CI verte ne se relance que si sa base est dépassée : sinon elle prouve déjà le merge.
  if (run.conclusion !== "failure" && !(run.conclusion === "success" && basePerimee)) {
    throw new RefusFusion("la dernière CI n'est ni en échec ni sur une base dépassée");
  }
  const resultat = { depot, numero, sha, runId, tentative };
  if (basePerimee) {
    try {
      // expected_head_sha : GitHub refuse si la tête a bougé depuis la vérification.
      await api("PUT", `/repos/${depot}/pulls/${numero}/update-branch`, { expected_head_sha: sha });
    } catch (err) {
      throw new RefusFusion(`mise à jour de la branche refusée (conflit ou tête déplacée) : ${String(err.message).split("\n")[0]}`);
    }
    return { ...resultat, statut: "branche_mise_a_jour" };
  }
  await api("POST", `/repos/${depot}/actions/runs/${runId}/rerun-failed-jobs`);
  return { ...resultat, statut: "relancee" };
}

/**
 * Écrit à l'agent d'une PR (commande `github.pr.comment`, déposée par un conseiller du chat).
 * Le message vise l'état lu : PR interne, ouverte, même tête, sinon rien n'est posté.
 * @returns {Promise<{ depot: string, numero: number, sha: string, url: string|null }>}
 */
async function commenter({ api, demande }) {
  const { depot, numero, sha, corps } = demande || {};
  if (!DEPOT.test(String(depot)) || !Number.isInteger(numero) || numero < 1 || !SHA.test(String(sha)) || typeof corps !== "string" || !corps.trim()) {
    throw new RefusFusion("demande de commentaire incomplète");
  }
  const pr = await api("GET", `/repos/${depot}/pulls/${numero}`);
  if (pr.state !== "open" || pr.head?.sha !== sha) throw new RefusFusion("la PR est fermée ou sa tête a changé");
  if (pr.head?.repo?.full_name?.toLowerCase() !== String(depot).toLowerCase()) throw new RefusFusion("PR d'un fork : pas de commentaire depuis le cockpit");
  const commentaire = await api("POST", `/repos/${depot}/issues/${numero}/comments`, { body: corps });
  return { depot, numero, sha, url: commentaire?.html_url || null };
}

const DEPOT =/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

/**
 * Les dépôts dont le cockpit montre les PR : la liste explicite de PULL_REQUESTS_DEPOTS
 * (« propriétaire/dépôt » séparés par des virgules), sinon les dépôts système et ceux des
 * fiches projet qui déclarent un `github`.
 * @param {{ texte?: string|null, miroirs?: Array<{ github: string }>, projetsDir?: string|null }} opts
 */
function depotsSurveilles({ texte = null, miroirs = [], projetsDir = null } = {}) {
  const explicites = String(texte || "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => DEPOT.test(d));
  if (explicites.length) return [...new Set(explicites)];
  const depots = miroirs.map((m) => m.github).filter((d) => DEPOT.test(String(d)));
  if (projetsDir && fs.existsSync(projetsDir)) {
    for (const entree of fs.readdirSync(projetsDir, { withFileTypes: true })) {
      if (!entree.isDirectory()) continue;
      try {
        const fiche = JSON.parse(fs.readFileSync(path.join(projetsDir, entree.name, "project.json"), "utf8"));
        if (DEPOT.test(String(fiche.github || ""))) depots.push(fiche.github);
      } catch {
        // Une fiche absente ou illisible ne cache pas les autres dépôts.
      }
    }
  }
  return [...new Set(depots)];
}

function ecrireInstantane(fichier, instantane) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(instantane, null, 2));
  fs.renameSync(tmp, fichier);
}

function lireInstantane(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, "utf8"));
  } catch {
    return null;
  }
}

// Les branches que les agents ouvrent, celles de la norme d'auto-merge.
const BRANCHES_AGENT = /^(codex|claude|agent|automation)\//;

/**
 * Les PR d'agents dont la CI est verte sur une base dépassée. Personne ne relance leur CI :
 * l'autofix ne réagit qu'à un échec, et la fusion exige un merge testé sur la base courante.
 * Mettre la branche à jour crée un nouveau merge, donc une nouvelle CI.
 * @param {{ depots?: Array<{ depot: string, ouvertes?: any[] }> }|null} instantane
 */
function aMettreAJour(instantane) {
  const liste = [];
  for (const d of (instantane && instantane.depots) || []) {
    for (const pr of d.ouvertes || []) {
      if (pr.etat !== "open" || pr.brouillon || !pr.interne || !pr.versDefaut || !BRANCHES_AGENT.test(String(pr.branche || ""))) continue;
      if (!pr.ci || !pr.ci.basePerimee || pr.fusionnable === false || pr.etatFusion === "dirty") continue;
      liste.push({ depot: d.depot, numero: pr.numero, sha: pr.sha, baseSha: pr.baseSha });
    }
  }
  return liste;
}

/** Met la branche d'une PR à jour avec la base ; GitHub refuse si la tête a bougé. */
async function mettreAJourBranche({ api, depot, numero, sha }) {
  if (!DEPOT.test(String(depot)) || !Number.isInteger(numero) || numero < 1 || !SHA.test(String(sha))) throw new RefusFusion("mise à jour de branche incomplète");
  await api("PUT", `/repos/${depot}/pulls/${numero}/update-branch`, { expected_head_sha: sha });
}

module.exports = {
  aMettreAJour,
  mettreAJourBranche,
  SENSIBLES,
  estSensible,
  pourquoiDe,
  etatCI,
  releverDepot,
  releverPR,
  relever,
  raisonDeNePasFusionner,
  fusionner,
  relancerCI,
  commenter,
  RefusFusion,
  depotsSurveilles,
  ecrireInstantane,
  lireInstantane,
};
