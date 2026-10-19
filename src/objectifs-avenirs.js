// Catalogue strict partagé avec la page « À venir ». Les titres/détails restent dans
// la feuille TypeScript ; seuls les IDs encore attribuables et leur révision sont listés ici.
const objectifs = require("../web/src/avenir/objectifs.json");
const parId = new Map(objectifs.map((objectif) => [objectif.id, objectif]));

function validerReference(reference) {
  if (!reference || typeof reference.id !== "string" || !Number.isInteger(reference.revision) || reference.revision < 1) {
    throw new Error("référence d'objectif invalide");
  }
  const objectif = parId.get(reference.id);
  if (!objectif) throw new Error(`objectif À venir inconnu ou non attribuable : ${reference.id}`);
  if (objectif.revision !== reference.revision) {
    throw new Error(`révision périmée pour l'objectif ${reference.id}`);
  }
  return objectif;
}

module.exports = { objectifs, validerReference };
