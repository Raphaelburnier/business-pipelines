// Fixtures communes aux tests de contrat et à la recette navigateur locale, sans modèle réel.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const { EventStore }=require('agent-orchestrator');
const REGISTRE_SOURCE=path.join(__dirname,'registre-planificateur');
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

function fixture({ securite = false, roster = ROSTER, financeDisponible, financeVersion = 1 } = {}) {
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
  const financeProject = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "projects", "finance", "project.json")));
  financeProject.pipelines[0].extends = `finance-research@${financeVersion}`;
  ecrire("finance", financeProject, {
    "spec.json": JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "projects", "finance", "spec.json"))),
  });
  process.env.ORCH_REGISTRE = reg;
  const store = new EventStore(path.join(dir, "events.sqlite"));
  const params = { projetsDir: projets, roster, affectations: {}, financeDisponible };
  return { dir, reg, projets, store, params, fermer: () => { store.fermer(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

const YANIS = { id: "yanis", nom: "Yanis", role: "Sécurité", famille: "claude", llm: claudeOpus, registre: ["security-reviewer"], budgetMensuelUsd: 30 };


module.exports={fixture,ROSTER,YANIS,claudeSonnet,claudeOpus,codex};
