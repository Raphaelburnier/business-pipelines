// Le suivi d'une livraison jusqu'au résultat GitHub (plan des runs autonomes, chantier 5).
//
// Un run « succeeded » a fini de s'exécuter : sa branche `agent/…` est livrée sur le dépôt
// du NAS. Ses changements ne sont fusionnés que lorsque GitHub le dit. Le moteur garde une
// ligne par livraison dans l'event store (run → commande → branche → SHA livré) ; le publieur
// la complète à chaque passage avec la PR, la tête et la base, la CI, la correction après CI
// rouge et le SHA de fusion.
//
// Tout est relu sur GitHub, rien n'est supposé : après un redémarrage, le publieur repart des
// livraisons non finies de l'event store et retrouve leur état réel. Les métadonnées seules
// passent, le code d'une PR n'est jamais récupéré.
const { revues } = require("agent-orchestrator");
const { SHA, pages } = require("./github-merge-gates");
const pullRequests = require("./pull-requests");

// Les marqueurs du workflow ci-autofix (.github/workflows/ci-autofix.yml).
const MARQUE_TRANSMISE = /ci-autofix:([0-9a-f]{40})/;
const MARQUE_CORRECTION = /\[ci-autofix\]/;
const MARQUE_ESCALADE = /La CI échoue encore après la correction automatique/;
const MARQUE_ARRET = /<!-- ci-autofix-(?:arret|echec):([0-9a-f]{40}):[1-9][0-9]{0,3} -->/;
const MARQUE_ECHEC = /<!-- ci-autofix-echec:([0-9a-f]{40}):[1-9][0-9]{0,3} -->/;

const court = (sha) => String(sha || "").slice(0, 7);

/**
 * Où en est la correction automatique d'une PR, d'après ses commentaires et ses commits.
 * @param {{ commentaires: any[], commits: any[], tete: string }} lu
 * @returns {{ etat: "transmise"|"poussee"|"escaladee", echecSha: string|null, correctionSha: string|null, url: string|null }|null}
 */
function correctionDe({ commentaires, commits, tete }) {
  const transmises = commentaires.filter((c) => MARQUE_TRANSMISE.test(String(c.body || "")));
  const escalades = commentaires.filter((c) => MARQUE_ESCALADE.test(String(c.body || "")) || MARQUE_ECHEC.test(String(c.body || "")));
  const corrections = commits.filter((c) => MARQUE_CORRECTION.test(String(c.commit?.message || "")));
  if (!transmises.length && !escalades.length && !corrections.length) return null;
  const derniere = transmises.at(-1);
  const echecSha = derniere ? MARQUE_TRANSMISE.exec(String(derniere.body))[1] : null;
  const correction = corrections.at(-1);
  const correctionSha = correction && SHA.test(correction.sha) ? correction.sha : null;
  // Un correcteur peut échouer avant le premier commit (quota, patch vide ou refusé).
  // Un nouveau départ explicite sur la même tête remplace l'ancien arrêt.
  const escalade = escalades.at(-1);
  const arretSha = escalade && (MARQUE_ARRET.exec(String(escalade.body || ""))?.[1] || correctionSha);
  if (escalade && arretSha === tete && (!derniere || commentaires.indexOf(escalade) > commentaires.indexOf(derniere))) {
    return { etat: "escaladee", echecSha: echecSha || arretSha, correctionSha, url: escalade.html_url || null };
  }
  // Une correction poussée après le dernier échec transmis.
  if (correctionSha && (!echecSha || commits.findIndex((c) => c.sha === correctionSha) > commits.findIndex((c) => c.sha === echecSha))) {
    return { etat: "poussee", echecSha, correctionSha, url: correction.html_url || null };
  }
  if (derniere) return { etat: "transmise", echecSha, correctionSha: null, url: derniere.html_url || null };
  return null;
}

/**
 * L'état de livraison d'une PR relevée. Pur : se teste sans GitHub.
 * @param {{ pr: any, detail: any|null, correction: any, depot: string, preuves?: any }} lu
 *   `pr` est la PR brute de GitHub, `detail` le relevé de `releverPR` (null si la PR est fermée),
 *   `preuves` ce que `raisonPreuvesFusion` du moteur dit de la tête (null : rien n'y fait obstacle).
 *   `fusionAuto` n'est vrai que pour une PR prête, non sensible, aux preuves valides.
 */
function etatLivraison({ pr, detail, correction, depot, preuves = null }) {
  const commun = { pr: pr.number, prUrl: pr.html_url || null, headSha: SHA.test(pr.head?.sha) ? pr.head.sha : null, correction };
  if (pr.merged_at || pr.merged) {
    if (!SHA.test(pr.merge_commit_sha)) return { ...commun, statut: "pr_open", raison: "GitHub n'a pas encore rendu le commit de fusion" };
    return { ...commun, statut: "merged", raison: null, mergeSha: pr.merge_commit_sha };
  }
  if (pr.state === "closed") return { ...commun, statut: "failed", raison: "PR fermée sans fusion", finale: true };
  const ci = detail.ci || {};
  const champsCI = { baseSha: SHA.test(detail.baseSha) ? detail.baseSha : null, ci: ci.etat || null, ciUrl: ci.url || null };
  const sur = `sur ${court(detail.sha)}`;
  if (ci.etat === "en_cours") return { ...commun, ...champsCI, statut: "ci_running", raison: `CI en cours ${sur}` };
  if (ci.etat === "absente") {
    // Une CI introuvable n'est pas une CI illisible : la seconde bloque la fusion.
    if (ci.raison && ci.raison !== "aucune CI sur ce commit") return { ...commun, ...champsCI, statut: "merge_blocked", raison: ci.raison };
    return { ...commun, ...champsCI, statut: "pr_open", raison: `CI pas encore lancée ${sur}` };
  }
  if (ci.etat === "rouge") {
    if (correction && correction.etat === "escaladee") {
      return { ...commun, ...champsCI, statut: "failed", raison: `Correction automatique arrêtée ${sur} : reprise à la main` };
    }
    const suite =
      correction && correction.etat === "transmise" && correction.echecSha === detail.sha
        ? " : correction automatique transmise à l'agent"
        : correction && correction.etat === "poussee"
          ? " : la correction automatique n'a pas suffi"
          : "";
    if (!(preuves && preuves.reverifier)) return { ...commun, ...champsCI, statut: "merge_blocked", raison: `CI rouge ${sur}${suite}` };
  }
  // Tête corrigée hors du run : tests et revues repassent avant toute fusion, CI ou non.
  if (preuves && !preuves.expliciteAutorise) return { ...commun, ...champsCI, statut: "merge_blocked", raison: preuves.raison };
  // CI verte : la même règle que la fusion décide, y compris une CI périmée par une base avancée.
  const blocage = pullRequests.raisonDeNePasFusionner(detail);
  if (blocage) return { ...commun, ...champsCI, statut: "merge_blocked", raison: blocage };
  if (detail.sensibles && detail.sensibles.length) {
    return { ...commun, ...champsCI, statut: "merge_blocked", raison: `fichiers sensibles (${detail.sensibles.slice(0, 3).join(", ")}) : fusion explicite depuis le cockpit` };
  }
  if (preuves) return { ...commun, ...champsCI, statut: "merge_blocked", raison: preuves.raison };
  return { ...commun, ...champsCI, statut: "pr_open", raison: `prête à fusionner : CI verte sur le merge ${court(ci.preuve?.mergeSha)}, tests et revues sur cet arbre (${depot})`, fusionAuto: true };
}

/** La PR d'une branche, ouverte ou non : la plus récente si la branche en a eu plusieurs. */
async function prDeBranche({ api, depot, branche }) {
  const proprietaire = depot.split("/")[0];
  const prs = await api("GET", `/repos/${depot}/pulls?state=all&head=${encodeURIComponent(`${proprietaire}:${branche}`)}&sort=created&direction=desc&per_page=10`);
  return Array.isArray(prs) && prs[0] ? prs[0] : null;
}

/**
 * L'arbre Git d'un commit de GitHub, ou null s'il est illisible.
 * @param {{ api: Function, depot: string, sha: string }} opts
 */
async function arbreDe({ api, depot, sha }) {
  if (!SHA.test(String(sha))) return null;
  try {
    const commit = await api("GET", `/repos/${depot}/git/commits/${sha}`);
    return commit && commit.sha === sha && SHA.test(commit.tree?.sha) ? commit.tree.sha : null;
  } catch {
    return null;
  }
}

/**
 * Les preuves d'une livraison face à une tête de PR : la règle du moteur, avec l'arbre lu sur
 * GitHub. Une livraison sans attestation n'a pas besoin de lire l'arbre.
 * @param {{ api: Function, depot: string, livraison: any, sha: string }} opts
 */
async function preuvesDe({ api, depot, livraison, sha }) {
  const arbre = livraison && livraison.attestation ? await arbreDe({ api, depot, sha }) : null;
  return revues.raisonPreuvesFusion(livraison, arbre);
}

/**
 * Relève une livraison sur GitHub et met à jour l'event store. Rejouable : un état identique
 * n'émet rien.
 * `reverifier` est appelé quand la tête de la PR n'est plus l'arbre testé et revu ; `fusionnerAuto`
 * quand la PR est prête et que ses preuves couvrent sa tête. Les deux sont optionnels.
 * @param {{ api: Function, store: any, livraison: any, depot: string,
 *   reverifier?: (a: { livraison: any, headSha: string }) => Promise<void>,
 *   fusionnerAuto?: (a: { livraison: any, detail: any, depot: string }) => Promise<void> }} opts
 * @returns {Promise<any>} la livraison à jour
 */
async function suivreLivraison({ api, store, livraison, depot, reverifier = null, fusionnerAuto = null }) {
  let pr = livraison.pr ? await api("GET", `/repos/${depot}/pulls/${livraison.pr}`) : await prDeBranche({ api, depot, branche: livraison.branche });
  if (!pr) {
    // Pas encore de PR : le publieur l'ouvrira. Un échec de push garde sa raison.
    return store.majLivraison(livraison.runId, { repo: depot }).livraison;
  }
  if (!livraison.pr) pr = await api("GET", `/repos/${depot}/pulls/${pr.number}`);
  const ouverte = pr.state === "open";
  const infos = ouverte ? await api("GET", `/repos/${depot}`) : null;
  const detail = ouverte ? await pullRequests.releverPR({ api, depot, numero: pr.number, parDefaut: infos.default_branch }) : null;
  let correction = livraison.correction || null;
  try {
    const commentaires = await pages({ api, chemin: `/repos/${depot}/issues/${pr.number}/comments`, limite: 1000 });
    const commits = await pages({ api, chemin: `/repos/${depot}/pulls/${pr.number}/commits`, limite: 250 });
    correction = correctionDe({ commentaires, commits, tete: pr.head?.sha });
  } catch {
    // Les marqueurs illisibles ne cachent pas l'état de la PR : la dernière lecture reste.
  }
  const preuves = ouverte ? await preuvesDe({ api, depot, livraison, sha: pr.head?.sha }) : null;
  const { fusionAuto, ...etat } = etatLivraison({ pr, detail, correction, depot, preuves });
  const apres = store.majLivraison(livraison.runId, { repo: depot, ...etat }).livraison;
  if (preuves && preuves.reverifier && reverifier && SHA.test(pr.head?.sha)) await reverifier({ livraison: apres, headSha: pr.head.sha });
  if (fusionAuto && fusionnerAuto) await fusionnerAuto({ livraison: apres, detail, depot });
  return apres;
}

/**
 * Le passage de suivi du publieur : reprend les livraisons d'avant ce suivi, puis relève
 * toutes celles qui ne sont pas finies. Une livraison en échec de lecture n'arrête pas les autres.
 * @param {{ api: Function, store: any, projets: Array<{ id: string, github: string }>, journal?: (l: string) => void }} opts
 */
async function suivreLivraisons({ api, store, projets, journal = () => {}, reverifier = null, fusionnerAuto = null }) {
  store.reprendreLivraisonsAnciennes();
  const depotDe = new Map(projets.map((p) => [p.id, p.github]));
  const suivies = [];
  for (const livraison of store.livraisons({ enCours: true })) {
    const depot = livraison.repo || depotDe.get(livraison.projectId);
    if (!depot) continue;
    try {
      const apres = await suivreLivraison({ api, store, livraison, depot, reverifier, fusionnerAuto });
      if (apres.statut !== livraison.statut || apres.raison !== livraison.raison) {
        journal(`livraison ${livraison.runId.slice(0, 8)} (${depot}${apres.pr ? `#${apres.pr}` : ""}) : ${apres.statut}${apres.raison ? `, ${apres.raison}` : ""}`);
      }
      suivies.push(apres);
    } catch (err) {
      journal(`livraison ${livraison.runId.slice(0, 8)} : relevé GitHub impossible, ${String(err.message).split("\n")[0]}`);
    }
  }
  return suivies;
}

/**
 * La livraison d'une branche publiée, créée si le run l'a livrée avant ce suivi. Le run est
 * lu dans le nom de la branche ou les messages de commit du moteur.
 * @param {{ store: any, projet: { id: string, github: string }, branche: string, sha: string, runId: string|null }} opts
 */
function livraisonDeBranche({ store, projet, branche, sha, runId }) {
  const connue = store.livraisonParBranche(projet.id, branche);
  if (connue) return connue;
  if (!runId || !store.run(runId)) return null;
  return store.ouvrirLivraison({ runId, branche, sha, repo: projet.github });
}

/**
 * La vue d'une livraison pour l'API du cockpit (schéma `livraison` du moteur).
 * @param {any} l
 */
function vueLivraison(l) {
  if (!l) return null;
  return {
    statut: l.statut,
    raison: l.raison,
    branche: l.branche,
    deliverySha: l.deliverySha,
    depot: l.repo,
    pr: l.pr,
    prUrl: l.prUrl,
    headSha: l.headSha,
    baseSha: l.baseSha,
    ci: l.ci,
    ciUrl: l.ciUrl,
    correction: l.correction,
    mergeSha: l.mergeSha,
    attestation: l.attestation
      ? {
          arbre: l.attestation.treeSha,
          tests: Boolean(l.attestation.tests),
          revueRequise: Boolean(l.attestation.reviewRequired),
          revues: (l.attestation.reviews || []).map((r) => ({ noeud: r.node, agent: r.agentRef, llm: { via: r.via, model: r.model }, session: r.sessionId, verdict: r.verdict })),
        }
      : null,
    finale: Boolean(l.finishedAt),
    majLe: l.majLe,
    relueLe: l.relueLe,
  };
}

module.exports = { correctionDe, etatLivraison, prDeBranche, suivreLivraison, suivreLivraisons, livraisonDeBranche, vueLivraison, arbreDe, preuvesDe };
