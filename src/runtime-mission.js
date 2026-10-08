// Même contrôle de placement pour une mission et un tour de conversation.
const catalogue = require("./modeles");
const { roleEffectif } = require("agent-orchestrator/src/dispatch");

function verifier({ viaParMachine, machines }) {
  return (llm, noeud) => {
    const dispo = catalogue.disponibiliteVia(llm.via, { viaParMachine, machines });
    if (!dispo.utilisable) throw new Error(`${noeud.id} : backend ${llm.via} indisponible (${dispo.raison})`);
    const role = roleEffectif({ ...noeud, llm });
    if (role === "nas") return;
    const worker = machines.find((m) => m.machine === role);
    if (!worker || !["online", "busy"].includes(worker.etat)) throw new Error(`${noeud.id} : worker ${role} indisponible`);
    const capacites = worker.meta?.capacites;
    if (capacites?.missions !== 1) throw new Error(`${noeud.id} : mettre le worker ${role} à jour pour les missions`);
    if (noeud.dialogue && capacites?.discussion !== 1) throw new Error(`${noeud.id} : mettre le worker ${role} à jour pour la discussion d'équipe`);
    if (!(capacites?.backends || []).includes(llm.via)) throw new Error(`${noeud.id} : runtime ${llm.via} non annoncé par ${role}`);
  };
}
module.exports = { verifier };
