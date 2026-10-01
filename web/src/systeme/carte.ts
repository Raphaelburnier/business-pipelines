// La carte du système agentique, écrite à la main à partir du code et du vault (relevé du
// 2026-09-29, revu le 2026-09-30). Ce n'est pas une donnée vivante : l'état des runs et des machines reste dans la
// topologie. Quand une brique change de rôle, c'est ici qu'on la corrige.

export type Zone = "interfaces" | "nas" | "pc" | "cloud";
export type Genre = "humain" | "service" | "donnee" | "moteur" | "externe" | "app";
export type Statut = "actif" | "partiel" | "arrete";
export type Famille = "commande" | "execution" | "lecture" | "livraison" | "modeles" | "dev";

export interface Brique {
  id: string;
  titre: string;
  sous: string;
  zone: Zone;
  genre: Genre;
  statut: Statut;
  x: number;
  y: number;
  resume: string;
  faits: string[];
  depuis?: string;
  depot?: string;
}

export interface Lien {
  de: string;
  vers: string;
  famille: Famille;
  libelle?: string;
  bloque?: boolean;
}

export interface ZoneCarte {
  id: Zone;
  titre: string;
  sous: string;
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

export const LARGEUR_BRIQUE = 230;
export const HAUTEUR_BRIQUE = 74;

export const ZONES: ZoneCarte[] = [
  { id: "interfaces", titre: "Interfaces", sous: "qui décide, qui code", x: 0, y: 0, largeur: 1770, hauteur: 130 },
  { id: "nas", titre: "NAS Synology", sous: "toujours allumé · décide et stocke · tailnet seulement", x: 0, y: 160, largeur: 1170, hauteur: 810 },
  { id: "pc", titre: "PC WSL", sous: "veille possible · calcule", x: 1200, y: 160, largeur: 570, hauteur: 560 },
  { id: "cloud", titre: "Cloud", sous: "modèles et forge", x: 1200, y: 750, largeur: 570, hauteur: 220 },
];

export const FAMILLES: Record<Famille, { nom: string; detail: string }> = {
  commande: { nom: "Commande", detail: "une décision devient une commande signée, puis un run" },
  execution: { nom: "Exécution", detail: "le moteur fait travailler les agents" },
  lecture: { nom: "Observation", detail: "événements, flux SSE, chat en lecture seule" },
  livraison: { nom: "Livraison", detail: "du run réussi jusqu'à la production" },
  modeles: { nom: "Modèles", detail: "catalogue OmniRoute, repli de quota, GPU" },
  dev: { nom: "Développement", detail: "les sessions d'agents qui font évoluer le système lui-même" },
};

// Colonnes de 300 et rangées de 130 : l'écart entre deux briques laisse la place à l'étiquette
// d'un lien sans qu'elle recouvre un nom.
const C = [30, 330, 630, 930] as const;
const R = [200, 330, 460, 590, 720, 850] as const;
const P = [1230, 1530] as const;

export const BRIQUES: Brique[] = [
  // ---------- Interfaces ----------
  {
    id: "telephone",
    titre: "Raphaël",
    sous: "téléphone · PC · tailnet",
    zone: "interfaces",
    genre: "humain",
    statut: "actif",
    x: C[0],
    y: 40,
    resume: "Le seul humain de la boucle. Il lance les runs, tranche les approbations et valide une livraison, depuis le téléphone ou le PC, toujours par Tailscale.",
    faits: [
      "Identité prouvée par WireGuard (en-tête Tailscale-User-Login), jamais par un champ de texte",
      "Décide : lancer un run, approuver ou refuser un gel, livrer une version",
      "Le téléphone est une interface du cockpit, pas un worker",
      "Une approbation en attente l'atteint par trois lecteurs du même fichier : boîte durable, cockpit, alerte",
    ],
  },
  {
    id: "sessions",
    titre: "Sessions d'agents",
    sous: "Claude Code · Codex",
    zone: "interfaces",
    genre: "humain",
    statut: "actif",
    x: P[0],
    y: 40,
    resume: "Les sessions interactives qui écrivent le système lui-même : moteur, cockpit, registre. Elles ouvrent des PR sur des branches claude/, codex/, agent/ ou automation/.",
    faits: [
      "Contexte partagé par le vault Obsidian (_context/) depuis le 2026-08-12",
      "Repli de quota : claude-auto reprend la conversation sur OmniRoute",
      "Les jobs en arrière-plan sont repris par le minuteur claude-jobs-repli (toutes les 2 min)",
      "Fichiers sensibles (workflows, Docker, AGENTS.md, secrets) : fusion manuelle obligatoire",
    ],
  },

  // ---------- NAS : entrée et lecture ----------
  {
    id: "tailscale",
    titre: "Tailscale serve",
    sous: "tailnet · relais whois",
    zone: "nas",
    genre: "service",
    statut: "actif",
    x: C[0],
    y: R[0],
    resume: "La seule porte du cockpit. Tailscale DSM sert le cockpit en serve, jamais en funnel : rien n'est joignable depuis internet.",
    faits: [
      "Nom tailnet : nas.tail8296f6.ts.net",
      "Service tailscale-whois : relais qui résout l'identité d'un pair pour le maître",
      "Principe non négociable n°7 de la spec : jamais sur internet",
      "Risque connu : CCleaner Performance Optimizer peut couper Tailscale côté PC",
    ],
    depuis: "2026-08-20",
  },
  {
    id: "cockpit",
    titre: "Cockpit AgenticOS",
    sous: "cockpit.js :4600 · React",
    zone: "nas",
    genre: "service",
    statut: "actif",
    x: C[1],
    y: R[0],
    resume: "L'API REST et SSE et le front Night City. Il lit l'event store, dépose des commandes signées et n'a aucune clé de modèle : exposé au tailnet, il ne peut rien payer.",
    faits: [
      "Routes de lecture : /api/topology, /api/runs, /api/machines, /api/usage, /api/stream (SSE)",
      "POST /api/runs : contrôle d'origine, JSON seul, 20 ko max, réponse 202 et commande run.start",
      "Décisions : GET /api/livraison et POST /api/livraisons (livraison.start), GET /api/approbations et POST /api/decider",
      "Le flux SSE ne porte pas l'état, il dit qu'il a changé (rechargement au plus toutes les 600 ms)",
      "Vues : Accueil (topologie), Agents, Demander, AI Studio, Décisions, Système",
      "Refuse avant la file un run dont le modèle ou la machine est indisponible",
    ],
    depuis: "2026-08-19",
    depot: "business-pipelines",
  },
  {
    id: "chat",
    titre: "Demander",
    sous: "chat · lecture seule",
    zone: "nas",
    genre: "service",
    statut: "actif",
    x: C[2],
    y: R[0],
    resume: "La conversation du cockpit, disponible même quand le PC dort. Elle lit l'état et explique une étape ; sa seule action privilégiée prévue est de lancer un pipeline.",
    faits: [
      "Les appels Claude partent du runner du NAS, jamais du service web exposé",
      "Outils de lecture branchés le 2026-09-25, réponse suivie en direct depuis le 2026-09-26",
      "Remplace le rôle prévu pour Hermes, qui reste hors du chemin",
      "Plafond mensuel séparé, hors budgets de projet",
    ],
    depuis: "2026-09-25",
  },
  {
    id: "aistudio",
    titre: "AI Studio",
    sous: "/ai-studio · ComfyUI",
    zone: "nas",
    genre: "app",
    statut: "partiel",
    x: C[3],
    y: R[0],
    resume: "Génération d'images par lots sur le GPU du PC. Le navigateur ne parle jamais à ComfyUI : tout passe par le backend du cockpit, et seules les images validées sont archivées.",
    faits: [
      "Profils, références, file durable, galerie, inspector, export du workflow exact",
      "Archive : /volume1/IAstudio/<projet>/<profil>/AAAA/MM/<génération>/",
      "Checkpoints importés sur le NAS, copiés vers le PC par sync-ai-studio-models.ps1",
      "Phase 1 : les références ne sont pas encore injectées (identity providers en phase 2)",
    ],
    depuis: "2026-09-29",
  },

  // ---------- NAS : état ----------
  {
    id: "approbations",
    titre: "Boîte d'approbations",
    sous: "hors workspace · alerte",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[0],
    y: R[1],
    resume: "Les décisions en attente, rangées hors du workspace parce que les agents y écrivent : une approbation posée là serait falsifiable par ce qu'elle contrôle.",
    faits: [
      "Passée de fichiers JSON à SQLite le 2026-09-17",
      "Une approbation gèle le plan : on approuve un texte figé, c'est celui-là qui s'exécute",
      "Péremption comptée depuis la collecte (max_age_heures, 12 h dans le pipeline livré)",
      "Canal d'alerte : prévient, au plus deux messages par plan, sans bouton qui approuve",
      "Décision libre (steering) en texte possible depuis le 2026-09-11",
    ],
    depuis: "2026-08-18",
  },
  {
    id: "eventstore",
    titre: "Event store",
    sous: "SQLite WAL · node:sqlite",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[1],
    y: R[1],
    resume: "L'état d'exécution et rien d'autre : runs, étapes, événements, approbations, commandes. Les définitions vivent dans git, jamais ici.",
    faits: [
      "Tables : machines, runs, steps, events, approvals, commands, eval_results",
      "Statuts de run : queued, running, paused, waiting_approval, waiting_quota, waiting_machine, succeeded, failed, cancelled",
      "Commandes durables : creerCommande, prendreCommande (atomique), terminerCommande",
      "reprendreCommandesInterrompues filtre par type : le runner ne rejoue que les siennes (#33)",
      "Si ce n'est pas dans l'event store, le cockpit ne le montre pas",
    ],
    depuis: "2026-09-18",
    depot: "agent-orchestrator",
  },
  {
    id: "runner",
    titre: "Runner",
    sous: "commande-runner.js",
    zone: "nas",
    genre: "service",
    statut: "actif",
    x: C[2],
    y: R[1],
    resume: "Le seul détenteur de l'accès au modèle. Il prend les commandes run.start et chat dans l'event store et lance le moteur.",
    faits: [
      "Tourne sur l'abonnement Claude depuis le 2026-09-25 (ORCH_EXIGER_ABONNEMENT=1)",
      "Ne monte que le dépôt du projet et workers.json, plus jamais tout specs/ (#22)",
      "Deux files : runs et chat, pour qu'une conversation n'attende pas un run",
      "Lance les runs en mode distribué vers le maître",
      "restart: always depuis le redémarrage du NAS du 2026-09-23",
    ],
    depuis: "2026-09-23",
    depot: "business-pipelines",
  },
  {
    id: "modelesjson",
    titre: "etat/modeles.json",
    sous: "relevé OmniRoute",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[3],
    y: R[1],
    resume: "Le catalogue des modèles utilisables, déposé par le PC toutes les 2 minutes. Le cockpit le lit pour proposer un modèle par run et refuser un modèle épuisé.",
    faits: [
      "États : frais, périmé (plus de 10 min, PC en veille), absent",
      "Quotas par connexion : disponible, limité (moins de 20 %), épuisé avec heure de reprise",
      "Un modèle sans appel d'outils est marqué inutilisable pour un run",
    ],
    depuis: "2026-09-24",
  },

  // ---------- NAS : moteur ----------
  {
    id: "registre",
    titre: "agent-registry",
    sous: "agent@version · pipelines",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[0],
    y: R[2],
    resume: "Les définitions réutilisables, chacune à une version épinglée. Une version publiée ne change plus : corriger un agent, c'est publier la suivante.",
    faits: [
      "26 agents, dont 21 importés en v1 le 2026-09-17 (moteur, marketing, SaaS generator)",
      "Pipelines : improve-app@1 à @4, marketing@1 et @2",
      "allowedTools est le périmètre d'un agent ; il n'a que ces outils",
      "Un outcome d'agent renvoie au travail, il ne valide jamais : une arête qui avance mène à un script ou à un humain",
      "La CI refuse une PR qui modifie une version existante",
    ],
    depuis: "2026-09-17",
    depot: "agent-registry",
  },
  {
    id: "moteur",
    titre: "agent-orchestrator",
    sous: "moteur en graphe · Agent SDK",
    zone: "nas",
    genre: "moteur",
    statut: "actif",
    x: C[1],
    y: R[2],
    resume: "L'interpréteur générique. Il ne connaît ni les agents, ni l'ordre des étapes, ni le domaine : tout vient du pipeline.json et du projet. Extrait du générateur de SaaS le 2026-08-17.",
    faits: [
      "Nœuds agent, script et approval ; arêtes conditionnées par l'issue (PASS, FAIL)",
      "Cycles bornés par maxLoops, comptés par cycle et non par étape",
      "mustChange : empreinte SHA-1 du workspace avant et après, sorties de l'agent exclues",
      "Budget USD et tours vérifié après chaque appel ; un dépassement devient une approbation",
      "Checkpoints git par lot sur run/<runId>, relance par --depuis",
      "Backends par agent : le même agent tourne sur Anthropic ou en local",
    ],
    depuis: "2026-08-17",
    depot: "agent-orchestrator",
  },
  {
    id: "maitre",
    titre: "Maître",
    sous: "orch :4650 · WebSocket",
    zone: "nas",
    genre: "service",
    statut: "partiel",
    x: C[2],
    y: R[2],
    resume: "Le répartiteur : il envoie chaque étape au worker désigné par runsOn. Ce n'est pas un modèle, c'est du code. Aujourd'hui il écoute en loopback et les étapes tournent sur le NAS.",
    faits: [
      "Protocole : hello, heartbeat, event, step.result, sleep.request / step.dispatch, step.cancel, ack, refus",
      "Numéros de séquence acquittés et rejoués",
      "Refuse avant la file une tâche dont le worker est indisponible, sans Wake-on-LAN",
      "Écoute 127.0.0.1 depuis le 2026-09-26 : Tailscale DSM n'a pas d'interface",
      "Écart acté comme provisoire : les runs tournent sur le NAS (runsOn: nas)",
    ],
    depuis: "2026-09-21",
    depot: "agent-orchestrator",
  },
  {
    id: "livreur",
    titre: "Livreur",
    sous: "docker.sock · deploy.sh",
    zone: "nas",
    genre: "service",
    statut: "actif",
    x: C[3],
    y: R[2],
    resume: "Livre le cockpit depuis le cockpit. Il compare la production aux miroirs, propose une version, et sur une commande livraison.start validée par Raphaël, construit, bascule et restaure en cas d'échec.",
    faits: [
      "Aucune clé de modèle ni jeton : il lit les miroirs en lecture seule",
      "Ne livre que des commits déjà fusionnés sur les branches par défaut",
      "Étapes : vérifier, préparer, sauvegarder, construire, basculer, santé ; restaurer si la bascule échoue",
      "Publie sa proposition dans etat/livraison.json, recalculée dès qu'une version part",
      "Ne se livre jamais lui-même : sa mise à jour passe par bin/livrer.sh --livreur",
      "L'image construit le front et lance les tests : une image qui échoue n'existe pas",
      "Sauvegarde et restaure le code seulement, jamais l'état vivant",
    ],
    depuis: "2026-09-29",
    depot: "business-pipelines",
  },

  // ---------- NAS : git et livraison ----------
  {
    id: "marketing",
    titre: "Pipelines métier",
    sous: "marketing@2 · veille",
    zone: "nas",
    genre: "moteur",
    statut: "arrete",
    x: C[0],
    y: R[3],
    resume: "La forme proposer, geler, décider, agir, consigner, construite sur eBay puis gardée sans eBay. Le marketing tourne à la demande ; le cycle eBay est arrêté.",
    faits: [
      "Six types de stage déterministes : fetch, verify, verify-actions, approval, charger, execute",
      "L'accès au monde extérieur appartient à un stage typé, jamais à un agent",
      "marketing@2 : deux analystes (marque, économie), un synthétiseur, un gate de code, un humain qui arbitre",
      "eBay écarté le 2026-09-11, refresh token supprimé",
      "Question ouverte : quelle tâche récurrente a un « fini » vérifiable par un critère binaire",
    ],
    depuis: "2026-08-17",
  },
  {
    id: "workspaces",
    titre: "Workspaces",
    sous: "/app/workspaces · run/<id>",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[1],
    y: R[3],
    resume: "Un dossier de travail par run, cloné depuis origin/HEAD du projet. Jetable : les agents y écrivent, donc rien de ce qui décide n'y vit.",
    faits: [
      "Nouveau run depuis origin/HEAD, jamais depuis la branche d'un run précédent (#21)",
      "Chemin absolu écrit dans le prompt : un modèle ne voit pas le cwd",
      "Étape inachevée sauvegardée sur run/<id>-inacheve-<étape>",
      "Fichiers d'échange (plan, rapports) retirés avant la livraison",
    ],
  },
  {
    id: "bare",
    titre: "Dépôts git du NAS",
    sous: "/volume1/docker/git",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[2],
    y: R[3],
    resume: "Le remote principal des projets (dépôts bare) et les miroirs en lecture seule des trois dépôts système.",
    faits: [
      "Projets : steam-tierlist.git, marketing.git",
      "Miroirs système dans systeme/ : business-pipelines, agent-orchestrator, agent-registry, tenus par le publieur, lus par le livreur",
      "Le runner y pousse les checkpoints run/<id>",
    ],
  },
  {
    id: "publieur",
    titre: "Publieur",
    sous: "jetons GitHub · sans agent",
    zone: "nas",
    genre: "service",
    statut: "actif",
    x: C[3],
    y: R[3],
    resume: "Sans agent, il est le seul service à détenir des jetons GitHub. Il pousse les branches agent/ des runs réussis, ouvre la PR, ramène main de GitHub vers le NAS en avance rapide, et tient les miroirs des trois dépôts système.",
    faits: [
      "Jeton fine-grained : Contents et Pull requests, limité aux dépôts qui publient",
      "Un GITHUB_TOKEN de workflow ne déclencherait pas la CI, d'où ce jeton dédié",
      "Second jeton, en lecture seule, pour les miroirs système (#38) : jamais de repli sur le jeton d'écriture",
      "Premier retour automatique de main sur le NAS le 2026-09-28 (Steam dd34688)",
    ],
    depuis: "2026-09-27",
    depot: "business-pipelines",
  },

  // ---------- NAS : apps ----------
  {
    id: "apps",
    titre: "Apps en service",
    sous: "Steam TierList · tcg-generator",
    zone: "nas",
    genre: "app",
    statut: "actif",
    x: C[2],
    y: R[4],
    resume: "Ce que les boucles ont produit et qui tourne. Le registre des apps est relu à chaque rendu du cockpit ; un déploiement l'alimente seul.",
    faits: [
      "Steam TierList sous /steam (127.0.0.1:4610), façon magasin Steam, 188 858 jeux",
      "tcg-generator sur :4700, généré le 2026-07-18 pour 5,97 $, en ligne le 2026-09-05",
      "Chaque bascule garde l'ancienne version (image et conteneur avant-<sha>)",
    ],
  },
  {
    id: "releases",
    titre: "Release du cockpit",
    sous: "/volume1/docker/releases",
    zone: "nas",
    genre: "donnee",
    statut: "actif",
    x: C[3],
    y: R[4],
    resume: "Une release est une archive des trois SHA (cockpit, moteur, registre) avec son .release et son deploy.sh. Le chemin de secours reste bin/livrer.sh lancé depuis le PC.",
    faits: [
      "Trois SHA notés dans .release à chaque livraison",
      "Sauvegardes sous /volume1/docker/business-pipelines-backups",
      "Services recréés : cockpit, runner, tailscale-whois, publieur ; jamais le livreur",
      "Cinq releases et cinq sauvegardes gardées, les plus anciennes supprimées",
    ],
  },

  // ---------- PC ----------
  {
    id: "workerpc",
    titre: "Worker PC",
    sous: "runsOn: pc · WS sortant",
    zone: "pc",
    genre: "service",
    statut: "partiel",
    x: P[0],
    y: R[0],
    resume: "Le worker de calcul : il ouvre lui-même sa connexion vers le maître et exécute les étapes lourdes. Aujourd'hui le maître le refuse : derrière le relais DSM, son identité Tailscale ne se résout pas.",
    faits: [
      "Seul worker de calcul prévu ; le PC n'est jamais réveillé pour une tâche",
      "Veille Windows accordée seulement à l'inactivité (sleep.request / sleep.allowed)",
      "Les tâches OmniRoute n'ont le droit de tourner que sur lui",
      "Bloqué depuis le 2026-09-26 : identité vue comme 127.0.0.1",
    ],
    depuis: "2026-09-21",
  },
  {
    id: "omniroute",
    titre: "OmniRoute",
    sous: ":20128 · 12 fournisseurs",
    zone: "pc",
    genre: "service",
    statut: "actif",
    x: P[1],
    y: R[0],
    resume: "La passerelle LLM locale : secours gratuit quand le quota Claude tombe, et backend des boucles agentiques. Combos en stratégie priority, le premier maillon sert.",
    faits: [
      "Combos : agentic-code, agentic-bulk, agentic-plan, agentic-loop, long-context, vision, local-infinite",
      "Noms claude-* redirigés par model_combo_mappings (opus, sonnet vers agentic-code)",
      "Détection de tâche coupée exprès : elle casserait l'orchestrateur et LoopClient",
      "Backend omniroute déclaré dans backends.json d'agent-orchestrator",
    ],
    depuis: "2026-09-15",
  },
  {
    id: "collecteur",
    titre: "Collecteur modèles",
    sous: "orch modeles · minuteur 2 min",
    zone: "pc",
    genre: "service",
    statut: "actif",
    x: P[0],
    y: R[1],
    resume: "Interroge OmniRoute (/v1/models, /v1/me/status) et dépose le relevé sur le NAS par SSH avec publier-modeles.sh.",
    faits: [
      "Aucun service entrant sur Windows : c'est le PC qui pousse",
      "Relevé périmé après 10 min : le cockpit en conclut que le PC dort",
    ],
    depuis: "2026-09-24",
  },
  {
    id: "repli",
    titre: "Repli de quota",
    sous: "claude-auto · jobs-repli",
    zone: "pc",
    genre: "service",
    statut: "actif",
    x: P[1],
    y: R[1],
    resume: "Claude Code parle directement à Anthropic. Si une session s'arrête sur la limite d'usage, la même conversation reprend sur OmniRoute.",
    faits: [
      "Détection sur le transcript : error rate_limit et quotaLimits.status rejected",
      "Un 429 passager sans quotaLimits ne déclenche rien",
      "Jobs en arrière-plan : nouveau job --resume --fork-session, une seule reprise par limite",
    ],
    depuis: "2026-09-17",
  },
  {
    id: "saas",
    titre: "Saas-generator",
    sous: "web-app · discord-bot · MCP",
    zone: "pc",
    genre: "moteur",
    statut: "actif",
    x: P[0],
    y: R[2],
    resume: "Le premier consommateur du moteur : une spec JSON entre, une app web testée sort. 350 lignes de domaine posées sur le moteur.",
    faits: [
      "Six agents : architect, design-system, backend-builder, frontend-builder, test-runner, security-reviewer",
      "Gates : test-report PASS, security-report CLEAR, reprise à rerun_from: test, 3 cycles max",
      "Stage migrate avec garde RLS déterministe, stage assemble pour la cible",
      "Outils MCP : deposer_spec, valider_spec, lancer_generation, deployer_projet, etat_deploiement",
      "À faire : la vérification de déployabilité après assemblage",
    ],
    depuis: "2026-07-18",
    depot: "Saas-generator",
  },
  {
    id: "comfyui",
    titre: "ComfyUI",
    sous: ":8188 · GPU",
    zone: "pc",
    genre: "service",
    statut: "partiel",
    x: P[1],
    y: R[2],
    resume: "Le moteur de génération d'images d'AI Studio, sur le GPU du PC. Le NAS stocke, le PC calcule.",
    faits: [
      "Joignable par le NAS sur l'adresse LAN du PC (COMFYUI_URL dans specs/cockpit.env)",
      "Checkpoints listés par /object_info/CheckpointLoaderSimple",
      "Adresse DHCP non réservée : peut changer",
    ],
    depuis: "2026-09-29",
  },
  {
    id: "ollama",
    titre: "Ollama local",
    sous: "qwen3 · gemma4 · qwen2.5-coder",
    zone: "pc",
    genre: "service",
    statut: "actif",
    x: P[0],
    y: R[3],
    resume: "Les modèles locaux, à coût marginal nul. Règle de délégation : gros volume, faible jugement.",
    faits: [
      "Backends ollama et ollama-coder dans backends.json",
      "_billed: false : le coût évité est mesuré à part (avoidedUsd)",
      "Dernier maillon des combos agentic-loop et local-infinite",
    ],
  },

  // ---------- Cloud ----------
  {
    id: "anthropic",
    titre: "Anthropic",
    sous: "abonnement Claude · Agent SDK",
    zone: "cloud",
    genre: "externe",
    statut: "actif",
    x: P[0],
    y: 820,
    resume: "Le raisonnement des agents. Avec l'abonnement, le coût affiché est une estimation ; la vraie contrainte est la limite d'usage par fenêtre.",
    faits: [
      "Appelé par @anthropic-ai/claude-agent-sdk, pas par sous-processus CLI (décision 1 du 2026-09-18)",
      "Limite de quota : l'étape passe en waiting_quota, elle n'échoue pas",
      "Reprise prévue sur resetsAt, jauge par getUsage() (phase 5)",
    ],
  },
  {
    id: "github",
    titre: "GitHub",
    sous: "CI · agent-gated-merge",
    zone: "cloud",
    genre: "externe",
    statut: "actif",
    x: P[1],
    y: 820,
    resume: "La forge et la porte automatique. Une PR d'agent est fusionnée en squash seulement si tout est prouvé ; le workflow de fusion n'exécute jamais le code de la PR.",
    faits: [
      "Branches admises : codex/, claude/, agent/, automation/",
      "CI verte sur le SHA exact de la tête, testée sur un merge ref de la base courante",
      "Tête et base inchangées entre validation et fusion, aucune conversation ouverte",
      "Aucun fichier sensible touché : sinon fusion à la main",
      "Norme de tous les dépôts actifs depuis le 2026-09-25",
    ],
    depuis: "2026-09-25",
  },
];

export const LIENS: Lien[] = [
  // Commande : de la décision au run.
  { de: "telephone", vers: "tailscale", famille: "commande", libelle: "HTTPS tailnet" },
  { de: "tailscale", vers: "cockpit", famille: "commande", libelle: "identité prouvée" },
  { de: "cockpit", vers: "eventstore", famille: "commande", libelle: "commande signée" },
  { de: "eventstore", vers: "runner", famille: "commande", libelle: "prendreCommande" },
  { de: "runner", vers: "moteur", famille: "commande", libelle: "orch projet" },
  { de: "moteur", vers: "maitre", famille: "commande", libelle: "--distribue" },
  { de: "maitre", vers: "workerpc", famille: "commande", libelle: "step.dispatch", bloque: true },
  { de: "cockpit", vers: "approbations", famille: "commande", libelle: "décider" },

  // Exécution.
  { de: "registre", vers: "moteur", famille: "execution", libelle: "agent@version" },
  { de: "moteur", vers: "anthropic", famille: "execution", libelle: "Agent SDK" },
  { de: "moteur", vers: "workspaces", famille: "execution", libelle: "checkpoints" },
  { de: "moteur", vers: "approbations", famille: "execution", libelle: "gel · budget" },
  { de: "workerpc", vers: "omniroute", famille: "execution", libelle: "via:modèle" },
  { de: "marketing", vers: "moteur", famille: "execution", libelle: "consommateur" },
  { de: "saas", vers: "anthropic", famille: "execution", libelle: "agents" },

  // Observation.
  { de: "moteur", vers: "eventstore", famille: "lecture", libelle: "événements" },
  { de: "eventstore", vers: "cockpit", famille: "lecture", libelle: "SSE" },
  { de: "chat", vers: "eventstore", famille: "lecture", libelle: "lecture seule" },
  { de: "cockpit", vers: "chat", famille: "lecture" },

  // Livraison.
  { de: "workspaces", vers: "bare", famille: "livraison", libelle: "push run/ · agent/" },
  { de: "bare", vers: "publieur", famille: "livraison" },
  { de: "publieur", vers: "github", famille: "livraison", libelle: "PR agent/" },
  { de: "github", vers: "publieur", famille: "livraison", libelle: "main fusionné" },
  { de: "publieur", vers: "bare", famille: "livraison", libelle: "avance rapide" },
  { de: "bare", vers: "apps", famille: "livraison", libelle: "mise en service" },
  { de: "bare", vers: "livreur", famille: "livraison", libelle: "miroirs ro" },
  { de: "eventstore", vers: "livreur", famille: "livraison", libelle: "livraison.start" },
  { de: "livreur", vers: "releases", famille: "livraison", libelle: "prépare · deploy.sh" },
  { de: "livreur", vers: "cockpit", famille: "livraison", libelle: "bascule · proposition" },
  { de: "saas", vers: "apps", famille: "livraison", libelle: "deployer_projet" },

  // Modèles.
  { de: "omniroute", vers: "collecteur", famille: "modeles", libelle: "/v1/models" },
  { de: "collecteur", vers: "modelesjson", famille: "modeles", libelle: "SSH" },
  { de: "modelesjson", vers: "cockpit", famille: "modeles", libelle: "catalogue" },
  { de: "repli", vers: "omniroute", famille: "modeles", libelle: "quota épuisé" },
  { de: "omniroute", vers: "ollama", famille: "modeles" },
  { de: "aistudio", vers: "comfyui", famille: "modeles", libelle: "backend → :8188" },

  // Développement du système.
  { de: "sessions", vers: "github", famille: "dev", libelle: "PR claude/ codex/" },
];

// ---------- La boucle d'un run, telle qu'improve-app@4 la déroule ----------

export type GenreEtape = "humain" | "deterministe" | "agent" | "script" | "externe";

export interface Etape {
  id: string;
  titre: string;
  sous: string;
  genre: GenreEtape;
  x: number;
  y: number;
  detail: string;
}

export interface Transition {
  de: string;
  vers: string;
  libelle?: string;
  issue?: "pass" | "fail" | "attente";
  // Un retour en arrière sur la même rangée passe par dessous, sinon il recouvre l'aller.
  boucle?: boolean;
}

export const ETAPES: Etape[] = [
  { id: "b-decision", titre: "Lancer", sous: "Raphaël · cockpit", genre: "humain", x: 0, y: 0, detail: "Raphaël choisit le projet, le modèle et lance. Le cockpit refuse tout de suite si le modèle est épuisé ou la machine absente." },
  { id: "b-commande", titre: "run.start", sous: "commande signée", genre: "deterministe", x: 290, y: 0, detail: "POST /api/runs dépose une commande avec l'identité tailnet (par, canal). Réponse 202 : la commande attend dans l'event store." },
  { id: "b-runner", titre: "Runner", sous: "prendreCommande", genre: "deterministe", x: 580, y: 0, detail: "Le runner réserve la commande de façon atomique, clone le projet depuis origin/HEAD et lance le moteur avec le pipeline épinglé du projet." },
  { id: "b-deps", titre: "dependencies", sous: "script · npm run prepare:run", genre: "script", x: 870, y: 0, detail: "Étape script, zéro token : installe les dépendances du projet dans le workspace." },
  { id: "b-plan", titre: "plan", sous: "improvement-planner@1 · 16 tours", genre: "agent", x: 1160, y: 0, detail: "Choisit une amélioration utile et écrit improvement-plan.json : objectif, commande de test, critères d'acceptation, changements, coverage_gaps, risques, blocages. Forme validée par le moteur." },
  { id: "b-impl", titre: "implement", sous: "improvement-editor@2 · 35 tours", genre: "agent", x: 1160, y: 170, detail: "Applique le plan et écrit applied.json. mustChange : si l'empreinte du workspace n'a pas bougé (sorties de l'agent exclues), l'étape échoue." },
  { id: "b-verify", titre: "verify", sous: "test-verifier@2 · 18 tours", genre: "agent", x: 870, y: 170, detail: "Lance la suite du projet et teste à la main les coverage_gaps. v2 : rend test-report.json avant les contrôles manuels, pour ne plus manquer de tours sans rapport." },
  { id: "b-verdict", titre: "verdict", sous: "script · valider-test-report.js", genre: "deterministe", x: 580, y: 170, detail: "Le juge est du code. Il recopie le verdict dans verdict.json, que le moteur lit par outcomeFrom. Un agent ne valide jamais son propre travail." },
  { id: "b-echec", titre: "Run en échec", sous: "run/<id>-inacheve", genre: "deterministe", x: 290, y: 170, detail: "Cycle correction épuisé (maxLoops 1) : le run passe en failed avec sa raison. L'étape inachevée reste sauvegardée sur une branche pour être relue." },
  { id: "b-livraison", titre: "agent/<projet>-<run>", sous: "moteur · livraison", genre: "deterministe", x: 580, y: 340, detail: "PASS : le moteur retire les fichiers d'échange et pousse la branche agent/. Désactivé par défaut, activé par publier dans project.json." },
  { id: "b-pr", titre: "PR GitHub", sous: "publieur", genre: "deterministe", x: 870, y: 340, detail: "Le publieur, seul détenteur du jeton, pousse la branche et ouvre la PR. Option B du 2026-09-27 : pas de relecture humaine si les preuves sont là." },
  { id: "b-ci", titre: "CI + auto-merge", sous: "GitHub Actions", genre: "externe", x: 1160, y: 340, detail: "CI verte sur le SHA exact et le merge ref de la base courante, aucune conversation ouverte, aucun fichier sensible : fusion en squash." },
  { id: "b-retour", titre: "main sur le NAS", sous: "publieur · avance rapide", genre: "deterministe", x: 1450, y: 340, detail: "Le publieur ramène main de GitHub vers le dépôt bare du NAS. L'app est ensuite remise en service, l'ancienne version gardée à côté." },
  { id: "b-budget", titre: "Approbation", sous: "budget · gel", genre: "humain", x: 1450, y: 170, detail: "Budget du run dépassé (3 $, 80 tours, 35 par agent) : le run passe en waiting_approval au lieu de s'arrêter. budget:exceeded n'est émis qu'une fois." },
  { id: "b-quota", titre: "waiting_quota", sous: "limite d'usage", genre: "externe", x: 1450, y: 0, detail: "Une limite de quota n'est pas une erreur : l'étape attend la réinitialisation au lieu d'échouer." },
];

export const TRANSITIONS: Transition[] = [
  { de: "b-decision", vers: "b-commande" },
  { de: "b-commande", vers: "b-runner" },
  { de: "b-runner", vers: "b-deps" },
  { de: "b-deps", vers: "b-plan" },
  { de: "b-plan", vers: "b-impl" },
  { de: "b-impl", vers: "b-verify" },
  { de: "b-verify", vers: "b-verdict" },
  { de: "b-verdict", vers: "b-impl", libelle: "FAIL · maxLoops 1", issue: "fail", boucle: true },
  { de: "b-verdict", vers: "b-echec", libelle: "FAIL épuisé", issue: "fail" },
  { de: "b-verdict", vers: "b-livraison", libelle: "PASS", issue: "pass" },
  { de: "b-livraison", vers: "b-pr" },
  { de: "b-pr", vers: "b-ci" },
  { de: "b-ci", vers: "b-retour", issue: "pass" },
  { de: "b-plan", vers: "b-quota", libelle: "quota", issue: "attente" },
  { de: "b-impl", vers: "b-budget", libelle: "budget dépassé", issue: "attente" },
];

// ---------- Garde-fous : ce qui rend la boucle digne de confiance ----------

export interface GardeFou {
  titre: string;
  texte: string;
  origine: string;
}

export const GARDE_FOUS: GardeFou[] = [
  { titre: "Le juge est du code", texte: "Un gate lit un rapport et rend un verdict binaire. Un agent ne valide jamais son propre travail : l'arête qui avance part d'un script ou d'un humain.", origine: "business-pipelines, 2026-08-18" },
  { titre: "mustChange", texte: "Un gate déjà vert avant le travail n'atteste rien. Le moteur compare l'empreinte du workspace avant et après, sans compter les rapports de l'agent.", origine: "agent-orchestrator, 2026-08-17" },
  { titre: "Boucles bornées", texte: "Toute arête qui crée un cycle est couverte par un maxLoops, compté par cycle. Un aller-retour entre deux gates est un seul épisode.", origine: "Saas-generator puis moteur" },
  { titre: "Budget exécutoire", texte: "USD et tours vérifiés après chaque appel d'agent, pas en fin d'étape. Un dépassement ouvre une approbation au lieu de couper net.", origine: "moteur, phase 2" },
  { titre: "Le quota n'est pas une erreur", texte: "Une limite d'usage met l'étape en waiting_quota. Le run reprend, il n'échoue pas.", origine: "SPEC cockpit §8" },
  { titre: "Versions épinglées", texte: "Un projet référence agent@version. Une version publiée ne change plus ; la CI du registre refuse une modification.", origine: "agent-registry, 2026-09-17" },
  { titre: "Le monde extérieur passe par un stage typé", texte: "Aucun agent n'appelle une API. Un handler déterministe collecte, écrit un fichier, et l'agent lit ce fichier.", origine: "business-pipelines, 2026-08-18" },
  { titre: "Geler ce qui est décidé", texte: "Planifier et appliquer sont deux pipelines séparés par une décision humaine. On approuve un texte figé, périmé après 12 h depuis la collecte.", origine: "cycle eBay, 2026-08-17" },
  { titre: "Une seule clé, au bon endroit", texte: "Le runner seul accède au modèle, le publieur seul à GitHub, le livreur à Docker. Le cockpit exposé n'a rien à voler.", origine: "phase 5, 2026-09-24" },
  { titre: "Jamais sur internet", texte: "Cockpit, maître et modèles ne sont joignables que par le tailnet. Tailscale serve, jamais funnel.", origine: "SPEC cockpit §3" },
  { titre: "Auto-merge prouvé", texte: "Fusion automatique seulement sur CI verte au SHA exact, base inchangée, rien de sensible. Le workflow ne lance jamais le code de la PR.", origine: "norme GitHub, 2026-09-25" },
  { titre: "Pas de repli silencieux", texte: "Si le PC dort, une tâche dev est refusée clairement. Aucun Wake-on-LAN, aucune bascule cachée vers un autre modèle.", origine: "décision du 2026-09-24" },
];

// ---------- Chronologie ----------

export interface Jalon {
  date: string;
  titre: string;
  texte: string;
  projet: "saas" | "moteur" | "cockpit" | "registre" | "modeles" | "runs";
}

export const JALONS: Jalon[] = [
  { date: "2026-07-18", projet: "saas", titre: "Première app générée", texte: "Saas-generator sort tcg-generator pour 5,97 $. Pipeline web-app : plan, build, migrate, test, security, assemble." },
  { date: "2026-08-17", projet: "moteur", titre: "Le moteur sort du générateur", texte: "agent-orchestrator devient un paquet autonome. Arbitrage : le flot de contrôle va aux pipelines, pas à une boucle conversationnelle. Ajout de must_change." },
  { date: "2026-08-17", projet: "cockpit", titre: "Le moteur tient hors des fichiers", texte: "business-pipelines prouve le moteur sur des appels d'API : stage typé fetch, approbation, gel du plan après le blocage du cycle d'approbation." },
  { date: "2026-08-18", projet: "moteur", titre: "101 vérifications", texte: "Un gate sur un stage typé était ignoré en silence : corrigé. Les tests du moteur quittent le générateur. Boîte durable des décisions." },
  { date: "2026-08-20", projet: "cockpit", titre: "Le cockpit sur le téléphone", texte: "Premier cockpit de décision, joignable par Tailscale sans ouvrir de porte." },
  { date: "2026-09-05", projet: "saas", titre: "Une app générée répond", texte: "deployer_projet met tcg-generator en ligne sur le NAS. Le déploiement révèle le défaut de chemins de l'étape assemble." },
  { date: "2026-09-11", projet: "cockpit", titre: "eBay écarté, NAS seul cockpit", texte: "La forme proposer, geler, décider, agir, consigner survit à eBay. Le cockpit devient un écran d'accueil." },
  { date: "2026-09-12", projet: "cockpit", titre: "Deux voix et un arbitre", texte: "Pipeline marketing : deux analystes indépendants, un gate de code, un humain qui arbitre." },
  { date: "2026-09-15", projet: "modeles", titre: "OmniRoute réparé", texte: "Passerelle locale auditée, combos de repli refaits, claude-fallback vérifié sans appel à Anthropic." },
  { date: "2026-09-17", projet: "registre", titre: "agent-registry", texte: "21 agents importés en v1, versions épinglées. Approbations passées en SQLite." },
  { date: "2026-09-18", projet: "moteur", titre: "SPEC du cockpit agentique", texte: "Audit de phase 0 et 15 décisions. Agents par Agent SDK, event store SQLite, runs lus en direct." },
  { date: "2026-09-21", projet: "moteur", titre: "Phases 1 à 4 fusionnées", texte: "Runner et event store, moteur en graphe, maître et workers en WebSocket, cockpit en lecture." },
  { date: "2026-09-23", projet: "cockpit", titre: "Phase 4 en production", texte: "Le cockpit tourne sur le NAS. Premier lancement de Steam TierList depuis le cockpit." },
  { date: "2026-09-24", projet: "modeles", titre: "Harness de modèles", texte: "Catalogue OmniRoute dans le cockpit, choix du modèle par run, tâches dev réservées au PC sans réveil automatique." },
  { date: "2026-09-25", projet: "cockpit", titre: "Chat et auto-merge", texte: "Demander en lecture seule depuis le NAS. Runner sur l'abonnement Claude. CI et auto-merge deviennent la norme des dépôts." },
  { date: "2026-09-26", projet: "runs", titre: "Run 2 Steam : PASS 28/28", texte: "Le travail passe, le verdict casse : le moteur effaçait le rapport lu par outcomeFrom. improve-app@3 lit son propre verdict.json." },
  { date: "2026-09-27", projet: "cockpit", titre: "Option B : le publieur", texte: "Un run réussi part sur agent/, la CI et l'auto-merge le fusionnent sans relecture. Le publieur tient le seul jeton GitHub." },
  { date: "2026-09-28", projet: "runs", titre: "Steam V2 en ligne", texte: "Run 3 (ff9d5e91) : magasin façon Steam. Le publieur ramène main sur le NAS tout seul. Front AgenticOS Night City." },
  { date: "2026-09-29", projet: "cockpit", titre: "Livrer depuis le cockpit", texte: "Livreur, miroirs système, image qui se construit et se teste, carte Livraison. AI Studio phase 1." },
];

export const OUVERTS: string[] = [
  "Worker PC refusé par le maître : derrière le relais DSM, son identité Tailscale se lit 127.0.0.1",
  "Les runs tournent sur le NAS (runsOn: nas), écart provisoire à « le NAS décide, le PC calcule »",
  "Phase 5 à finir : pause, reprise, stop, relance depuis une étape, approbation par commande, jauge de quota",
  "Relier chaque commande à son run_id et afficher la raison d'un refus",
  "fingerprint ignore les fichiers commençant par un point : must_change aveugle sur .env ou .github/",
  "Saas-generator : vérification de déployabilité après assemble jamais écrite",
  "La question de fond : quelle tâche récurrente a un « fini » vérifiable par un critère binaire",
];
