const { Maitre, servirMaitre, lireWorkers, wol } = require("agent-orchestrator");

// Le maître n'exécute jamais d'agent. Il possède les connexions réelles et publie donc
// la même disponibilité que celle exigée par la reprise waiting_machine (lot 2.7).
class MaitrePermanent extends Maitre {
  etatsMachines() {
    return super.etatsMachines().map(machine => ({
      ...machine,
      disponible: this.machineDisponible(machine.machine),
      concurrence: this.connexions.get(machine.machine)?.capacites?.concurrence || 1,
    }));
  }
}

async function ouvrirMaitrePermanent({ store, env, journal = console.log }) {
  const maitre = new MaitrePermanent({ store, workers: lireWorkers(),
    wol: ["0", "false", "no", "off"].includes(String(process.env.ORCH_REVEIL_MACHINE ?? "1").toLowerCase()) ? null : wol.pourMaitre(), journal });
  try { await maitre.demarrer(); }
  catch (err) { await maitre.arreter(); throw err; }
  const service = servirMaitre({ store, maitre, env, journal });
  return { maitre, async arreter() { await service.arreter(); await maitre.arreter(); } };
}

module.exports = { MaitrePermanent, ouvrirMaitrePermanent };
