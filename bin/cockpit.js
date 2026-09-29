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
const flux = require("../src/flux");
const statique = require("../src/statique");
const catalogueModeles = require("../src/modeles");
const apiChat = require("../src/api-chat");
const fluxChat = require("../src/flux-chat");
const { AIStudioService } = require("../src/ai-studio/service");
const { creerRouteurAIStudio } = require("../src/ai-studio/http");

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

// Les fiches projet (décision §15, option A) : `projects/<id>/project.json`. La topologie en
// tire les catégories et les projets.
const PROJETS = ENV.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects");
// Le relevé des modèles poussé par le PC, et les backends joignables par chaque machine.
// Sur le NAS, `claude` vient de la clé du runner ; OmniRoute reste local au worker PC.
const CATALOGUE_MODELES = ENV.COCKPIT_CATALOGUE_MODELES || path.join(RACINE, "etat", "modeles.json");
const VIA_PAR_MACHINE = catalogueModeles.lireViaParMachine(ENV.COCKPIT_VIA_MACHINES);
// « Demander au cockpit » : Claude via le runner du NAS, dépense plafonnée à part (§11.7).
const CHAT_PLAFOND_USD = Number(ENV.COCKPIT_CHAT_PLAFOND_USD || 10);
const CHAT_MODELE = ENV.COCKPIT_CHAT_MODELE || "sonnet";

// Le corps JSON d'une écriture du front, avec les contrôles de POST /api/runs : origine du
// cockpit, JSON seul, 20 ko au plus. Rend `null` après avoir répondu en cas de refus.
async function corpsJson(req, res, maximum = 20_000) {
  if (!acces.origineAutorisee(req.headers, PORTEE)) {
    json(res, 403, { erreur: "origine refusée : cette écriture ne vient pas du cockpit" });
    return null;
  }
  const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    json(res, 415, { erreur: "type de contenu refusé : application/json attendu" });
    return null;
  }
  let brut = "";
  for await (const morceau of req) {
    brut += morceau;
    if (brut.length > maximum) {
      json(res, 413, { erreur: "corps trop gros" });
      return null;
    }
  }
  try {
    return JSON.parse(brut || "{}");
  } catch {
    json(res, 400, { erreur: "JSON illisible" });
    return null;
  }
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
    templatesDir: path.join(RACINE, "workflows", "ai-studio"),
    comfyuiUrl: ENV.COMFYUI_URL || "http://comfyui:8188",
    maxConcurrent: Number(ENV.AI_STUDIO_MAX_CONCURRENT_JOBS || 2),
  });
} catch (err) {
  erreurAIStudio = err.message;
  console.error(`AI Studio indisponible : ${err.message}`);
}
const traiterAIStudioActif = AI_STUDIO
  ? creerRouteurAIStudio({ service: AI_STUDIO, json, corpsJson, durcissement: DURCISSEMENT })
  : null;
async function traiterAIStudio(req, res) {
  if (!req.url.startsWith("/api/ai-studio")) return false;
  if (!traiterAIStudioActif) {
    json(res, 503, { erreur: `stockage AI Studio indisponible : ${erreurAIStudio}` });
    return true;
  }
  return traiterAIStudioActif(req, res);
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
    return json(res, 200, {
      qui: { par: qui.par, nom: qui.nom ?? null, canal: qui.canal },
      etat: cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }),
      modules: registreApps(),
    });
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
      // mise en file : autant le refuser ici, avec la raison. Une machine endormie reste
      // indisponible : lancer une tâche de développement ne réveille pas le PC.
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
