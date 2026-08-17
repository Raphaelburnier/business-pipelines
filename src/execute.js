const approval = require("./approval");

// La garde d'exécution. Elle ne sait rien de ce qu'elle exécute : c'est le registre
// d'exécuteurs qui porte le geste, et il n'en existe encore aucun pour une action
// d'écriture réelle. Ce fichier ne contient que ce qui protège.
//
// Quatre propriétés, toutes vérifiées avant qu'une seule action ne parte :
//
//   1. le plan n'a pas bougé depuis l'approbation (TOCTOU, second tour de clé)
//   2. rien ne s'exécute qui ne figure pas dans `executables`
//   3. une action déjà faite n'est jamais refaite (idempotence par ledger)
//   4. un type sans exécuteur s'arrête, il ne se saute pas en silence
//
// La clé du ledger porte l'empreinte du plan ET l'id de l'action. Un id comme
// "prix-001" revient d'un plan à l'autre en désignant autre chose : sans l'empreinte,
// un ajustement légitime serait sauté au motif qu'un homonyme a déjà eu lieu.
function cle(empreinte, id) {
  return `${empreinte}:${id}`;
}

function preparer({ approbation, actions, ledger }) {
  const empreinte = approval.fingerprint(actions);

  // L'approbation vise un plan précis. Si celui qu'on s'apprête à exécuter n'est pas
  // celui-là, aucune décision humaine ne le couvre.
  if (approbation.empreinte !== empreinte) {
    return {
      empreinte,
      bloquant: `le plan a changé depuis l'approbation : approuvé "${approbation.empreinte}", sur le point d'être exécuté "${empreinte}"`,
    };
  }

  if (approbation.verdict !== "APPROUVE") {
    return {
      empreinte,
      bloquant: `l'approbation porte le verdict "${approbation.verdict}", rien n'est exécutable`,
    };
  }

  const autorisees = new Map((approbation.executables || []).map((a) => [a.id, a]));
  const faites = new Set((ledger.executees || []).map((e) => e.cle));

  const aFaire = [];
  const deja = [];
  const ecartees = [];

  // On parcourt `executables`, jamais `actions` : c'est la liste courte, celle que
  // l'humain a validée. Partir du plan complet et filtrer laisserait la porte ouverte
  // à une erreur de filtre, ici il n'y a rien à filtrer.
  for (const action of autorisees.values()) {
    if (faites.has(cle(empreinte, action.id))) deja.push(action);
    else aFaire.push(action);
  }

  // Ce que le plan contient et que l'approbation n'autorise pas. Non exécuté, mais
  // rapporté : un écart silencieux entre plan et exécution rendrait l'audit faux.
  for (const action of actions) {
    if (!autorisees.has(action.id)) ecartees.push(action);
  }

  return { empreinte, bloquant: null, aFaire, deja, ecartees };
}

// Deux natures d'échec, qui ne se traitent pas pareil. Même distinction que
// `isTransientSdkCrash` côté moteur, et pour la même raison : confondre "ce cas-là est
// perdu" et "le système est en panne" fait prendre la mauvaise décision dans les deux
// sens.
//
// FAIL-CLOSED : seul un exécuteur peut déclarer une perte de cible, en posant
// `err.cible = true`. Tout le reste vaut panne et arrête. Ne jamais deviner dans le sens
// permissif : un 500 pris pour une cible morte enchaînerait quarante appels sur une API
// déjà en difficulté.
function natureDe(err) {
  return err && err.cible === true ? "cible" : "systemique";
}

// Un échec de cible (annonce supprimée, 404, 403 sur un objet précis) ne doit pas bloquer
// les trente-neuf autres actions déjà approuvées. Le blocage serait pire que le mal :
// retirer l'action fautive du plan changerait son empreinte, invaliderait l'approbation,
// et obligerait à réapprouver tout le reste à la main.
//
// Une panne, elle, arrête tout de suite. Et une SÉRIE d'échecs de cible arrête aussi :
// une API qui renvoie 404 sur tout parce qu'un identifiant a changé de périmètre
// ressemble à quarante mauvaises cibles, et ce motif-là doit couper.
//
// `consigner` est appelé APRÈS chaque succès, pas à la fin du lot. Un processus tué au
// milieu doit laisser derrière lui la trace exacte de ce qui a eu lieu : consigner en
// bloc ferait rejouer au run suivant des actions déjà passées, ce qui sur un changement
// de prix ou un remboursement est le pire des résultats.
async function executer({
  aFaire,
  executeurs,
  empreinte,
  contexte,
  consigner,
  maxEchecsConsecutifs = 3,
}) {
  const reussies = [];
  const echecs = [];
  let consecutifs = 0;
  let arret = null;

  for (const action of aFaire) {
    const executeur = executeurs[action.type];
    // Un type sans exécuteur est un défaut de configuration, pas une cible perdue :
    // c'est systémique, et le sauter en silence laisserait croire qu'une action
    // approuvée a eu lieu.
    if (!executeur) {
      arret = {
        action: action.id,
        nature: "systemique",
        raison: `aucun exécuteur pour le type "${action.type}" (déclarés : ${Object.keys(executeurs).join(", ") || "aucun"})`,
      };
      break;
    }

    try {
      const resultat = await executeur(action, contexte);
      const trace = {
        cle: cle(empreinte, action.id),
        id: action.id,
        type: action.type,
        resultat: resultat ?? null,
      };
      reussies.push(trace);
      if (consigner) await consigner(trace);
      consecutifs = 0;
    } catch (err) {
      const nature = natureDe(err);
      const echec = { action: action.id, nature, raison: err.message };
      echecs.push(echec);

      if (nature === "systemique") {
        arret = echec;
        break;
      }

      consecutifs += 1;
      if (consecutifs >= maxEchecsConsecutifs) {
        arret = {
          action: action.id,
          nature: "serie",
          raison: `${consecutifs} échecs de cible consécutifs : le motif ressemble à une panne, pas à des cibles isolées`,
        };
        break;
      }
    }
  }

  return { reussies, echecs, arret };
}

module.exports = { preparer, executer, cle, natureDe };
