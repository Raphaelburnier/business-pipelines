// Identités issues de la mission figée, sans exposer son contexte ni sa configuration.
function agentsTaches(mission) {
  return (mission?.participants || []).filter(p => ['agent', 'review'].includes(p.type))
    .map(p => ({ id: p.membre || null, nom: p.nom || p.agent, role: p.noeud, via: p.llm?.via || '' }));
}
module.exports = { agentsTaches };
