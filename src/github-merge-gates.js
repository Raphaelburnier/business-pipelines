// Preuves de fusion lues sur GitHub, sans checkout ni exécution du code de la PR.
// Le nom de l'étape CI est évalué par GitHub depuis son contexte pull_request ; son script
// vérifie HEAD et ses deux parents avant les tests. On relit les jobs de la tentative exacte
// puis les parents du commit par l'API Git, sans se fier aux dates des commits.
const SHA = /^[0-9a-f]{40}$/;
const PREUVE = /^Verify tested merge \(merge=([0-9a-f]{40}), head=([0-9a-f]{40}), base=([0-9a-f]{40})\)$/;

async function pages({ api, chemin, cle = null, limite = 3000 }) {
  const lignes = [];
  for (let page = 1; page <= Math.ceil(limite / 100) + 1; page++) {
    const lu = await api("GET", `${chemin}${chemin.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const lot = cle ? lu?.[cle] : lu;
    if (!Array.isArray(lot) || lot.length > 100) throw new Error("pagination GitHub invalide");
    if (cle && (!Number.isInteger(lu.total_count) || lu.total_count > limite || lu.total_count < 0)) {
      throw new Error("collection GitHub incomplète ou trop grande");
    }
    lignes.push(...lot);
    if (lignes.length > limite) throw new Error("collection GitHub trop grande");
    if (lot.length < 100) {
      if (cle && lignes.length !== lu.total_count) throw new Error("collection GitHub incomplète");
      return lignes;
    }
  }
  throw new Error("pagination GitHub incomplète");
}

function derniereCI(runs, workflowId, sha) {
  return runs
    .filter((r) => r.workflow_id === workflowId && r.name === "CI" && r.head_sha === sha && r.event === "pull_request")
    .sort((a, b) => (b.run_number - a.run_number) || (b.id - a.id) || (b.run_attempt - a.run_attempt))[0] || null;
}

async function lireCI({ api, depot, numero, sha, baseSha, parDefaut }) {
  const workflow = await api("GET", `/repos/${depot}/actions/workflows/ci.yml`);
  if (workflow?.name !== "CI" || workflow.path !== ".github/workflows/ci.yml" || !Number.isInteger(workflow.id)) {
    throw new Error("le workflow ci.yml doit s'appeler exactement CI");
  }
  const runs = await pages({ api, chemin: `/repos/${depot}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=pull_request`, cle: "workflow_runs", limite: 1000 });
  const dernier = derniereCI(runs, workflow.id, sha);
  const ci = { etat: "absente", details: [], preuve: null, runId: null, tentative: null, raison: "aucune CI sur ce commit" };
  if (!dernier) return ci;
  ci.runId = Number.isInteger(dernier.id) ? dernier.id : null;
  ci.tentative = Number.isInteger(dernier.run_attempt) ? dernier.run_attempt : null;
  ci.details = [{ nom: "CI", statut: dernier.status, conclusion: dernier.conclusion || null }];
  // Le lien du run CI, pour l'écran ; jamais une preuve.
  ci.url = typeof dernier.html_url === "string" ? dernier.html_url : null;
  if (dernier.status !== "completed") return { ...ci, etat: "en_cours", raison: "CI en cours" };
  if (dernier.conclusion !== "success") return { ...ci, etat: "rouge", raison: "CI rouge (seul success autorise la fusion)" };
  ci.etat = "verte";
  ci.raison = "la CI ne prouve pas le merge testé sur la base courante";
  if (!Number.isInteger(dernier.id) || !Number.isInteger(dernier.run_attempt) || dernier.run_attempt < 1) return ci;
  const association = dernier.pull_requests?.find((p) => p.number === numero);
  if (!association || association.head?.sha !== sha || association.base?.ref !== parDefaut || association.base?.sha !== baseSha) return ci;
  const jobs = await pages({ api, chemin: `/repos/${depot}/actions/runs/${dernier.id}/attempts/${dernier.run_attempt}/jobs`, cle: "jobs", limite: 1000 });
  const preuves = jobs
    .filter((j) => j.head_sha === sha && j.status === "completed" && j.conclusion === "success")
    .flatMap((j) => (j.steps || []).filter((s) => s.status === "completed" && s.conclusion === "success").map((s) => PREUVE.exec(s.name)))
    .filter(Boolean);
  if (!preuves.length || preuves.some((p) => p[2] !== sha || p[3] !== baseSha || p[1] !== preuves[0][1])) return ci;
  const mergeSha = preuves[0][1];
  const merge = await api("GET", `/repos/${depot}/git/commits/${mergeSha}`);
  if (merge?.sha !== mergeSha || merge.parents?.length !== 2 || merge.parents[0].sha !== baseSha || merge.parents[1].sha !== sha) return ci;
  return { ...ci, raison: null, preuve: { runId: dernier.id, tentative: dernier.run_attempt, headSha: sha, baseSha, mergeSha } };
}

const THREADS = `query($owner:String!, $name:String!, $number:Int!, $after:String) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100, after:$after) { nodes { isResolved } pageInfo { hasNextPage endCursor } }
    }
  }
}`;

async function lireConversations({ api, depot, numero }) {
  const [owner, name] = depot.split("/");
  let after = null;
  let ouvertes = 0;
  const cursors = new Set();
  for (let page = 0; page < 100; page++) {
    const lu = await api("POST", "/graphql", { query: THREADS, variables: { owner, name, number: numero, after } });
    const threads = lu?.data?.repository?.pullRequest?.reviewThreads;
    if (lu?.errors?.length || !Array.isArray(threads?.nodes) || typeof threads?.pageInfo?.hasNextPage !== "boolean" || threads.nodes.some((n) => typeof n?.isResolved !== "boolean")) {
      throw new Error("conversations de revue illisibles");
    }
    ouvertes += threads.nodes.filter((n) => !n.isResolved).length;
    if (!threads.pageInfo.hasNextPage) return { ouvertes, erreur: null };
    after = threads.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("pagination des conversations incomplète");
    cursors.add(after);
  }
  throw new Error("trop de conversations pour valider la fusion");
}

module.exports = { SHA, PREUVE, pages, derniereCI, lireCI, lireConversations };
