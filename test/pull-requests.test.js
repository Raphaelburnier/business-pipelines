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
const CORPS = "## Pourquoi\n\nLe marketing n'était pas lançable depuis le cockpit. Le run a échoué.\n\n## Ce qui change\n\n- rien";

// Une fausse API GitHub : une PR ouverte (CI verte, touche le compose) et une fusionnée.
function faussesAPI({ ci = "success", mergeable = true, tete = SHA } = {}) {
  const appels = [];
  const api = async (methode, chemin, corps) => {
    appels.push({ methode, chemin, corps });
    if (chemin === `/repos/${DEPOT}`) return { default_branch: "main" };
    if (chemin.startsWith(`/repos/${DEPOT}/pulls?state=open`)) {
      return [{ number: 60, title: "feat: marketing", html_url: "u", user: { login: "r" }, head: { ref: "claude/m", sha: tete }, base: { ref: "main" }, draft: false, body: CORPS, created_at: "2026-10-05T12:00:00Z" }];
    }
    if (chemin === `/repos/${DEPOT}/pulls/60`) return { mergeable, mergeable_state: mergeable ? "clean" : "dirty" };
    if (chemin.startsWith(`/repos/${DEPOT}/actions/runs?head_sha=${tete}`)) {
      // La plus récente d'abord, puis une exécution plus ancienne du même workflow, en échec :
      // seule la plus récente doit compter.
      return {
        workflow_runs: [
          { workflow_id: 1, name: "CI", status: ci === "pending" ? "in_progress" : "completed", conclusion: ci === "pending" ? null : ci },
          { workflow_id: 1, name: "CI", status: "completed", conclusion: "failure" },
        ],
      };
    }
    if (chemin.startsWith(`/repos/${DEPOT}/pulls/60/files`)) return [{ filename: "docker-compose.yaml" }, { filename: "src/stage-handlers.js" }];
    if (chemin.startsWith(`/repos/${DEPOT}/pulls?state=closed`)) {
      return [
        { number: 59, title: "feat: run approvals", html_url: "u59", merged_at: "2026-10-05T11:00:00Z", merge_commit_sha: "a".repeat(40), head: { sha: "b".repeat(40) }, body: "## Pourquoi\n\nTrancher depuis Décisions." },
        { number: 58, title: "fermée sans fusion", html_url: "u58", merged_at: null, head: { sha: "c".repeat(40) }, body: "" },
      ];
    }
    if (methode === "PUT" && chemin === `/repos/${DEPOT}/pulls/60/merge`) return { merged: true, sha: "f".repeat(40), message: "Pull Request successfully merged" };
    throw new Error(`appel inattendu : ${methode} ${chemin}`);
  };
  return { api, appels };
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
  const base = { brouillon: false, versDefaut: true, base: "main", fusionnable: true, etatFusion: "clean", ci: { etat: "verte" } };
  assert.strictEqual(pullRequests.raisonDeNePasFusionner(base), null);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, ci: { etat: "rouge" } }), /CI rouge/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, ci: { etat: "en_cours" } }), /en cours/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, ci: { etat: "absente" } }), /aucune CI/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, fusionnable: false, etatFusion: "dirty" }), /conflit/);
  assert.match(pullRequests.raisonDeNePasFusionner({ ...base, brouillon: true }), /brouillon/);
});

test("la fusion relit la PR sur GitHub et refuse une tête qui a bougé", async () => {
  const { api, appels } = faussesAPI();
  await assert.rejects(() => pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: "1".repeat(40) } }), /a bougé/);
  assert.ok(!appels.some((a) => a.methode === "PUT"), "aucune fusion tentée");
  const fusion = await pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: SHA } });
  assert.strictEqual(fusion.fusionnee, true);
  const put = appels.find((a) => a.methode === "PUT");
  assert.deepStrictEqual(put.corps, { sha: SHA, merge_method: "squash" });
});

test("la fusion refuse une CI qui n'est plus verte au moment de fusionner", async () => {
  const { api, appels } = faussesAPI({ ci: "failure" });
  await assert.rejects(() => pullRequests.fusionner({ api, demande: { depot: DEPOT, numero: 60, sha: SHA } }), /CI rouge/);
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
  const commande = apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA, par: "usurpateur" } });
  assert.strictEqual(commande.kind, "github.merge");
  assert.strictEqual(commande.par, RAPHAEL.par);
  assert.deepStrictEqual(commande.payload, { depot: DEPOT, numero: 60, sha: SHA });
  const vue = apiPullRequests.etat({ ...b, qui: RAPHAEL });
  assert.strictEqual(vue.depots[0].ouvertes[0].fusionEnCours, true);
  assert.throws(() => apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA } }), /déjà demandée/);
});

test("pas de fusion pour une identité non autorisée, un relevé périmé ou une tête différente", async () => {
  const { api } = faussesAPI();
  const releve = await pullRequests.relever({ api, depots: [DEPOT] });
  const b = bac({ releve });
  assert.throws(() => apiPullRequests.demander({ ...b, qui: { par: "inconnu@example.com", canal: "tailnet" }, demande: { depot: DEPOT, numero: 60, sha: SHA } }), (e) => e.code === 403);
  assert.throws(() => apiPullRequests.demander({ ...b, qui: { ...RAPHAEL, canal: "local" }, demande: { depot: DEPOT, numero: 60, sha: SHA } }), (e) => e.code === 403);
  assert.throws(() => apiPullRequests.demander({ ...b, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: "1".repeat(40) } }), (e) => e.code === 409);
  const vieux = bac({ releve: { ...releve, releveLe: "2026-01-01T00:00:00Z" } });
  assert.throws(() => apiPullRequests.demander({ ...vieux, qui: RAPHAEL, demande: { depot: DEPOT, numero: 60, sha: SHA } }), (e) => e.code === 503);
});

test("les dépôts surveillés : la liste explicite, sinon système et projets", () => {
  assert.deepStrictEqual(pullRequests.depotsSurveilles({ texte: "a/b, c/d, pas-un-depot" }), ["a/b", "c/d"]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projets-"));
  fs.mkdirSync(path.join(dir, "steam"));
  fs.writeFileSync(path.join(dir, "steam", "project.json"), JSON.stringify({ github: "Raphaelburnier/steam_tierList" }));
  assert.deepStrictEqual(pullRequests.depotsSurveilles({ miroirs: [{ github: DEPOT }], projetsDir: dir }), [DEPOT, "Raphaelburnier/steam_tierList"]);
});
