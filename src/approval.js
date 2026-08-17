const crypto = require("crypto");

// Empreinte du plan d'actions. Une approbation vaut pour CES actions-là, pas pour le
// stage qui les a produites : c'est ce qui ferme le TOCTOU. Sans ça, un plan approuvé
// pourrait être remplacé par un autre entre la décision et l'exécution, et l'approbation
// couvrirait des actions que personne n'a jamais lues.
//
// L'empreinte porte sur ce qui engage, pas sur la mise en forme : un plan reformaté ne
// doit pas invalider une approbation, un plan dont un montant change doit l'invalider.
function fingerprint(actions) {
  const engageant = actions.map((a) => ({
    id: a.id,
    type: a.type,
    cible: a.cible,
    valeur: a.valeur,
  }));
  return crypto.createHash("sha256").update(JSON.stringify(engageant)).digest("hex").slice(0, 16);
}

// Fail-closed : une action requiert une approbation SAUF si son type est explicitement
// listé comme automatique. L'inverse (lister ce qui demande approbation) oblige à penser
// à tout d'avance, et la première omission est celle qui coûte cher. Même raisonnement
// que le backend facturé par défaut du moteur.
function estAutomatique(action, auto) {
  return (auto || []).includes(action.type);
}

// Rend l'état de chaque action sans jamais rien exécuter ni écrire : cette fonction est
// le juge, elle doit être lisible d'un coup d'oeil et testable seule.
function evaluate({ actions, decisions, auto }) {
  const empreinte = fingerprint(actions);
  const registre = decisions || {};
  const prises = new Map((registre.decisions || []).map((d) => [d.action_id, d]));

  // Une décision prise sur un autre plan ne vaut rien. On le dit avant d'examiner les
  // actions une à une, sinon le message parlerait d'actions en attente là où le vrai
  // problème est que le plan a changé depuis la décision.
  const perimee =
    registre.plan !== undefined && registre.plan !== empreinte
      ? { attendu: empreinte, trouve: registre.plan }
      : null;

  const automatiques = [];
  const approuvees = [];
  const refusees = [];
  const en_attente = [];

  for (const action of actions) {
    if (estAutomatique(action, auto)) {
      automatiques.push(action);
      continue;
    }
    const decision = perimee ? undefined : prises.get(action.id);
    if (!decision) {
      en_attente.push(action);
    } else if (decision.decision === "approuve") {
      approuvees.push(action);
    } else if (decision.decision === "refuse") {
      refusees.push({ ...action, motif: decision.motif || null });
    } else {
      // Ni approuvé ni refusé : traité comme en attente. Un champ mal orthographié ne
      // doit jamais valoir approbation.
      en_attente.push(action);
    }
  }

  // Une décision qui ne correspond à aucune action du plan est signalée sans bloquer :
  // elle ne rend rien exécutable, mais elle trahit une dérive entre le plan et le
  // registre, et se taire là-dessus rendrait le registre progressivement faux.
  const orphelines = (registre.decisions || [])
    .filter((d) => !actions.some((a) => a.id === d.action_id))
    .map((d) => d.action_id);

  return {
    empreinte,
    perimee,
    verdict: perimee || en_attente.length > 0 ? "EN_ATTENTE" : "APPROUVE",
    // Ce que le stage suivant aurait le droit d'exécuter. Une action refusée n'y est
    // pas : un refus est une décision, pas un échec.
    executables: [...automatiques, ...approuvees],
    automatiques,
    approuvees,
    refusees,
    en_attente,
    orphelines,
  };
}

module.exports = { evaluate, fingerprint };
