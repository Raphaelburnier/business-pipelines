// Le canal d'alerte : un lecteur de plus de la boîte, et le premier qui parle sans qu'on
// lui demande.
//
// La boîte est un état, pas un transport, et le cockpit ne règle que la moitié du
// problème : il faut encore ouvrir la page pour apprendre qu'elle a quelque chose à
// montrer. Ce module est ce qui va chercher l'humain. Il ne touche donc ni au moteur ni
// au cockpit, il lit le même fichier qu'eux.
//
// La logique est séparée du transport, comme le cockpit sépare la logique du serveur :
// ce qui décide d'envoyer se teste sans réseau, et ce qui se décide ici est si une
// demande qui engage de l'argent est vue ou oubliée.
const path = require("path");
const cockpit = require("./cockpit");
const durable = require("./durable");

const JOURNAL = "ALERTES.json";

// Registre de transports, comme `SOURCES` pour les marchés. Un transport reçoit un
// message déjà rédigé et le fait sortir, rien de plus : il ne décide jamais s'il faut
// l'envoyer. C'est ce qui rend le choix réversible, et ce qui permettra d'ajouter le push
// de l'application sans toucher à une ligne de ce qui décide.
//
// Le courriel est le canal qui marche partout, sans rien installer sur le téléphone, et
// qui continue de marcher quand le téléphone est neuf, réinitialisé ou hors réseau. Même
// quand le push existera, il restera le filet.
const TRANSPORTS = {
  courriel: async ({ titre, texte }, env) => {
    const manquantes = ["SMTP_HOTE", "SMTP_UTILISATEUR", "SMTP_MOTDEPASSE", "ALERTE_DESTINATAIRE"].filter(
      (k) => !env[k]
    );
    if (manquantes.length > 0) {
      throw new Error(
        `Transport courriel : variables manquantes : ${manquantes.join(", ")}. ` +
          `Voir specs/alerte.env.example.`
      );
    }
    const nodemailer = require("nodemailer");
    const port = Number(env.SMTP_PORT || 587);
    const transporteur = nodemailer.createTransport({
      host: env.SMTP_HOTE,
      port,
      // 465 est le port du TLS implicite, 587 celui de STARTTLS. Déduire du port évite de
      // demander un réglage de plus, et se tromper des deux côtés donne une erreur de
      // connexion immédiate plutôt qu'un envoi en clair silencieux.
      secure: port === 465,
      auth: { user: env.SMTP_UTILISATEUR, pass: env.SMTP_MOTDEPASSE },
    });
    await transporteur.sendMail({
      from: env.ALERTE_EXPEDITEUR || env.SMTP_UTILISATEUR,
      to: env.ALERTE_DESTINATAIRE,
      subject: titre,
      // Texte brut, jamais de HTML. Le cockpit échappe ce qu'il affiche parce qu'il rend
      // une page ; ici on ne demande aucune mise en forme, donc les justifications
      // écrites par un modèle ne peuvent pas devenir de la structure. Un problème qu'on
      // n'a pas à résoudre vaut mieux qu'un problème qu'on résout bien.
      text: texte,
    });
  },
};

function lireJournal(approvalsDir) {
  const p = path.join(approvalsDir, JOURNAL);
  return durable.lireJson(p) || { envoyees: [] };
}

// La clé porte le dossier, l'empreinte du plan ET le verdict de fraîcheur, et c'est ce
// qui borne le bavardage sans rien perdre.
//
// L'empreinte : replanifier produit un autre plan, donc une autre demande, qui mérite son
// alerte. Le verdict : un plan qui périme pendant qu'il attend change d'état, et l'humain
// doit l'apprendre, parce que son approbation ne s'appliquera plus. Deux messages au
// maximum par plan, et un cron qui se réveille toutes les quinze minutes n'en produit
// aucun de plus. Une boîte qui répète se fait taire, exactement comme une boîte pleine de
// faux se fait ignorer.
function cle(dossier) {
  return `${dossier.dossier}:${dossier.empreinte}:${dossier.fraicheur.verdict}`;
}

function depuisQuand(iso, maintenant) {
  if (!iso) return "date inconnue";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "date illisible";
  // Borné à zéro : la machine qui planifie et celle qui lit n'ont pas forcément la même
  // heure, et « depuis -469 min » ferait douter de tout le message plutôt que de la seule
  // horloge.
  const heures = Math.max(0, (maintenant - t) / 3600000);
  if (heures < 1) return `${Math.round(heures * 60)} min`;
  if (heures < 48) return `${heures.toFixed(1)} h`;
  return `${(heures / 24).toFixed(1)} jours`;
}

const MONTREES = 5;

// Le message dit ce qu'il y a à décider et où le décider. Il ne porte AUCUNE décision :
// pas de bouton, pas de lien qui approuve. Un « approuver » atteignable depuis un message
// serait un chemin d'écriture vers l'argent qui contournerait tous les refus du cockpit,
// l'empreinte vérifiée et la signature en tête. Le canal prévient, il n'engage pas.
function message(dossier, { maintenant, cockpitUrl }) {
  const f = dossier.fraicheur;
  const perime = f.verdict === "perime";
  const titre = perime
    ? `Décision PÉRIMÉE : ${dossier.dossier} (${dossier.actions.length} action(s))`
    : `Décision en attente : ${dossier.dossier} (${dossier.actions.length} action(s))`;

  const lignes = [];
  lignes.push(`${dossier.actions.length} action(s), depuis ${depuisQuand(dossier.depuis, maintenant)}`);
  lignes.push(`empreinte ${dossier.empreinte}`);

  if (f.age_heures === null) {
    lignes.push("fraîcheur des données inconnue");
  } else if (f.max_heures === null) {
    lignes.push(`données collectées il y a ${f.age_heures} h (aucun maximum déclaré)`);
  } else {
    lignes.push(
      `données collectées il y a ${f.age_heures} h, maximum ${f.max_heures} h` +
        (perime ? ", ce plan ne peut plus être appliqué" : "")
    );
  }

  lignes.push("");
  for (const action of dossier.actions.slice(0, MONTREES)) {
    // Un arbitrage porte sa question en clair : la montrer, pas une valeur structurée.
    lignes.push(
      action.question
        ? `  ${action.id} : ${action.question}`
        : `  ${action.id} : ${action.type} sur ${action.cible} → ${JSON.stringify(action.valeur)}`
    );
  }
  // Une liste tronquée doit le dire. Un message qui montre cinq actions sur douze sans le
  // signaler laisse approuver douze choses après en avoir lu cinq.
  if (dossier.actions.length > MONTREES) {
    lignes.push(`  ... et ${dossier.actions.length - MONTREES} autre(s), toutes dans le cockpit`);
  }

  lignes.push("");
  if (cockpitUrl) lignes.push(`Décider : ${cockpitUrl}`);
  if (dossier.registre) lignes.push(`ou à la main : ${dossier.registre}`);

  return { titre, texte: lignes.join("\n") };
}

// Ce qui mérite une alerte maintenant : les dossiers en attente dont l'état n'a pas déjà
// été notifié. Aucun envoi ici, aucune écriture : cette fonction est le juge, et un juge
// se teste sans réseau.
function aNotifier({ approvalsDir, pipelinesDir = null, maintenant = Date.now(), cockpitUrl = null }) {
  // Un dossier tranché n'attend plus personne : prévenir à son sujet ferait ignorer les vrais.
  const dossiers = cockpit.etat({ approvalsDir, pipelinesDir, maintenant }).dossiers.filter((d) => !d.tranche);
  const deja = new Set(lireJournal(approvalsDir).envoyees.map((e) => e.cle));

  return dossiers
    .filter((d) => !deja.has(cle(d)))
    .map((d) => ({ dossier: d, cle: cle(d), ...message(d, { maintenant, cockpitUrl }) }));
}

function consigner(approvalsDir, entree) {
  const journal = lireJournal(approvalsDir);
  journal.envoyees.push(entree);
  durable.ecrireJson(path.join(approvalsDir, JOURNAL), journal);
}

// Envoie ce qui mérite de l'être, et consigne CE QUI EST PARTI, jamais ce qui a échoué.
//
// L'ordre compte : consigner avant d'envoyer coûterait moins de code et perdrait
// silencieusement l'alerte au premier réseau coupé, en laissant la demande attendre pour
// toujours. C'est très exactement le défaut que la boîte durable existe pour corriger, et
// le réintroduire dans son notifieur serait une belle ironie.
//
// Un échec de transport n'arrête pas le lot : les autres dossiers partent, et le raté
// repart au prochain réveil puisqu'il n'a pas été consigné. Même distinction que le stage
// `execute` entre une cible perdue et une panne.
async function envoyer({
  approvalsDir,
  pipelinesDir = null,
  maintenant = Date.now(),
  cockpitUrl = null,
  transport,
  env = {},
  dry = false,
}) {
  const candidats = aNotifier({ approvalsDir, pipelinesDir, maintenant, cockpitUrl });
  const envoyees = [];
  const echecs = [];

  for (const candidat of candidats) {
    // Une répétition à blanc ne consigne rien : sinon regarder ce qui partirait
    // empêcherait que ça parte, et la première alerte perdue serait celle qu'on a voulu
    // vérifier.
    if (dry) {
      envoyees.push(candidat);
      continue;
    }
    try {
      await transport({ titre: candidat.titre, texte: candidat.texte }, env);
      consigner(approvalsDir, {
        cle: candidat.cle,
        dossier: candidat.dossier.dossier,
        empreinte: candidat.dossier.empreinte,
        le: new Date(maintenant).toISOString(),
      });
      envoyees.push(candidat);
    } catch (err) {
      echecs.push({ cle: candidat.cle, erreur: err.message });
    }
  }

  return { envoyees, echecs, candidats: candidats.length };
}

// Un transport inconnu, ou aucun transport, est un échec bruyant. Rendre une fonction
// muette ferait un canal d'alerte qui ne prévient de rien et ne se remarque jamais : le
// jour où il compte est celui où on découvre qu'il ne marchait pas. Fail-closed, comme le
// backend facturé par défaut du moteur.
function transportDe(nom) {
  if (!nom) {
    throw new Error(
      `Aucun transport d'alerte configuré. Poser ALERTE_TRANSPORT, ` +
        `connus : ${Object.keys(TRANSPORTS).join(", ")}.`
    );
  }
  const transport = TRANSPORTS[nom];
  if (!transport) {
    throw new Error(
      `Transport d'alerte inconnu : "${nom}". Connus : ${Object.keys(TRANSPORTS).join(", ")}.`
    );
  }
  return transport;
}

module.exports = { aNotifier, envoyer, message, cle, transportDe, lireJournal, TRANSPORTS, JOURNAL };
