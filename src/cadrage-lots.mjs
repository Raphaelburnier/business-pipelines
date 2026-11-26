// Validation et construction communes au front et au serveur : les consignes
// ne doivent pas varier selon le formulaire utilisé pour lancer la même tâche.
export const LIBELLES_PHASE = { 'a-faire': 'À faire', developpement: 'Développement', 'fusion-attendue': 'Fusion attendue', 'recette-attendue': 'Recette attendue', bloque: 'Bloqué', clos: 'Clos' };
const STATUTS_PHASE = { 'a-faire': 'a-faire', developpement: 'en-cours', 'fusion-attendue': 'en-cours', 'recette-attendue': 'en-cours', bloque: 'en-cours', clos: 'fait' };
const texte = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const refuser = (id, message) => { throw new Error(`Cadrage ${id} : ${message}`); };
const uniques = (xs) => [...new Set(xs)];

/** @param {any} etape */
export function validerCadrage(etape) {
  const { id, cadrage: c, suivi: s } = etape;
  if (!c) refuser(id, 'préparation requise, cadrage manquant');
  if (!Number.isInteger(c.revision) || c.revision < 1) refuser(id, 'révision invalide');
  if (!Array.isArray(c.criteres) || c.criteres.length < 1 || c.criteres.length > 30 || !c.criteres.every(x => texte(x, 1000))) refuser(id, '1 à 30 critères non vides de 1 000 caractères maximum sont requis');
  for (const champ of ['directives', 'exclusions']) {
    if (!Array.isArray(c[champ]) || !c[champ].every(x => texte(x, 4000)) || c[champ].join('\n').length > 4000) refuser(id, `${champ} invalides ou trop longues`);
  }
  if (!Array.isArray(c.dependances) || !c.dependances.every(x => texte(x, 80)) || uniques(c.dependances).length !== c.dependances.length) refuser(id, 'dépendances invalides ou dupliquées');
  const cloture = c.cloture || {};
  for (const champ of ['fusionRequise', 'recetteRequise']) if (cloture[champ] !== undefined && typeof cloture[champ] !== 'boolean') refuser(id, `${champ} doit être un booléen`);
  if (cloture.recetteRequise === false && !texte(cloture.motifDispenseRecette, 1000)) refuser(id, 'une dispense de recette doit être motivée');
  if (!s || !Object.hasOwn(STATUTS_PHASE, s.phase) || STATUTS_PHASE[s.phase] !== etape.statut) refuser(id, 'phase et statut incohérents');
  if (s.attente !== null && !texte(s.attente, 2000)) refuser(id, 'raison d’attente invalide');
  if (s.phase === 'bloque' && !texte(s.attente, 2000)) refuser(id, 'blocage sans raison');
  if (!Array.isArray(s.preuves) || !s.preuves.every(p => p && ['verification', 'fusion', 'recette'].includes(p.type) && texte(p.reference, 2000) && p.revision === c.revision && typeof p.commit === 'string' && /^[a-f0-9]{40}$/.test(p.commit))) refuser(id, 'preuve invalide ou rattachée à une autre révision');
  if (s.phase === 'clos') {
    const requis = ['verification', ...(cloture.fusionRequise !== false ? ['fusion'] : []), ...(cloture.recetteRequise !== false ? ['recette'] : [])];
    for (const type of requis) if (!s.preuves.some(p => p.type === type)) refuser(id, `clôture sans preuve de ${type}`);
    if (uniques(s.preuves.filter(p => p.type !== 'fusion').map(p => p.commit)).length !== 1) refuser(id, 'vérification et recette portent sur des commits différents');
  }
  return c;
}

// La revue lit 100 000 octets par fichier : les lots entièrement faits et les défauts
// faits vivent dans une archive pour que seule la feuille du travail ouvert grossisse.
// Les lecteurs voient une seule feuille, lots triés par numéro comme dans le fichier
// d'origine. Une entrée rouverte retourne dans la feuille principale.
/** @param {any} principale @param {any} archive */
export function assemblerFeuille(principale, archive) {
  for (const [nom, f] of [['Feuille', principale], ['Archive', archive]]) {
    if (!Array.isArray(f?.lots) || !Array.isArray(f?.defauts)) throw new Error(`${nom} de route invalide`);
  }
  for (const lot of archive.lots) {
    if (!Array.isArray(lot.etapes) || !lot.etapes.length || lot.etapes.some(e => e.statut !== 'fait')) throw new Error(`Lot ${lot.id} archivé avec une étape non faite : le remettre dans la feuille principale`);
  }
  for (const d of archive.defauts) if (d.statut !== 'fait') throw new Error(`Défaut ${d.id} archivé sans être fait : le remettre dans la feuille principale`);
  const lots = [...principale.lots, ...archive.lots].sort((a, b) => String(a.id).localeCompare(String(b.id), 'fr', { numeric: true }));
  return { lots, defauts: [...principale.defauts, ...archive.defauts] };
}

/** @param {any} feuille */
export function indexerFeuille(feuille) {
  if (!Array.isArray(feuille?.lots) || !Array.isArray(feuille?.defauts)) throw new Error('Feuille de route invalide');
  const index = new Map(), lots = new Set();
  const ajouter = (etape, lot) => {
    if (!texte(etape.id, 80) || index.has(etape.id) || !['a-faire', 'en-cours', 'fait'].includes(etape.statut)) refuser(etape.id, 'identifiant dupliqué ou statut invalide');
    index.set(etape.id, { etape, lot });
  };
  for (const lot of feuille.lots) {
    if (!texte(lot.id, 80) || lots.has(lot.id) || !texte(lot.but, 10000) || !Array.isArray(lot.etapes)) throw new Error('Lot invalide ou dupliqué');
    lots.add(lot.id);
    for (const e of lot.etapes) ajouter(e, lot);
  }
  for (const e of feuille.defauts) ajouter(e, null);
  const visites = new Set(), chemin = new Set();
  const visiter = (id) => {
    if (chemin.has(id)) refuser(id, 'cycle de dépendances');
    if (visites.has(id)) return;
    chemin.add(id);
    const e = index.get(id).etape;
    if (e.cadrage) {
      const c = validerCadrage(e);
      for (const dep of c.dependances) {
        if (!index.has(dep)) refuser(id, `dépendance inconnue : ${dep}`);
        visiter(dep);
      }
    } else if (e.suivi) refuser(id, 'suivi sans cadrage');
    chemin.delete(id); visites.add(id);
  };
  for (const id of index.keys()) visiter(id);
  return index;
}

// Le statut et les preuves peuvent progresser sans changer la mission. En
// revanche, changer ce qui est demandé invalide les plans d'une ancienne révision.
export function validerEvolution(avant, apres) {
  const anciens = indexerFeuille(avant), nouveaux = indexerFeuille(apres);
  const contenu = ({ etape: e, lot }) => JSON.stringify({
    titre: e.titre, detail: e.detail, correctif: e.correctif, fichiers: e.fichiers,
    raisonSensibilite: e.raisonSensibilite, but: lot?.but, prerequis: lot?.prerequis,
    criteres: e.cadrage.criteres, directives: e.cadrage.directives,
    exclusions: e.cadrage.exclusions, dependances: e.cadrage.dependances, cloture: e.cadrage.cloture,
  });
  for (const [id, ancien] of anciens) {
    if (!ancien.etape.cadrage || !nouveaux.has(id)) continue;
    const nouveau = nouveaux.get(id);
    if (!nouveau.etape.cadrage) refuser(id, 'un cadrage existant ne peut pas être retiré');
    const a = ancien.etape.cadrage.revision, b = nouveau.etape.cadrage.revision;
    if (b < a || (contenu(ancien) !== contenu(nouveau) && b <= a)) refuser(id, 'incrémenter la révision après modification du cadrage');
  }
}

// Normalisation idempotente : une mission passe plusieurs fois par le serveur
// avant d'être figée, sans devoir recopier le même cadrage à chaque passage.
const prefixer = (socle, complement = '') => !socle ? complement : complement === socle || complement.startsWith(`${socle}\n\n`) ? complement : `${socle}${complement ? `\n\n${complement}` : ''}`;

/** @param {any} etape @param {any} lot @param {any} spec */
export function construireCadrage(etape, lot, spec) {
  const c = validerCadrage(etape), cloture = c.cloture || {};
  const criteres = uniques([...c.criteres, ...(spec.criteres || [])].map(x => x.trim()));
  if (criteres.length > 30 || !criteres.every(x => texte(x, 1000))) refuser(etape.id, 'critères supplémentaires hors limites');
  const document = [
    `Tâche ${etape.id} · ${etape.titre}`, `But : ${lot?.but || etape.titre}`,
    etape.detail || etape.correctif,
    `Dépendances : ${c.dependances.length ? c.dependances.join(', ') : 'aucune'}.`,
    ...(lot?.prerequis ? [`Contexte des prérequis : ${lot.prerequis}`] : []),
    `Fichiers annoncés : ${Array.isArray(etape.fichiers) ? etape.fichiers.join(', ') : etape.fichiers}.`,
    `Clôture : vérification requise ; fusion ${cloture.fusionRequise !== false ? 'requise' : 'non requise'} ; recette ${cloture.recetteRequise !== false ? 'requise' : `dispensée (${cloture.motifDispenseRecette})`}.`,
  ].join('\n\n');
  const resultat = { ...spec, objectif: `${etape.titre} — ${etape.detail || etape.correctif}`, criteres,
    document: prefixer(document, spec.document), directives: prefixer(c.directives.join('\n'), spec.directives), exclusions: prefixer(c.exclusions.join('\n'), spec.exclusions) };
  for (const [champ, max] of [['objectif', 4000], ['document', 30000], ['directives', 4000], ['exclusions', 4000]]) if (resultat[champ].length > max) refuser(etape.id, `${champ} dépasse ${max} caractères`);
  return resultat;
}

/** @param {any} feuille @param {any[]} catalogue */
export function creerCadreur(feuille, catalogue) {
  const index = indexerFeuille(feuille), admis = new Map();
  for (const o of catalogue) {
    if (admis.has(o.id) || !index.has(o.id)) refuser(o.id, 'catalogue absent de la feuille ou dupliqué');
    const e = index.get(o.id).etape;
    const fichiers = Array.isArray(e.fichiers) ? e.fichiers : e.fichiers.split(/\s*[;,]\s*(?=(?:BP|AO|REG|AS)\s)/);
    if (e.statut !== 'a-faire' || JSON.stringify(o.fichiers) !== JSON.stringify(fichiers) || o.raisonSensibilite !== e.raisonSensibilite || (e.cadrage && o.revision !== e.cadrage.revision)) refuser(o.id, 'catalogue incohérent avec la feuille');
    admis.set(o.id, o);
  }
  const verifier = (id) => {
    // Revalider aussi les données lors de leur utilisation par un outil de suivi.
    indexerFeuille(feuille);
    const cible = index.get(id);
    if (!cible) refuser(id, 'objectif inconnu');
    const e = cible.etape;
    if (e.statut !== 'a-faire') refuser(id, 'objectif déjà en cours ou fait');
    const c = validerCadrage(e);
    for (const dep of c.dependances) if (index.get(dep).etape.statut !== 'fait') refuser(id, `dépendance non terminée : ${dep}`);
    if (!admis.has(id)) refuser(id, 'plan exécutable à préparer avant attribution');
    if (c.revision !== admis.get(id).revision) refuser(id, 'révision périmée');
    return cible;
  };
  return { index, admis, verifier,
    blocage(id) { try { verifier(id); return null; } catch (e) { return e.message; } },
    cadrer(id, spec) { const { etape, lot } = verifier(id); return construireCadrage(etape, lot, spec); },
  };
}
