const fs = require("fs");
const os = require("os");
const path = require("path");

const { BudgetTracker, Reporter, loader } = require("agent-orchestrator");
const stageHandlers = require("../src/stage-handlers");

const PIPELINE = path.join(__dirname, "..", "pipelines", "veille-ebay.json");

class SilentReporter extends Reporter {
  event(type, data = {}) {
    this.events.push({ type, ...data });
  }
}

// Charge le VRAI pipeline avec les VRAIS validateurs. Un pipeline qui ne se charge pas
// fait donc échouer tous les tests, ce qui est le comportement voulu : la validité du
// pipeline livré n'est pas une hypothèse de test, c'est la première chose testée.
function loadPipeline() {
  return loader.loadPipeline(PIPELINE, {
    stageValidators: stageHandlers.validators,
    backends: { anthropic: {} },
  });
}

// Une réponse HTTP factice, à la forme de celle d'eBay. C'est ce qui permet d'exercer
// le vrai handler `fetch` et la vraie normalisation sans réseau ni credentials.
function fakeEbay(items, { ok = true, status = 200, total } = {}) {
  return async () => ({
    ok,
    status,
    json: async () => ({ total: total ?? items.length, itemSummaries: items }),
  });
}

function annonce(i, overrides = {}) {
  return {
    itemId: `v1|${100 + i}|0`,
    title: `Booster box ${i}`,
    price: { value: String(80 + i), currency: "EUR" },
    condition: i % 2 === 0 ? "New" : "Used",
    seller: { username: `vendeur${i % 3}`, feedbackPercentage: "99.1" },
    shippingOptions: [{ shippingCost: { value: i % 2 === 0 ? "0.0" : "4.9" } }],
    itemWebUrl: `https://www.ebay.com/itm/${100 + i}`,
    ...overrides,
  };
}

// Le seul mock est runAgent (et le transport HTTP). Le moteur, le stage-executor, le
// gate-evaluator, le routeur, le budget et le handler `fetch` sont le vrai code.
function createHarness({ pipeline, spec, script, items = [1, 2, 3, 4].map((i) => annonce(i)), transport }) {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "veille-"));
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

  const ctx = {
    pipeline,
    spec,
    workspaceDir,
    agentDefinitions: Object.fromEntries(
      Object.keys(pipeline.slicing).map((name) => [name, { name }])
    ),
    runAgent,
    stageHandlers: stageHandlers.handlers,
    transports: { ebay: transport || fakeEbay(items) },
    backends: {},
    env: { EBAY_OAUTH_TOKEN: "jeton-de-test" },
    budget: new BudgetTracker(pipeline.budget),
    reporter,
  };

  return { ctx, calls, prompts, reporter, workspaceDir };
}

function writeJson(workspaceDir, file, content) {
  fs.writeFileSync(path.join(workspaceDir, file), JSON.stringify(content, null, 2));
}

function readJson(workspaceDir, file) {
  return JSON.parse(fs.readFileSync(path.join(workspaceDir, file), "utf-8"));
}

module.exports = { createHarness, loadPipeline, fakeEbay, annonce, writeJson, readJson };
