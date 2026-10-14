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
const apiLivraison = require("../src/api-livraison");
const apiPullRequests = require("../src/api-pull-requests");
const flux = require("../src/flux");
const statique = require("../src/statique");
const catalogueModeles = require("../src/modeles");
const apiChat = require("../src/api-chat");
const fluxChat = require("../src/flux-chat");
const conseiller = require("../src/conseiller");
const { creerRouteurConseiller } = require("../src/api-conseiller");
const approbationsRuns = require("../src/approbations-runs");
const equipe = require("../src/equipe");
const missions = require("../src/missions");
const discussions = require("../src/discussions-equipe");
const { creerRouteur: creerRouteurDiscussions } = require("../src/api-discussions-equipe");
const plansMissions = require("../src/api-plans-missions");
const { AIStudioService } = require("../src/ai-studio/service");
const { creerRouteurAIStudio } = require("../src/ai-studio/http");
const { FinanceService } = require("../src/finance/service");
const { MacroSourceService } = require("../src/finance/sources");
const { PriceSourceService } = require("../src/finance/prices");
const { creerRouteurFinance } = require("../src/finance/http");
const { FinanceReportArchive } = require("../src/finance/missions");
const stageHandlersFinance = require("../src/stage-handlers");

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
// La livraison depuis le cockpit (docs/SPEC-livraison.md) : la proposition que le livreur
// écrit à côté de l'event store, et qui a le droit de livrer, tenu sur le NAS seulement.
const LIVRAISON_PROPOSITION = path.join(
  ENV.ORCH_EVENT_STORE ? path.dirname(ENV.ORCH_EVENT_STORE) : path.join(RACINE, "etat"),
  "livraison.json"
);
const LIVRAISON_AUTORISES = ENV.LIVRAISON_AUTORISES_FICHIER || path.join(RACINE, "specs", "livraison.json");
// Les PR GitHub relevées par le publieur (src/pull-requests.js), à côté de la proposition.
const PULL_REQUESTS = path.join(path.dirname(LIVRAISON_PROPOSITION), "pull-requests.json");

// Les fiches projet (décision §15, option A) : `projects/<id>/project.json`. La topologie en
// tire les catégories et les projets.
const PROJETS = ENV.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
// Le relevé des modèles poussé par le PC, et les backends joignables par chaque machine.
// Sur le NAS, `claude` vient de la clé du runner ; OmniRoute reste local au worker PC.
const CATALOGUE_MODELES = ENV.COCKPIT_CATALOGUE_MODELES || path.join(RACINE, "etat", "modeles.json");
const VIA_PAR_MACHINE = catalogueModeles.lireViaParMachine(ENV.COCKPIT_VIA_MACHINES);
// L'équipe d'agents (src/equipe.js) : le roster versionné, et ses affectations écrites à côté
// de l'event store, avec l'état durable.
const EQUIPE_ROSTER = ENV.COCKPIT_EQUIPE_ROSTER || path.join(RACINE, "equipe", "agents.json");
const EQUIPE_AFFECTATIONS = path.join(
  ENV.ORCH_EVENT_STORE ? path.dirname(ENV.ORCH_EVENT_STORE) : path.join(RACINE, "etat"),
  "equipe-affectations.json"
);
const traiterDiscussions = creerRouteurDiscussions({ store, json, corpsJson, projetsDir: PROJETS,
  rosterFichier: EQUIPE_ROSTER, affectationsFichier: EQUIPE_AFFECTATIONS, viaParMachine: VIA_PAR_MACHINE });
// « Demander au cockpit » : Claude via le runner du NAS, dépense plafonnée à part (§11.7).
const CHAT_PLAFOND_USD = Number(ENV.COCKPIT_CHAT_PLAFOND_USD || 10);
const CHAT_MODELE = ENV.COCKPIT_CHAT_MODELE || "sonnet";
// Le conseiller des approbations (src/conseiller.js) : sa base à côté de l'event store, hors
// de celle des approbations, et l'empreinte du jeton de l'agent du PC. Sans empreinte, les
// routes de l'agent répondent 503 et l'écran dit « PC endormi ».
const CONSEILLER_BASE =
  ENV.CONSEILLER_BASE ||
  path.join(ENV.ORCH_EVENT_STORE ? path.dirname(ENV.ORCH_EVENT_STORE) : path.join(RACINE, "etat"), "conseiller.sqlite");
const CONSEILLER_JETON_SHA256 = (ENV.CONSEILLER_JETON_SHA256 || "").trim() || null;
const ERREUR_CONFIGURATION_CONSEILLER = conseiller.erreurConfiguration({
  base: CONSEILLER_BASE,
  approvalsDir: APPROVALS,
  jetonSha256: CONSEILLER_JETON_SHA256,
});
if (ERREUR_CONFIGURATION_CONSEILLER) console.error(`conseiller désactivé : ${ERREUR_CONFIGURATION_CONSEILLER}`);

// Le corps JSON d'une écriture du front, avec les contrôles de POST /api/runs : origine du
// cockpit, JSON seul, 20 ko au plus. Rend `null` après avoir répondu en cas de refus.
async function lireCorpsJson(req, res, maximum, { controleOrigine }) {
  if (controleOrigine && !acces.origineAutorisee(req.headers, PORTEE)) {
    json(res, 403, { erreur: "origine refusée : cette écriture ne vient pas du cockpit" });
    return null;
  }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    json(res, 415, { erreur: "type de contenu refusé : application/json attendu" });
    return null;
  }
  const morceaux = [];
  let taille = 0;
  for await (const morceau of req) {
    const buffer = Buffer.isBuffer(morceau) ? morceau : Buffer.from(morceau);
    taille += buffer.length;
    if (taille > maximum) {
      json(res, 413, { erreur: "corps trop gros" });
      req.resume();
      return null;
    }
    morceaux.push(buffer);
  }
  let corps;
  try {
    corps = JSON.parse(Buffer.concat(morceaux).toString("utf8") || "{}");
  } catch {
    json(res, 400, { erreur: "JSON illisible" });
    return null;
  }
  // `null` signifie « réponse déjà envoyée » pour les appelants : un corps `null` laisserait
  // la requête ouverte sans réponse.
  if (corps === null || typeof corps !== "object" || Array.isArray(corps)) {
    json(res, 400, { erreur: "objet JSON attendu" });
    return null;
  }
  return corps;
}

// Une écriture humaine est protégée contre les requêtes inter-sites. Le bearer de l'agent PC
// est une autre preuve, sans origine navigateur : les deux protocoles ne se mélangent pas.
function corpsJson(req, res, maximum = 20_000) {
  return lireCorpsJson(req, res, maximum, { controleOrigine: true });
}

function corpsAgent(req, res, maximum = 200_000) {
  if (req.headers.origin && !acces.origineAutorisee(req.headers, PORTEE)) {
    json(res, 403, { erreur: "origine refusée pour l'agent" });
    return Promise.resolve(null);
  }
  return lireCorpsJson(req, res, maximum, { controleOrigine: false });
}

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

// AI Studio partage le serveur, l'identité Tailscale et les contrôles d'origine du
// Cockpit. Seul ce service backend parle à ComfyUI ; le navigateur ne voit jamais son URL.
let AI_STUDIO = null;
let erreurAIStudio = null;
try {
  AI_STUDIO = new AIStudioService({
    storageRoot: ENV.AI_STUDIO_STORAGE_ROOT || path.join(RACINE, "ai-studio-data"),
    archiveRoot: ENV.AI_STUDIO_ARCHIVE_ROOT || path.join(RACINE, "ai-studio-archive"),
    modelsRoot: ENV.AI_STUDIO_MODELS_ROOT || path.join(RACINE, "ai-studio-models"),
    templatesDir: path.join(RACINE, "workflows", "ai-studio"),
    comfyuiUrl: ENV.COMFYUI_URL || "http://comfyui:8188",
    maxConcurrent: Number(ENV.AI_STUDIO_MAX_CONCURRENT_JOBS || 2),
  });
} catch (err) {
  erreurAIStudio = err.message;
  console.error(`AI Studio indisponible : ${err.message}`);
}
const traiterAIStudioActif = AI_STUDIO
  ? creerRouteurAIStudio({ service: AI_STUDIO, json, corpsJson, durcissement: DURCISSEMENT,
    origineAutorisee: (entetes) => acces.origineAutorisee(entetes, PORTEE) })
  : null;
async function traiterAIStudio(req, res) {
  if (!req.url.startsWith("/api/ai-studio")) return false;
  if (!traiterAIStudioActif) {
    json(res, 503, { erreur: `stockage AI Studio indisponible : ${erreurAIStudio}` });
    return true;
  }
  return traiterAIStudioActif(req, res);
}

// Finance partage les contrôles d'identité et d'origine du serveur principal.
let traiterFinanceActif = null;
let rapportsFinance = null;
let serviceFinance = null;
const stockageFinance = ENV.FINANCE_STORAGE_ROOT || path.join(RACINE, "etat", "finance");
let sourcesMacro = null;
let sourcesCours = null;
try {
  sourcesMacro = new MacroSourceService({ storageRoot: stockageFinance });
} catch (err) {
  console.error(`Sources macro indisponibles : ${err.message}`);
}
try {
  sourcesCours = new PriceSourceService({ storageRoot: stockageFinance, token: ENV.EODHD_API_TOKEN });
} catch (err) {
  console.error(`Sources cours indisponibles : ${err.message}`);
}
try {
  rapportsFinance = new FinanceReportArchive({ root: ENV.FINANCE_REPORTS_ROOT || path.join(stockageFinance, "reports") });
  serviceFinance = new FinanceService({ storageRoot: stockageFinance });
  traiterFinanceActif = creerRouteurFinance({
    service: serviceFinance,
    macro: sourcesMacro,
    prices: sourcesCours,
    reports: rapportsFinance,
    json, corpsJson, durcissement: DURCISSEMENT,
  });
} catch (err) {
  console.error(`Finance indisponible : ${err.message}`);
}
const financeDisponible = (handler, machine) =>
  machine === "nas" &&
  ["finance-snapshot", "finance-report-validate", "finance-report-publish"].includes(handler) &&
  typeof stageHandlersFinance.handlers[handler] === "function" &&
  rapportsFinance !== null &&
  serviceFinance !== null &&
  traiterFinanceActif !== null &&
  sourcesMacro !== null &&
  sourcesCours !== null;
async function traiterFinance(req, res) {
  if (!/^\/api\/finance(?:\/|\?|$)/.test(req.url)) return false;
  if (traiterFinanceActif) return traiterFinanceActif(req, res);
  json(res, 503, { erreur: "Stockage Finance indisponible. Consulter les logs serveur." });
  return true;
}

// La boîte métier et les approbations des runs du moteur (phase 5), dans une seule liste :
// la page, le conseiller et la note du vault les traitent pareil. Sans event store, ou avec
// un moteur antérieur à `approbationsOuvertes`, la boîte reste lisible seule.
function etatApprobations() {
  const etat = cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES });
  const s = store();
  if (!s || typeof s.approbationsOuvertes !== "function") return etat;
  try {
    const runs = approbationsRuns.dossiers(s);
    return { dossiers: [...etat.dossiers, ...runs], decidables: etat.decidables + runs.filter((d) => !d.tranche).length };
  } catch (err) {
    console.error(`approbations des runs illisibles : ${err.message}`);
    return etat;
  }
}
const traiterConseiller = creerRouteurConseiller({
  base: CONSEILLER_BASE,
  jetonSha256: CONSEILLER_JETON_SHA256,
  json,
  corpsJson,
  corpsAgent,
  erreurConfiguration: ERREUR_CONFIGURATION_CONSEILLER,
  etatApprobations,
  // Les derniers runs, contexte des avis. Sans event store, le conseiller travaille sans.
  runs: () => {
    const s = store();
    return s ? api.runs(s, { limite: 8 }) : [];
  },
});

// L'état des approbations avec ce que le conseiller en dit. Une base du conseiller illisible
// ne doit jamais empêcher de décider : l'écran perd les avis, pas les boutons.
function approbationsAvecConseil() {
  const etat = etatApprobations();
  if (ERREUR_CONFIGURATION_CONSEILLER) {
    return {
      etat,
      conseiller: { disponible: false, vuLe: null, modele: null, vault: null, erreur: ERREUR_CONFIGURATION_CONSEILLER },
    };
  }
  try {
    return conseiller.enrichir(CONSEILLER_BASE, etat);
  } catch (err) {
    console.error(`conseiller illisible : ${err.message}`);
    return { etat, conseiller: { disponible: false, vuLe: null, modele: null, vault: null, erreur: err.message } };
  }
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
  // `/decisions` est une page du front depuis la livraison (carte Livraison + lien vers les
  // approbations) ; l'ancienne page d'approbations est servie sous `/decisions/pipelines`.
  const routeWeb = chemin === "/" || chemin === "/graph" || chemin === "/agents" ||
    chemin === "/finance" || chemin === "/finance/" ||
    chemin === "/missions" || chemin.startsWith("/missions/") ||
    chemin === "/marketing" || chemin.startsWith("/marketing/") ||
    chemin === "/systeme" || chemin === "/systeme/" ||
    chemin === "/decisions" || chemin === "/decisions/" ||
    chemin === "/decisions/pipelines" || chemin === "/decisions/pipelines/" ||
    chemin === "/demander" || chemin.startsWith("/demander/") ||
    chemin === "/ai-studio" || chemin.startsWith("/ai-studio/") ||
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

  // Les approbations des pipelines (/decisions/pipelines, page du front) : qui signe, la
  // boîte, et les modules. Un registre de modules fautif se nomme sans empêcher de décider :
  // le panneau est un confort, décider est la raison d'être de la page.
  if (req.method === "GET" && chemin === "/api/approbations") {
    const { etat, conseiller: agent } = approbationsAvecConseil();
    return json(res, 200, {
      qui: { par: qui.par, nom: qui.nom ?? null, canal: qui.canal },
      etat,
      conseiller: agent,
      modules: registreApps(),
    });
  }

  // Trancher l'approbation d'un run : une commande signée pour le runner, qui décide puis
  // reprend le run. Le cockpit n'écrit pas l'historique du moteur.
  const approbationRun = req.method === "POST" && chemin.match(/^\/api\/approbations-runs\/([0-9a-f-]{36})$/);
  if (approbationRun) {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    const demande = await corpsJson(req, res);
    if (demande === null) return undefined;
    try {
      const envoi = approbationsRuns.demander(magasinOuvert, { approbationId: approbationRun[1], demande, qui });
      // Une consigne renvoie le run au travail : rien n'est validé, pas de note au vault.
      if (envoi.decision !== "oriented") {
        try {
          conseiller.noter(CONSEILLER_BASE, approbationsRuns.dossierTranche(magasinOuvert, { ...envoi, qui }));
        } catch (err) {
          console.error(`note du vault non mise en file : ${err.message}`);
        }
      }
      return json(res, 202, { commande: { id: envoi.commande.id, statut: envoi.commande.status } });
    } catch (err) {
      if (err instanceof approbationsRuns.RefusApprobationRun) return json(res, err.code, { erreur: err.message });
      throw err;
    }
  }

  // Le conseiller : l'agent du PC (jeton) et le fil de chaque dossier (identité tailnet).
  if (chemin.startsWith("/api/conseiller/")) {
    if (await traiterConseiller(req, res, chemin, qui)) return undefined;
  }

  // ---- PR GitHub : relevé du publieur, fusion par commande signée ----
  if (chemin === "/api/pull-requests" || chemin === "/api/pull-requests/fusions" || chemin === "/api/pull-requests/ci-relances") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    const contexte = { store: magasinOuvert, instantaneFichier: PULL_REQUESTS, autorisesFichier: LIVRAISON_AUTORISES, qui };
    if (req.method === "GET" && chemin === "/api/pull-requests") return json(res, 200, apiPullRequests.etat(contexte));
    if (req.method === "POST" && chemin === "/api/pull-requests/fusions") {
      const demande = await corpsJson(req, res);
      if (demande === null) return undefined;
      try {
        const commande = apiPullRequests.demander({ ...contexte, demande });
        return json(res, 202, { commande: { id: commande.id, statut: commande.status } });
      } catch (err) {
        if (err instanceof apiPullRequests.RefusPullRequest) return json(res, err.code, { erreur: err.message });
        throw err;
      }
    }
    if (req.method === "POST" && chemin === "/api/pull-requests/ci-relances") {
      const demande = await corpsJson(req, res);
      if (demande === null) return undefined;
      try {
        const commande = apiPullRequests.demanderRelanceCI({ ...contexte, demande });
        return json(res, 202, { commande: { id: commande.id, statut: commande.status } });
      } catch (err) {
        if (err instanceof apiPullRequests.RefusPullRequest) return json(res, err.code, { erreur: err.message });
        throw err;
      }
    }
    return json(res, 405, { erreur: "méthode non prise en charge" });
  }

  // ---- livraison du cockpit (docs/SPEC-livraison.md, §6) ----
  if (req.method === "GET" && chemin === "/api/livraison") {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    return json(
      res,
      200,
      apiLivraison.etat({ store: magasinOuvert, propositionFichier: LIVRAISON_PROPOSITION, autorisesFichier: LIVRAISON_AUTORISES, qui })
    );
  }

  // Le cockpit ne livre rien : il dépose une commande signée que le service livreur prend.
  // Mêmes contrôles d'écriture que pour un run, plus l'identité tailnet autorisée.
  if (req.method === "POST" && chemin === "/api/livraisons") {
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
    let demande;
    try {
      demande = JSON.parse(brut);
    } catch {
      return json(res, 400, { erreur: "JSON illisible" });
    }
    try {
      const commande = apiLivraison.demander({
        store: magasinOuvert,
        demande,
        propositionFichier: LIVRAISON_PROPOSITION,
        autorisesFichier: LIVRAISON_AUTORISES,
        qui,
      });
      return json(res, 202, { commande: { id: commande.id, statut: commande.status } });
    } catch (err) {
      if (err instanceof apiLivraison.RefusLivraison) return json(res, err.code, { erreur: err.message });
      return json(res, 400, { erreur: err.message });
    }
  }

  if (req.method === "GET" && req.url === "/api/etat") {
    return json(res, 200, cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }));
  }

  if (await traiterAIStudio(req, res)) return undefined;
  if (await traiterFinance(req, res)) return undefined;
  if (await traiterDiscussions(req, res, chemin, qui)) return undefined;

  const preparationMission = chemin.match(/^\/api\/projects\/([a-z0-9][a-z0-9-]*)\/mission$/);
  if (req.method === "GET" && preparationMission) {
    try {
      const index = Number(new URL(req.url, "http://cockpit").searchParams.get("pipeline") || 0);
      if (!Number.isInteger(index) || index < 0) throw new Error("index de pipeline invalide");
      const { options } = missions.lire({ projetsDir: PROJETS, projectId: preparationMission[1], pipelineIndex: index,
        roster: equipe.lireRoster(EQUIPE_ROSTER), affectations: equipe.lireAffectations(EQUIPE_AFFECTATIONS), financeDisponible });
      return json(res, 200, options);
    } catch (err) { return json(res, 400, { erreur: err.message }); }
  }

  // Le planificateur de missions (src/planificateur.js) : une spec, un plan, un lancement.
  if (await plansMissions.traiter({ req, res, chemin, json, corps: () => corpsJson(req, res, 128_000), store, qui,
    params: () => ({ projetsDir: PROJETS, roster: equipe.lireRoster(EQUIPE_ROSTER), affectations: equipe.lireAffectations(EQUIPE_AFFECTATIONS), financeDisponible }),
    machines: api.machines, viaParMachine: VIA_PAR_MACHINE, origineAutorisee: (r) => acces.origineAutorisee(r.headers, PORTEE) })) return undefined;

  const repriseRun =req.method === "POST" && chemin.match(/^\/api\/runs\/([^/]+)\/reprise$/);
  if (repriseRun) {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: "event store indisponible" });
    const demande = await corpsJson(req, res);
    if (demande === null) return undefined;
    try {
      // L'API publique ne peut pas se faire passer pour le planificateur.
      const corps = require("agent-orchestrator/packages/schemas/commandes").valider("run.resume", {
        ...demande, runId: decodeURIComponent(repriseRun[1]), automatique: false,
      });
      const commande = magasinOuvert.attentes.demander(corps.runId, { ...corps, par: qui.par, canal: qui.canal });
      return json(res, 202, { commande: { id: commande.id, statut: commande.status } });
    } catch (err) { return json(res, 409, { erreur: err.message }); }
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
      if (Buffer.byteLength(brut) > 128_000) return json(res, 413, { erreur: "corps trop gros" });
    }
    try {
      const demande = JSON.parse(brut);
      if (Object.hasOwn(demande, "demande")) {
        const etatMachines = api.machines(magasinOuvert);
        const commande = missions.demander({ store: magasinOuvert, qui, demande,
          params: { projetsDir: PROJETS, roster: equipe.lireRoster(EQUIPE_ROSTER), affectations: equipe.lireAffectations(EQUIPE_AFFECTATIONS), financeDisponible },
          verifierBackend: plansMissions.verifierBackend({ viaParMachine: VIA_PAR_MACHINE, machines: etatMachines }),
          verifierBrouillon: (id, projectId, nature) => discussions.origineBrouillon(magasinOuvert, id, projectId, nature) });
        return json(res, 202, { commande: { id: commande.id, statut: commande.status } });
      }
      // L'équipe associée au projet pose le modèle de chaque membre (src/equipe.js). Un
      // choix explicite de la requête garde la main : clé identique écrasée, nœud nommé
      // prioritaire dans le moteur. Avec `*`, l'équipe ne servirait à rien et n'est pas
      // posée : un membre sans effet ne doit pas pouvoir faire refuser le lancement.
      const toutLeRun = Boolean(demande.llmOverrides && demande.llmOverrides["*"]);
      const equipeLancee = toutLeRun
        ? { lancement: {}, membres: {} }
        : equipe.lancementEquipe({
            roster: equipe.lireRoster(EQUIPE_ROSTER),
            affectations: equipe.lireAffectations(EQUIPE_AFFECTATIONS),
            projet: String(demande.projectId || ""),
          });
      const llmOverrides = { ...equipeLancee.lancement, ...(demande.llmOverrides || {}) };
      // Un modèle sans machine capable de le servir échouerait au premier nœud, après la
      // mise en file : autant le refuser ici, avec la raison. Une machine endormie reste
      // indisponible : lancer une tâche de développement ne réveille pas le PC.
      const etatMachines = api.machines(magasinOuvert);
      for (const [cle, llm] of Object.entries(llmOverrides)) {
        if (llm) {
          const disponibilite = catalogueModeles.disponibiliteVia(llm.via, { viaParMachine: VIA_PAR_MACHINE, machines: etatMachines });
          if (!disponibilite.utilisable) {
            const membre = equipeLancee.membres[cle] && !(demande.llmOverrides || {})[cle] ? equipeLancee.membres[cle] : null;
            const cause = membre ? `${membre} (équipe du projet) : ` : "";
            const conseil = membre ? ` Libère ${membre} du projet ou attends que la machine soit disponible.` : "";
            return json(res, 400, { erreur: `${cause}backend « ${llm.via} » indisponible : ${disponibilite.raison}.${conseil}` });
          }
        }
      }
      const commande = magasinOuvert.creerCommande({
        kind: "run.start",
        payload: {
          projectId: demande.projectId,
          pipelineIndex: demande.pipelineIndex,
          llmOverrides: Object.keys(llmOverrides).length ? llmOverrides : demande.llmOverrides,
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
        run: commande.run_id,
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

  if (lecture && lecture.pathname === "/api/equipe") {
    try {
      // Sans event store, la page montre quand même l'équipe et ses affectations.
      const magasinOuvert = store();
      return json(
        res,
        200,
        equipe.etat({
          roster: equipe.lireRoster(EQUIPE_ROSTER),
          affectations: equipe.lireAffectations(EQUIPE_AFFECTATIONS),
          store: magasinOuvert,
          projets: api.lireFiches(PROJETS).fiches.map((f) => f.id),
        })
      );
    } catch (err) {
      return json(res, 500, { erreur: err.message });
    }
  }

  if (req.method === "POST" && chemin === "/api/equipe/affectations") {
    const corps = await corpsJson(req, res);
    if (!corps) return undefined;
    try {
      const erreur = equipe.affecter({
        fichier: EQUIPE_AFFECTATIONS,
        roster: equipe.lireRoster(EQUIPE_ROSTER),
        agents: corps.agents,
        projet: corps.projet === undefined ? null : corps.projet,
        par: qui.par,
      });
      if (erreur) return json(res, 400, { erreur });
      return json(res, 200, { ok: true });
    } catch (err) {
      return json(res, 500, { erreur: err.message });
    }
  }

  // ---- Demander au cockpit (§11.7) ----
  //
  // Lecture et questions derrière le même contrôle d'identité que les runs. Aucune route
  // ici ne déclenche autre chose qu'une réponse écrite : le chat n'agit pas.
  const cheminChat = req.url.split("?")[0];
  if (cheminChat === "/api/chat" || cheminChat.startsWith("/api/chat/")) {
    const magasinOuvert = store();
    if (!magasinOuvert) return json(res, 503, { erreur: `event store indisponible : ${magasinErreur}` });
    const morceaux = cheminChat.split("/").filter(Boolean).slice(2).map(decodeURIComponent);

    if (req.method === "GET" && morceaux.length === 0) {
      return json(res, 200, apiChat.listeFils(magasinOuvert, { plafondUsd: CHAT_PLAFOND_USD, modele: CHAT_MODELE }));
    }
    // Tenu ouvert pendant la réponse ; `ouvrirFil` le referme quand elle est finie.
    if (req.method === "GET" && morceaux.length === 2 && morceaux[1] === "flux") {
      fluxChat.ouvrirFil({ req, res, store: magasinOuvert, threadId: morceaux[0] });
      return undefined;
    }
    if (req.method === "GET" && morceaux.length === 1) {
      const fil = apiChat.filDetaille(magasinOuvert, morceaux[0]);
      return fil ? json(res, 200, fil) : json(res, 404, { erreur: "conversation inconnue" });
    }
    const nouveauFil = req.method === "POST" && morceaux.length === 0;
    const suite = req.method === "POST" && morceaux.length === 2 && morceaux[1] === "messages";
    if (nouveauFil || suite) {
      const demande = await corpsJson(req, res);
      if (!demande) return undefined;
      const { code, corps } = apiChat.poser(magasinOuvert, {
        threadId: suite ? morceaux[0] : null,
        contenu: demande.contenu,
        projet: typeof demande.projet === "string" ? demande.projet : null,
        par: qui.par,
        canal: qui.canal,
        plafondUsd: CHAT_PLAFOND_USD,
      });
      return json(res, code, corps);
    }
    return json(res, 405, { erreur: "méthode non prise en charge" });
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
      const registre = cockpit.enregistrer({
        approvalsDir: APPROVALS,
        dossier: demande.dossier,
        empreinte: demande.empreinte,
        decisions: demande.decisions,
        reponse: demande.reponse,
        par: qui.par,
        canal: qui.canal,
      });
      // Une décision complète enlève parfois le dossier de la boîte avant cette seconde
      // lecture. Le plan gelé et le registre viennent de l'écriture que nous venons de faire,
      // ils suffisent à construire la note sans dépendre de cette boîte mutable.
      try {
        const plan = cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }).dossiers.find((d) => d.dossier === demande.dossier);
        if (plan && plan.tranche) conseiller.noter(CONSEILLER_BASE, plan);
        else {
          const gel = require("../src/store").lirePlan(APPROVALS, demande.dossier);
          const toutesPrises = gel && (gel.actions || []).length > 0 && (gel.actions || []).every((action) =>
            (registre.decisions || []).some((decision) => decision.action_id === action.id)
          );
          if (toutesPrises && !registre.reponse) {
            const prises = new Map((registre.decisions || []).map((decision) => [decision.action_id, decision]));
            conseiller.noter(CONSEILLER_BASE, {
              dossier: demande.dossier,
              empreinte: demande.empreinte,
              appliquer_avec: null,
              tranche: true,
              actions: (gel.actions || []).map((action) => ({
                ...action,
                decision: prises.get(action.id)?.decision ?? null,
                note: prises.get(action.id)?.motif ?? null,
                decision_par: prises.get(action.id)?.par ?? null,
              })),
            });
          }
        }
      } catch (err) {
        console.error(`note du vault non mise en file : ${err.message}`);
      }
      return json(res, 200, registre);
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
