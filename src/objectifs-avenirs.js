// Catalogue strict partagé avec la page « À venir ». Les titres/détails restent dans
// la feuille TypeScript ; seuls les IDs encore attribuables, leur révision et le projet
// système où le travail se fait sont listés ici. Le projet n'est pas un choix de l'utilisateur :
// un objectif sans projet (gates partagés, autre dépôt) se traite hors du cockpit.
const objectifs = require("../web/src/avenir/objectifs.json");
const parId = new Map(objectifs.map((objectif) => [objectif.id, objectif]));
const motifs = require("../deploy/fichiers-sensibles.json").motifs.map((m) => new RegExp(m, "i"));
const CRITERE_SECURITE = "Les contrôles d'accès, les entrées invalides et la non-régression du changement sont vérifiés et documentés par des preuves ; la revue de sécurité indépendante est favorable.";

// Le client peut renforcer la revue. Les risques du catalogue sont décidés par le serveur.
function cadrerSensibilite(spec) {
  const ref = spec.contexte._roadmapObjective;
  const objectif = ref ? validerReference(ref, spec.projectId) : null;
  const fichiers = (objectif?.fichiers || []).filter((f) => {
    let chemin = f.replace(/^(BP|AO|REG|AS)\s+/, "").replace(/:\d[\d,\s-]*$/, "");
    if (/^(agent-gated-merge|ci-autofix|ci|claude|claude-code-review)\.ya?ml$/i.test(chemin)) chemin = `.github/workflows/${chemin}`;
    return motifs.some((motif) => motif.test(chemin));
  });
  const raisons = [...fichiers.map((f) => `Fichier protégé annoncé : ${f}.`),
    ...(objectif?.raisonSensibilite ? [`Risque signalé dans le cadrage : ${objectif.raisonSensibilite}`] : [])];
  if (!raisons.length && !spec.exigences.includes("revue-securite")) return spec;
  const controle = `Sensibilité vérifiée par l'orchestrateur :\n${raisons.length ? raisons.join("\n") : "Revue de sécurité supplémentaire demandée par l'utilisateur."}`;
  return { ...spec, exigences: [...new Set([...spec.exigences, "revue-securite"])],
    criteres: [...new Set([...spec.criteres, CRITERE_SECURITE])],
    document: spec.document.includes(controle) ? spec.document : `${spec.document}\n\n${controle}` };
}

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

module.exports = { objectifs, validerReference, cadrerSensibilite, CRITERE_SECURITE };
