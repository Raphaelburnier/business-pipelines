#!/usr/bin/env node

const path = require("path");
const {
  loader,
  workspace,
  agentRunner,
  envLoader,
  backends: backendLoader,
  BudgetTracker,
  Reporter,
  engine,
} = require("agent-orchestrator");

const stageHandlers = require("./src/stage-handlers");

async function main() {
  const [, , pipelineName, specPath] = process.argv;
  if (!pipelineName || !specPath) {
    console.error("Usage : node orchestrator.js <pipeline> <spec.json>");
    console.error("Exemple : node orchestrator.js veille-ebay ./specs/veille.example.json");
    process.exit(1);
  }

  const backends = backendLoader.load(__dirname);

  const pipeline = loader.loadPipeline(
    path.join(__dirname, "pipelines", `${pipelineName}.json`),
    { stageValidators: stageHandlers.validators, backends }
  );
  const spec = loader.loadSpec(specPath);
  loader.validateSpecAgainstPipeline(spec, pipeline);

  // Les credentials des API vivent dans le .env du spec, jamais dans le dépôt : un
  // spec par marché, un .env par spec, donc un jeu de clés par périmètre.
  const env = envLoader.load(__dirname, specPath, process.env.ENV_FILE);

  const agentsDir = path.join(__dirname, ".claude", "agents");
  const agentDefinitions = {};
  for (const stage of pipeline.stages) {
    for (const agent of stage.agents || []) {
      agentDefinitions[agent.name] = agentRunner.loadAgentDefinition(agentsDir, agent.name);
    }
  }

  // Une veille produit un rapport, pas un projet : le workspace est un dossier de
  // travail jetable, et il n'y a rien à versionner ni à déployer. D'où l'absence de
  // `vcs` dans le contexte, que le moteur traite comme optionnel.
  const outputRoot = process.env.OUTPUT_ROOT || path.join(__dirname, "runs");
  const { dir: workspaceDir } = workspace.create(outputRoot, spec.project_name, {
    overwrite: true,
  });

  const reporter = new Reporter(workspaceDir);
  const budget = new BudgetTracker(pipeline.budget);
  reporter.event("generation:start", {
    pipeline: pipeline.name,
    project: spec.project_name,
    workspace: workspaceDir,
  });

  const ctx = {
    pipeline,
    spec,
    workspaceDir,
    agentDefinitions,
    runAgent: agentRunner.run,
    stageHandlers: stageHandlers.handlers,
    backends,
    env,
    specPath,
    budget,
    reporter,
  };

  try {
    await engine.runPipeline(ctx);
    reporter.event("generation:done", {});
    reporter.finalize("success", budget);
    console.log(`\n✓ Rapport : ${path.join(workspaceDir, "veille-report.json")}`);
  } catch (err) {
    reporter.event("generation:failed", { error: err.message });
    reporter.finalize("failed", budget);
    throw err;
  }
}

main().catch((err) => {
  console.error(`\n✘ ${err.message}`);
  process.exit(1);
});
