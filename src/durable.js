// Lecture et écriture des fichiers qui SURVIVENT au run : la boîte de réception, les
// plans gelés, les registres de décisions, le ledger d'exécution, le journal d'alertes.
//
// Deux incidents dictent ce module.
//
// L'écriture d'abord. `writeFileSync` sur le fichier de destination le vide avant de le
// remplir. Un processus tué entre les deux laisse un JSON incomplet. Ces fichiers-là
// portent qui a engagé l'argent et ce qui a déjà été exécuté : un ledger tronqué fait
// rejouer un changement de prix déjà appliqué. On écrit donc à côté puis on renomme, ce
// qui est atomique sur un même système de fichiers. Le fichier est le nouveau, ou reste
// l'ancien, jamais un mélange des deux.
//
// La lecture ensuite. Un JSON.parse nu ne dit pas QUEL fichier il n'a pas su lire, alors
// que la boîte, les plans gelés et les registres passent tous par le même appel. Constaté
// en tronquant EN-ATTENTE.json : le message parlait d'une position dans une chaîne sans
// nommer le fichier à réparer, et il fallait lire la trace d'appels pour le deviner.
const fs = require("fs");

// Distincte de Refus : un fichier corrompu n'est pas une décision refusée, c'est une
// panne. Le cockpit répond 500 pour l'une et 409 pour l'autre, et confondre les deux
// ferait croire à un plan périmé là où il y a un disque à réparer.
class JsonIllisible extends Error {}

function lireJson(chemin) {
  if (!fs.existsSync(chemin)) return null;
  try {
    return JSON.parse(fs.readFileSync(chemin, "utf-8"));
  } catch (err) {
    throw new JsonIllisible(`${chemin} est illisible : ${err.message}`);
  }
}

function ecrireJson(chemin, valeur) {
  // Le PID dans le nom du temporaire : deux processus qui écrivent le même fichier ne
  // doivent pas se partager ce tampon, sinon le renommage de l'un publie ce que l'autre
  // était en train d'écrire.
  const temporaire = `${chemin}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaire, JSON.stringify(valeur, null, 2));
    fs.renameSync(temporaire, chemin);
  } catch (err) {
    // Un temporaire abandonné à côté du registre est un déchet qui ressemble à une trace
    // d'audit. On le retire, et on laisse remonter la vraie erreur.
    try {
      fs.unlinkSync(temporaire);
    } catch {}
    throw err;
  }
}

module.exports = { lireJson, ecrireJson, JsonIllisible };
