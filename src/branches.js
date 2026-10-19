// Les branches métier du cockpit (`GET /api/natures`) : chaque nature déclarée, les
// pipelines du registre qui la portent et les projets qui la lancent. La navigation, le choix
// de nature d'une mission et la page Branches lisent cette liste au lieu d'un enum.
const fs = require("node:fs");
const path = require("node:path");
const registre = require("agent-orchestrator/src/registre");
const natures = require("./natures");
const planificateur = require("./planificateur");

/**
 * @param {{ projetsDir: string, dossier?: string }} entree
 * @returns {{ natures: Array<{ id: string, libelle: string, description: string, tags: string[], handlers: string[], priorite: number,
 *   regles: "dediees" | "generiques", pipelines: string[], projets: Array<{ id: string, nom: string }>,
 *   discussion: { gabarit: string, competences: string[], versNature: string | null } | null }> }}
 */
function branches({ projetsDir, dossier = registre.dossierRegistre() }) {
  const declarees = natures.naturesDeclarees(dossier);
  const discussions = new Map(natures.discussionsDeclarees(declarees).map((d) => [d.nature, { gabarit: d.gabarit, competences: d.competences, versNature: d.versNature }]));
  /** @type {Map<string, Array<{ id: string, nom: string }>>} */
  const projetsParNature = new Map();
  const ids = fs.existsSync(projetsDir) ? fs.readdirSync(projetsDir).filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)).sort() : [];
  for (const id of ids) {
    const fiche = path.join(projetsDir, id, "project.json");
    if (!fs.existsSync(fiche)) continue;
    let lue;
    try { lue = JSON.parse(fs.readFileSync(fiche, "utf-8")); } catch { continue; }
    const vues = new Set();
    for (const attache of lue.pipelines || []) {
      let nature = null;
      try { nature = planificateur.natureDe(registre.lirePipelineBrut(dossier, attache.extends), declarees); } catch { /* pipeline illisible : le planificateur le signale */ }
      if (!nature || vues.has(nature)) continue;
      vues.add(nature);
      if (!projetsParNature.has(nature)) projetsParNature.set(nature, []);
      projetsParNature.get(nature).push({ id, nom: String(lue.name || id) });
    }
  }
  return {
    natures: declarees.map((n) => ({
      id: n.id, libelle: n.libelle, description: n.description, tags: n.tags, handlers: n.handlers, priorite: n.priorite,
      regles: Object.hasOwn(natures.REGLES, n.id) ? "dediees" : "generiques",
      pipelines: planificateur.pipelinesDuRegistre(n.id, dossier),
      projets: projetsParNature.get(n.id) || [],
      discussion: discussions.get(n.id) || null,
    })),
  };
}

module.exports = { branches };
