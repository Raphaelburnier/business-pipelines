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

// Le fichier garde son nom alors que le concept a grandi : il ne liste plus seulement des
// applications en ligne mais des modules, c'est à dire tout ce qui compte comme un
// business. Un site déployé, un site écrit mais pas encore mis en ligne, une piste qui
// n'existe encore que sur le papier. Renommer le fichier casserait le chemin que
// vers-nas.sh a en configuration, pour un gain de vocabulaire : la clé `modules` est donc
// acceptée à côté de `apps`, et c'est l'interface qui parle de modules.
//
// L'état n'est pas décoratif : c'est lui qui décide si la tuile est un lien ou une fiche.
// Une tuile cliquable qui ne mène nulle part apprend à se méfier de toutes les autres.
const ETATS = new Set(["en-ligne", "en-cours", "idee", "arrete"]);

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

  const liste = Array.isArray(brut) ? brut : brut && (brut.modules || brut.apps);
  if (!Array.isArray(liste)) {
    throw new RegistreInvalide(`${chemin} : attendu une liste de modules sous "modules" ou "apps".`);
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

  const notes = Array.isArray(entree.notes)
    ? entree.notes.map((n) => String(n || "").trim()).filter(Boolean)
    : [];

  // Pas d'URL, et c'est le cas normal d'un business qui n'existe pas encore. La tuile est
  // alors une fiche, pas un lien.
  const brute = String(entree.url || "").trim();
  if (!brute) {
    const etat = etatDe(entree, ou, nom, false);
    if (etat === "en-ligne") {
      throw new RegistreInvalide(
        `${ou} (${nom}) : déclaré "en-ligne" sans "url". Un module en ligne se visite, ` +
          `sinon la tuile serait un lien qui ne mène nulle part.`
      );
    }
    return { nom, url: null, etat, description: descriptionDe(entree), notes };
  }

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

  return {
    nom,
    url: url.href,
    etat: etatDe(entree, ou, nom, true),
    description: descriptionDe(entree),
    notes,
  };
}

function descriptionDe(entree) {
  return String(entree.description || "").trim() || null;
}

// L'état se déclare, ou se déduit de la présence d'une URL. Se déduire n'est pas deviner :
// un module qu'on peut visiter est en ligne, un module sans adresse ne l'est pas. Un état
// écrit à la main l'emporte, parce que lui seul distingue « pas encore » de « plus ».
function etatDe(entree, ou, nom, aUneUrl) {
  const brut = String(entree.etat || "").trim().toLowerCase();
  if (!brut) return aUneUrl ? "en-ligne" : "idee";
  if (!ETATS.has(brut)) {
    throw new RegistreInvalide(
      `${ou} (${nom}) : état "${brut}" inconnu. Attendu : ${[...ETATS].join(", ")}.`
    );
  }
  return brut;
}

module.exports = { charger, RegistreInvalide, FICHIER, ETATS };
