#!/usr/bin/env node
// Les outils de « Demander » servis en MCP stdio à Codex (agent-orchestrator, cockpit-read).
//
// Codex lance ce script lui-même, le temps d'une réponse : stdin et stdout portent le
// protocole, rien d'autre ne doit y écrire. Le seul argument est le fichier où ranger les
// propositions et les actions faites ; le runner le relit à la fin du tour et les range sous
// la réponse. COCKPIT_CHAT_PAR et COCKPIT_CHAT_CANAL, posés par le runner, sont l'identité de
// la question : sans eux, Codex ne relance ni n'écrit rien. COCKPIT_CHAT_ORIGINE est l'id de
// la question signée, que le publieur exige sur chaque action.
const { EventStore, cockpitRead } = require("agent-orchestrator");
const chatOutils = require("../src/chat-outils");

const fichier = process.argv[2];
if (!fichier) {
  console.error("usage : chat-outils-mcp.js <fichier-propositions>");
  process.exit(2);
}

const store = new EventStore(chatOutils.chemins().store);
const par = process.env.COCKPIT_CHAT_PAR;
const agir = par ? chatOutils.agir(store, { qui: { par, canal: process.env.COCKPIT_CHAT_CANAL || null }, agent: "codex", origine: process.env.COCKPIT_CHAT_ORIGINE || null }) : null;
const definitions = cockpitRead.definitionsOutils({
  ...chatOutils.sources(store),
  propositions: cockpitRead.propositionsFichier(fichier),
  agir,
});
cockpitRead
  .servirStdio(definitions)
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => store.fermer());
