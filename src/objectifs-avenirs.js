// Catalogue strict partagé avec la page « À venir ». Les titres/détails restent dans
// la feuille TypeScript ; seuls les IDs encore attribuables, leur révision et le projet
// système où le travail se fait sont listés ici. Le projet n'est pas un choix de l'utilisateur :
// un objectif sans projet (gates partagés, autre dépôt) se traite hors du cockpit.
const objectifs = require("../web/src/avenir/objectifs.json");
const parId = new Map(objectifs.map((objectif) => [objectif.id, objectif]));

function validerReference(reference, projectId) {
  if (!reference || typeof reference.id !== "string" || !Number.isInteger(reference.revision) || reference.revision < 1) {
    throw new Error("référence d'objectif invalide");
  }
  const objectif = parId.get(reference.id);
  if (!objectif) throw new Error(`objectif À venir inconnu ou non attribuable : ${reference.id}`);
  if (objectif.revision !== reference.revision) {
    throw new Error(`révision périmée pour l'objectif ${reference.id}`);
  }
  if (!objectif.projet) throw new Error(`l'objectif ${reference.id} touche plusieurs dépôts : il se traite hors du cockpit`);
  if (projectId !== undefined && projectId !== objectif.projet) {
    throw new Error(`l'objectif ${reference.id} se traite dans ${objectif.projet}, pas dans ${projectId}`);
  }
  return objectif;
}

module.exports = { objectifs, validerReference };
