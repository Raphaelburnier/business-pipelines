// Même contrôle de placement pour une mission et un tour de conversation.
const catalogue = require("./modeles");
const { roleEffectif } = require("agent-orchestrator/src/dispatch");

// Le mode vient du pipeline résolu côté serveur, jamais d'une capacité fournie par le client.
function verifierMachine(machines, role, noeud, { pipeline, agent } = {}) {
  if (role === "nas") return;
  const worker = machines.find((m) => m.machine === role);
  if (!worker || !["online", "busy"].includes(worker.etat)) throw new Error(`${noeud.id} : worker ${role} indisponible`);
  const capacites = worker.meta?.capacites;
  if (capacites?.missions !== 1) throw new Error(`${noeud.id} : mettre le worker ${role} à jour pour les missions`);
  if (noeud.dialogue && capacites?.discussion !== 1) throw new Error(`${noeud.id} : mettre le worker ${role} à jour pour la discussion d'équipe`);
  if (pipeline?.workspace === "documents") {
    if (capacites?.documents !== 1) throw new Error(`${noeud.id} : mettre le worker ${role} à jour pour les workspaces documentaires`);
    if (agent?.procedures?.length && capacites?.procedures !== 1) throw new Error(`${noeud.id} : mettre le worker ${role} à jour pour les procédures documentaires`);
  }
  return capacites;
}

function verifier({ viaParMachine, machines }) {
  return (llm, noeud, contexte = {}) => {
    if (llm) {
      const dispo = catalogue.disponibiliteVia(llm.via, { viaParMachine, machines });
      if (!dispo.utilisable) throw new Error(`${noeud.id} : backend ${llm.via} indisponible (${dispo.raison})`);
    }
    const role = roleEffectif(llm ? { ...noeud, llm } : noeud);
    const capacites = verifierMachine(machines, role, noeud, contexte);
    if (role === "nas") return;
    if (llm && !(capacites?.backends || []).includes(llm.via)) throw new Error(`${noeud.id} : runtime ${llm.via} non annoncé par ${role}`);
  };
}
module.exports = { verifier, verifierMachine };
