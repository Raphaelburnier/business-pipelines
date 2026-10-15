// Les pipelines vus par le cockpit et les noms choisis depuis la page Pipelines.
//
// Un nom vaut pour toutes les versions d'un pipeline (`improve-app`, pas `improve-app@7`) :
// une version publiée du registre ne change plus, le nom affiché si. C'est de l'état, écrit à
// côté de l'event store comme les profils de l'équipe. Sans nom choisi, la page montre le
// titre du registre ; un pipeline lancé hors registre n'a que son identifiant.
const fs = require("fs");
const path = require("path");
const { lireJson, ecrireJson } = require("./durable");

const ID = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
// Un nom libre, mais sans balise ni caractère de contrôle : il finit dans un fichier et une page.
const NOM = /^[\p{L}\p{N}][\p{L}\p{N} '’._()&+/·:,→↔-]{0,59}$/u;

/** `improve-app@7` → `improve-app` ; une référence sans version reste telle quelle. */
const base = (ref) => String(ref || "").split("@")[0];

/** @param {string} fichier */
function lireNoms(fichier) {
  const brut = lireJson(fichier);
  return brut && typeof brut.noms === "object" && brut.noms ? brut.noms : {};
}

/** Les versions publiées d'un pipeline du registre et le titre de la dernière. */
function duRegistre(dossier, id) {
  const racine = path.join(dossier, "pipelines", id);
  let versions = [];
  try {
    versions = fs
      .readdirSync(racine)
      .map((v) => /^v([1-9][0-9]*)$/.exec(v))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);
  } catch {
    return { versions: [], titre: null };
  }
  let titre = null;
  try {
    const brut = JSON.parse(fs.readFileSync(path.join(racine, `v${versions[versions.length - 1]}`, "pipeline.json"), "utf8"));
    titre = typeof brut.title === "string" && brut.title.trim() ? brut.title.trim() : null;
  } catch {
    // Une version illisible n'empêche pas de lister le pipeline.
  }
  return { versions, titre };
}

/**
 * Tous les pipelines connus : ceux du registre, ceux que les fiches projet étendent et ceux
 * qui ont tourné. Chacun dit quels projets s'en servent, ce qui montre sa réutilisation.
 * @param {{ fichier: string, registre: string, fiches: Array<{ id: string, pipelines: Array<{ extends: string }> }>, runs: Array<{ pipeline: string, projet: string|null, debut: string|null }> }} options
 */
function liste({ fichier, registre, fiches, runs }) {
  const noms = lireNoms(fichier);
  const ids = new Set();
  try {
    for (const d of fs.readdirSync(path.join(registre, "pipelines"))) if (ID.test(d)) ids.add(d);
  } catch {
    // Pas de registre monté : les fiches et les runs suffisent.
  }
  for (const f of fiches) for (const p of f.pipelines) ids.add(base(p.extends));
  for (const r of runs) ids.add(base(r.pipeline));

  return [...ids]
    .filter((id) => ID.test(id))
    .map((id) => {
      const { versions, titre } = duRegistre(registre, id);
      const sesRuns = runs.filter((r) => base(r.pipeline) === id);
      const projets = new Set(fiches.filter((f) => f.pipelines.some((p) => base(p.extends) === id)).map((f) => f.id));
      for (const r of sesRuns) if (r.projet) projets.add(r.projet);
      const dernier = sesRuns.map((r) => r.debut).filter(Boolean).sort().pop() ?? null;
      const perso = typeof noms[id]?.nom === "string" ? noms[id].nom : null;
      return { id, nom: perso ?? titre, perso: perso !== null, titreRegistre: titre, versions, projets: [...projets].sort(), runs: sesRuns.length, dernierRun: dernier };
    })
    .sort((a, b) => (b.dernierRun ?? "").localeCompare(a.dernierRun ?? "") || a.id.localeCompare(b.id));
}

/**
 * Nomme un pipeline ; `nom: null` rend le titre du registre. Rend l'erreur, ou `null`.
 * @param {{ fichier: string, pipeline: unknown, nom: unknown, par?: string|null, maintenant?: number }} demande
 */
function renommer({ fichier, pipeline, nom, par = null, maintenant = Date.now() }) {
  if (typeof pipeline !== "string" || !ID.test(base(pipeline))) return "pipeline invalide";
  const id = base(pipeline);
  let propre = null;
  if (typeof nom === "string") {
    propre = nom.trim().replace(/\s+/g, " ");
    if (!NOM.test(propre)) return "nom invalide (60 caractères : lettres, chiffres, espaces et ponctuation simple)";
  } else if (nom !== null) return "nom invalide";
  const noms = { ...lireNoms(fichier) };
  if (propre === null) delete noms[id];
  else noms[id] = { nom: propre, par, le: new Date(maintenant).toISOString() };
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  ecrireJson(fichier, { noms });
  return null;
}

module.exports = { liste, renommer, lireNoms, base };
