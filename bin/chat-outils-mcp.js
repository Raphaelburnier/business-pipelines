#!/usr/bin/env node
// Les outils de « Demander » servis en MCP stdio à Codex (agent-orchestrator, cockpit-read).
//
// Codex lance ce script lui-même, le temps d'une réponse : stdin et stdout portent le
// protocole, rien d'autre ne doit y écrire. Le seul argument est le fichier où ranger les
// propositions d'action ; le runner le relit à la fin du tour et les range sous la réponse.
const { EventStore, cockpitRead } = require("agent-orchestrator");
const chatOutils = require("../src/chat-outils");

const fichier = process.argv[2];
if (!fichier) {
  console.error("usage : chat-outils-mcp.js <fichier-propositions>");
  process.exit(2);
}

const store = new EventStore(chatOutils.chemins().store);
const definitions = cockpitRead.definitionsOutils({
  ...chatOutils.sources(store),
  propositions: cockpitRead.propositionsFichier(fichier),
});
cockpitRead
  .servirStdio(definitions)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => store.fermer());
