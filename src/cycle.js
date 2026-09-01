// Ce qu'un cron doit faire à chaque réveil, et rien d'autre.
//
// Une boucle avec un humain dedans n'avance pas toute seule : elle alterne entre des
// moments où la machine travaille et des moments où elle attend. Un cron qui lancerait
// simplement la planification toutes les heures détruirait la moitié attente, parce que
// replanifier change l'empreinte du plan, et qu'une empreinte qui change invalide la
// décision que l'humain était en train de prendre. Il aurait cliqué sur un montant qui
// n'existe plus, et le cockpit aurait eu raison de le refuser.
//
// Ce module choisit donc UNE action selon l'état de la boîte, et surtout il sait quand ne
// rien faire. Comme le cockpit, la logique est séparée de ce qui l'exécute : décider quoi
// lancer est ce qui dépense, et ce qui dépense se teste sans lancer quoi que ce soit.
const path = require("path");

const cockpit = require("./cockpit");
const durable = require("./durable");

// Combien de temps un constat de stérilité tient le cycle avant qu'il repaie pour vérifier.
//
// Le nombre est un arbitrage, pas une vérité : trop court et la retenue ne retient rien,
// trop long et un marché qui redevient exploitable attend pour rien. Six heures tiennent
// parce que l'autre moitié de cette boucle est humaine et que le stock d'un marché de
// collection ne se renouvelle pas à l'heure. C'est aussi la moitié des douze heures de
// péremption d'un plan : une planification qui reprend après la retenue a encore le temps
// d'être décidée avant que ses données ne meurent.
const RETENUE_HEURES = 6;

// Le marqueur porte le nom du DOSSIER, celui qu'écrit le stage d'approbation. Le cycle le
// reçoit par --plan, et c'est volontairement le seul lien entre les deux : sans nom fourni,
// il n'y a pas de retenue et le cycle planifie comme avant. Une configuration incomplète
// doit dégrader vers le comportement d'origine, jamais vers un cycle qui ne planifie plus
// jamais sans dire pourquoi.
function retenue({ approvalsDir, dossier, maintenant, heures }) {
  if (!dossier) return null;
  const marque = durable.lireJson(path.join(approvalsDir, `${dossier}.retenue.json`));
  if (!marque || !marque.le) return null;
  const age = (maintenant - Date.parse(marque.le)) / 3600000;
  if (!Number.isFinite(age) || age >= heures) return null;
  return { ...marque, depuis: duree(age), reste: duree(heures - age) };
}

// Une durée sous l'heure arrondie à l'heure s'affiche « 0 h », ce qui laisse croire que le
// cycle n'a pas de mémoire du tout. Les minutes disent la même chose sans mentir.
function duree(heures) {
  const minutes = Math.round(heures * 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(heures * 10) / 10} h`;
}

// Un dossier n'a qu'une action pertinente à la fois, et l'ordre des règles est le fond du
// sujet, pas un détail d'implémentation. Chaque branche porte la raison de sa place.
function prochaine({
  approvalsDir,
  pipelinesDir = null,
  dossier: nomDossier = null,
  maintenant = Date.now(),
  retenueHeures = RETENUE_HEURES,
}) {
  const { dossiers } = cockpit.etat({ approvalsDir, pipelinesDir, maintenant });

  // Rien n'attend : c'est le seul moment où planifier ne piétine personne. Encore faut-il
  // que planifier serve à quelque chose.
  if (dossiers.length === 0) {
    // La planification précédente a lu le marché et n'a rien proposé. Recommencer tout de
    // suite repaierait le planificateur pour relire le même marché et conclure la même
    // chose : c'est la dépense la plus discrète de toute la boucle, parce qu'elle ne
    // produit aucune erreur. La règle est celle qui gouverne déjà le plan périmé jamais
    // regardé : en cas de doute, ne pas engager d'argent.
    const tenu = retenue({
      approvalsDir,
      dossier: nomDossier,
      maintenant,
      heures: retenueHeures,
    });
    if (tenu) {
      return {
        action: "attendre",
        dossier: null,
        raison:
          `la planification d'il y a ${tenu.depuis} n'a proposé aucune action : ` +
          `replanifier maintenant repaierait pour le même constat (encore ${tenu.reste})`,
      };
    }
    return { action: "planifier", dossier: null, raison: "aucune décision en attente" };
  }

  // Une boîte qui porte plusieurs dossiers, c'est plusieurs marchés suivis en parallèle.
  // On en traite un par réveil : le suivant sera vu au prochain, et faire tourner deux
  // pipelines à la fois sur la même machine ne ferait qu'entrelacer leurs journaux.
  const d = dossiers[0];

  // La demande ne désigne aucun plan lisible : elle ne peut pas être appliquée, et la
  // laisser en place ferait attendre pour rien. Replanifier la remplace.
  if (d.plan_absent) {
    return { action: "planifier", dossier: d, raison: `plan gelé introuvable pour "${d.dossier}"` };
  }

  const decidees = d.actions.filter((a) => a.decision).length;
  const toutesDecidees = d.actions.length > 0 && decidees === d.actions.length;

  if (d.fraicheur.verdict === "perime") {
    // Périmé sans qu'aucune décision n'ait été prise : personne ne regarde. Replanifier
    // repaierait le planificateur pour produire un plan que personne n'attend, et
    // recommencerait toutes les douze heures indéfiniment. On attend, sans rien dépenser.
    // C'est la même règle que partout ici : en cas de doute, ne pas engager d'argent.
    if (decidees === 0) {
      return {
        action: "attendre",
        dossier: d,
        raison: `plan périmé (${d.fraicheur.age_heures} h) et jamais décidé : replanifier dépenserait pour personne`,
      };
    }
    // Périmé alors qu'une décision a commencé : quelqu'un s'en occupe, il était juste en
    // retard. Sa décision porte sur des données mortes et ne peut pas s'exécuter, donc on
    // lui redonne un plan frais à décider. C'est la règle de péremption du moteur qui
    // s'applique, pas une exception à celle-ci.
    return {
      action: "replanifier",
      dossier: d,
      raison: `décision prise sur un plan périmé (${d.fraicheur.age_heures} h) : les montants portent sur des données mortes`,
    };
  }

  if (toutesDecidees) {
    // Le pipeline d'application se lit dans la demande, jamais deviné : c'est la
    // planification qui sait ce qui applique son plan, et le cockpit lit déjà au même
    // endroit. Sans lui, on refuse plutôt que de choisir à sa place.
    if (!d.appliquer_avec) {
      return {
        action: "attendre",
        dossier: d,
        raison: `"${d.dossier}" est entièrement décidé mais la demande ne dit pas quel pipeline l'applique`,
      };
    }
    return {
      action: "appliquer",
      dossier: d,
      raison: `${decidees} action(s) décidée(s) sur ${d.actions.length}`,
    };
  }

  return {
    action: "attendre",
    dossier: d,
    raison: `${decidees} action(s) décidée(s) sur ${d.actions.length} : la décision est en cours`,
  };
}

module.exports = { prochaine, RETENUE_HEURES };
