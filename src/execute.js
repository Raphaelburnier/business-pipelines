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

// Exécute, en s'arrêtant à la première casse. Un échec est plus souvent systémique
// (identifiants expirés, quota, API indisponible) qu'isolé : continuer enchaînerait
// alors quarante échecs, ce qui sur une plateforme marchande se paie en suspension de
// compte. Le ledger rend la reprise indolore, les actions déjà passées étant sautées.
// `consigner` est appelé APRÈS chaque succès, pas à la fin du lot. Un processus tué au
// milieu doit laisser derrière lui la trace exacte de ce qui a eu lieu : consigner en
// bloc ferait rejouer au run suivant des actions déjà passées, ce qui sur un changement
// de prix ou un remboursement est le pire des résultats.
async function executer({ aFaire, executeurs, empreinte, contexte, consigner }) {
  const reussies = [];

  for (const action of aFaire) {
    const executeur = executeurs[action.type];
    // Fail-closed : un type sans exécuteur s'arrête. Le sauter en silence laisserait
    // croire qu'une action approuvée a eu lieu.
    if (!executeur) {
      return {
        reussies,
        echec: {
          action,
          raison: `aucun exécuteur pour le type "${action.type}" (déclarés : ${Object.keys(executeurs).join(", ") || "aucun"})`,
        },
      };
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
    } catch (err) {
      return { reussies, echec: { action, raison: err.message } };
    }
  }

  return { reussies, echec: null };
}

module.exports = { preparer, executer, cle };
