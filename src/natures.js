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

const jugeParDefaut = (n) => n.type === "review" || n.type === "approval" || (n.type === "script" && Boolean(n.outcomeFrom));

/**
 * Ce qui change d'une nature à l'autre dans un plan. Le planificateur n'a aucun test sur le nom
 * d'une nature : une nature nouvelle s'ajoute ici.
 * - `valider` : contrôle propre à la nature, qui lève une erreur sur un pipeline invalide ;
 * - `roleDuNoeud` : rôle imposé à chaque nœud, à la place de la déduction structurelle ;
 * - `developpementParMustChange` : un agent `mustChange` est un développeur ;
 * - `roleParDefaut` : rôle d'un agent que la structure ne classe pas ;
 * - `exige` : éléments sans lesquels le pipeline est incomplet ;
 * - `publicationInterdite`, `scriptsInstalles` : contrôles du projet et des machines ;
 * - `realisePar` : rôles qui réalisent les critères (sinon synthèse, puis analyse et production) ;
 * - `jugePar` : nœuds qui jugent les critères ;
 * - `resultat` : résultat fixe du plan, sinon déduit de l'approbation et de la publication.
 */
const REGLES = {
  developpement: {
    roleDuNoeud: null,
    developpementParMustChange: true,
    roleParDefaut: "production",
    exige: [
      { present: ({ roles }) => roles.includes("developpement"), manque: (ref) => `${ref} n'a aucun nœud de développement (agent avec mustChange).` },
      { present: ({ actifs }) => actifs.some((n) => n.handler === "verify-project"), manque: (ref) => `${ref} n'exécute pas les tests du projet (verify-project).` },
      { present: ({ actifs }) => actifs.some((n) => n.type === "review"), manque: (ref) => `${ref} n'a aucune revue indépendante active.` },
    ],
    publicationInterdite: false,
    scriptsInstalles: false,
    realisePar: ["developpement"],
    jugePar: jugeParDefaut,
    resultat: null,
  },
  marketing: {
    roleDuNoeud: null,
    developpementParMustChange: false,
    roleParDefaut: "analyse",
    exige: [],
    publicationInterdite: false,
    scriptsInstalles: false,
    realisePar: null,
    jugePar: jugeParDefaut,
    resultat: null,
  },
  finance: {
    valider: finance.validerFinance,
    roleDuNoeud: finance.roleFinance,
    developpementParMustChange: false,
    roleParDefaut: "production",
    exige: [],
    publicationInterdite: true,
    scriptsInstalles: true,
    realisePar: null,
    jugePar: (n) => n.handler === "finance-report-validate",
    resultat: { type: "rapport", depot: null, description: "Rapport financier privé, daté et sourcé, archivé après validation déterministe des références. Les scénarios restent à examiner par l'opérateur." },
  },
};

/** Règles d'une nature lançable ; une nature sans règles est une erreur de programmation. */
function reglesDe(nature) {
  const regles = Object.hasOwn(REGLES, nature) ? REGLES[nature] : null;
  if (!regles) throw new Error(`nature sans règles : ${nature}`);
  return regles;
}

module.exports = { classer, natureLancable, reglesDe, REGLES, TAGS_NATURE };
