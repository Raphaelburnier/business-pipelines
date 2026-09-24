// Le catalogue des modèles, relevé sur le PC par `orch modeles` et poussé dans `etat/`.
//
// Le cockpit ne joint pas OmniRoute (décision 5) et ne reçoit aucune clé : il sert le
// dernier relevé avec son âge, et dit quels backends le runner sait joindre. Un relevé vieux
// veut dire que le PC dort ou que le minuteur s'est arrêté, pas que les modèles sont morts.
const fs = require("fs");
const { modeles } = require("agent-orchestrator/packages/schemas/modeles");

// Le minuteur du PC relève toutes les deux minutes ; au-delà de dix, le relevé est périmé.
const PERIME_S = 600;

/**
 * @param {string} fichier
 * @param {{ viaRunner?: string[], maintenant?: number }} [options]
 */
function lireCatalogue(fichier, { viaRunner = ["claude"], maintenant = Date.now() } = {}) {
  const vide = (raison) => ({ catalogue: null, ageSecondes: null, perime: true, viaRunner, raison });
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
  return { catalogue: lu.data, ageSecondes, perime: ageSecondes > PERIME_S, viaRunner, raison: null };
}

module.exports = { lireCatalogue, PERIME_S };
