// Servir le front buildé (web/dist), et rien d'autre.
//
// Le cockpit sert ses propres fichiers plutôt que de monter un second serveur : c'est lui
// qui tient l'identité, et une page servie à côté serait une page servie sans contrôle.
//
// Deux règles qui valent d'être explicites. Toute requête est résolue puis vérifiée comme
// étant SOUS la racine : sans ça, `/app/../../specs/cockpit.env` sort du dossier et rend
// des secrets. Et un chemin inconnu rend l'index, parce que le front garde son état dans
// le fragment d'URL — mais seulement pour un chemin sans extension, sinon une image
// manquante renverrait du HTML.
const fs = require("fs");
const path = require("path");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * @param {{ racine: string, prefixe?: string, url: string }} demande
 * @returns {{ corps: Buffer, type: string, cache: string }|null}
 */
function ressource({ racine, prefixe = "/app", url }) {
  const chemin = decodeURIComponent(String(url).split("?")[0]);
  const sousPrefixe = prefixe === "/" ? chemin.startsWith("/") : chemin === prefixe || chemin.startsWith(`${prefixe}/`);
  if (!sousPrefixe) return null;

  const relatif = (prefixe === "/" ? chemin.slice(1) : chemin.slice(prefixe.length)).replace(/^\//, "");
  const cible = path.resolve(racine, relatif || "index.html");
  const racineResolue = path.resolve(racine);
  if (cible !== racineResolue && !cible.startsWith(racineResolue + path.sep)) return null;

  let fichier = cible;
  if (!fs.existsSync(fichier) || fs.statSync(fichier).isDirectory()) {
    // Une route du front (sans extension) rend l'index ; un fichier manquant reste manquant.
    if (path.extname(relatif)) return null;
    fichier = path.join(racineResolue, "index.html");
    if (!fs.existsSync(fichier)) return null;
  }

  const ext = path.extname(fichier).toLowerCase();
  return {
    corps: fs.readFileSync(fichier),
    type: TYPES[ext] || "application/octet-stream",
    // Les fichiers d'assets portent une empreinte dans leur nom : ils peuvent être gardés
    // longtemps. L'index, lui, ne doit jamais l'être, sinon un déploiement ne se voit pas.
    cache: /\/assets\//.test(fichier) ? "public, max-age=31536000, immutable" : "no-store",
  };
}

/** Le front est-il buildé ? Sinon, le cockpit le dit au lieu de rendre un 404 muet. */
function present(racine) {
  return fs.existsSync(path.join(racine, "index.html"));
}

module.exports = { ressource, present, TYPES };
