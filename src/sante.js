// Le contrat que produisent les checks de santé, et ce qu'on en déduit.
//
// Ce fichier est écrit AVANT le premier check, et c'est le point important. Les checks
// vivent dans trois langages sur deux machines : PowerShell sur le poste, shell sur le
// NAS, Python pour les agents. Trois producteurs qui inventent chacun leur forme, c'est
// une normalisation rétroactive le jour où on voudra les lire ensemble. Une forme figée
// d'abord, et le stockage qui viendra ensuite n'est plus qu'un lecteur de plus.
//
// Rien ici ne stocke ni n'envoie. La forme, sa validation et le jugement qu'on en tire se
// testent sans fichier ni réseau, comme src/acces.js sépare la décision du socket.
//
// ---------------------------------------------------------------------------
// La forme
//
//   {
//     check:     "nas.smart"      identifiant stable, jamais réutilisé pour autre chose
//     cible:     "nas"            la machine observée : "pc", "nas", "agents"
//     statut:    "OK"             OK | ATTENTION | CRITIQUE | INCONNU
//     valeur:    "healthy"        ce qui a été mesuré, ou null si rien n'a pu l'être
//     seuil:     null             le seuil appliqué, pour que l'alerte soit lisible seule
//     attendue:  true             la cible était-elle censée répondre à cet instant
//     le:        "2026-09-10T..." horodatage ISO, UTC
//   }
//
// `valeur` et `seuil` ne sont pas typés : un pourcentage de disque est un nombre, un
// statut SMART est un mot. Le check a déjà fait la comparaison, ces deux champs ne
// servent qu'à ce qu'un humain lise « 87 % au-delà de 80 % » sans ouvrir autre chose.
//
// ---------------------------------------------------------------------------
// Pourquoi INCONNU, et pourquoi `attendue`
//
// Deux distinctions que trois niveaux d'alerte ne savent pas porter, et dont l'absence
// suffit à faire abandonner tout le dispositif en une semaine.
//
// INCONNU d'abord. Un check qui n'a pas pu mesurer n'est pas un check qui a mesuré
// quelque chose de mauvais. Un SSH qui tombe et un disque qui meurt donneraient la même
// alerte, et on irait chercher un disque en bon état. La panne de l'instrument doit se
// lire comme telle.
//
// `attendue` ensuite. Le poste s'éteint, et c'est normal. Sans ce champ, chaque nuit
// produit une vague de CRITIQUE, on cesse de lire les messages en trois jours, et le
// dispositif ne sert plus à rien précisément quand il aurait servi. Une dimension séparée
// plutôt qu'un cinquième statut : le statut reste le jugement porté sur la mesure,
// `attendue` reste un fait sur la cible, et les deux se croisent sans se confondre.
//
// Le croisement dit tout :
//
//   INCONNU  + attendue=false   le poste dort. Silence, c'était prévu.
//   INCONNU  + attendue=true    on aurait dû mesurer et on n'a pas pu. Alerte.
//   CRITIQUE + attendue quelconque   mesuré, et mauvais. Alerte.
//   ATTENTION                   digest quotidien, jamais d'interruption.
//
// La deuxième ligne est celle qui a de la valeur. Un poste qui disparaît sans que
// personne ne l'ait éteint, sur une machine dont l'historique de BSOD `nvlddmkm.sys` est
// documenté, c'est un plantage. Aujourd'hui rien ne le distingue d'une extinction du
// soir. C'est le meilleur signal du lot et il ne coûte qu'un champ booléen.

const STATUTS = ["OK", "ATTENTION", "CRITIQUE", "INCONNU"];
const CIBLES = ["pc", "nas", "agents"];

// Distincte de Refus et de JsonIllisible, pour la même raison qui les sépare déjà : un
// résultat mal formé n'est ni une décision refusée ni un disque à réparer, c'est un check
// à corriger. Trois langages écrivent ces objets, et une faute de frappe sur un statut
// doit échouer bruyamment à l'entrée plutôt que devenir un INCONNU silencieux qu'on
// prendrait pour une vraie panne d'instrument.
class ResultatInvalide extends Error {}

function valider(brut) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) {
    throw new ResultatInvalide(`résultat de check attendu : un objet, reçu ${typeof brut}`);
  }
  const { check, cible, statut, attendue, le } = brut;

  if (typeof check !== "string" || !check.trim()) {
    throw new ResultatInvalide('champ "check" manquant ou vide');
  }
  if (!CIBLES.includes(cible)) {
    throw new ResultatInvalide(`cible inconnue pour "${check}" : ${JSON.stringify(cible)}, attendu ${CIBLES.join(" | ")}`);
  }
  if (!STATUTS.includes(statut)) {
    throw new ResultatInvalide(`statut inconnu pour "${check}" : ${JSON.stringify(statut)}, attendu ${STATUTS.join(" | ")}`);
  }
  // Booléen strict. Une chaîne "false" venue de PowerShell est vraie en JavaScript, et ce
  // serait exactement le champ à ne pas se tromper : un poste endormi passerait pour un
  // poste qui aurait dû répondre, et réveillerait quelqu'un chaque nuit.
  if (typeof attendue !== "boolean") {
    throw new ResultatInvalide(`champ "attendue" de "${check}" doit être un booléen, reçu ${JSON.stringify(attendue)}`);
  }
  if (typeof le !== "string" || Number.isNaN(Date.parse(le))) {
    throw new ResultatInvalide(`horodatage "le" de "${check}" illisible : ${JSON.stringify(le)}`);
  }
  // Un INCONNU qui porte une valeur se contredit : soit la mesure a eu lieu, soit non.
  if (statut === "INCONNU" && brut.valeur !== null && brut.valeur !== undefined) {
    throw new ResultatInvalide(`"${check}" est INCONNU mais porte une valeur : la mesure a eu lieu ou non, pas les deux`);
  }

  return {
    check: check.trim(),
    cible,
    statut,
    valeur: brut.valeur === undefined ? null : brut.valeur,
    seuil: brut.seuil === undefined ? null : brut.seuil,
    attendue,
    le,
  };
}

// Ce qu'on fait du résultat, séparé de la façon dont on l'envoie. Le transport est déjà
// écrit dans src/alerte.js et n'a aucune raison de connaître ces règles.
function urgence(resultat) {
  const { statut, attendue } = resultat;
  if (statut === "CRITIQUE") return "immediate";
  if (statut === "INCONNU") return attendue ? "immediate" : "silence";
  if (statut === "ATTENTION") return "digest";
  return "silence";
}

// La clé de déduplication, sur le modèle de celle de src/alerte.js : elle change quand
// l'état change, et seulement là. Un service tombé vérifié chaque minute enverrait 1440
// messages par jour ; avec le statut dans la clé, il en envoie un à la chute et un au
// retour. Le retour compte autant que la chute, c'est ce qui permet de refermer un
// incident sans aller vérifier à la main.
function cle(resultat) {
  return `${resultat.check}:${resultat.statut}`;
}

// Le résultat d'un check qui n'a pas pu s'exécuter. Écrit ici plutôt que recopié dans
// chaque script : c'est le cas que les producteurs oublient, et l'oublier fait disparaître
// la panne au lieu de la signaler.
function inconnu({ check, cible, attendue, le = new Date().toISOString() }) {
  return valider({ check, cible, statut: "INCONNU", valeur: null, seuil: null, attendue, le });
}

module.exports = { valider, urgence, cle, inconnu, STATUTS, CIBLES, ResultatInvalide };
