// Feuille de route et défauts issus de l'audit du 17 octobre 2026 (rapport « Boucle agentique
// business pipelines »). Préfixes : AO = agent-orchestrator, BP = business-pipelines,
// REG = agent-registry, AS = agent-secrets. Mettre `statut` à jour à chaque PR qui avance un point.
import objectifsAttribuables from "./objectifs.json";

export type Statut = "a-faire" | "en-cours" | "fait";
export type Severite = "critique" | "haute" | "moyenne" | "basse";

export interface Etape {
  id: string;
  titre: string;
  detail: string;
  fichiers: string[];
  statut: Statut;
  // Un risque motivé peut renforcer la revue, en plus du classement des chemins.
  raisonSensibilite?: string;
}

export interface Lot {
  id: string;
  titre: string;
  but: string;
  prerequis?: string;
  etapes: Etape[];
}

export interface Defaut {
  id: string;
  severite: Severite;
  titre: string;
  fichiers: string;
  correctif: string;
  statut: Statut;
}

const IDS_ATTRIBUABLES = new Set(objectifsAttribuables.map((objectif) => objectif.id));
const REVISION_OBJECTIFS = new Map(objectifsAttribuables.map((objectif) => [objectif.id, objectif.revision]));
const PROJET_OBJECTIFS = new Map(objectifsAttribuables.map((objectif) => [objectif.id, objectif.projet]));

export function estAttribuable(etape: Pick<Etape, "id" | "statut">): boolean {
  return etape.statut === "a-faire" && IDS_ATTRIBUABLES.has(etape.id);
}

export function revisionObjectif(id: string): number | null {
  return REVISION_OBJECTIFS.get(id) ?? null;
}

// Le dépôt système où l'objectif se traite. null : plusieurs dépôts, à faire hors du cockpit.
export function projetObjectif(id: string): string | null {
  return PROJET_OBJECTIFS.get(id) ?? null;
}

export const DATE_AUDIT = "2026-10-17";

// Classement éditorial validé le 22 octobre : il ne change pas la priorité des runs.
export const PRIORITES = [
  {
    titre: "Fiabiliser les runs",
    detail: "Avant de relancer 0.7 : préparer les dépendances, borner la planification et conserver la cause d'arrêt ainsi que l'usage partiel. Puis traiter les délais de la file et la reprise au retour du worker (2.6, 2.7).",
    lots: ["2"],
  },
  {
    titre: "Sécuriser les fusions et les livraisons",
    detail: "Reprendre 0.7 une fois la préparation fiable, puis terminer les protections d'autorité. Ces protections restent un prérequis à toute autonomie supplémentaire.",
    lots: ["0"],
  },
  {
    titre: "Installer les garde-fous d'exploitation",
    detail: "Ordre conseillé : arrêt d'urgence (4.1), budgets (4.4), sauvegardes (4.5), santé (4.3), puis alertes externes (4.2). Raccorder l'arrêt au pilotage des runs (10.4).",
    lots: ["4"],
  },
  {
    titre: "Consolider les contrats et le pilotage",
    detail: "Stabiliser la CI entre moteur et cockpit, les versions des workers et les revues, puis améliorer le suivi des runs, le catalogue, l'attribution et le calendrier.",
    lots: ["1", "7", "6", "10", "9", "11", "12"],
  },
  {
    titre: "Étendre les métiers et simplifier l'interface",
    detail: "Compléter les branches métier pluggables après la fiabilisation, puis traiter les ajustements Finance et la lisibilité du graphe d'accueil.",
    lots: ["3", "8", "13"],
  },
  {
    titre: "Activer l'autonomie supplémentaire",
    detail: "Livrer le superviseur et les missions automatiques après mise en service et vérification des lots sécurité, fiabilité et exploitation.",
    lots: ["5"],
  },
];

export const LOTS: Lot[] = [
  {
    id: "0",
    titre: "Sécurité : fermer les failles critiques",
    but: "Retirer à un agent détourné tout chemin vers une fusion ou une livraison au nom de Raphaël, avant d'ajouter de l'autonomie.",
    etapes: [
      { id: "0.1", titre: "Sortir le runner du réseau hôte (F1)", detail: "Identité par en-tête Tailscale refusée sans preuve du proxy ; canal local refusé en écriture dans le conteneur.", fichiers: ["BP docker-compose.yaml:136", "BP src/acces.js:109-137"], statut: "en-cours" },
      { id: "0.2", titre: "Signer les commandes d'autorité (F2)", detail: "HMAC et nonce sur fusion, livraison et actions de chat ; vérification par le publieur et le livreur.", fichiers: ["BP bin/publieur.js:197", "BP bin/livreur.js:94-99", "AO src/event-store.js"], statut: "en-cours" },
      { id: "0.3", titre: "Élargir la liste des fichiers sensibles (F4)", detail: "Code d'authentification, runner, chat, worker, .claude/, .mcp.json, package.json et lockfiles.", fichiers: ["agent-gated-merge.yml:228", "BP src/pull-requests.js:30-43"], statut: "en-cours" },
      { id: "0.4", titre: "Confirmer les écritures du chat « Demander » (F5)", detail: "Plus d'outil d'écriture après la lecture d'un contenu non fiable dans le même tour.", fichiers: ["AO src/chat.js:66-85", "AO src/cockpit-read.js:228-250"], statut: "en-cours" },
      { id: "0.5", titre: "Authentifier le maître côté worker (F6, F15)", detail: "Vérifier le pair NAS, liste blanche locale, runId validé.", fichiers: ["AO src/worker.js:127-131", "AO src/worker-exec.js:59-133"], statut: "en-cours" },
      { id: "0.6", titre: "Isoler les agents de production (F7, F12, F14)", detail: "Environnement par liste blanche, hook de périmètre étendu à Bash, utilisateur non root.", fichiers: ["AO src/agent-runner.js:216-249", "REG agents/passage-extractor"], statut: "en-cours" },
      { id: "0.7", titre: "Réduire le jeton de fusion et la chaîne de livraison (F3, F8)", detail: "Jeton limité aux dépôts fusionnables ; deploy.sh figé côté livreur.", fichiers: ["BP specs/publieur.env.example", "BP src/livreur.js:167-176"], statut: "fait" },
      { id: "0.8", titre: "Durcir les workflows Claude (F11, F13)", detail: "Actions épinglées par SHA, déclencheur issues retiré, outils restreints.", fichiers: ["BP .github/workflows/claude.yml", "BP .github/workflows/claude-code-review.yml"], statut: "en-cours" },
    ],
  },
  {
    id: "1",
    titre: "Contrat moteur/cockpit et CI croisée",
    but: "Qu'une PR du moteur ne puisse plus casser la compilation du cockpit (cas TS2322 de #58 sans #118).",
    prerequis: "Lot 0",
    etapes: [
      { id: "1.1", titre: "La CI du moteur construit le front du cockpit", detail: "Job qui clone BP origin/main, branche le moteur de la PR, lance tsc et les tests.", fichiers: ["AO .github/workflows/ci.yml"], statut: "a-faire" },
      { id: "1.2", titre: "Aligner les gates de fusion", detail: "Preuve par triplet dans Steam, tcg, Saas ; agent/* admis ; CHANGES_REQUESTED bloquant.", fichiers: ["agent-gated-merge.yml:203-214"], statut: "a-faire" },
      { id: "1.3", titre: "Détecter une base déjà rouge", detail: "Un échec hérité de main ne consomme pas de tentative de correction.", fichiers: ["ci-autofix.yml:36-50,155-161"], statut: "a-faire" },
      { id: "1.4", titre: "Mettre agent-secrets à la norme", detail: "Dépôt GitHub, CI et gate de fusion.", fichiers: ["AS .github/workflows/ci.yml", "AS .github/workflows/agent-gated-merge.yml"], statut: "a-faire" },
    ],
  },
  {
    id: "2",
    titre: "Fiabilité du moteur pour des runs non surveillés",
    but: "Qu'aucun run ne reste bloqué sans fin et que chaque arrêt soit reprenable.",
    prerequis: "Lot 0",
    etapes: [
      { id: "2.1", titre: "Borner MaitreDistant.executer", detail: "Délai maximal et sortie sur abort.", fichiers: ["AO src/maitre-distant.js:62-81"], statut: "fait" },
      { id: "2.2", titre: "Classer les arrêts machine", detail: "MachineIndisponible et EtapePerdue dans ARRETS.", fichiers: ["AO src/graphe.js:353"], statut: "fait" },
      { id: "2.3", titre: "Cycle épuisé reprenable", detail: "Une approbation au lieu d'une Error générique.", fichiers: ["AO src/graphe.js:523-530"], statut: "fait" },
      { id: "2.4", titre: "Relais : vraie erreur et tests", detail: "Propager l'erreur du remplaçant.", fichiers: ["AO src/relais.js:155-167"], statut: "fait" },
      { id: "2.5", titre: "Borner Codex", detail: "Bornes de 15 min et 100 actions par défaut. Les tours, jetons observés et la session sont conservés lors des arrêts par durée, inactivité, plafond d’actions ou annulation. Complément livré sur le NAS et le worker PC (moteur #85), recette de la copie installée vérifiée sans appel modèle. Équivalent API facultatif ; les jetons des tours inachevés ne sont pas estimés.", fichiers: ["AO src/codex-runner.js:189-198, 244-245"], statut: "fait" },
      { id: "2.6", titre: "Délais sur la file unique", detail: "orch.js, scripts, git, fetch du publieur et du conseiller, deploy.sh.", fichiers: ["BP bin/commande-runner.js:68-77", "AO src/graphe.js:162-177"], statut: "a-faire" },
      { id: "2.7", titre: "Reprendre waiting_machine", detail: "Reprise programmée au retour du worker ; approval.decide hors file longue.", fichiers: ["AO src/run-waits.js", "BP bin/commande-runner.js:281-286"], statut: "a-faire" },
      { id: "2.8", titre: "Reprise automatique après un quota", detail: "Un run interrompu par un quota reprend seul, y compris sans échéance annoncée : nouvelle tentative bornée après la fenêtre d'abonnement au lieu d'attendre un clic (cas du run finance 2bf1abcc bloqué plus de 40 h).", fichiers: ["AO src/run-waits.js:84-103", "BP src/api-plans-missions.js"], statut: "a-faire" },
    ],
  },
  {
    id: "3",
    titre: "Branches métier pluggables",
    but: "Ajouter une branche par des données (nature, pipeline, agents) sans toucher au moteur ni au cockpit.",
    prerequis: "Lot 1",
    etapes: [
      { id: "3.1", titre: "Registre des natures en données", detail: "agent-registry/natures/<id>.json au lieu de l'enum developpement | marketing | finance.", fichiers: ["AO packages/schemas/plan.js:60,75", "AO packages/schemas/mission.js:23", "BP src/natures.js", "REG natures/"], statut: "fait" },
      { id: "3.2", titre: "Une seule détection de nature", detail: "Tag inconnu signalé au lieu d'un null silencieux.", fichiers: ["BP src/natures.js", "BP src/planificateur.js", "BP src/missions.js"], statut: "fait" },
      { id: "3.3", titre: "Règles par nature déclarées", detail: "Remplacer les if par nature.", fichiers: ["BP src/natures.js", "BP src/planificateur.js"], statut: "fait" },
      { id: "3.4", titre: "UI générique et page Branche", detail: "Natures servies par l'API pour la navigation et les vues.", fichiers: ["BP src/branches.js", "BP web/src/vues/Branches.tsx", "BP web/src/vues/PlanMission.tsx"], statut: "fait" },
      { id: "3.5", titre: "Discussions d'équipe par nature", detail: "Compétences et gabarit déclarés dans la nature.", fichiers: ["BP src/discussions-equipe.js", "BP src/natures.js", "AO packages/schemas/index.js", "REG natures/marketing.json"], statut: "fait" },
      { id: "3.6", titre: "Créer un projet depuis le cockpit", detail: "PR automation/ avec gabarits CI et gate.", fichiers: ["BP src/rattachements.js"], statut: "a-faire" },
      { id: "3.7", titre: "Handlers en plugins, dépôts sans Docker", detail: "Dossier de handlers par convention, montage générique.", fichiers: ["BP src/stage-handlers.js", "BP Dockerfile:25-27"], statut: "a-faire" },
      { id: "3.8", titre: "Exécuter les plans approuvés", detail: "Nœud générique pour les branches sans PR.", fichiers: ["AO src/graphe.js"], statut: "a-faire" },
    ],
  },
  {
    id: "4",
    titre: "Garde-fous d'exploitation",
    but: "Pouvoir arrêter, surveiller et restaurer la plateforme avant de la laisser décider seule.",
    prerequis: "À livrer avant le lot 5",
    etapes: [
      { id: "4.1", titre: "Arrêt d'urgence", detail: "run.cancel et pause globale de la file.", fichiers: ["AO packages/schemas/commandes.js", "BP bin/commande-runner.js"], statut: "a-faire" },
      { id: "4.2", titre: "Alertes hors du cockpit", detail: "Consommateur des événements alerte, run.failed et budgets.", fichiers: ["AO src/maitre.js:483,549,556", "BP src/alerte.js"], statut: "a-faire" },
      { id: "4.3", titre: "Santé de la plateforme", detail: "/api/sante, healthcheck Docker, rotation des logs.", fichiers: ["BP bin/cockpit.js:590-592"], statut: "a-faire" },
      { id: "4.4", titre: "Budgets", detail: "Plafond quotidien, budget mensuel aussi sur POST /api/runs.", fichiers: ["BP bin/cockpit.js:633-698"], statut: "a-faire" },
      { id: "4.5", titre: "Sauvegardes", detail: "events.sqlite, specs/ et workers.json hors NAS.", fichiers: ["BP deploy/nas/deploy.sh.modele", "AO scripts/nas/nettoyer-runs.sh:11"], statut: "a-faire" },
    ],
  },
  {
    id: "5",
    titre: "Superviseur de boucle et déclencheurs",
    but: "Des runs lancés et relancés sans clic, sous des bornes globales.",
    prerequis: "Lots 0, 2 et 4 en service",
    etapes: [
      { id: "5.1", titre: "Déclencheurs durables", detail: "Planification dans l'event store et webhooks, identité de service signée.", fichiers: ["AO src/event-store.js"], statut: "a-faire" },
      { id: "5.2", titre: "Superviseur côté cockpit", detail: "Missions de correction bornées après run échoué, CI rouge persistante ou findings P2/P3.", fichiers: ["BP src/missions.js", "AO src/mission.js:18-90"], statut: "a-faire" },
      { id: "5.3", titre: "Correcteur des échecs de main", detail: "Mission sur branche automation/ quand la CI de main est rouge.", fichiers: ["ci-autofix.yml:39"], statut: "a-faire" },
      { id: "5.4", titre: "Escalade par changement de modèle", detail: "Utiliser le secours selon une politique écrite.", fichiers: ["BP src/missions.js:77-89"], statut: "a-faire" },
    ],
  },
  {
    id: "6",
    titre: "Réviseur GitHub relié au correcteur",
    but: "Une revue qui rend un verdict sur le SHA exact et déclenche une correction bornée.",
    prerequis: "Lot 0.8",
    etapes: [
      { id: "6.1", titre: "Revue avec verdict", detail: "Diagnostiquer la revue muette, allowed_bots: claude.", fichiers: ["BP .github/workflows/claude-code-review.yml"], statut: "a-faire" },
      { id: "6.2", titre: "Gate qui exige ce verdict", detail: "Fusion seulement avec une revue sur la tête courante.", fichiers: ["agent-gated-merge.yml"], statut: "a-faire" },
      { id: "6.3", titre: "Correcteur déclenché par la revue", detail: "Mêmes bornes et même isolement que ci-autofix.", fichiers: ["ci-autofix.yml"], statut: "a-faire" },
      { id: "6.4", titre: "Relance bornée après arrêt", detail: "Une tentative de plus si l'échec porte sur une autre étape (cas #120).", fichiers: ["ci-autofix.yml"], statut: "en-cours" },
      { id: "6.5", titre: "Hook Stop local nettoyé", detail: "Log assaini, échec de revue dû au quota ignoré.", fichiers: ["~/.claude/hooks/ci-pr/stop_ci.py"], statut: "a-faire" },
    ],
  },
  {
    id: "7",
    titre: "Basculement machine et versions",
    but: "Ne plus dépendre d'un seul PC et éviter la dérive entre NAS et worker.",
    etapes: [
      { id: "7.1", titre: "Machine de remplacement par nœud", detail: "Wake-on-LAN réactivé si le PC reste seul.", fichiers: ["BP docker-compose.yaml:117-119"], statut: "a-faire" },
      { id: "7.2", titre: "Contrôle de dérive worker/NAS", detail: "Unité systemd versionnée sur la copie figée.", fichiers: ["AO deploy/systemd/orch-worker.service"], statut: "a-faire" },
      { id: "7.3", titre: "deploy.sh qui respecte les runs vivants", detail: "Refuser de couper un run ; npm ci dans le Dockerfile.", fichiers: ["BP deploy/nas/deploy.sh.modele:106-110", "BP Dockerfile"], statut: "a-faire" },
    ],
  },
  // Lots 8 à 13 : page Notion « Cockpit amelioration » de Raphaël, validée le 2026-10-22.
  {
    id: "8",
    titre: "Finance",
    but: "Une page Finance sans élément parasite.",
    etapes: [
      { id: "8.1", titre: "Remettre « En cours » dans sa colonne", detail: "Finance réserve la colonne de droite aux runs vivants, comme l'Accueil, avec défilement indépendant du contenu financier.", fichiers: ["BP web/src/App.tsx", "BP web/src/style.css"], statut: "fait" },
    ],
  },
  {
    id: "9",
    titre: "Pipelines : le catalogue",
    but: "Une page qui ne montre que les pipelines enregistrés, prêts à l'emploi, et permet d'en créer ou d'en modifier.",
    etapes: [
      { id: "9.1", titre: "N'afficher que les pipelines enregistrés", detail: "Le catalogue du registre, utilisable directement ; les runs des projets partent sur la page Run (10.1).", fichiers: ["BP web/src/vues/Pipelines.tsx", "BP web/src/donnees/pipelines.ts"], statut: "a-faire" },
      { id: "9.2", titre: "Servir /pipelines au rechargement", detail: "Un lien direct ou un F5 sur /pipelines renvoie « route inconnue » : la route manque dans la liste du serveur.", fichiers: ["BP bin/cockpit.js:442"], statut: "a-faire" },
      { id: "9.3", titre: "Créer un pipeline", detail: "Nouveau pipeline depuis la page, publié en v1 dans le registre.", fichiers: ["BP web/src/vues/Pipelines.tsx", "REG pipelines/"], statut: "a-faire", raisonSensibilite: "Publier un pipeline modifie les actions que le moteur peut exécuter." },
      { id: "9.4", titre: "Modifier un pipeline par glisser-déposer", detail: "Éditeur de graphe : ajouter, retirer, réordonner les étapes. Enregistrer publie la version suivante ; une version publiée ne change jamais et les projets restent épinglés.", fichiers: ["BP web/src/vues/Pipelines.tsx", "REG pipelines/<nom>/v<n>/pipeline.json"], statut: "a-faire", raisonSensibilite: "Modifier le graphe change les étapes exécutables et leurs contrôles." },
      { id: "9.5", titre: "Agents de secours par étape", detail: "Une liste ordonnée d'agents de secours dans la définition ; le moteur passe au suivant tout seul quand le principal n'a plus de quota.", fichiers: ["REG schemas/", "AO src/graphe.js", "BP web/src/vues/Pipelines.tsx"], statut: "a-faire", raisonSensibilite: "Changer les secours modifie les agents autorisés à exécuter une étape." },
    ],
  },
  {
    id: "10",
    titre: "Run : les pipelines en cours",
    but: "Suivre et piloter les pipelines qui tournent dans les projets.",
    etapes: [
      { id: "10.1", titre: "Page Run", detail: "Les runs des projets (aujourd'hui sur la page Pipelines) : liste à gauche, graphe et inspecteur.", fichiers: ["BP web/src/vues/Pipelines.tsx", "BP web/src/App.tsx", "BP bin/cockpit.js:442"], statut: "a-faire" },
      { id: "10.2", titre: "Changer l'agent d'une étape", detail: "Remplacer un agent sans quota ou occupé sur un run en cours.", fichiers: ["AO src/maitre.js", "BP bin/cockpit.js"], statut: "a-faire" },
      { id: "10.3", titre: "Agents de secours sur un run", detail: "Ajouter ou réordonner les secours d'un run en cours ; reprise automatique sur le suivant quand le principal n'a plus de quota.", fichiers: ["AO src/maitre.js", "BP web/src/vues/EnCours.tsx"], statut: "a-faire" },
      { id: "10.4", titre: "Interrompre un run", detail: "Pause et arrêt avec leur route serveur ; le panneau En cours n'en propose aucun aujourd'hui.", fichiers: ["AO src/maitre.js", "BP bin/cockpit.js", "BP web/src/vues/EnCours.tsx:4-6"], statut: "a-faire" },
      { id: "10.5", titre: "Discuter avec l'équipe ou un agent", detail: "Fil de l'équipe du run, ou d'un agent précis.", fichiers: ["BP src/discussions-equipe.js", "BP web/src/vues/ActionsChat.tsx"], statut: "a-faire" },
      { id: "10.6", titre: "Le conseiller discute avec l'équipe", detail: "Même accès pour le conseiller du PC.", fichiers: ["BP src/conseiller.js", "BP src/api-conseiller.js"], statut: "a-faire" },
    ],
  },
  {
    id: "11",
    titre: "Coming soon",
    but: "Attribuer un objectif en choisissant qui, quand et avec quelle urgence.",
    etapes: [
      { id: "11.1", titre: "Renommer « À venir » en « Coming soon »", detail: "Menu, titre de la page et en-tête.", fichiers: ["BP web/src/App.tsx:235", "BP web/src/avenir/AVenir.tsx"], statut: "a-faire" },
      { id: "11.2", titre: "Choisir l'agent dans Attribuer", detail: "Aujourd'hui : « choisis par le planificateur ».", fichiers: ["BP web/src/avenir/AVenir.tsx:141", "BP src/objectifs-avenirs.js"], statut: "a-faire" },
      { id: "11.3", titre: "Interrupteur Prioritaire", detail: "Remplace le sélecteur Priorité : un run prioritaire passe en premier quand le quota est serré et à la reprise.", fichiers: ["BP web/src/avenir/AVenir.tsx:142", "AO src/maitre.js"], statut: "a-faire" },
      { id: "11.4", titre: "Label Sensible décidé par l'orchestrateur", detail: "Revue et tests plus sévères ; posé par l'orchestrateur, que Raphaël peut aussi cocher.", fichiers: ["BP web/src/avenir/AVenir.tsx", "AO src/maitre.js"], statut: "a-faire" },
      { id: "11.5", titre: "Planifier une tâche", detail: "Placer l'objectif dans le calendrier (lot 12) au lieu de le lancer tout de suite.", fichiers: ["BP web/src/avenir/AVenir.tsx"], statut: "fait", raisonSensibilite: "Planifier une tâche autorise un lancement différé." },
    ],
  },
  {
    id: "12",
    titre: "Calendrier",
    but: "Voir et préparer les runs prévus.",
    etapes: [
      { id: "12.1", titre: "Page Calendrier", detail: "Les runs prévus par jour de la semaine ; déclenchement par le moteur à l'heure dite.", fichiers: ["BP web/src/calendrier/Calendrier.tsx", "BP src/atelier.js", "BP bin/commande-runner.js", "BP bin/cockpit.js", "AO src/event-store.js"], statut: "fait" },
    ],
  },
  {
    id: "13",
    titre: "Accueil : un graphe lisible",
    but: "Partir d'une vue simple et déplier le détail à la demande.",
    etapes: [
      { id: "13.1", titre: "Flux depuis le milieu des cellules", detail: "Les liens des projets partent du milieu de leur bord inférieur, avec des ancrages cohérents pendant les rafraîchissements et les déplacements.", fichiers: ["BP web/src/topologie/Topologie.tsx:118"], statut: "fait" },
      { id: "13.2", titre: "Cellules déplaçables, disposition retenue", detail: "Les cellules se déplacent à la souris ou au doigt. Les positions restent dans le navigateur entre les visites, séparément sur téléphone et bureau ; « Disposition initiale » les efface.", fichiers: ["BP web/src/topologie/Topologie.tsx:195,289", "BP web/src/donnees/brouillons.ts"], statut: "fait" },
      { id: "13.3", titre: "Graphe simple au départ", detail: "La première visite montre uniquement le maître, les machines et les projets. Les étapes sont chargées à la demande quand le projet est déplié.", fichiers: ["BP web/src/topologie/disposition.ts:111"], statut: "fait" },
      { id: "13.4", titre: "Déplier une cellule", detail: "Un clic déplie ou replie les machines et projets ; les étapes clés du dernier run ouvrent leur détail dans l’inspecteur. Le clavier fonctionne aussi.", fichiers: ["BP web/src/topologie/disposition.ts", "BP web/src/topologie/Topologie.tsx"], statut: "fait" },
      { id: "13.5", titre: "Renommer « Orchestrateur » en « Maître (répartiteur) »", detail: "La cellule de pilotage s’appelle « Maître (répartiteur) » ; le projet du moteur reste « Moteur (agent-orchestrator) ».", fichiers: ["BP web/src/topologie/Topologie.tsx:88"], statut: "fait" },
    ],
  },
];

const ordreLots = PRIORITES.flatMap((priorite) => priorite.lots);
// Un futur lot absent du classement reste visible à la fin de la feuille.
const rangLot = (id: string) => ordreLots.includes(id) ? ordreLots.indexOf(id) : ordreLots.length;
const ordreExploitation = ["4.1", "4.4", "4.5", "4.3", "4.2"];
export const LOTS_PRIORISES = [...LOTS]
  .sort((a, b) => rangLot(a.id) - rangLot(b.id))
  .map((lot) => ({
    ...lot,
    etapes: [...lot.etapes].sort((a, b) =>
      Number(a.statut === "fait") - Number(b.statut === "fait") ||
      (lot.id === "4" ? ordreExploitation.indexOf(a.id) - ordreExploitation.indexOf(b.id) : 0)
    ),
  }));

export const DEFAUTS: Defaut[] = [
  { id: "F1", severite: "critique", titre: "Identité Tailscale du cockpit forgeable par un agent du runner", fichiers: "BP docker-compose.yaml:136 ; src/acces.js:109-116", correctif: "Lot 0.1", statut: "en-cours" },
  { id: "F2", severite: "critique", titre: "Commandes de fusion, livraison et chat non signées", fichiers: "BP docker-compose.yaml:87 ; bin/publieur.js:197 ; bin/livreur.js:94-99", correctif: "Lot 0.2", statut: "en-cours" },
  { id: "F3", severite: "haute", titre: "Fusion non stricte puis deploy.sh de la release exécuté en root", fichiers: "BP bin/publieur.js:223 ; src/livreur.js:167-176", correctif: "Lot 0.7", statut: "fait" },
  { id: "F4", severite: "haute", titre: "Liste sensible du gate trop courte", fichiers: "agent-gated-merge.yml:228 ; BP src/pull-requests.js:30-43", correctif: "Lot 0.3", statut: "en-cours" },
  { id: "F5", severite: "haute", titre: "Outils d'écriture du chat déclenchables par du contenu non fiable", fichiers: "AO src/chat.js:66-85", correctif: "Lot 0.4", statut: "en-cours" },
  { id: "F6", severite: "haute", titre: "Worker PC qui n'authentifie pas le maître", fichiers: "AO src/worker.js:127-131 ; src/worker-exec.js:99,133", correctif: "Lot 0.5", statut: "a-faire" },
  { id: "F7", severite: "haute", titre: "Bash hors hook de périmètre, héritage de process.env", fichiers: "AO src/agent-runner.js:216,245,249", correctif: "Lot 0.6", statut: "en-cours" },
  { id: "F8", severite: "haute", titre: "GITHUB_TOKEN_FUSION sur tous les dépôts", fichiers: "BP specs/publieur.env.example", correctif: "Lot 0.7", statut: "fait" },
  { id: "R1", severite: "haute", titre: "Attente sans borne dans MaitreDistant.executer", fichiers: "AO src/maitre-distant.js:62-81", correctif: "Lot 2.1", statut: "fait" },
  { id: "R2", severite: "haute", titre: "File unique sans délai (orch.js, scripts, git, fetch)", fichiers: "BP bin/commande-runner.js:68-77 ; AO src/graphe.js:162-177", correctif: "Lot 2.6", statut: "a-faire" },
  { id: "R3", severite: "haute", titre: "Étape Codex sans borne d’actions ni durée", fichiers: "AO src/codex-runner.js:189-198, 244-245", correctif: "Lot 2.5", statut: "fait" },
  { id: "R4", severite: "haute", titre: "Aucune sauvegarde de l'event store ni de specs/", fichiers: "BP deploy/nas/deploy.sh.modele:45-55", correctif: "Lot 4.5", statut: "a-faire" },
  { id: "R5", severite: "moyenne", titre: "Arrêts machine routés comme un échec métier", fichiers: "AO src/graphe.js:353,468-472", correctif: "Lot 2.2", statut: "fait" },
  { id: "R6", severite: "moyenne", titre: "Cycle épuisé = Error générique", fichiers: "AO src/graphe.js:523-530", correctif: "Lot 2.3", statut: "fait" },
  { id: "R7", severite: "moyenne", titre: "Relais qui masque l'erreur réelle, sans test", fichiers: "AO src/relais.js:155-167", correctif: "Lot 2.4", statut: "fait" },
  { id: "C1", severite: "moyenne", titre: "CI rouge sur main jamais transmise, base rouge imputée à la PR", fichiers: "ci-autofix.yml:39", correctif: "Lots 1.3 et 5.3", statut: "a-faire" },
  { id: "C2", severite: "moyenne", titre: "Gate ancien dans Steam, tcg, Saas ; Steam refuse agent/*", fichiers: "agent-gated-merge.yml", correctif: "Lot 1.2", statut: "a-faire" },
  { id: "C3", severite: "moyenne", titre: "Gate aveugle à CHANGES_REQUESTED sans fil inline", fichiers: "agent-gated-merge.yml:203-214", correctif: "Lot 1.2", statut: "a-faire" },
  { id: "C4", severite: "moyenne", titre: "Revue GitHub muette, en échec sur les commits de claude[bot]", fichiers: "BP claude-code-review.yml", correctif: "Lot 6.1", statut: "a-faire" },
  { id: "F11", severite: "moyenne", titre: "Workflows Claude non épinglés, id-token: write, déclenchés par issue", fichiers: "BP claude.yml:3-37", correctif: "Lot 0.8", statut: "en-cours" },
  { id: "F12", severite: "moyenne", titre: "passage-extractor cumule WebFetch, Bash et Write", fichiers: "REG agents/passage-extractor/v1/agent.md:8-14", correctif: "Lot 0.6", statut: "a-faire" },
  { id: "F9", severite: "moyenne", titre: "Vaultwarden en latest, inscriptions ouvertes au dernier constat", fichiers: "BP nas/vaultwarden/docker-compose.yaml:15", correctif: "Déployer la version AS, 2FA", statut: "a-faire" },
  { id: "F10", severite: "moyenne", titre: "IP_HEADER=X-Forwarded-For contournable depuis le loopback", fichiers: "BP nas/vaultwarden/docker-compose.yaml:34", correctif: "Corollaire de 0.1", statut: "a-faire" },
  { id: "O1", severite: "moyenne", titre: "Événements alerte sans lecteur, alerter.js jamais lancé", fichiers: "AO src/maitre.js:483 ; BP bin/alerter.js", correctif: "Lot 4.2", statut: "a-faire" },
  { id: "O2", severite: "moyenne", titre: "deploy.sh coupe le runner sans vérifier les runs", fichiers: "BP deploy/nas/deploy.sh.modele:106-110", correctif: "Lot 7.3", statut: "a-faire" },
  { id: "O3", severite: "moyenne", titre: "POST /api/runs sans contrôle du budget mensuel", fichiers: "BP bin/cockpit.js:633-698", correctif: "Lot 4.4", statut: "a-faire" },
  { id: "O4", severite: "moyenne", titre: "Tag de pipeline inconnu ignoré sans message", fichiers: "BP src/planificateur.js:26-33", correctif: "Lot 3.2", statut: "fait" },
  { id: "O5", severite: "moyenne", titre: "Hook Stop qui injecte un log brut de PR", fichiers: "~/.claude/hooks/ci-pr/stop_ci.py:53-64", correctif: "Lot 6.5", statut: "a-faire" },
  { id: "F13", severite: "basse", titre: "Actions GitHub épinglées par tag", fichiers: "ci.yml ; ci-autofix.yml", correctif: "Lot 0.8", statut: "a-faire" },
  { id: "F14", severite: "basse", titre: "Jetons Codex et Claude lisibles par les agents du runner", fichiers: "BP docker-compose.yaml:110,133", correctif: "Lot 0.6", statut: "a-faire" },
  { id: "F15", severite: "basse", titre: "runId joint au chemin sans validation", fichiers: "AO src/worker-exec.js:59-60", correctif: "Lot 0.5", statut: "en-cours" },
  { id: "B1", severite: "basse", titre: "Collision possible de branche sur 8 caractères d'UUID", fichiers: "AO src/checkpoints.js:185,202", correctif: "Suffixe plus long", statut: "a-faire" },
  { id: "B2", severite: "basse", titre: "Push de livraison en échec jamais retenté", fichiers: "AO src/checkpoints.js:203-210", correctif: "Retry borné", statut: "a-faire" },
  { id: "B3", severite: "basse", titre: "Départ silencieux d'une base périmée si fetch échoue", fichiers: "AO src/checkpoints.js:33-54", correctif: "Événement d'avertissement", statut: "a-faire" },
  { id: "B4", severite: "basse", titre: "Sortie de script tronquée à 4 000 caractères mélangés", fichiers: "AO src/graphe.js:170-176", correctif: "stderr séparé, artefact complet", statut: "a-faire" },
  { id: "B5", severite: "basse", titre: "nettoyer-runs.sh vise /volume1/git", fichiers: "AO scripts/nas/nettoyer-runs.sh:11", correctif: "/volume1/docker/git", statut: "a-faire" },
  { id: "B6", severite: "basse", titre: "Code 130 absent des sorties attendues du runner", fichiers: "BP bin/commande-runner.js:26", correctif: "L'ajouter", statut: "a-faire" },
  { id: "B7", severite: "basse", titre: "workers.json figé au démarrage du maître", fichiers: "AO src/maitre.js:53,66", correctif: "Relecture à chaud", statut: "a-faire" },
  { id: "B8", severite: "basse", titre: "Unité systemd du worker sur le checkout périmé", fichiers: "AO deploy/systemd/orch-worker.service:8,11", correctif: "Lot 7.2", statut: "a-faire" },
  { id: "B9", severite: "basse", titre: "README annonçant 128 vérifications au lieu de 276", fichiers: "BP README.md", correctif: "Mettre à jour", statut: "a-faire" },
];

export const SUGGESTIONS: string[] = [
  "Écrire la politique d'escalade (profondeur de missions dérivées, modèles de secours, budget cumulé) avant de coder le superviseur.",
  "Garder deux clics humains : fusion d'un fichier sensible et mise en production.",
  "Afficher dans la carte de livraison les commits auto-fusionnés depuis la dernière release.",
  "Ventiler le verdict des reviewers par critère d'acceptation.",
  "Faire des findings P2 et P3 une file de dette consultable avant d'en faire des missions automatiques.",
  "Séparer l'abonnement Claude de la CI de celui du poste local.",
  "Ouvrir une concurrence par projet quand le superviseur tournera.",
  "Retirer le chemin legacy marketing (orchestrator.js, pipelines/marketing.json) et le code eBay.",
  "Remplir les dossiers evals/ du registre.",
];
