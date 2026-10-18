// Détection unique de la nature d'un pipeline, partagée par le planificateur et les missions
// du cockpit. Un pipeline sans nature reconnue n'est jamais écarté en silence : `raison` dit
// pourquoi, pour que le planificateur puisse l'afficher.
const finance = require("agent-orchestrator/packages/schemas/finance");

const TAGS_NATURE = { code: "developpement", marketing: "marketing", finance: "finance" };

/**
 * Nature d'un pipeline et s'il est un gabarit de discussion que le planificateur ne lance pas.
 * @param {{ name?: string, version?: number, tags?: string[], workspace?: string, nodes?: Array<{ handler?: string }> }} pipeline
 * @returns {{ nature: "developpement" | "marketing" | "finance" | null, gabarit: boolean, raison: string | null }}
 */
function classer(pipeline) {
  const tags = pipeline.tags || [];
  if (finance.estFinance(pipeline)) return { nature: "finance", gabarit: false, raison: null };
  const gabarit = pipeline.workspace === "documents" || tags.includes("discussion");
  const nature = tags.includes("code") || (pipeline.nodes || []).some((n) => n.handler === "verify-project")
    ? "developpement"
    : tags.includes("marketing") ? "marketing" : null;
  if (gabarit) return { nature, gabarit, raison: "gabarit de discussion, lancé depuis une discussion d'équipe" };
  if (nature) return { nature, gabarit, raison: null };
  const connus = Object.keys(TAGS_NATURE).join(", ");
  return { nature: null, gabarit, raison: tags.length
    ? `aucun tag de nature (${connus}) parmi ses tags ${tags.join(", ")}`
    : `aucun tag (${connus} attendu) ni étape verify-project` };
}

/** Nature d'un pipeline que le planificateur peut lancer, ou null. */
function natureLancable(pipeline) {
  const c = classer(pipeline);
  return c.gabarit ? null : c.nature;
}

module.exports = { classer, natureLancable, TAGS_NATURE };
