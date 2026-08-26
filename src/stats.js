// Statistiques déterministes sur une collecte d'annonces.
//
// Le premier run réel contre eBay a produit un rapport intégralement sourcé, cohérent,
// et faux : l'agent annonçait 46,99 comme médiane de 35 prix là où c'était 45,99. Il
// avait pris la 19e valeur triée au lieu de la 18e. Un off-by-one invisible à la lecture,
// que le gate a validé parce qu'il contrôlait la couverture et les sources, jamais
// l'arithmétique.
//
// La leçon n'est pas « mieux formuler le prompt ». Un nombre calculable ne se demande pas
// à un modèle : il se calcule. L'agent reçoit désormais ces valeurs déjà justes et se
// limite à les interpréter et à les rédiger.

// Les prix sont de l'argent : deux décimales, et un arrondi posé une seule fois ici pour
// que la valeur citée par l'agent et la valeur recalculée par la vérification soient
// comparables au centième près, sans dérive de virgule flottante.
function arrondi(n) {
  return n === null || n === undefined ? null : Math.round(n * 100) / 100;
}

// Convention explicite parce que c'est exactement là que le modèle s'est trompé : n impair
// prend la valeur du milieu, n pair fait la moyenne des deux valeurs centrales.
function mediane(tries) {
  if (tries.length === 0) return null;
  const m = tries.length / 2;
  return tries.length % 2
    ? tries[Math.floor(m)]
    : (tries[m - 1] + tries[m]) / 2;
}

// Quantile par la méthode du plus proche rang, sans interpolation : la valeur rendue est
// toujours un prix réellement affiché par une annonce, ce qui la rend citable.
function quantile(tries, p) {
  if (tries.length === 0) return null;
  const rang = Math.ceil(p * tries.length);
  return tries[Math.min(Math.max(rang, 1), tries.length) - 1];
}

function resumePrix(annonces) {
  const tries = annonces
    .map((a) => a.prix)
    .filter((p) => typeof p === "number" && Number.isFinite(p))
    .sort((a, b) => a - b);

  if (tries.length === 0) {
    return { n: 0, min: null, max: null, mediane: null, moyenne: null, q1: null, q3: null };
  }

  return {
    n: tries.length,
    min: arrondi(tries[0]),
    max: arrondi(tries[tries.length - 1]),
    mediane: arrondi(mediane(tries)),
    // La moyenne est rendue à côté de la médiane, pas à sa place : une seule annonce à
    // 18999 sur 35 tirait la moyenne à 614 pour un marché dont la médiane est à 46.
    moyenne: arrondi(tries.reduce((s, p) => s + p, 0) / tries.length),
    q1: arrondi(quantile(tries, 0.25)),
    q3: arrondi(quantile(tries, 0.75)),
  };
}

function part(n, total) {
  return total === 0 ? null : arrondi((n / total) * 100);
}

// Groupement stable : trié par effectif décroissant, puis par clé alphabétique. Sans le
// second critère, deux états à égalité changeraient d'ordre d'un run à l'autre et une
// réponse citant `par_etat.0` désignerait autre chose sans que rien n'ait bougé.
// Un repère débarrassé des valeurs aberrantes, par la règle de l'écart interquartile.
//
// Ajouté parce qu'un run réel l'a réclamé : le planificateur a refusé d'agir en écrivant
// « je ne peux pas recalculer de médiane filtrée ». Une seule annonce à 18 999 $ sur un
// relevé de 5 tirait la médiane à 337 pour un marché réel autour de 145, et l'agent, à
// qui l'arithmétique a été retirée à raison, n'avait aucun moyen de citer autre chose.
//
// Lui rendre le calcul aurait rouvert le défaut d'origine. On lui rend donc un second
// repère, calculé ici, aussi vérifiable que le premier. Les deux sont publiés côte à
// côte : écarter des points est un choix, pas une correction, et masquer l'écart entre
// les deux mesures cacherait justement ce que ce choix change.
function horsAberrants(annonces) {
  const prix = annonces
    .map((a) => a.prix)
    .filter((p) => typeof p === "number" && Number.isFinite(p))
    .sort((a, b) => a - b);

  if (prix.length < 4) {
    return { regle: "iqr_1.5", applicable: false, seuil_bas: null, seuil_haut: null, exclus: [], prix: resumePrix(annonces) };
  }

  const q1 = quantile(prix, 0.25);
  const q3 = quantile(prix, 0.75);
  const ecart = q3 - q1;
  const bas = q1 - 1.5 * ecart;
  const haut = q3 + 1.5 * ecart;

  const retenues = [];
  const exclus = [];
  for (const a of annonces) {
    if (typeof a.prix !== "number" || !Number.isFinite(a.prix)) continue;
    (a.prix < bas || a.prix > haut ? exclus : retenues).push(a);
  }

  return {
    regle: "iqr_1.5",
    applicable: true,
    seuil_bas: arrondi(bas),
    seuil_haut: arrondi(haut),
    exclus: exclus.map((a) => ({ id: a.id, prix: arrondi(a.prix) })),
    prix: resumePrix(retenues),
  };
}

function grouper(annonces, champ) {
  const paquets = new Map();
  for (const a of annonces) {
    const cle = a[champ];
    if (cle === null || cle === undefined || cle === "") continue;
    if (!paquets.has(cle)) paquets.set(cle, []);
    paquets.get(cle).push(a);
  }
  return [...paquets.entries()]
    .sort((x, y) => y[1].length - x[1].length || String(x[0]).localeCompare(String(y[0])))
    .map(([valeur, lot]) => ({ [champ]: valeur, n: lot.length, prix: resumePrix(lot) }));
}

function statistiques(listings) {
  const annonces = listings.collecte || [];
  const gratuites = annonces.filter((a) => a.livraison_gratuite === true);
  const payantes = annonces.filter((a) => a.livraison_gratuite === false);

  const vendeurs = grouper(annonces, "vendeur").map((v) => {
    const lot = annonces.filter((a) => a.vendeur === v.vendeur);
    const notes = lot.map((a) => a.note_vendeur).filter((x) => x !== null && x !== undefined);
    return { ...v, note: notes.length ? arrondi(Number(notes[0])) : null };
  });

  // Ce que la collecte ne porte PAS est une donnée de premier ordre, pas un détail : c'est
  // ce qui permet à l'agent de déclarer une question sans réponse en la chiffrant, au lieu
  // de conclure « données insuffisantes » sans savoir de combien.
  const absents = {};
  for (const champ of ["prix", "etat", "vendeur", "note_vendeur", "livraison_gratuite"]) {
    absents[champ] = annonces.filter(
      (a) => a[champ] === null || a[champ] === undefined || a[champ] === ""
    ).length;
  }

  return {
    n: annonces.length,
    marketplace: listings.marketplace || null,
    devises: listings.devises || [],
    // Une médiane n'a de sens que sur une seule devise. Le champ vaut null dès qu'il y en
    // a plusieurs, pour que l'agent le voie plutôt que d'additionner des monnaies.
    devise_unique: (listings.devises || []).length === 1 ? listings.devises[0] : null,
    prix: resumePrix(annonces),
    prix_hors_aberrants: horsAberrants(annonces),
    livraison_gratuite: { n: gratuites.length, part_pct: part(gratuites.length, annonces.length), prix: resumePrix(gratuites) },
    livraison_payante: { n: payantes.length, part_pct: part(payantes.length, annonces.length), prix: resumePrix(payantes) },
    par_etat: grouper(annonces, "etat"),
    par_vendeur: vendeurs,
    champs_absents: absents,
  };
}

// Résout "prix.mediane" ou "par_etat.0.prix.min" dans l'objet de statistiques. Rend
// undefined sur un chemin inconnu, ce qui est traité comme une citation invalide et non
// comme une absence de valeur.
function valeurAu(stats, chemin) {
  return String(chemin)
    .split(".")
    .reduce((noeud, segment) => (noeud === null || noeud === undefined ? undefined : noeud[segment]), stats);
}

module.exports = { statistiques, resumePrix, horsAberrants, mediane, quantile, valeurAu, arrondi };
