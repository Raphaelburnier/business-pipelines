// Détection unique de la nature d'un pipeline, partagée par le planificateur et les missions
// du cockpit. Les natures viennent du registre (`natures/<id>.json`, lues par le moteur) ; un
// registre ou un moteur qui ne les porte pas encore laisse les natures intégrées ci-dessous.
// Un pipeline sans nature reconnue n'est jamais écarté en silence : `raison` dit pourquoi.
const registre = require("agent-orchestrator/src/registre");
const finance = require("agent-orchestrator/packages/schemas/finance");

const INTEGREES = [
  { id: "finance", libelle: "Finance", description: "Recherche financière privée : collecte, analyse sourcée et rapport validé, sans publication GitHub ni ordre courtier.",
    tags: ["finance"], handlers: [], priorite: 10 },
  { id: "developpement", libelle: "Développement", description: "Changement de code dans un dépôt : planification, édition, tests du projet et revue indépendante, jusqu'à la PR.",
    tags: ["code"], handlers: ["verify-project"], priorite: 20 },
  { id: "marketing", libelle: "Marketing", description: "Analyses de marque, de marché et d'économie, synthétisées puis soumises à une décision.",
    tags: ["marketing"], handlers: [], priorite: 30 },
];

/**
 * Les natures connues, par priorité croissante : celles du registre, sinon les intégrées.
 * @param {string} [dossier]
 * @returns {Array<{ id: string, libelle: string, description: string, tags: string[], handlers: string[], priorite: number }>}
 */
function naturesDeclarees(dossier = registre.dossierRegistre()) {
  const lues = typeof registre.lireNatures === "function" ? registre.lireNatures(dossier) : [];
  return lues.length ? lues : INTEGREES;
}

/** Les tags qui donnent une nature, pour les messages. */
const tagsConnus = (natures = naturesDeclarees()) => natures.flatMap((n) => n.tags);

/**
 * Nature d'un pipeline et s'il est un gabarit de discussion que le planificateur ne lance pas.
 * La première nature, par priorité, dont un tag ou un handler figure dans le pipeline l'emporte.
 * @param {{ tags?: string[], workspace?: string, nodes?: Array<{ handler?: string }> }} pipeline
 * @param {ReturnType<typeof naturesDeclarees>} [natures]
 * @returns {{ nature: string | null, gabarit: boolean, raison: string | null }}
 */
function classer(pipeline, natures = naturesDeclarees()) {
  const tags = pipeline.tags || [];
  const handlers = new Set((pipeline.nodes || []).map((n) => n.handler).filter(Boolean));
  const trouvee = natures.find((n) => n.tags.some((t) => tags.includes(t)) || n.handlers.some((h) => handlers.has(h)));
  const nature = trouvee ? trouvee.id : null;
  const gabarit = tags.includes("discussion") || (pipeline.workspace === "documents" && !(nature && reglesDe(nature).documents));
  if (gabarit) return { nature, gabarit, raison: "gabarit de discussion, lancé depuis une discussion d'équipe" };
  if (nature) return { nature, gabarit, raison: null };
  const connus = tagsConnus(natures).join(", ");
  return { nature: null, gabarit, raison: tags.length
    ? `aucun tag de nature (${connus}) parmi ses tags ${tags.join(", ")}`
    : `aucun tag (${connus} attendu) ni étape qui en donne une` };
}

/** Nature d'un pipeline que le planificateur peut lancer, ou null. */
function natureLancable(pipeline, natures) {
  const c = classer(pipeline, natures);
  return c.gabarit ? null : c.nature;
}

const jugeParDefaut = (n) => n.type === "review" || n.type === "approval" || (n.type === "script" && Boolean(n.outcomeFrom));

/**
 * Ce qui change d'une nature à l'autre dans un plan. Le planificateur n'a aucun test sur le nom
 * d'une nature. Une nature déclarée dans le registre sans entrée ici suit `GENERIQUES`.
 * - `documents` : un pipeline de cette nature en espace documents reste lançable ;
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
    documents: true,
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

const GENERIQUES = {
  roleDuNoeud: null,
  developpementParMustChange: false,
  roleParDefaut: "production",
  exige: [],
  publicationInterdite: false,
  scriptsInstalles: false,
  realisePar: null,
  jugePar: jugeParDefaut,
  resultat: null,
};

/** Règles d'une nature : les siennes, sinon les génériques d'une branche déclarée en données. */
function reglesDe(nature) {
  return Object.hasOwn(REGLES, nature) ? REGLES[nature] : GENERIQUES;
}

module.exports = { classer, natureLancable, naturesDeclarees, tagsConnus, reglesDe, REGLES, GENERIQUES, INTEGREES };
