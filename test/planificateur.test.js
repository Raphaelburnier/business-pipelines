// Le planificateur de missions sur les vrais pipelines improve-app@7 et marketing@1 du
// registre (copies figées dans test/fixtures/registre-planificateur) : sélection, refus,
// persistance du plan dans le contrat et passage au moteur.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REGISTRE_SOURCE = path.join(__dirname, "fixtures", "registre-planificateur");
const { EventStore } = require("agent-orchestrator");
const contrat = require("agent-orchestrator/src/mission");
const planificateur = require("../src/planificateur");
const plansMissions = require("../src/api-plans-missions");
const api = require("../src/api-lecture");

const claudeSonnet = { via: "claude", model: "sonnet" };
const claudeOpus = { via: "claude", model: "opus" };
const codex = { via: "codex", model: "gpt-5.6-terra:medium" };

const ROSTER = [
  { id: "margaux", nom: "Margaux", role: "Cheffe de projet", famille: "claude", llm: claudeOpus, registre: ["improvement-planner", "plan-synthesist"], budgetMensuelUsd: 60 },
  { id: "sacha", nom: "Sacha", role: "Édition de code", famille: "codex", llm: codex, registre: ["improvement-editor"], budgetMensuelUsd: null },
  { id: "theo", nom: "Théo", role: "Relecteur", famille: "claude", llm: claudeSonnet, registre: ["code-reviewer"], budgetMensuelUsd: 30 },
  { id: "ines", nom: "Inès", role: "Relectrice Codex", famille: "codex", llm: codex, registre: ["code-reviewer"], budgetMensuelUsd: null },
  { id: "camille", nom: "Camille", role: "Marque", famille: "claude", llm: claudeSonnet, registre: ["brand-analyst"], budgetMensuelUsd: 40 },
  { id: "elise", nom: "Élise", role: "Économie", famille: "codex", llm: codex, registre: ["economy-analyst"], budgetMensuelUsd: null },
];

function fixture({ securite = false, roster = ROSTER, financeDisponible } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "planificateur-"));
  const reg = path.join(dir, "registre");
  fs.cpSync(REGISTRE_SOURCE, reg, { recursive: true });
  const projets = path.join(dir, "projects");
  const ecrire = (id, fiche, fichiers = {}) => {
    fs.mkdirSync(path.join(projets, id), { recursive: true });
    fs.writeFileSync(path.join(projets, id, "project.json"), JSON.stringify(fiche, null, 2));
    for (const [nom, contenu] of Object.entries(fichiers)) fs.writeFileSync(path.join(projets, id, nom), JSON.stringify(contenu));
  };
  ecrire("app", { id: "app", name: "Application", business: "outils-perso", homeMachine: "nas", repo: "/git/app.git", publier: true, github: "Raphaelburnier/app",
    verification: { checks: [{ kind: "test", command: "npm", args: ["test"], timeoutMs: 60000 }] },
    pipelines: [{ extends: "improve-app@7", overrides: { nodes: securite ? { "review-security": { enabled: true } } : {} }, budget: { usdPerRun: 4, usdPerMonth: 15 } }] });
  ecrire("marketing", { id: "marketing", name: "Plan marketing", business: "marketing", homeMachine: "pc", repo: "/git/marketing.git",
    pipelines: [{ extends: "marketing@1", spec: "spec.json", overrides: { nodes: { consigne: { runsOn: "nas" }, couverture: { runsOn: "nas" } } }, budget: { usdPerRun: 2, usdPerMonth: 20 } }] },
  { "spec.json": { offre: "Cartes triées", marche: "Collectionneurs", questions: ["Quel prix ?"], contraintes: [] } });
  ecrire("vide", { id: "vide", name: "Sans pipeline", business: "x", homeMachine: "nas", repo: "/git/vide.git", pipelines: [{ extends: "marketing-dialogue@1" }] });
  ecrire("finance", JSON.parse(fs.readFileSync(path.join(__dirname, "..", "projects", "finance", "project.json"))), {
    "spec.json": JSON.parse(fs.readFileSync(path.join(__dirname, "..", "projects", "finance", "spec.json"))),
  });
  process.env.ORCH_REGISTRE = reg;
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const params = { projetsDir: projets, roster, affectations: {}, financeDisponible };
  return { dir, reg, projets, store, params, fermer: () => { store.fermer(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const spec = (surcharges = {}) => ({ projectId: "app", objectif: "Ajouter un tri par note", criteres: ["La liste se trie par note", "Les tests existants restent verts"], ...surcharges });
const etatLibre = (surcharges = {}) => surcharges;
const qui = { par: "raphael@test", canal: "tailnet" };
const specFinance = (surcharges = {}) => spec({ projectId: "finance", objectif: "Observer l'économie et les cours disponibles", criteres: ["Le rapport conserve les dates et les sources"], ...surcharges });

test("Finance reconnue sans capacité installée : blocages détaillés, aucune commande", () => {
  const f = fixture();
  try {
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "finance" }).options.nature, "finance");
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "finance" }).options.blocages.length, 3);
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "bloque");
    assert.equal(p.plan, null);
    assert.deepEqual(p.blocages.map((b) => [b.code, b.noeud]), [["capacite-absente", "collecte"], ["capacite-absente", "validation"], ["capacite-absente", "publication"]]);
    assert.ok(p.blocages.every((b) => b.pipeline === "finance-research@1"));
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { spec: specFinance(), empreinte: "0".repeat(64), requestId: crypto.randomUUID() }, etat: {} }), /Plan non lançable/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);
  } finally { f.fermer(); }
});

test("Finance : capacité serveur complète, proposition et mise en file du rapport figé, sans exécution", () => {
  const appels = [];
  const f = fixture({ roster: [...ROSTER, { id: "analyste-finance", nom: "Analyste Finance (test)", role: "Analyse financière", famille: "claude", llm: claudeSonnet, registre: ["financial-research-analyst"], budgetMensuelUsd: 20 }], financeDisponible: (handler, machine) => { appels.push([handler, machine]); return true; } });
  try {
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "lancable", JSON.stringify(p.blocages));
    assert.equal(p.plan.nature, "finance");
    assert.deepEqual(p.plan.etapes.map((e) => [e.noeud, e.role]), [["collecte", "collecte"], ["analyse", "analyse"], ["validation", "validation"], ["publication", "publication"]]);
    assert.deepEqual(p.plan.criteres[0], { texte: specFinance().criteres[0], realisePar: ["analyse"], jugePar: ["validation"] });
    assert.equal(p.plan.resultat.type, "rapport");
    assert.equal(p.plan.resultat.depot, null);
    assert.deepEqual(p.plan.limites.corrections, [{ cycle: "correction", noeuds: ["analyse", "validation"], maxLoops: 1 }]);
    assert.deepEqual([...new Set(appels.map((a) => JSON.stringify(a)))].map(JSON.parse), [["finance-snapshot", "nas"], ["finance-report-validate", "nas"], ["finance-report-publish", "nas"]]);
    const corps = { spec: specFinance(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} });
    assert.deepEqual(contrat.valider(c.payload.mission).plan, p.plan);
    assert.equal(planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }).id, c.id);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 1);
    assert.equal(f.store.runs().length, 0, "la recette valide la file, pas une analyse native");
    f.params.financeDisponible = () => false;
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, requestId: crypto.randomUUID() }, etat: {} }), /Plan non lançable/);
  } finally { f.fermer(); }
});

test("Finance : capacité partielle ou non booléenne refusée, formulaire manuel également bloqué", () => {
  const f = fixture({ financeDisponible: (handler) => handler === "finance-snapshot" });
  try {
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.deepEqual(p.blocages.map((b) => b.noeud), ["validation", "publication"]);
    f.params.financeDisponible = () => "oui";
    assert.equal(planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} }).blocages.length, 3);
    const options = require("../src/missions").lire({ ...f.params, projectId: "finance" }).options;
    const demande = { projectId: "finance", pipelineIndex: 0, requestId: crypto.randomUUID(), configuration: options.configuration,
      demande: { objectif: specFinance().objectif, criteres: specFinance().criteres, spec: options.spec,
        agents: options.roles.map((r) => ({ noeud: r.noeud, membre: null, llm: r.llm })) } };
    assert.throws(() => require("../src/missions").demander({ store: f.store, qui, params: f.params, demande }), /étape Finance collecte.*pas installée/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);
  } finally { f.fermer(); }
});

test("Finance : publication GitHub interdite et nature développement refusée", () => {
  const f = fixture({ financeDisponible: () => true });
  try {
    const autre = planificateur.proposer({ spec: specFinance({ nature: "developpement" }), params: f.params, etat: {} });
    assert.equal(autre.blocages[0].code, "aucun-pipeline");
    const fiche = path.join(f.projets, "finance", "project.json");
    fs.writeFileSync(fiche, JSON.stringify({ ...JSON.parse(fs.readFileSync(fiche)), publier: true, github: "Raphaelburnier/finance" }));
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "bloque");
    assert.equal(p.blocages[0].code, "decision-requise");
  } finally { f.fermer(); }
});

test("spec de développement : développeur, tests du projet et reviewer indépendant choisis dans l'équipe", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "lancable");
    assert.equal(p.plan.pipeline.ref, "improve-app@7");
    const parNoeud = Object.fromEntries(p.plan.etapes.map((e) => [e.noeud, e]));
    assert.deepEqual(p.plan.etapes.map((e) => [e.noeud, e.role]), [["plan", "planification"], ["implement", "developpement"], ["verify", "verification"], ["review", "revue"]]);
    assert.equal(parNoeud.implement.membre, "sacha");
    assert.deepEqual(parNoeud.implement.llm, codex);
    // Deux relecteurs incarnent code-reviewer : celui dont le runtime diffère du développement gagne.
    assert.equal(parNoeud.review.membre, "theo");
    assert.ok(parNoeud.review.raisons.some((r) => /distinct de celui du développement/.test(r)));
    assert.deepEqual(p.plan.independance, [{ revue: "review", auteurs: ["implement"], membreDistinct: true, runtimeDistinct: true, sessionNeuve: true }]);
    assert.deepEqual(p.plan.criteres[0], { texte: "La liste se trie par note", realisePar: ["implement"], jugePar: ["verify", "review"] });
    assert.equal(p.plan.resultat.type, "pull-request");
    assert.equal(p.plan.limites.usdPerRun, 4);
    assert.deepEqual(p.plan.limites.corrections, [{ cycle: "correction", noeuds: ["implement", "verify", "review", "review-security"], maxLoops: 2 }]);
    assert.ok(!p.plan.etapes.some((e) => e.noeud === "review-security"), "une revue optionnelle désactivée n'est pas au plan");
  } finally { f.fermer(); }
});

test("spec marketing : rôles marketing seulement, sans étape de développement", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec({ projectId: "marketing", objectif: "Positionner l'offre", criteres: ["Chaque question a une réponse sourcée"] }), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "lancable");
    assert.equal(p.plan.nature, "marketing");
    assert.deepEqual(p.plan.etapes.map((e) => e.role), ["controle", "analyse", "analyse", "synthese", "controle", "decision"]);
    assert.ok(!p.plan.etapes.some((e) => ["developpement", "verification", "revue"].includes(e.role)));
    assert.deepEqual(p.plan.criteres[0].realisePar, ["synthese"]);
    assert.deepEqual(p.plan.criteres[0].jugePar, ["couverture", "approbation"], "consigne prépare, elle ne juge pas");
    assert.equal(p.plan.resultat.type, "approbation");
    assert.ok(p.plan.avertissements.some((a) => /repris de la spec du projet/.test(a)));
  } finally { f.fermer(); }
});

test("une spec marketing sur un projet de développement est bloquée, sans imposer de développement", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec({ nature: "marketing" }), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "bloque");
    assert.equal(p.plan, null);
    assert.equal(p.blocages[0].code, "aucun-pipeline");
    assert.match(p.blocages[0].arbitrage, /marketing@1/);
  } finally { f.fermer(); }
});

test("projet inconnu ou sans pipeline lançable : blocage expliqué", () => {
  const f = fixture();
  try {
    assert.equal(planificateur.proposer({ spec: spec({ projectId: "absent" }), params: f.params, etat: {} }).blocages[0].code, "projet-inconnu");
    const vide = planificateur.proposer({ spec: spec({ projectId: "vide" }), params: f.params, etat: {} });
    assert.equal(vide.blocages[0].code, "nature-indeterminee");
  } finally { f.fermer(); }
});

test("quota Codex atteint : un autre runtime est choisi s'il existe, sinon blocage avec la raison", () => {
  const f = fixture();
  try {
    const etat = etatLibre({ runtimesBloques: { codex: "quota codex atteint jusqu'à 2026-10-12T18:00:00.000Z (run 1234abcd)" } });
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat });
    assert.equal(p.statut, "bloque");
    const b = p.blocages.find((x) => x.noeud === "implement");
    assert.equal(b.code, "aucun-agent");
    assert.match(b.message, /Sacha .*quota codex atteint/);
    assert.match(b.arbitrage, /quota/);
  } finally { f.fermer(); }
});

test("worker PC hors ligne : les nœuds distants sont refusés, sans réveil", () => {
  const f = fixture();
  try {
    const etat = plansMissions.etatPlanification({ store: f.store, machines: [{ machine: "pc", etat: "sleeping", meta: null }],
      viaParMachine: { nas: ["claude"], pc: ["claude", "codex"] }, roster: f.params.roster, affectations: {} });
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat });
    assert.equal(p.statut, "bloque");
    assert.ok(p.blocages.some((b) => b.code === "machine-indisponible" && b.noeud === "verify"));
    assert.ok(p.blocages.some((b) => b.code === "aucun-agent" && /worker pc indisponible|pc en veille/.test(b.message)));
  } finally { f.fermer(); }
});

test("aucun relecteur dans l'équipe : plan dégradé explicitement, lancement seulement après confirmation", () => {
  const f = fixture({ roster: ROSTER.filter((m) => !m.registre.includes("code-reviewer")) });
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    assert.equal(p.statut, "degrade");
    const review = p.plan.etapes.find((e) => e.noeud === "review");
    assert.equal(review.membre, null);
    assert.ok(p.plan.avertissements.some((a) => /aucun membre de l'équipe n'incarne code-reviewer/.test(a)));
    const corps = { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }), planificateur.RefusPlan);
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, accepterDegrade: true }, etat: {} });
    assert.equal(c.payload.mission.plan.degrade, true);
  } finally { f.fermer(); }
});

test("le relecteur n'est jamais l'auteur : un membre qui incarne les deux est écarté de la revue", () => {
  const polyvalent = { id: "max", nom: "Max", role: "Tout", famille: "claude", llm: claudeSonnet, registre: ["improvement-editor", "code-reviewer"], budgetMensuelUsd: null };
  const f = fixture({ roster: [polyvalent, ROSTER[0]] });
  try {
    f.params.affectations = { max: { projet: "app", depuis: "2026-10-01T00:00:00.000Z" } };
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const parNoeud = Object.fromEntries(p.plan.etapes.map((e) => [e.noeud, e]));
    assert.equal(parNoeud.implement.membre, "max");
    assert.equal(parNoeud.review.membre, null);
    assert.ok(parNoeud.review.raisons.some((r) => /Max .*déjà auteur/.test(r)));
    assert.equal(p.statut, "degrade");
  } finally { f.fermer(); }
});

test("membre affecté à un autre projet, budget épuisé ou runtime exclu : écartés avec leur raison", () => {
  const f = fixture();
  try {
    f.params.affectations = { theo: { projet: "autre", depuis: "2026-10-01T00:00:00.000Z" } };
    const p = planificateur.proposer({ spec: spec({ runtimesExclus: ["codex"] }), params: f.params, etat: { depensesMembres: { margaux: 60 } } });
    assert.equal(p.statut, "bloque");
    const message = p.blocages.map((b) => b.message).join("\n");
    assert.match(message, /Sacha .*runtime codex exclu par la spec/);
    const proposePlan = planificateur.proposer({ spec: spec(), params: f.params, etat: { depensesMembres: { margaux: 60 } } });
    const plan = Object.fromEntries(proposePlan.plan.etapes.map((e) => [e.noeud, e]));
    assert.notEqual(plan.plan.membre, "margaux");
    assert.ok(plan.plan.raisons.some((r) => /Margaux .*budget mensuel épuisé/.test(r)));
    assert.equal(plan.review.membre, "ines", "Théo est affecté ailleurs");
    assert.ok(plan.review.raisons.some((r) => /Théo .*affecté au projet autre/.test(r)));
  } finally { f.fermer(); }
});

test("budget mensuel du projet atteint : blocage avant tout run", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: { depensesProjets: { app: 15.2 } } });
    assert.equal(p.blocages[0].code, "budget-epuise");
  } finally { f.fermer(); }
});

test("revue de sécurité exigée : décision demandée si la fiche ne l'active pas, plan complet sinon", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec({ exigences: ["revue-securite"] }), params: f.params, etat: {} });
    assert.equal(p.statut, "bloque");
    assert.equal(p.blocages[0].code, "decision-requise");
    assert.match(p.blocages[0].arbitrage, /overrides\.nodes\.review-security\.enabled/);
  } finally { f.fermer(); }
  const g = fixture({ securite: true, roster: [...ROSTER, { id: "yanis", nom: "Yanis", role: "Sécurité", famille: "claude", llm: claudeOpus, registre: ["security-reviewer"], budgetMensuelUsd: 30 }] });
  try {
    const p = planificateur.proposer({ spec: spec({ exigences: ["revue-securite"] }), params: g.params, etat: {} });
    assert.equal(p.statut, "lancable");
    assert.deepEqual(p.plan.criteres[0].jugePar, ["verify", "review", "review-security"]);
  } finally { g.fermer(); }
});

test("spec incomplète pour les tranches d'un agent : champs listés", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.projets, "marketing", "spec.json"), JSON.stringify({ offre: "x" }));
    const p = planificateur.proposer({ spec: spec({ projectId: "marketing" }), params: f.params, etat: {} });
    assert.equal(p.blocages[0].code, "spec-incomplete");
    assert.match(p.blocages[0].message, /marche, questions, contraintes/);
    const complete = planificateur.proposer({ spec: spec({ projectId: "marketing", contexte: { marche: "m", questions: ["q"], contraintes: [] } }), params: f.params, etat: {} });
    assert.equal(complete.statut, "lancable");
  } finally { f.fermer(); }
});

test("lancement : contrat figé avec le plan, accepté par le moteur, et reprise insensible aux changements", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const corps = { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} });
    const mission = c.payload.mission;
    assert.deepEqual(mission.plan, p.plan);
    assert.deepEqual(c.payload.llmOverrides, Object.fromEntries(p.plan.etapes.filter((e) => e.llm).map((e) => [e.noeud, e.llm])));
    assert.deepEqual(mission.participants.map((x) => [x.noeud, x.membre]), [["plan", "margaux"], ["implement", "sacha"], ["review", "theo"]]);

    // Même requête rejouée : même commande, pas de second run.
    assert.equal(planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }).id, c.id);
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, spec: spec({ objectif: "autre" }) }, etat: {} }), /déjà été utilisée/);

    // Le registre, l'équipe et la fiche changent après le lancement.
    const pipeline = path.join(f.reg, "pipelines", "improve-app", "v7", "pipeline.json");
    const brut = JSON.parse(fs.readFileSync(pipeline, "utf-8"));
    brut.budget.usdPerRun = 99;
    fs.writeFileSync(pipeline, JSON.stringify(brut));
    f.params.roster = ROSTER.filter((m) => m.id !== "theo");
    const fiche = path.join(f.projets, "app", "project.json");
    fs.writeFileSync(fiche, JSON.stringify({ ...JSON.parse(fs.readFileSync(fiche, "utf-8")), publier: false }));

    const resolution = contrat.resoudreLancement({ store: f.store, commandId: c.id, fichier: fiche, index: 0, lancement: c.payload.llmOverrides });
    assert.equal(resolution.budget.usdPerRun, 4);
    assert.equal(resolution.projet.publier, true);
    const relu = contrat.valider(f.store.commande(c.id).payload.mission);
    assert.deepEqual(relu.plan, p.plan);
    // Le plan d'aujourd'hui serait différent : relancer la même spec exige de relire le plan.
    assert.notEqual(planificateur.proposer({ spec: spec(), params: f.params, etat: {} }).empreinte, p.empreinte);
  } finally { f.fermer(); }
});

test("lancement refusé si le plan a changé depuis sa présentation ou s'il est bloqué", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const corps = { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: { runtimesBloques: { codex: "quota codex atteint" } } }), /Plan non lançable/);
    f.params.affectations = { ines: { projet: "app", depuis: "2026-10-01T00:00:00.000Z" } };
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }), /a changé depuis sa présentation/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);
  } finally { f.fermer(); }
});

test("un contrat dont le plan contredit la résolution est refusé par le moteur", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const plan = structuredClone(p.plan);
    plan.etapes.find((e) => e.noeud === "review").llm = codex;
    const lancement = { projectId: "app", pipelineIndex: 0, requestId: crypto.randomUUID(),
      configuration: require("../src/missions").lire({ ...f.params, projectId: "app" }).options.configuration,
      demande: { objectif: "x", criteres: spec().criteres, directives: "", exclusions: "", document: "", spec: {},
        agents: p.plan.etapes.filter((e) => e.llm).map((e) => ({ noeud: e.noeud, membre: e.membre, llm: e.llm })) } };
    assert.throws(() => require("../src/missions").demander({ store: f.store, qui, params: f.params, demande: lancement, plan }), /Plan de mission incohérent : modèle de review/);
  } finally { f.fermer(); }
});

test("le run rapporte chaque critère avec la dernière tentative des étapes qui le jugent", () => {
  const plan = { criteres: [{ texte: "Tri", realisePar: ["implement"], jugePar: ["verify", "review"] }] };
  const etape = (noeud, statut, outcome = null) => ({ noeud, statut, outcome });
  const r = (etapes) => planificateur.resultatCriteres(plan, etapes)[0].etat;
  assert.equal(r([]), "a-venir");
  assert.equal(r([etape("implement", "running")]), "en-cours");
  assert.equal(r([etape("implement", "succeeded"), etape("verify", "succeeded", "FAIL")]), "echec");
  // La correction rejoue les étapes : seule la dernière tentative compte.
  assert.equal(r([etape("implement", "succeeded"), etape("verify", "succeeded", "FAIL"), etape("implement", "succeeded"),
    etape("verify", "succeeded", "PASS"), etape("review", "succeeded", "PASS")]), "valide");
  assert.equal(planificateur.resultatCriteres({ criteres: [{ texte: "x", realisePar: ["a"], jugePar: [] }] }, [])[0].etat, "non-verifie");
});

test("le détail du run expose le plan figé et les critères reliés", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps: { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() }, etat: {} });
    const runId = f.store.creerRun({ pipelineRef: "improve-app@7", projectId: "app" });
    f.store.db.prepare("UPDATE commands SET run_id = ? WHERE id = ?").run(runId, c.id);
    const detail = api.run(f.store, runId);
    assert.equal(detail.mission.plan.pipeline.ref, "improve-app@7");
    assert.deepEqual(detail.criteres.map((x) => [x.texte, x.etat]), [["La liste se trie par note", "a-venir"], ["Les tests existants restent verts", "a-venir"]]);
  } finally { f.fermer(); }
});

test("runtimes bloqués lus dans les attentes des runs vivants", () => {
  const store = { runs: () => [{ id: "abcdef123456", status: "waiting_quota" }, { id: "x", status: "succeeded" }, { id: "fedcba654321", status: "waiting_auth" }],
    attentes: { vue: (id) => id === "abcdef123456" ? { statut: "waiting_quota", runtime: "codex", resetAt: "2026-10-12T18:00:00.000Z" } : { statut: "waiting_auth", runtime: "claude", resetAt: null } } };
  assert.deepEqual(plansMissions.runtimesBloques(store), {
    codex: "quota codex atteint jusqu'à 2026-10-12T18:00:00.000Z (run abcdef12)",
    claude: "connexion claude absente ou expirée (run fedcba65)",
  });
});

test("routes HTTP : origine contrôlée, plan proposé, plan changé refusé, lancement dédupliqué", async () => {
  const { spawn } = require("node:child_process");
  const http = require("node:http");
  const f = fixture();
  const port = 4689;
  f.store.majMachine({ id: "pc", state: "online", heartbeat: true, meta: { capacites: { backends: ["claude", "codex"], noeuds: ["agent", "script", "review"], missions: 1 } } });
  const roster = path.join(f.dir, "agents.json");
  fs.writeFileSync(roster, JSON.stringify({ agents: ROSTER }));
  const poster = (chemin, corps, entetes = {}) => new Promise((resoudre, rejeter) => {
    const brut = JSON.stringify(corps);
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: chemin,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(brut), ...entetes } }, (res) => {
      let r = ""; res.setEncoding("utf-8"); res.on("data", (d) => (r += d)); res.on("end", () => resoudre({ code: res.statusCode, corps: JSON.parse(r || "null") }));
    });
    req.on("error", rejeter); req.end(brut);
  });
  const enfant = spawn(process.execPath, [path.join(__dirname, "..", "bin", "cockpit.js")], { stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, COCKPIT_PORT: String(port), APPROVALS_DIR: path.join(f.dir, "approvals"), ORCH_EVENT_STORE: path.join(f.dir, "events.sqlite"),
      COCKPIT_OPERATEUR_LOCAL: "test", COCKPIT_PROJETS_DIR: f.projets, COCKPIT_EQUIPE_ROSTER: roster, ORCH_REGISTRE: f.reg } });
  try {
    await new Promise((resoudre, rejeter) => {
      const minuterie = setTimeout(() => rejeter(new Error("le cockpit n'a pas démarré")), 8000);
      enfant.stdout.on("data", (d) => { if (String(d).includes("Cockpit sur")) { clearTimeout(minuterie); resoudre(); } });
      enfant.on("exit", (code) => rejeter(new Error(`cockpit arrêté (code ${code})`)));
    });
    assert.equal((await poster("/api/missions/plan", { spec: spec() }, { origin: "https://autre.example" })).code, 403);
    const finance = await poster("/api/missions/plan", { spec: specFinance({ nature: "finance" }), financeDisponible: true });
    assert.equal(finance.code, 200, JSON.stringify(finance.corps));
    assert.equal(finance.corps.statut, "bloque", "un champ HTTP ne déclare pas de capacité serveur");
    assert.deepEqual(finance.corps.blocages.map((b) => b.noeud), ["collecte", "validation", "publication"]);
    assert.equal((await poster("/api/missions/lancer", { spec: specFinance(), empreinte: "0".repeat(64), requestId: crypto.randomUUID() })).code, 409);
    const proposition = await poster("/api/missions/plan", { spec: spec() });
    assert.equal(proposition.code, 200, JSON.stringify(proposition.corps));
    assert.equal(proposition.corps.statut, "lancable");
    assert.equal(proposition.corps.plan.etapes.find((e) => e.noeud === "implement").machine, "pc");
    const corps = { spec: spec(), empreinte: proposition.corps.empreinte, requestId: crypto.randomUUID() };
    assert.equal((await poster("/api/missions/lancer", { ...corps, empreinte: "0".repeat(64) })).code, 409);
    const premier = await poster("/api/missions/lancer", corps);
    const second = await poster("/api/missions/lancer", corps);
    assert.equal(premier.code, 202, JSON.stringify(premier.corps));
    assert.equal(second.corps.commande.id, premier.corps.commande.id);
    const commande = f.store.commande(premier.corps.commande.id);
    assert.equal(commande.par, "test");
    assert.equal(commande.payload.mission.plan.pipeline.ref, "improve-app@7");
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE kind = 'run.start'").get().n, 1);
  } finally { enfant.kill(); f.fermer(); }
});
