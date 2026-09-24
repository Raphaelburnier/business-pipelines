#!/usr/bin/env node
//
// Cockpit d'approbation. Une page qui lit la boîte de réception, montre les plans en
// attente et écrit les décisions.
//
// Elle n'écoute que sur 127.0.0.1, et c'est une exigence, plus seulement une précaution.
// Dans un conteneur cette adresse la rendrait injoignable, et la publication loopback de
// l'hôte reprend alors le rôle : ce déplacement se déclare par COCKPIT_CONTENEUR=1 et
// n'arrive jamais par défaut. Le téléphone y accède par Tailscale, qui termine le TLS sur
// un vrai nom et relaie vers localhost. Tailscale n'injecte l'identité de l'appelant que
// si le service reste local : ouvrir l'écoute laisserait n'importe qui sur le réseau
// fabriquer cette identité. Le détail est dans src/acces.js.
//
// Les défenses, et l'incident que chacune vise :
//
//   - écoute loopback seule, plus le relais Tailscale au-dessus. Un cockpit d'approbation
//     joignable sans authentification est une porte ouverte sur le compte marchand. La
//     seule exception est le conteneur, où lier la boucle locale rend le service
//     injoignable même publié, et où la publication loopback de l'hôte porte alors le
//     confinement. Elle se déclare, elle ne se devine pas : voir adresseEcoute() ;
//   - liste blanche d'hôtes. Sans elle, un site visité dans le même navigateur fait
//     pointer un nom vers 127.0.0.1 et parle au serveur à ta place ;
//   - vérification de l'origine et du type de contenu sur les écritures. Tant que la page
//     n'était joignable qu'en loopback, aucun site tiers ne pouvait viser une URL stable.
//     Sous un nom de domaine réel, un formulaire hébergé ailleurs le peut, et un POST de
//     formulaire échappe au contrôle préalable CORS ;
//   - le corps de la requête ne fournit plus que le dossier, l'empreinte et les décisions.
//     Il était étalé tel quel dans l'appel à enregistrer(), donc il pouvait redéfinir
//     approvalsDir et faire écrire le registre n'importe où sur le disque. La liaison
//     loopback était tout ce qui empêchait ça ;
//   - la signature vient du canal, jamais du corps. Un champ texte libre laisse écrire
//     n'importe quel nom, y compris par distraction ;
//   - tout texte affiché est échappé. Les justifications sont écrites par un modèle, et
//     du texte de modèle rendu tel quel dans une page est une injection en attente ;
//   - aucune exception ne sort du gestionnaire. Il est `async`, donc ce qui en sortait
//     devenait une promesse rejetée que Node ne rattrape pas : le processus mourait. Une
//     boîte de réception tronquée tuait le cockpit à chaque requête, et systemd finissait
//     par renoncer à le relancer ;
//   - l'identifiant d'une action voyage dans un attribut de données, pas dans un nom de
//     champ à redécouper. Le découpage supposait qu'un nom de dossier tenait en un
//     segment, et rendait un autre identifiant dès qu'il portait un underscore.
const http = require("http");
const path = require("path");
const { envLoader, EventStore } = require("agent-orchestrator");
const cockpit = require("../src/cockpit");
const acces = require("../src/acces");
const pwa = require("../src/pwa");
const apps = require("../src/apps");
const api = require("../src/api-lecture");
const flux = require("../src/flux");
const statique = require("../src/statique");
const catalogueModeles = require("../src/modeles");

const RACINE = path.resolve(__dirname, "..");

// Le fichier d'abord, l'environnement du processus par-dessus, comme partout ailleurs
// dans le dépôt : un réglage passé à la main pour un essai doit l'emporter sur le fichier.
const ENV = { ...envLoader.load(RACINE, null, path.join(RACINE, "specs", "cockpit.env")), ...process.env };

const APPROVALS = ENV.APPROVALS_DIR || path.join(RACINE, "approvals");
const PIPELINES = path.join(RACINE, "pipelines");
const PORT = Number(ENV.COCKPIT_PORT || 4600);

// Le nom du tailnet est propre à une installation, donc il vient de l'environnement.
// Non renseigné, le cockpit reste exactement ce qu'il était : joignable en local seul.
const TAILNET = (ENV.COCKPIT_TAILNET || "").trim() || null;
const OPERATEUR = (ENV.COCKPIT_OPERATEUR_LOCAL || "").trim() || null;
const PORTEE = { port: PORT, tailnet: TAILNET };

// L'adresse d'écoute est 127.0.0.1 partout sauf dans un conteneur, où lier la boucle
// locale rend le service injoignable même publié. Le raisonnement complet, et le refus
// qui empêche d'ouvrir le cockpit sur le LAN par mégarde, sont dans src/acces.js.
const HOTE = acces.adresseEcoute({
  hote: ENV.COCKPIT_HOTE,
  conteneur: String(ENV.COCKPIT_CONTENEUR || "").trim() === "1",
});

// Surchargeable comme APPROVALS_DIR, et pour la même raison : ce qui n'est pas déplaçable
// ne se teste que contre le dossier réel du dépôt.
const APPS_DIR = ENV.COCKPIT_APPS_DIR || path.join(RACINE, "specs");

// L'event store des runs (§9). Le cockpit le LIT, il n'y écrit jamais : ce qui s'est passé
// est écrit par le moteur et par le maître, au moment où ça arrive.
//
// Ouvert une fois, gardé ouvert : SQLite en WAL laisse lire pendant qu'un run écrit, et
// rouvrir la base à chaque requête coûterait un verrou à chaque rafraîchissement de page.
// Une base absente ou illisible ne tue pas le cockpit — les décisions d'approbation, elles,
// ne dépendent pas d'elle et doivent rester accessibles.
// Le front buildé (web/dist). Absent, la racine le dit : un 404 muet laisserait croire
// à une route cassée alors qu'il manque une commande de build.
const WEB = ENV.COCKPIT_WEB_DIR || path.join(RACINE, "web", "dist");

// Les fiches projet (décision §15, option A) : `projects/<id>/project.json`. La topologie en
// tire les catégories et les projets.
const PROJETS = ENV.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
// Le relevé des modèles poussé par le PC, et les backends joignables par chaque machine.
// Sur le NAS, `claude` vient de la clé du runner ; OmniRoute reste local au worker PC.
const CATALOGUE_MODELES = ENV.COCKPIT_CATALOGUE_MODELES || path.join(RACINE, "etat", "modeles.json");
const VIA_PAR_MACHINE = catalogueModeles.lireViaParMachine(ENV.COCKPIT_VIA_MACHINES);

let magasin = null;
let magasinErreur = null;
function store() {
  if (magasin || magasinErreur) return magasin;
  try {
    magasin = new EventStore(ENV.ORCH_EVENT_STORE || undefined);
  } catch (err) {
    magasinErreur = err.message;
    console.error(`event store indisponible : ${err.message}`);
  }
  return magasin;
}

// Le registre des applications est relu à chaque rendu de page, pas une fois au démarrage.
//
// Lu au démarrage, ajouter une app demandait de redémarrer le conteneur. Une liste de
// liens qui exige une commande pour se mettre à jour est une liste qu'on cesse de tenir,
// et une liste fausse vaut moins que pas de liste.
//
// Ce que la relecture coûte est nul en pratique : un petit JSON, sur une page qu'un humain
// ouvre pour décider, pas une API sollicitée en boucle. Ce qu'elle aurait pu coûter, une
// panne de plus sur la page qui garde l'argent, est déjà écarté plus bas : un registre
// fautif nomme son défaut à la place de la liste et laisse le reste de la page intact.
// Décider ne dépend pas du panneau, et ne doit jamais en dépendre.
function registreApps() {
  try {
    return { apps: apps.charger({ specsDir: APPS_DIR, origines: acces.originesAutorisees(PORTEE) }), erreur: null };
  } catch (err) {
    // Se taire serait pire que dire le défaut : on croirait n'avoir rien déployé.
    return { apps: [], erreur: err.message };
  }
}

// L'apostrophe est échappée elle aussi. Aucun attribut de cette page n'est écrit en
// guillemets simples aujourd'hui, donc rien n'en dépend : c'est le prochain attribut
// écrit ainsi qui deviendrait une injection, et une fonction d'échappement qui ne couvre
// que les cas actuels est un piège posé pour plus tard.
const ech = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Un horodatage ISO n'est pas une information pour quelqu'un qui décide sur un téléphone :
// il faut le lire, le convertir, et le comparer à l'heure qu'il est. Ce qu'on cherchait est
// la durée écoulée, et la page la donne donc directement. L'instant exact reste dans
// l'attribut title, pour qui veut le recouper avec un journal.
//
// Calculer une durée au rendu ne vaut que si la page n'est jamais servie depuis un cache.
// C'est le cas et c'est voulu : la page et son API partent en Cache-Control: no-store, et
// le service worker ne garde rien. Voir src/pwa.js.
function depuis(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return `<span>${ech(iso)}</span>`;

  const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
  let texte;
  if (minutes < 60) texte = `${minutes} min`;
  else if (minutes < 48 * 60) {
    const h = minutes / 60;
    texte = `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  } else texte = `${Math.round(minutes / 1440)} j`;

  return `<span title="${ech(iso)}">${ech(texte)}</span>`;
}

function badge(f) {
  // `max_heures` est lu dans un fichier de pipelines/, pas calculé ici. Il traverse donc
  // la page comme du contenu de fichier, et tout contenu de fichier est échappé.
  if (f.verdict === "perime") {
    return `<span class="b rouge">périmé, ${ech(f.age_heures)} h sur ${ech(f.max_heures)} h</span>`;
  }
  if (f.verdict === "frais") {
    return `<span class="b vert">frais, ${ech(f.age_heures)} h sur ${ech(f.max_heures)} h</span>`;
  }
  const age = f.age_heures === null ? "date absente" : `${f.age_heures} h, maximum non déclaré`;
  return `<span class="b gris">fraîcheur inconnue, ${ech(age)}</span>`;
}

// Le nom du groupe radio est un compteur, et l'identifiant d'action voyage dans un
// attribut de données que le navigateur rend tel quel.
//
// Avant, le nom était `d_${dossier}_${id}` et le script le redécoupait sur les underscores
// en supposant que le dossier tenait en un segment. Un dossier nommé `ajustement_prix`
// renvoyait donc `prix_001` au lieu de `001`. Le cas heureux était un refus « action
// absente du plan gelé » ; le cas malheureux, un identifiant reconstruit qui correspond à
// une AUTRE action réelle, donc un changement de prix approuvé sans avoir été lu. Deux
// dossiers pouvaient aussi produire le même nom de groupe, et cocher dans l'un décochait
// dans l'autre.
// Le texte simple d'un arbitrage produit avant que la synthèse écrive `question` et
// `rapport`. Ces plans-là portaient une valeur structurée, que la page affichait telle quelle
// comme un dictionnaire. On la relit en phrases plutôt que de laisser ces plans illisibles.
function arbitrageEnTexte(a) {
  const v = a.valeur || {};
  const lignes = [];
  if (Array.isArray(v.options) && v.options.length) {
    lignes.push(...v.options.map((o, i) => `Option ${i + 1} : ${o}`));
  }
  if (v.recommandation) lignes.push(`Recommandation : ${v.recommandation}`);
  if (v.pourquoi) lignes.push(`Pourquoi : ${v.pourquoi}`);
  return { question: a.cible || a.id, rapport: lignes };
}

function ligneAction(a, nom, lectureSeule = false) {
  const deja = a.decision ? `<span class="b ${a.decision === "approuve" ? "vert" : "rouge"}">${lectureSeule ? "" : "déjà "}${ech(a.decision === "approuve" ? "approuvé" : "refusé")}</span>` : "";
  const notePosee = a.note ? `<p class="note-posee">Note : ${ech(a.note)}</p>` : "";

  // Un arbitrage se lit comme une question qu'on tranche : la question en gras, le rapport
  // en plus petit, en texte simple. Le reste des actions, les changements de prix, garde
  // son rendu chiffré.
  let corps;
  const lisible = typeof a.question === "string" && a.question.trim()
    ? { question: a.question, rapport: String(a.rapport || "").split(/\n+/) }
    : a.type === "arbitrage"
      ? arbitrageEnTexte(a)
      : null;
  if (lisible) {
    corps = `<div class="tete"><span class="mono id">${ech(a.id)}</span> ${deja}</div>
  <p class="question"><strong>${ech(lisible.question)}</strong></p>
  ${lisible.rapport.filter((l) => l.trim()).map((l) => `<p class="rapport">${ech(l)}</p>`).join("\n  ")}`;
  } else {
    const v = a.valeur || {};
    const delta =
      // Une remise de 100 % depuis un prix de zéro n'existe pas : sans cette garde, la page
      // affichait « Infinity % ».
      typeof v.de === "number" && typeof v.vers === "number" && v.de !== 0
        ? `${v.de} → ${v.vers} ${ech(v.devise || "")} (${(((v.vers - v.de) / v.de) * 100).toFixed(1)} %)`
        : ech(JSON.stringify(v));
    corps = `<div class="tete"><b>${ech(a.id)}</b> <span class="mono">${ech(a.type)}</span> sur <span class="mono">${ech(a.cible)}</span> ${deja}</div>
  <div class="delta">${delta}</div>
  <p>${ech(a.justification || "")}</p>
  ${(a.sources || []).length ? `<div class="src">appuyé sur ${(a.sources || []).map((s) => `<span class="mono">${ech(s)}</span>`).join(", ")}</div>` : ""}`;
  }

  // Un dossier tranché se relit, il ne se redécide pas depuis cette page.
  const choix = lectureSeule
    ? notePosee
    : `${notePosee}
  <div class="choix">
    <label><input type="radio" name="${nom}" value="approuve"> approuver</label>
    <label><input type="radio" name="${nom}" value="refuse"> refuser</label>
    <label><input type="radio" name="${nom}" value="" checked> ne pas décider</label>
  </div>
  <input type="text" class="note" maxlength="500" aria-label="Note pour ${ech(a.id)}" placeholder="Note, facultative, enregistrée avec la décision">`;

  return `<div class="act" data-action="${ech(a.id)}">
  ${corps}
  ${choix}
</div>`;
}

// `rel="noopener"` n'est pas décoratif ici. Sans lui, la page ouverte reçoit une poignée
// sur l'onglet du cockpit et peut le faire naviguer ailleurs, vers une copie qui demande
// de reconfirmer une décision par exemple. Ces applications sortent d'un générateur, donc
// d'un modèle : c'est exactement le genre de page à qui on ne prête pas son onglet.
const LIBELLE_ETAT = {
  "en-ligne": "en ligne",
  "en-cours": "en cours",
  idee: "à venir",
  arrete: "arrêté",
};

// Une tuile par module, et le même gabarit qu'il mène quelque part ou non.
//
// Le lien couvre toute la tuile par un ::after plutôt que d'envelopper son contenu. Deux
// raisons. Une cible large se touche au pouce sans viser, et c'est la moitié de l'intérêt
// d'un écran d'accueil. Et surtout, un <details> de notes ne peut pas vivre à l'intérieur
// d'un <a> : imbriquer deux éléments interactifs casse la navigation au clavier et rend le
// balisage invalide. Le recouvrement garde un seul élément focusable par tuile, et les
// notes repassent au-dessus par un z-index.
//
// Un module sans adresse n'est pas cliquable, et ne fait pas semblant de l'être. Une tuile
// qui ne mène nulle part apprend à se méfier de toutes les autres.
function tuileModule(m) {
  const etiquette = LIBELLE_ETAT[m.etat] || m.etat;
  const titre = m.url
    ? `<a class="lien" href="${ech(m.url)}" target="_blank" rel="noopener noreferrer">${ech(m.nom)}</a>`
    : `<span class="lien">${ech(m.nom)}</span>`;

  const notes = m.notes.length
    ? `<details class="notes"><summary>${m.notes.length} note${m.notes.length > 1 ? "s" : ""}</summary>
    <ul>${m.notes.map((n) => `<li>${ech(n)}</li>`).join("")}</ul></details>`
    : "";

  return `<article class="module module--${ech(m.etat)}">
  <div class="chef"><h3>${titre}</h3><span class="etat">${ech(etiquette)}</span></div>
  ${m.description ? `<p class="desc">${ech(m.description)}</p>` : ""}
  ${m.url ? `<span class="mono adresse">${ech(m.url)}</span>` : ""}
  ${notes}
</article>`;
}

function panneauModules() {
  const { apps: liste, erreur } = registreApps();
  if (erreur) {
    return `<section class="bloc"><h2>Modules</h2>
<p class="rouge">Registre illisible, la liste n'est pas affichée. ${ech(erreur)}</p></section>`;
  }
  if (!liste.length) return "";

  // Les modules en ligne d'abord, puis ceux qu'on construit, puis les pistes, puis ce qui
  // s'est arrêté. L'ordre du fichier ne dit rien ; celui-ci dit ce qui tourne aujourd'hui.
  const rang = { "en-ligne": 0, "en-cours": 1, idee: 2, arrete: 3 };
  const triee = [...liste].sort((a, b) => (rang[a.etat] ?? 9) - (rang[b.etat] ?? 9));

  return `<section class="bloc">
  <h2>Modules <span class="compteur">${triee.length}</span></h2>
  <div class="modules">${triee.map(tuileModule).join("")}</div>
</section>`;
}

// Le bandeau d'accueil. Ce qu'on vient chercher en ouvrant la page, avant tout le reste :
// est-ce qu'une décision attend, et à quel point elle presse.
//
// Quand rien n'attend, il le dit calmement au lieu de disparaître. Une absence de bandeau
// se lit comme une page qui n'a pas fini de charger, pas comme une boîte vide.
function bandeau(etat) {
  // Un dossier tranché reste listé plus bas avec ses décisions, mais il n'attend plus rien.
  const dossiers = (etat.dossiers || []).filter((d) => !d.tranche);
  if (!dossiers.length) {
    return `<div class="bandeau bandeau--calme">
  <span class="pastille"></span>
  <span class="dit">Rien n'attend de décision.</span>
</div>`;
  }

  const actions = dossiers.reduce((n, d) => n + (d.actions ? d.actions.length : 0), 0);
  const perimes = dossiers.filter((d) => d.fraicheur && d.fraicheur.verdict === "perime").length;
  const sansPlan = dossiers.filter((d) => d.plan_absent).length;

  const detail = [
    `${dossiers.length} dossier${dossiers.length > 1 ? "s" : ""}`,
    perimes ? `${perimes} périmé${perimes > 1 ? "s" : ""}` : null,
    sansPlan ? `${sansPlan} sans plan gelé` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `<a class="bandeau bandeau--attente${perimes ? " bandeau--perime" : ""}" href="#decisions">
  <span class="compte">${ech(actions)}</span>
  <span class="dit"><b>action${actions > 1 ? "s" : ""} à décider</b><br><span class="sous">${ech(detail)}</span></span>
  <span class="fleche" aria-hidden="true">&rarr;</span>
</a>`;
}

function page(etat, qui) {
  const corps = etat.dossiers.length
    ? etat.dossiers
        .map(
          (d, di) => `<section data-dossier="${ech(d.dossier)}" data-empreinte="${ech(d.empreinte)}">
  <h2>${ech(d.dossier)} ${d.tranche ? `<span class="b vert">tranché</span>` : badge(d.fraicheur)}</h2>
  <div class="meta">empreinte <span class="mono">${ech(d.empreinte)}</span>, ${d.tranche ? "toutes les actions sont décidées" : `en attente depuis ${depuis(d.depuis)}`}</div>
  ${d.plan_absent ? `<p class="rouge">Plan gelé introuvable. Rien ne peut être décidé sans lui.</p>` : d.actions.map((a, ai) => ligneAction(a, `d${di}-${ai}`, d.tranche)).join("")}
  ${d.fraicheur.verdict === "perime" ? `<p class="rouge">Ce plan est périmé : le pipeline d'application le refusera. Relancer la planification.</p>` : ""}
  ${
    d.reponse_posee
      ? `<p class="posee">Réponse déjà déposée${d.reponse_posee.par ? ` par ${ech(d.reponse_posee.par)}` : ""}, en attente du prochain réveil : « ${ech(d.reponse_posee.consigne)} »</p>`
      : ""
  }
  ${
    d.tranche
      ? ""
      : `<label class="libre" for="rep-d${di}">Réponse libre, si ni approuver ni refuser ne convient</label>
  <textarea class="libre" id="rep-d${di}" rows="3" placeholder="Le plan repart au travail avec cette consigne. Aucune action ne s'exécute."></textarea>`
  }
</section>`
        )
        .join("")
    : `<p class="vide">Rien n'attend de décision.</p>`;

  const canal =
    qui.canal === "tailnet" ? "identité établie par le tailnet" : "console de la machine, identité non prouvée";

  // `lang` compte pour une page en français lue par un lecteur d'écran ou traduite : sans
  // lui, le navigateur devine, et prononce des montants en anglais.
  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Cockpit d'approbation</title>
${pwa.BALISES}
<style>
/* Deux directions artistiques, une par thème, et c'est délibéré.
   Sombre : noir, violet et bleu, des tuiles qui se lisent comme une grille de vignettes.
   Clair : ivoire chaud et terre cuite, un registre plus tranquille, un titrage en serif.
   Le même outil ne se regarde pas pareil à six heures du matin et en plein après-midi.

   Chaque paire texte / fond ci-dessous a été mesurée avant d'être écrite. La plus basse
   est à 5.32:1 en clair et 5.70:1 en sombre, pour un seuil à 4.50:1. Rien n'est laissé à
   l'opacité, qui donne un gris lisible sur blanc et illisible sur noir. */
:root{
  color-scheme:light dark;
  --fond:#EAE4D7;--surface:#FFFDF8;--carte:#FFFFFF;
  --encre:#1E1A14;--encre-douce:#5A5145;--trait:#DDD5C6;
  --accent:#A5422A;--accent-fort:#A5422A;--sur-accent:#FFFFFF;
  --bleu:#2F5C8A;
  --ok:#2F6B3F;--ok-fond:#E4EFE3;
  --danger:#A8362A;--danger-fond:#F8E4E0;
  --alerte:#7D5510;--alerte-fond:#F6EBD5;
  --police-titre:ui-serif,Georgia,"Times New Roman",serif;
  --police-texte:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --graisse-titre:600;--serrage:0;
  --rayon:14px;
  --ombre:0 1px 2px rgba(30,26,20,.06),0 6px 18px rgba(30,26,20,.05);
  --lueur:radial-gradient(1100px 420px at 12% -8%,rgba(165,66,42,.10),transparent 62%),
          radial-gradient(900px 380px at 92% -4%,rgba(47,92,138,.09),transparent 60%);
}
@media (prefers-color-scheme:dark){
  :root{
    --fond:#09090C;--surface:#141419;--carte:#23232E;
    --encre:#F3F3F6;--encre-douce:#A5A5B3;--trait:#3A3A49;
    --accent:#A78BFA;--accent-fort:#7C3AED;--sur-accent:#FFFFFF;
    --bleu:#7DB3F5;
    --ok:#5FD08A;--ok-fond:#12301F;
    --danger:#F58A7C;--danger-fond:#39191A;
    --alerte:#E0B04A;--alerte-fond:#332708;
    /* Le titrage change de famille avec le thème : une grotesque serrée et lourde pour le
       registre sombre, un serif pour le registre clair. C'est ce qui sépare vraiment les
       deux ambiances, plus que les couleurs, et ça ne coûte aucune police à télécharger. */
    --police-titre:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
    --graisse-titre:800;--serrage:-.02em;
    --ombre:0 1px 2px rgba(0,0,0,.5),0 10px 28px rgba(0,0,0,.45);
    --lueur:radial-gradient(1100px 460px at 10% -10%,rgba(124,58,237,.22),transparent 62%),
            radial-gradient(900px 400px at 95% -6%,rgba(37,99,235,.16),transparent 58%);
  }
}
*{box-sizing:border-box}
body{font:16px/1.55 var(--police-texte);color:var(--encre);background:var(--fond);
  background-image:var(--lueur);background-repeat:no-repeat;background-attachment:fixed;
  max-width:56rem;margin:0 auto;
  padding:calc(1.25rem + env(safe-area-inset-top)) calc(1rem + env(safe-area-inset-right)) 0 calc(1rem + env(safe-area-inset-left))}

/* ---- en-tête ---- */
.entete{margin-bottom:1.1rem}
.entete-ligne{display:flex;align-items:center;justify-content:space-between;gap:1rem}
.marque{font-family:var(--police-titre);font-weight:var(--graisse-titre);
  letter-spacing:var(--serrage);font-size:1.7rem;line-height:1.1}
.qui{color:var(--encre-douce);font-size:.875rem;margin:.3rem 0 0}
.retour-graphe{color:var(--accent);font-size:.85rem;font-weight:700;text-decoration:none;
  border:1px solid var(--trait);border-radius:9px;padding:.45rem .7rem;background:var(--surface)}
.retour-graphe:hover{border-color:var(--accent)}
.retour-graphe:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* ---- bandeau d'accueil ---- */
.bandeau{display:flex;align-items:center;gap:1rem;min-height:76px;
  padding:1rem 1.15rem;border-radius:var(--rayon);border:1px solid var(--trait);
  background:var(--surface);box-shadow:var(--ombre);text-decoration:none;color:var(--encre)}
a.bandeau{cursor:pointer}
a.bandeau:hover{border-color:var(--accent)}
a.bandeau:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.bandeau--attente{border-left:4px solid var(--accent)}
.bandeau--perime{border-left-color:var(--danger)}
.bandeau .compte{font-family:var(--police-titre);font-weight:var(--graisse-titre);
  letter-spacing:var(--serrage);font-size:2.4rem;line-height:1;color:var(--accent);
  font-variant-numeric:tabular-nums;flex:none}
.bandeau--perime .compte{color:var(--danger)}
.bandeau .dit{flex:1}
.bandeau .sous{color:var(--encre-douce);font-size:.85rem}
.bandeau .fleche{color:var(--encre-douce);font-size:1.3rem;flex:none}
.bandeau--calme{color:var(--encre-douce)}
.bandeau--calme .pastille{width:.6rem;height:.6rem;border-radius:50%;background:var(--ok);flex:none}

/* ---- blocs ---- */
.bloc{margin:2.2rem 0 0}
h2{font-family:var(--police-titre);font-weight:var(--graisse-titre);letter-spacing:var(--serrage);
  font-size:1.15rem;margin:0 0 .7rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.compteur{font-family:var(--police-texte);font-weight:600;font-size:.72rem;
  color:var(--encre-douce);background:var(--carte);border:1px solid var(--trait);
  border-radius:99px;padding:.05rem .5rem;letter-spacing:0}

/* ---- tuiles de modules ---- */
.modules{display:grid;grid-template-columns:repeat(auto-fill,minmax(15rem,1fr));gap:.75rem}
.module{position:relative;display:flex;flex-direction:column;gap:.3rem;
  background:var(--carte);border:1px solid var(--trait);border-left:3px solid var(--trait);
  border-radius:var(--rayon);padding:.95rem 1rem;box-shadow:var(--ombre);min-height:96px}
.module--en-ligne{border-left-color:var(--ok)}
.module--en-cours{border-left-color:var(--alerte)}
.module--idee{border-left-color:var(--bleu)}
.module--arrete{border-left-color:var(--danger)}
.chef{display:flex;align-items:baseline;justify-content:space-between;gap:.6rem}
.module h3{font-family:var(--police-titre);font-weight:var(--graisse-titre);
  letter-spacing:var(--serrage);font-size:1rem;margin:0;line-height:1.25}
.module .lien{color:var(--encre);text-decoration:none}
/* Le lien couvre la tuile : on touche n'importe où, il n'y a qu'un élément focusable. */
a.lien::after{content:"";position:absolute;inset:0;border-radius:var(--rayon)}
.module:has(a.lien):hover{border-color:var(--accent);border-left-color:var(--accent)}
.module:has(a.lien:focus-visible){outline:2px solid var(--accent);outline-offset:3px}
.module .etat{font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  border-radius:99px;padding:.12rem .55rem;white-space:nowrap;flex:none;
  color:var(--encre-douce);background:var(--fond)}
.module--en-ligne .etat{color:var(--ok);background:var(--ok-fond)}
.module--en-cours .etat{color:var(--alerte);background:var(--alerte-fond)}
.module--idee .etat{color:var(--bleu);background:var(--fond)}
.module--arrete .etat{color:var(--danger);background:var(--danger-fond)}
.module .desc{color:var(--encre-douce);font-size:.875rem;margin:0}
.module .adresse{color:var(--encre-douce);font-size:.72rem;margin-top:auto}
/* Les notes repassent au-dessus du recouvrement du lien, sinon elles ne s'ouvriraient pas. */
.notes{position:relative;z-index:1;margin-top:.2rem}
.notes summary{cursor:pointer;color:var(--accent);font-size:.8rem;
  min-height:32px;display:flex;align-items:center}
.notes summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.notes ul{margin:.2rem 0 0;padding-left:1.1rem;color:var(--encre-douce);font-size:.85rem}
/* Un arbitrage : la question se lit d'abord, le rapport l'explique en plus petit. */
.act .id{color:var(--encre-douce);font-size:.75rem}
.question{margin:.35rem 0 .2rem;font-size:1.02rem;line-height:1.4}
.rapport{margin:.15rem 0;color:var(--encre-douce);font-size:.85rem;line-height:1.5}
.note{display:block;width:100%;box-sizing:border-box;margin-top:.45rem;padding:.4rem .55rem;
  font:inherit;font-size:.85rem;color:var(--encre);background:var(--carte);
  border:1px solid var(--trait);border-radius:6px}
.note:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.note-posee{margin:.3rem 0 0;color:var(--encre-douce);font-size:.85rem;font-style:italic}

/* ---- décisions ---- */
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;word-break:break-all}
.meta{color:var(--encre-douce);font-size:.875rem;margin-bottom:.9rem}
section[data-dossier] h2{margin-top:1.4rem}
/* Réponse libre : volontairement discrète. C'est la sortie de secours, pas le geste
   courant, et un champ texte aussi visible que les boutons inviterait à écrire là où
   une décision franche est attendue. */
label.libre{display:block;margin-top:1rem;color:var(--encre-douce);font-size:.85rem}
textarea.libre{width:100%;box-sizing:border-box;margin-top:.3rem;padding:.6rem;
  font:inherit;font-size:.9rem;color:var(--encre);background:var(--carte);
  border:1px solid var(--trait);border-radius:var(--rayon);resize:vertical}
textarea.libre:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.posee{margin-top:.9rem;padding:.6rem .8rem;border-left:3px solid var(--accent);
  background:var(--carte);color:var(--encre-douce);font-size:.9rem}
.act{background:var(--carte);border:1px solid var(--trait);border-radius:var(--rayon);
  padding:1rem;margin:.75rem 0;box-shadow:var(--ombre)}
.tete{color:var(--encre-douce);font-size:.9rem;margin-bottom:.1rem}
.tete b{color:var(--encre)}
.delta{font-family:var(--police-titre);font-size:1.55rem;font-weight:var(--graisse-titre);
  letter-spacing:var(--serrage);margin:.3rem 0 .5rem;font-variant-numeric:tabular-nums}
.act p{margin:.5rem 0;max-width:62ch}
.src{font-size:.8rem;color:var(--encre-douce)}
.choix{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.9rem}
.choix label{flex:1 1 8.5rem;display:flex;align-items:center;gap:.55rem;min-height:48px;
  padding:.7rem .85rem;border:1px solid var(--trait);border-radius:var(--rayon);
  background:var(--fond);color:var(--encre-douce);font-size:.95rem;cursor:pointer}
.choix label:has(input:checked){color:var(--encre);background:var(--carte);
  border-color:var(--encre-douce);font-weight:650}
.choix label:has(input[value="approuve"]:checked){color:var(--ok);background:var(--ok-fond);border-color:var(--ok)}
.choix label:has(input[value="refuse"]:checked){color:var(--danger);background:var(--danger-fond);border-color:var(--danger)}
.choix label:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.choix input{width:1.15rem;height:1.15rem;margin:0;flex:none;accent-color:currentColor}
.b{display:inline-block;font-size:.72rem;font-weight:700;border:1px solid;border-radius:99px;
  padding:.1rem .6rem;white-space:nowrap;letter-spacing:0}
.b.vert{color:var(--ok);background:var(--ok-fond)}
.b.rouge{color:var(--danger);background:var(--danger-fond)}
.b.gris{color:var(--encre-douce);background:var(--fond)}
.vert{color:var(--ok)}
.rouge{color:var(--danger)}
.gris{color:var(--encre-douce)}
p.rouge{background:var(--danger-fond);border-left:3px solid var(--danger);
  padding:.7rem .9rem;border-radius:0 var(--rayon) var(--rayon) 0;max-width:62ch}
.vide{color:var(--encre-douce);background:var(--carte);border:1px dashed var(--trait);
  border-radius:var(--rayon);padding:1.5rem;margin:.5rem 0;text-align:center}

/* ---- pied ---- */
form.pied{position:sticky;bottom:0;background:var(--fond);margin-top:2rem;
  border-top:1px solid var(--trait);padding:.9rem 0 calc(.9rem + env(safe-area-inset-bottom))}
button{font:inherit;font-family:var(--police-texte);font-weight:650;min-height:48px;
  padding:.8rem 1.2rem;width:100%;max-width:24rem;cursor:pointer;
  border:1px solid var(--accent-fort);border-radius:var(--rayon);
  background:var(--accent-fort);color:var(--sur-accent)}
button:hover{filter:brightness(1.1)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.source{color:var(--encre-douce);font-size:.78rem;margin:1.6rem 0 0}
#msg{margin-top:1rem;white-space:pre-wrap;color:var(--encre-douce);max-width:62ch}

/* Les transitions ne portent que sur des couleurs, jamais sur une taille : rien ne bouge
   sous le doigt entre le moment où on vise et celui où on touche. */
@media (prefers-reduced-motion:no-preference){
  .module,.choix label,button,a.bandeau{transition:border-color .15s,background-color .15s,color .15s}
}
@media (max-width:32rem){
  .modules{grid-template-columns:1fr}
  .bandeau .compte{font-size:2rem}
}
</style>
<header class="entete">
  <div class="entete-ligne"><div class="marque">Décisions</div><a class="retour-graphe" href="/">← Graphe</a></div>
  <p class="qui">Décisions signées <b>${ech(qui.par)}</b>, ${ech(canal)}.</p>
</header>
${bandeau(etat)}
${panneauModules()}
${
  // Pas de section « Décisions » quand il n'y a rien à décider. Le bandeau le dit déjà, et
  // le répéter deux écrans plus bas donnait deux fois la même phrase sur la même page.
  etat.dossiers.length
    ? `<section class="bloc" id="decisions">
  <h2>Décisions</h2>
  ${corps}
</section>`
    : ""
}
${
  etat.dossiers.some((d) => !d.tranche)
    ? `<form class="pied" onsubmit="return envoyer(event)">
  <button>Enregistrer les décisions</button>
</form>`
    : ""
}
<p class="source">Lecture de <span class="mono">${ech(APPROVALS)}</span>. Cette page écrit de vraies décisions.</p>
<div id="msg" role="status" aria-live="polite"></div>
<script>
async function envoyer(e){
  e.preventDefault();
  const msg=document.getElementById('msg');
  const lots=[];
  for(const s of document.querySelectorAll('section[data-dossier]')){
    const decisions=[];
    for(const r of s.querySelectorAll('input[type=radio]:checked')){
      if(!r.value) continue;
      const act=r.closest('.act');
      const champ=act.querySelector('input.note');
      const motif=champ?champ.value.trim():'';
      decisions.push(motif?{action_id:act.dataset.action,decision:r.value,motif}:{action_id:act.dataset.action,decision:r.value});
    }
    const ta=s.querySelector('textarea.libre');
    const reponse=ta?ta.value.trim():'';
    if(decisions.length||reponse) lots.push({dossier:s.dataset.dossier,empreinte:s.dataset.empreinte,decisions,reponse});
  }
  if(!lots.length){msg.textContent='Aucune décision cochée, aucune réponse écrite.';return false}
  const sorties=[];
  for(const lot of lots){
    const r=await fetch('/api/decider',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(lot)});
    const b=await r.json();
    const fait=b.reponse?(b.decisions.length?b.decisions.length+' décision(s) et une réponse écrites':'réponse écrite, le plan repart au travail'):b.decisions.length+' décision(s) écrite(s)';
    sorties.push((r.ok?'✓ ':'✘ ')+lot.dossier+' : '+(b.erreur||fait));
  }
  msg.textContent=sorties.join('\\n');
  if(sorties.every(s=>s.startsWith('✓'))) setTimeout(()=>location.reload(),1200);
  return false;
}
</script>
${pwa.ENREGISTREMENT}`;
}

// Une page qui affiche des prix d'achat, des marges et l'adresse de celui qui décide n'a
// rien à faire dans un cache, ni à être devinée par reniflage de type.
const DURCISSEMENT = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(res, code, corps) {
  const t = JSON.stringify(corps);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(t),
    ...DURCISSEMENT,
  });
  res.end(t);
}

async function traiter(req, res) {
  // Défense contre le rebinding DNS : un nom d'hôte que je n'ai pas prévu ne parle pas au
  // serveur, même s'il résout vers 127.0.0.1.
  if (!acces.hoteAutorise(req.headers, PORTEE)) {
    return json(res, 403, { erreur: "hôte refusé : ce cockpit ne répond qu'en local ou par son tailnet" });
  }

  let qui;
  try {
    qui = acces.identite(req.headers, { tailnet: TAILNET, operateurLocal: OPERATEUR });
  } catch (err) {
    // Refus d'identité avant même de lire la boîte : si on ne sait pas à qui on parle, on
    // ne lui montre pas non plus les prix, les marges et les annonces.
    if (err instanceof cockpit.Refus) return json(res, 403, { erreur: err.message });
    throw err;
  }

  // Manifeste, service worker et icônes. Placés derrière le contrôle d'identité comme
  // le reste : un appelant que le tailnet n'a pas nommé n'installe pas cette application.
  if (req.method === "GET") {
    const r = pwa.ressource(req.url);
    if (r) {
      res.writeHead(200, {
        "Content-Type": r.type,
        "Content-Length": r.corps.length,
        ...DURCISSEMENT,
      });
      return res.end(r.corps);
    }
  }

  // Le cockpit React est l'entrée principale. Les objets ont une vraie route afin qu'un
  // clic dans le graphe ouvre une page partageable ; l'ancien /app reste un alias.
  const chemin = req.url.split("?")[0];
  const routeWeb = chemin === "/" || chemin === "/graph" || chemin === "/agents" ||
    chemin.startsWith("/projects/") || chemin.startsWith("/runs/") || chemin.startsWith("/machines/") ||
    chemin.startsWith("/assets/");
  if (req.method === "GET" && (chemin === "/app" || chemin.startsWith("/app/"))) {
    // La query suit : `/app/?source=maquette` doit rester la maquette après la redirection.
    const suite = req.url.slice(chemin.length);
    res.writeHead(308, { Location: `/${suite}`, ...DURCISSEMENT });
    return res.end();
  }
  if (req.method === "GET" && routeWeb) {
    if (!statique.present(WEB)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", ...DURCISSEMENT });
      return res.end(`Front non construit. Lancer : npm run web:build\nAttendu dans ${WEB}\n`);
    }
    const r = statique.ressource({ racine: WEB, prefixe: "/", url: req.url });
    if (!r) return json(res, 404, { erreur: "fichier inconnu" });
    res.writeHead(200, {
      "Content-Type": r.type,
      "Content-Length": r.corps.length,
      "Cache-Control": r.cache,
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(r.corps);
  }

  if (req.method === "GET" && (chemin === "/decisions" || chemin === "/decisions/")) {
    const html = page(cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }), qui);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...DURCISSEMENT });
    return res.end(html);
  }

  if (req.method === "GET" && req.url === "/api/etat") {
    return json(res, 200, cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }));
  }

  // La première action de phase 5 : lancer un pipeline attaché à un projet. Le cockpit
  // n'exécute rien et ne reçoit aucune clé de modèle ; il dépose une commande signée dans
  // l'event store, que le service runner consomme dans un autre conteneur.
  if (req.method === "POST" && chemin === "/api/runs") {
    if (!acces.origineAutorisee(req.headers, PORTEE)) {
      return json(res, 403, { erreur: "origine refusée : cette écriture ne vient pas du cockpit" });
    }
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return json(res, 415, { erreur: "type de contenu refusé : application/json attendu" });
    }
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });

    let brut = "";
    for await (const morceau of req) {
      brut += morceau;
      if (brut.length > 20_000) return json(res, 413, { erreur: "corps trop gros" });
    }
    try {
      const demande = JSON.parse(brut);
      // Un modèle sans machine capable de le servir échouerait au premier nœud, après la
      // mise en file : autant le refuser ici, avec la raison. Une machine endormie mais
      // munie d'une adresse WoL reste utilisable : le maître la réveillera.
      const etatMachines = api.machines(magasinOuvert);
      for (const llm of Object.values(demande.llmOverrides || {})) {
        if (llm) {
          const disponibilite = catalogueModeles.disponibiliteVia(llm.via, { viaParMachine: VIA_PAR_MACHINE, machines: etatMachines });
          if (!disponibilite.utilisable) {
            return json(res, 400, { erreur: `backend « ${llm.via} » indisponible : ${disponibilite.raison}` });
          }
        }
      }
      const commande = magasinOuvert.creerCommande({
        kind: "run.start",
        payload: {
          projectId: demande.projectId,
          pipelineIndex: demande.pipelineIndex,
          llmOverrides: demande.llmOverrides,
        },
        par: qui.par,
        canal: qui.canal,
      });
      return json(res, 202, { commande: { id: commande.id, statut: commande.status } });
    } catch (err) {
      return json(res, 400, { erreur: err.message });
    }
  }

  // ---- lecture des runs (§10) ----
  //
  // Derrière le même contrôle d'identité que le reste : ce que le cockpit montre d'un run,
  // ce sont des prompts, des coûts et des noms de machines. Les routes et leurs paramètres
  // suivent la spec (décision 7 du 2026-09-18).
  const lecture = req.method === "GET" ? new URL(req.url, "http://cockpit") : null;

  if (lecture && lecture.pathname.startsWith("/api/commands/")) {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    const id = decodeURIComponent(lecture.pathname.slice("/api/commands/".length));
    const commande = magasinOuvert.commande(id);
    if (!commande) return json(res, 404, { erreur: "commande inconnue" });
    return json(res, 200, {
      commande: {
        id: commande.id,
        type: commande.kind,
        statut: commande.status,
        projet: commande.payload.projectId,
        creeeLe: commande.created_at,
        priseLe: commande.taken_at,
        termineeLe: commande.done_at,
        resultat: commande.resultat,
      },
    });
  }

  if (lecture && lecture.pathname.startsWith("/api/runs")) {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    const reste = lecture.pathname.slice("/api/runs".length).replace(/^\//, "");
    if (!reste) {
      const limite = Math.min(Number(lecture.searchParams.get("limite") || 20) || 20, 100);
      try {
        return json(res, 200, {
          runs: api.runs(magasinOuvert, {
            limite,
            projet: lecture.searchParams.get("project"),
            statut: lecture.searchParams.get("status"),
          }),
        });
      } catch (err) {
        // Un statut inconnu est une faute de la requête, pas une panne.
        return json(res, 400, { erreur: err.message });
      }
    }
    const detail = api.run(magasinOuvert, decodeURIComponent(reste.split("/")[0]));
    if (!detail) return json(res, 404, { erreur: "run inconnu" });
    return json(res, 200, detail);
  }

  if (lecture && lecture.pathname === "/api/machines") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    return json(res, 200, { machines: api.machines(magasinOuvert) });
  }

  if (lecture && lecture.pathname === "/api/topology") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    return json(res, 200, api.topologie(magasinOuvert, { projetsDir: PROJETS }));
  }

  if (lecture && lecture.pathname === "/api/usage") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    return json(res, 200, api.usage(magasinOuvert));
  }

  if (lecture && lecture.pathname === "/api/modeles") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    return json(
      res,
      200,
      catalogueModeles.lireCatalogue(CATALOGUE_MODELES, {
        viaParMachine: VIA_PAR_MACHINE,
        machines: api.machines(magasinOuvert),
      })
    );
  }

  // Le flux temps réel. Il ne rend jamais la main tant que le client écoute : la réponse
  // est tenue ouverte, et `flux.ouvrir` la referme quand la connexion tombe.
  if (lecture && lecture.pathname === "/api/stream") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    flux.ouvrir({
      req,
      res,
      store: magasinOuvert,
      runId: lecture.searchParams.get("run"),
      apresId: Number(lecture.searchParams.get("apres") || 0) || 0,
    });
    return undefined;
  }

  if (req.method === "POST" && req.url === "/api/decider") {
    if (!acces.origineAutorisee(req.headers, PORTEE)) {
      return json(res, 403, { erreur: "origine refusée : cette écriture ne vient pas du cockpit" });
    }
    // Un POST de formulaire cross-site ne peut pas porter ce type de contenu sans contrôle
    // préalable CORS, et au contrôle préalable on ne répond pas. Exiger le type ferme la porte.
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return json(res, 415, { erreur: "type de contenu refusé : application/json attendu" });
    }

    let brut = "";
    for await (const morceau of req) {
      brut += morceau;
      if (brut.length > 100_000) return json(res, 413, { erreur: "corps trop gros" });
    }
    let demande;
    try {
      demande = JSON.parse(brut);
    } catch {
      return json(res, 400, { erreur: "corps illisible" });
    }
    try {
      // Champs nommés un par un, jamais étalés. Le corps ne choisit ni où on écrit, ni
      // quand, ni sous quel nom : il ne dit que ce qu'il décide.
      return json(
        res,
        200,
        cockpit.enregistrer({
          approvalsDir: APPROVALS,
          dossier: demande.dossier,
          empreinte: demande.empreinte,
          decisions: demande.decisions,
          reponse: demande.reponse,
          par: qui.par,
          canal: qui.canal,
        })
      );
    } catch (err) {
      // Un refus est une réponse attendue, pas une panne : il se lit dans la page.
      if (err instanceof cockpit.Refus) return json(res, 409, { erreur: err.message });
      return json(res, 500, { erreur: err.message });
    }
  }

  return json(res, 404, { erreur: "route inconnue" });
}

const serveur = http.createServer(async (req, res) => {
  try {
    await traiter(req, res);
  } catch (err) {
    // Un gestionnaire `async` passé à createServer ne remonte pas ses exceptions au
    // serveur : elles deviennent des promesses rejetées que personne ne rattrape, et le
    // défaut de Node est alors de tuer le processus.
    //
    // Constaté en tronquant EN-ATTENTE.json, ce que laisse une écriture interrompue : un
    // seul GET suffisait à faire mourir le cockpit. Le service systemd le relançait, il
    // remourait au rechargement suivant, et après cinq démarrages en dix secondes systemd
    // passait l'unité en échec et cessait de la relancer. L'accès depuis le téléphone
    // finissait donc par exiger de retourner taper une commande sur la machine, ce qu'il
    // était censé éviter.
    //
    // Un fichier illisible doit produire une réponse qui NOMME le fichier, pas un arrêt.
    console.error(err);
    if (!res.headersSent) json(res, 500, { erreur: `panne du cockpit : ${err.message}` });
    else res.end();
  }
});

serveur.listen(PORT, HOTE, () => {
  console.log(`Cockpit sur http://${HOTE}:${PORT}`);
  if (HOTE !== "127.0.0.1") {
    console.log(
      "Écoute hors boucle locale, déclarée par COCKPIT_CONTENEUR=1 : " +
        "ce qui confine le cockpit est désormais la publication loopback de l'hôte."
    );
  }
  if (TAILNET) {
    console.log(`Depuis le téléphone : https://${TAILNET}`);
    console.log("Ce nom ne répond que si le relais est monté : npm run cockpit:tailnet");
  } else {
    console.log("COCKPIT_TAILNET non renseigné : accès local seulement.");
  }
  console.log(`Approbations lues dans ${APPROVALS}`);
  console.log("Ctrl+C pour arrêter.");
});
