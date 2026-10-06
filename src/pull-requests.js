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

// Les fichiers dont une modification exige une fusion explicite (AGENTS.md, « Norme GitHub ») :
// la page le signale, et c'est le clic de Raphaël qui vaut fusion explicite.
const SENSIBLES = [
  /^\.github\//,
  /(^|\/)CODEOWNERS$/,
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /(^|\/)copilot-instructions\.md$/,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)specs\/[^/]*\.env/,
  /\.(pem|key|crt|p12)$/,
  /\.sql$/,
  /(^|\/)migrations?\//,
  /(^|\/)Dockerfile[^/]*$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)vercel\.json$/,
  /\.tf$/,
  /(^|\/)(terraform|infra)\//,
  /(^|\/)deploy\//,
  /(^|\/)bin\/livrer\.sh$/,
];

const estSensible = (fichier) => SENSIBLES.some((re) => re.test(String(fichier)));

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

// L'état de la CI d'un commit, d'après ses exécutions GitHub Actions : verte quand toutes sont
// terminées sans échec, en cours tant qu'une tourne, rouge au premier échec, absente sans
// aucune. Les exécutions plutôt que les « check runs » : un jeton fin ne peut pas recevoir le
// droit Checks (constaté le 2026-10-06), alors que le droit Actions en lecture suffit ici.
// Une exécution relancée remplace la précédente : seule la plus récente de chaque workflow compte.
function etatCI(actions) {
  const vus = new Set();
  const runs = ((actions && actions.workflow_runs) || []).filter((r) => {
    const cle = r.workflow_id ?? r.name;
    if (vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
  if (!runs.length) return { etat: "absente", details: [] };
  const details = runs.map((r) => ({ nom: r.name, statut: r.status, conclusion: r.conclusion || null }));
  if (runs.some((r) => r.status !== "completed")) return { etat: "en_cours", details };
  const ok = new Set(["success", "neutral", "skipped"]);
  return { etat: runs.every((r) => ok.has(r.conclusion)) ? "verte" : "rouge", details };
}

/**
 * Relève les PR d'un dépôt : les ouvertes, avec ce qu'il faut pour décider d'une fusion, et
 * les dernières fusionnées sur la branche par défaut, avec leur phrase « Pourquoi ».
 * @param {{ api: Function, depot: string }} opts `api(methode, chemin)` de src/publieur.js
 */
async function releverDepot({ api, depot }) {
  const infos = await api("GET", `/repos/${depot}`);
  const parDefaut = infos.default_branch;
  const ouvertesBrutes = await api("GET", `/repos/${depot}/pulls?state=open&per_page=30`);
  const ouvertes = [];
  for (const pr of ouvertesBrutes) {
    // `mergeable` n'est calculé qu'à la lecture d'une PR seule, jamais dans la liste.
    const detail = await api("GET", `/repos/${depot}/pulls/${pr.number}`);
    // Les plus récentes d'abord : `etatCI` garde la première de chaque workflow.
    const checks = await api("GET", `/repos/${depot}/actions/runs?head_sha=${pr.head.sha}&per_page=50`);
    const fichiers = await api("GET", `/repos/${depot}/pulls/${pr.number}/files?per_page=100`);
    ouvertes.push({
      numero: pr.number,
      titre: pr.title,
      url: pr.html_url,
      auteur: pr.user ? pr.user.login : null,
      branche: pr.head.ref,
      base: pr.base.ref,
      versDefaut: pr.base.ref === parDefaut,
      sha: pr.head.sha,
      brouillon: Boolean(pr.draft),
      fusionnable: detail.mergeable,
      etatFusion: detail.mergeable_state || null,
      ci: etatCI(checks),
      sensibles: fichiers.map((f) => f.filename).filter(estSensible),
      fichiers: fichiers.length,
      pourquoi: pourquoiDe(pr.body),
      creeeLe: pr.created_at,
    });
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
  if (pr.brouillon) return "brouillon";
  if (!pr.versDefaut) return `vise ${pr.base}, pas la branche par défaut`;
  if (pr.ci.etat !== "verte") return pr.ci.etat === "absente" ? "aucune CI sur ce commit" : `CI ${pr.ci.etat === "en_cours" ? "en cours" : "rouge"}`;
  if (pr.fusionnable === false || pr.etatFusion === "dirty") return "conflit avec la branche par défaut";
  if (pr.fusionnable !== true) return "GitHub calcule encore si elle est fusionnable";
  if (pr.etatFusion === "blocked") return "bloquée par une règle du dépôt (revue ou conversation ouverte)";
  return null;
}

class RefusFusion extends Error {}

/**
 * Fusionne une PR, après avoir tout relu sur GitHub : l'instantané du cockpit peut dater de
 * deux minutes. Squash, avec le SHA lu à l'écran : GitHub refuse si la tête a bougé.
 * @param {{ api: Function, demande: { depot: string, numero: number, sha: string } }} opts
 */
async function fusionner({ api, demande }) {
  const { depot, numero, sha } = demande;
  const relue = await releverDepot({ api, depot });
  const pr = relue.ouvertes.find((p) => p.numero === numero);
  if (!pr) throw new RefusFusion(`PR #${numero} de ${depot} introuvable ou déjà fermée`);
  if (pr.sha !== sha) throw new RefusFusion(`la PR #${numero} a bougé depuis l'affichage (${pr.sha.slice(0, 7)} au lieu de ${sha.slice(0, 7)})`);
  const raison = raisonDeNePasFusionner(pr);
  if (raison) throw new RefusFusion(`PR #${numero} non fusionnable : ${raison}`);
  const r = await api("PUT", `/repos/${depot}/pulls/${numero}/merge`, { sha, merge_method: "squash" });
  return { fusionnee: Boolean(r && r.merged), sha: r && r.sha, message: r && r.message };
}

const DEPOT = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

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

module.exports = {
  SENSIBLES,
  estSensible,
  pourquoiDe,
  etatCI,
  releverDepot,
  relever,
  raisonDeNePasFusionner,
  fusionner,
  RefusFusion,
  depotsSurveilles,
  ecrireInstantane,
  lireInstantane,
};
