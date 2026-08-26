// Logique du cockpit d'approbation, sans HTTP.
//
// La boîte de réception est un état, pas un transport : le commentaire au-dessus de
// `INBOX` dans stage-handlers le dit, Telegram, mail et cockpit en sont trois lecteurs.
// Ce module est ce lecteur-là. Séparer la logique du serveur permet de tester ce qui
// décide sans monter un socket, et ce qui décide est ce qui touche à l'argent.
//
// Une page qui écrit des décisions d'approbation change de vrais prix. Elle est donc
// écrite comme le reste du dépôt : elle refuse plutôt que de deviner.
const path = require("path");
const { lireJson, ecrireJson } = require("./durable");

const INBOX = "EN-ATTENTE.json";
const HEURE = 3600 * 1000;

// La fraîcheur se mesure depuis la COLLECTE, pas depuis le gel : c'est la donnée qui
// vieillit, pas la mise en forme. Le moteur applique déjà cette règle, et un cockpit qui
// en afficherait une autre mentirait sur ce qui va se passer.
function fraicheur(plan, maxAgeHeures, maintenant) {
  const reference = plan && (plan.collecte_le || plan.gele_le);
  if (!reference) {
    return { reference: null, age_heures: null, max_heures: maxAgeHeures ?? null, verdict: "inconnue" };
  }
  const age = (maintenant - Date.parse(reference)) / HEURE;
  const arrondi = Number(age.toFixed(2));
  if (maxAgeHeures === null || maxAgeHeures === undefined) {
    // Sans maximum déclaré, on montre l'âge et on s'abstient de conclure. Afficher un
    // feu vert qu'on ne peut pas justifier est pire que de n'en afficher aucun.
    return { reference, age_heures: arrondi, max_heures: null, verdict: "inconnue" };
  }
  return {
    reference,
    age_heures: arrondi,
    max_heures: maxAgeHeures,
    verdict: age > maxAgeHeures ? "perime" : "frais",
  };
}

// Le maximum vit dans le pipeline d'application, pas dans la boîte. On va le lire là où
// il est plutôt que d'en recopier une valeur qui divergerait au premier changement.
function maxAgeDuPipeline(pipelinesDir, nom) {
  if (!pipelinesDir || !nom) return null;
  const p = path.join(pipelinesDir, `${path.basename(nom, ".json")}.json`);
  const pipeline = lireJson(p);
  if (!pipeline) return null;
  const charger = (pipeline.stages || []).find((s) => s.type === "charger");
  return charger && charger.max_age_heures !== undefined ? charger.max_age_heures : null;
}

function etat({ approvalsDir, pipelinesDir = null, maintenant = Date.now() }) {
  const boite = lireJson(path.join(approvalsDir, INBOX)) || { en_attente: [] };

  const dossiers = (boite.en_attente || []).map((entree) => {
    const plan = entree.plan_gele ? lireJson(entree.plan_gele) : null;
    const decisions = entree.registre ? lireJson(entree.registre) : null;

    // Une décision déjà prise sur une AUTRE empreinte ne concerne pas ce plan. L'afficher
    // comme si elle s'y appliquait ferait croire à un travail fait qui ne l'est pas.
    const dejaPrises =
      decisions && decisions.plan === entree.empreinte
        ? Object.fromEntries((decisions.decisions || []).map((d) => [d.action_id, d]))
        : {};

    const maxAge = maxAgeDuPipeline(pipelinesDir, entree.appliquer_avec);

    return {
      dossier: entree.dossier,
      empreinte: entree.empreinte,
      depuis: entree.depuis,
      registre: entree.registre,
      plan_gele: entree.plan_gele,
      appliquer_avec: entree.appliquer_avec || null,
      // Le plan gelé est la seule source des actions. La boîte n'en porte que le nombre,
      // délibérément : deux copies d'un même plan finiraient par diverger.
      plan_absent: entree.plan_gele ? !plan : true,
      fraicheur: fraicheur(plan, maxAge, maintenant),
      actions: ((plan && plan.actions) || []).map((a) => ({
        ...a,
        decision: dejaPrises[a.id] ? dejaPrises[a.id].decision : null,
      })),
    };
  });

  return { dossiers, decidables: dossiers.filter((d) => !d.plan_absent).length };
}

class Refus extends Error {}

function enregistrer({ approvalsDir, dossier, empreinte, decisions, par, canal = null, maintenant = Date.now() }) {
  const boite = lireJson(path.join(approvalsDir, INBOX)) || { en_attente: [] };
  const entree = (boite.en_attente || []).find((e) => e.dossier === dossier);

  // Le dossier doit venir de la boîte. Sans ça, le chemin du registre serait dicté par la
  // requête, et une page locale deviendrait une écriture de fichier arbitraire.
  if (!entree) {
    throw new Refus(`aucun dossier "${dossier}" en attente : rien à décider`);
  }

  const plan = entree.plan_gele ? lireJson(entree.plan_gele) : null;
  if (!plan) {
    throw new Refus(`le plan gelé de "${dossier}" est introuvable : décider à l'aveugle est refusé`);
  }

  // L'empreinte lie la décision à CE plan. Si la planification a tourné entre l'affichage
  // de la page et le clic, les montants ne sont plus ceux qu'on a lus.
  if (plan.empreinte !== empreinte) {
    throw new Refus(
      `le plan a changé depuis l'affichage : lu "${empreinte}", en place "${plan.empreinte}". ` +
        `Recharger et relire avant de décider.`
    );
  }

  // Une décision de production porte le nom d'une personne. Un registre d'audit anonyme
  // ne dit pas qui a engagé l'argent.
  //
  // Cette signature n'est plus saisie dans la page depuis l'ouverture au tailnet : le
  // serveur la déduit du canal d'arrivée (voir src/acces.js). Le refus reste ici quand
  // même, parce qu'un appelant qui oublierait de la fournir écrirait sinon un registre
  // anonyme, et que ce module est le dernier à pouvoir dire non avant le disque.
  const signature = String(par || "").trim();
  if (!signature) {
    throw new Refus("décision non signée : indiquer qui décide");
  }

  const connues = new Set((plan.actions || []).map((a) => a.id));
  const propres = [];
  for (const d of decisions || []) {
    if (!connues.has(d.action_id)) {
      throw new Refus(`action "${d.action_id}" absente du plan gelé`);
    }
    if (d.decision !== "approuve" && d.decision !== "refuse") {
      throw new Refus(`décision "${d.decision}" inconnue pour ${d.action_id} : approuve ou refuse`);
    }
    propres.push({
      action_id: d.action_id,
      decision: d.decision,
      par: signature,
      // Le canal dit d'où la décision est venue. "tailnet" est prouvé par WireGuard,
      // "local" veut dire console de la machine et n'est prouvé par rien.
      ...(canal ? { canal: String(canal) } : {}),
      le: new Date(maintenant).toISOString(),
      ...(d.motif ? { motif: String(d.motif) } : {}),
    });
  }

  if (propres.length === 0) {
    throw new Refus("aucune décision à enregistrer");
  }

  const contenu = { plan: empreinte, decisions: propres };
  // Écriture atomique. Une écriture directe interrompue laisse un registre tronqué, et un
  // JSON tronqué dans les approbations tuait ensuite tout ce qui le relit. Ce fichier est
  // la trace de qui a engagé l'argent : il est complet, ou il reste le précédent.
  ecrireJson(entree.registre, contenu);
  return contenu;
}

module.exports = { etat, enregistrer, fraicheur, maxAgeDuPipeline, Refus, INBOX };
