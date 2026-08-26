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
const cockpit = require("./cockpit");

// Un dossier n'a qu'une action pertinente à la fois, et l'ordre des règles est le fond du
// sujet, pas un détail d'implémentation. Chaque branche porte la raison de sa place.
function prochaine({ approvalsDir, pipelinesDir = null, maintenant = Date.now() }) {
  const { dossiers } = cockpit.etat({ approvalsDir, pipelinesDir, maintenant });

  // Rien n'attend : c'est le seul moment où planifier ne piétine personne.
  if (dossiers.length === 0) {
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

module.exports = { prochaine };
