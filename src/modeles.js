// Le catalogue des modèles, relevé sur le PC par `orch modeles` et poussé dans `etat/`.
//
// Le cockpit ne joint pas OmniRoute (décision 5) et ne reçoit aucune clé : il sert le
// dernier relevé avec son âge, et dit quelle machine sait joindre chaque backend. Un relevé
// vieux veut dire que le PC dort ou que le minuteur s'est arrêté, pas que les modèles sont
// morts.
const fs = require("fs");
const { modeles } = require("agent-orchestrator/packages/schemas/modeles");

// Le minuteur du PC relève toutes les deux minutes ; au-delà de dix, le relevé est périmé.
const PERIME_S = 600;

/**
 * `nas:claude;pc:claude,omniroute` → { nas: ["claude"], pc: [...] }.
 * Une faute de configuration est refusée au démarrage : ignorer une entrée pourrait faire
 * accepter un run sur une machine qui ne possède pas son backend.
 * @param {string} valeur
 */
function lireViaParMachine(valeur = "nas:claude;pc:claude,omniroute") {
  const table = {};
  for (const entree of String(valeur).split(";").map((v) => v.trim()).filter(Boolean)) {
    const separateur = entree.indexOf(":");
    const machine = separateur >= 0 ? entree.slice(0, separateur).trim() : "";
    const vias = separateur >= 0 ? entree.slice(separateur + 1).split(",").map((v) => v.trim()).filter(Boolean) : [];
    if (!machine || !vias.length) throw new Error(`COCKPIT_VIA_MACHINES invalide près de « ${entree} »`);
    if (table[machine]) throw new Error(`COCKPIT_VIA_MACHINES répète la machine « ${machine} »`);
    table[machine] = [...new Set(vias)];
  }
  if (!Object.keys(table).length) throw new Error("COCKPIT_VIA_MACHINES ne déclare aucune machine");
  return table;
}

const ETATS_JOIGNABLES = new Set(["online", "busy", "waking"]);

/**
 * Vérifie qu'au moins une machine configurée pour ce backend est présente et joignable,
 * ou explicitement réveillable grâce à son adresse MAC.
 * @param {string} via
 * @param {{ viaParMachine: Record<string, string[]>, machines: any[] }} etat
 */
function disponibiliteVia(via, { viaParMachine, machines }) {
  const cibles = Object.entries(viaParMachine).filter(([, vias]) => vias.includes(via)).map(([machine]) => machine);
  if (!cibles.length) return { utilisable: false, machine: null, reveillera: false, raison: `backend « ${via} » non configuré` };

  const parId = new Map(machines.map((m) => [m.machine, m]));
  for (const id of cibles) {
    const machine = parId.get(id);
    if (!machine) continue;
    if (ETATS_JOIGNABLES.has(machine.etat)) {
      return { utilisable: true, machine: id, reveillera: false, raison: null };
    }
    const mac = machine.meta && typeof machine.meta.mac === "string" && machine.meta.mac.trim();
    if (["sleeping", "offline"].includes(machine.etat) && mac) {
      return { utilisable: true, machine: id, reveillera: true, raison: null };
    }
  }

  const presentes = cibles.map((id) => parId.get(id)).filter(Boolean);
  const raison = presentes.length
    ? presentes.map((m) => `${m.machine} ${m.etat}${m.meta && m.meta.mac ? "" : " sans WoL"}`).join(", ")
    : `machine ${cibles.join(" ou ")} non enregistrée`;
  return { utilisable: false, machine: null, reveillera: false, raison };
}

/**
 * @param {string} fichier
 * @param {{ viaParMachine?: Record<string, string[]>, machines?: any[], maintenant?: number }} [options]
 */
function lireCatalogue(fichier, { viaParMachine = { nas: ["claude"], pc: ["claude", "omniroute"] }, machines = [], maintenant = Date.now() } = {}) {
  const vide = (raison) => ({ catalogue: null, ageSecondes: null, perime: true, viaParMachine, machines, raison });
  let brut;
  try {
    brut = fs.readFileSync(fichier, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") return vide("aucun relevé : lancer `orch modeles` sur le PC");
    throw err;
  }
  const lu = modeles.catalogue.safeParse(JSON.parse(brut));
  if (!lu.success) return vide("relevé illisible : forme inattendue");
  const ageSecondes = Math.max(0, Math.round((maintenant - Date.parse(lu.data.releveLe)) / 1000));
  return { catalogue: lu.data, ageSecondes, perime: ageSecondes > PERIME_S, viaParMachine, machines, raison: null };
}

module.exports = { lireCatalogue, lireViaParMachine, disponibiliteVia, PERIME_S };
