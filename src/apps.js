// Le registre des applications déployées, tel que le cockpit l'affiche.
//
// Le cockpit sert à décider, et une fois qu'on l'a sur l'écran d'accueil du téléphone, il
// est la porte d'entrée de tout ce qui tourne sur le NAS. Ce module ajoute la liste des
// applications déployées par le générateur de SaaS, en liens vers elles et rien de plus.
//
// Trois refus portent ce fichier, et chacun vise un incident précis.
//
// Le registre est un FICHIER, jamais le démon Docker. Interroger Docker donnerait une
// liste toujours juste, et coûterait le socket monté dans le conteneur, c'est-à-dire root
// sur le NAS accordé à la page joignable depuis le tailnet. Une liste qui vieillit se
// corrige en éditant un fichier ; un socket qu'on a monté ne se démonte jamais vraiment.
//
// Une adresse ne se construit pas, elle se déclare. Le code ne fabrique aucune URL à
// partir d'un port ou d'un nom d'hôte. La différence compte pour l'usage réel : une app
// publiée sur le LAN est injoignable depuis un téléphone qui n'est pas à la maison, et
// c'est un choix de configuration, pas une règle qu'un module peut deviner.
//
// Une app ne partage pas l'origine du cockpit. C'est le refus le moins évident et le plus
// important. Le cockpit contrôle l'en-tête Origin sur les écritures, et c'est ce qui
// empêche une page tierce de poster une décision. Servir une app sous le nom du cockpit
// lui donnerait cette origine, donc le droit d'écrire des décisions. Or ces applications
// sortent d'un générateur : elles sont écrites par un modèle, ce qui est la définition
// même d'une page tierce. Un port distinct suffit à les séparer, et ce module refuse
// plutôt que de laisser passer.
const path = require("path");
const { lireJson } = require("./durable");

const FICHIER = "cockpit-apps.json";

// Deux schémas seulement. `javascript:` dans un href est une exécution dans la page qui
// approuve l'argent, et `data:` un document sous notre propre origine. Le registre n'est
// écrit que par le propriétaire du NAS, mais une liste blanche coûte une ligne et ne
// dépend pas de ce que quelqu'un croira se rappeler en l'éditant dans six mois.
const SCHEMAS = new Set(["http:", "https:"]);

class RegistreInvalide extends Error {}

// `origines` est la liste des origines que le cockpit accepte pour ses propres écritures,
// telle que src/acces.js la calcule. Une app qui atterrit dessus est refusée.
function charger({ specsDir, origines = new Set() } = {}) {
  const chemin = path.join(specsDir, FICHIER);

  // Registre absent, pas de panneau. Comme COCKPIT_TAILNET : une configuration qui manque
  // ramène le cockpit à ce qu'il était, elle ne le dégrade pas et ne le fait pas échouer.
  const brut = lireJson(chemin);
  if (brut === null) return [];

  const liste = Array.isArray(brut) ? brut : brut && brut.apps;
  if (!Array.isArray(liste)) {
    throw new RegistreInvalide(`${chemin} : attendu une liste d'applications sous "apps".`);
  }

  return liste.map((entree, i) => valider(entree, i, chemin, origines));
}

function valider(entree, i, chemin, origines) {
  const ou = `${chemin}, entrée ${i + 1}`;
  if (!entree || typeof entree !== "object") {
    throw new RegistreInvalide(`${ou} : attendu un objet.`);
  }

  const nom = String(entree.nom || "").trim();
  if (!nom) throw new RegistreInvalide(`${ou} : "nom" manquant.`);

  const brute = String(entree.url || "").trim();
  if (!brute) throw new RegistreInvalide(`${ou} (${nom}) : "url" manquante.`);

  let url;
  try {
    url = new URL(brute);
  } catch {
    throw new RegistreInvalide(`${ou} (${nom}) : "${brute}" n'est pas une URL.`);
  }

  if (!SCHEMAS.has(url.protocol)) {
    throw new RegistreInvalide(
      `${ou} (${nom}) : schéma "${url.protocol}" refusé. ` +
        `Seuls http et https sont des liens ; le reste s'exécute dans la page qui approuve l'argent.`
    );
  }

  if (origines.has(url.origin.toLowerCase())) {
    throw new RegistreInvalide(
      `${ou} (${nom}) : "${url.origin}" est une origine que le cockpit accepte pour ses propres ` +
        `écritures. Une application servie là pourrait enregistrer des décisions, et celles-ci ` +
        `sortent d'un générateur. La servir sur un autre port suffit à l'en séparer.`
    );
  }

  return { nom, url: url.href, description: String(entree.description || "").trim() || null };
}

module.exports = { charger, RegistreInvalide, FICHIER };
