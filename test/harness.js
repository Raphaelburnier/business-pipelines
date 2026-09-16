const fs = require("fs");
const os = require("os");
const path = require("path");

const { BudgetTracker, Reporter, loader } = require("agent-orchestrator");
const stageHandlers = require("../src/stage-handlers");
const store = require("../src/store");

const pipelinePath = (name) => path.join(__dirname, "..", "pipelines", `${name}.json`);
const fixturePath = (name) => path.join(__dirname, "fixtures", `${name}.json`);

class SilentReporter extends Reporter {
  event(type, data = {}) {
    this.events.push({ type, ...data });
  }
}

// Charge un pipeline avec les VRAIS validateurs. Un pipeline qui ne se charge pas fait donc
// échouer tous les tests qui s'en servent : sa validité n'est pas une hypothèse de test,
// c'est la première chose testée.
function charger(fichier) {
  return loader.loadPipeline(fichier, {
    stageValidators: stageHandlers.validators,
    backends: { anthropic: {} },
  });
}

const loadPipeline = (name) => charger(pipelinePath(name));
const loadFixture = (name) => charger(fixturePath(name));

// Un stage se désigne par son id, jamais par sa position : insérer une étape en amont
// ne doit pas casser un test qui parle d'une étape en aval.
function stageParId(pipeline, id) {
  const s = pipeline.stages.find((x) => x.id === id);
  if (!s) throw new Error(`aucun stage "${id}" dans le pipeline (ids : ${pipeline.stages.map((x) => x.id).join(", ")})`);
  return s;
}

// Le seul mock est runAgent. Le moteur, le stage-executor, le gate-evaluator, le routeur,
// le budget et les handlers de stage sont le vrai code.
function createHarness({ pipeline, spec, script, maintenant }) {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-"));
  const calls = {};
  const prompts = [];

  const runAgent = async ({ definition, userMessage, maxTurns, env }) => {
    const name = definition.name;
    calls[name] = (calls[name] || 0) + 1;
    prompts.push({ agent: name, call: calls[name], userMessage, maxTurns, env });

    const write = script[name];
    if (!write) throw new Error(`Harness : aucun script pour l'agent "${name}"`);
    const override = write(calls[name], workspaceDir) || {};
    return { costUsd: 0.1, turns: 2, summary: `${name} #${calls[name]}`, ...override };
  };

  const reporter = new SilentReporter(workspaceDir);

  // Le registre de décisions vit hors du workspace, comme en production : un dossier
  // séparé, que les agents ne voient pas.
  const approvalsDir = fs.mkdtempSync(path.join(os.tmpdir(), "approbations-"));

  const ctx = {
    pipeline,
    spec,
    workspaceDir,
    approvalsDir,
    agentDefinitions: Object.fromEntries(
      Object.keys(pipeline.slicing).map((name) => [name, { name }])
    ),
    runAgent,
    stageHandlers: stageHandlers.handlers,
    maintenant,
    backends: {},
    env: {},
    budget: new BudgetTracker(pipeline.budget),
    reporter,
  };

  return { ctx, calls, prompts, reporter, workspaceDir, approvalsDir };
}

// Écrit un registre de décisions là où le stage `approval` va le chercher : le store des
// approbations, hors du workspace. `file` garde le nom que déclare le pipeline
// (`exemple.decisions.json`), dont le dossier se déduit.
function writeDecisions(approvalsDir, file, content) {
  store.ecrireRegistre(approvalsDir, path.basename(file).replace(/\.decisions\.json$|\.json$/, ""), content);
}

function writeJson(workspaceDir, file, content) {
  fs.writeFileSync(path.join(workspaceDir, file), JSON.stringify(content, null, 2));
}

function readJson(workspaceDir, file) {
  return JSON.parse(fs.readFileSync(path.join(workspaceDir, file), "utf-8"));
}

module.exports = {
  stageParId,
  createHarness,
  loadPipeline,
  loadFixture,
  pipelinePath,
  fixturePath,
  writeJson,
  readJson,
  writeDecisions,
};
