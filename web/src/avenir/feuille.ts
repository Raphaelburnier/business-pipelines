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
    detail: "Ordre conseillé : arrêt d'urgence (4.1), sauvegardes (4.5), santé (4.3), puis alertes externes (4.2). Raccorder l'arrêt au pilotage des runs (10.4). Le budget des runs n'est plus suivi depuis le 24 octobre (4.4).",
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
      { id: "0.1", titre: "Sortir le runner du réseau hôte (F1)", detail: "Livré et vérifié : runner sur un réseau dédié, maître sans agents séparé, cockpit sans port publié et identité acceptée par socket uniquement. Relais local en lecture seule ; contrôles réseau et identité de production validés.", fichiers: ["BP docker-compose.yaml", "BP bin/maitre-permanent.js", "BP deploy/nas/cockpit-relais.js", "BP src/acces.js"], statut: "fait" },
      { id: "0.2", titre: "Signer les commandes d'autorité (F2)", detail: "HMAC et nonce sur fusion, livraison et actions de chat ; vérification par le publieur et le livreur.", fichiers: ["BP src/signature-commandes.js", "BP bin/publieur.js", "BP bin/livreur.js", "AO packages/schemas/commandes.js"], statut: "fait" },
      { id: "0.3", titre: "Élargir la liste des fichiers sensibles (F4)", detail: "Code d'authentification, runner, chat, worker, .claude/, .mcp.json, package.json et lockfiles.", fichiers: ["agent-gated-merge.yml:228", "BP src/pull-requests.js:30-43"], statut: "fait" },
      { id: "0.4", titre: "Confirmer les écritures du chat « Demander » (F5)", detail: "Plus d'outil d'écriture après la lecture d'un contenu non fiable dans le même tour.", fichiers: ["AO src/chat.js:66-85", "AO src/cockpit-read.js:228-250"], statut: "fait" },
      { id: "0.5", titre: "Authentifier le maître côté worker (F6, F15)", detail: "Vérifier le pair NAS, liste blanche locale, runId validé.", fichiers: ["AO src/worker.js:127-131", "AO src/worker-exec.js:59-133"], statut: "fait" },
      { id: "0.6", titre: "Isoler les agents de production (F7, F12, F14)", detail: "Agents sous un utilisateur dédié, environnement par liste blanche et jeton Claude conservé par un relais côté maître.", fichiers: ["AO src/agent-runner.js", "AO src/claude-auth-relay.js", "REG agents/passage-extractor"], statut: "fait" },
      { id: "0.7", titre: "Réduire le jeton de fusion et la chaîne de livraison (F3, F8)", detail: "Jeton limité aux dépôts fusionnables ; deploy.sh figé côté livreur.", fichiers: ["BP specs/publieur.env.example", "BP src/livreur.js:167-176"], statut: "fait" },
      { id: "0.8", titre: "Durcir les workflows Claude (F11, F13)", detail: "Actions épinglées par SHA, déclencheur issues retiré, outils restreints.", fichiers: ["BP .github/workflows/claude.yml", "BP .github/workflows/claude-code-review.yml"], statut: "fait" },
    ],
  },
  {
    id: "1",
    titre: "Contrat moteur/cockpit et CI croisée",
    but: "Qu'une PR du moteur ne puisse plus casser la compilation du cockpit (cas TS2322 de #58 sans #118).",
    prerequis: "Lot 0",
    etapes: [
      { id: "1.1", titre: "La CI du moteur construit le front du cockpit", detail: "Actif depuis le 4 novembre 2026 : chaque CI moteur vérifie le front courant du cockpit avec le moteur testé, puis lance typecheck, tests et build. Les deux versions sont consignées ; une incompatibilité bloque la CI.", fichiers: ["AO .github/workflows/ci.yml"], statut: "fait" },
      { id: "1.2", titre: "Aligner les gates de fusion", detail: "Actif dans GitHub : Steam #23, tcg #10 et Saas #9 fusionnées après CI verte. Les gates vérifient le triplet merge/tête/base et ses parents, acceptent agent/ sous les mêmes contrôles et bloquent les demandes de changements actives. Quarante scénarios par dépôt, dont une base déplacée pendant la dernière relecture, sont intégrés aux CI.", fichiers: ["agent-gated-merge.yml:203-214"], statut: "fait" },
      { id: "1.3", titre: "Détecter une base déjà rouge", detail: "Préparé : preuve de la base testée et comparaison stricte des échecs avant le compteur de corrections. Fusion des workflows et recette GitHub à vérifier avec 5.3.", fichiers: ["ci-autofix.yml:36-50,155-161"], statut: "en-cours" },
      { id: "1.4", titre: "Mettre agent-secrets à la norme", detail: "Actif dans GitHub : dépôt privé agent-secrets, installation Python verrouillée, 25 tests isolés et 44 recettes du gate. Types, paquet et CI vérifiés ; fusion automatique limitée aux PR admissibles sur le merge réellement testé, chemins privilégiés soumis à approbation.", fichiers: ["AS .github/workflows/ci.yml", "AS .github/workflows/agent-gated-merge.yml"], statut: "fait" },
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
      { id: "2.6", titre: "Délais sur la file unique", detail: "Livré sur le NAS, le livreur et le worker PC : Git, HTTP et scripts bornés, groupes de processus arrêtés et restauration contrôlée. À 6 h, le run reçoit un diagnostic et continue. Modèle de livraison approuvé par empreinte, délais configurables et 13 scénarios simulés vérifiés dans le livreur installé.", fichiers: ["BP bin/commande-runner.js", "AO src/runtime-process.js", "AO src/graphe.js", "BP deploy/nas/deploy.sh.modele"], statut: "fait" },
      { id: "2.7", titre: "Reprendre waiting_machine", detail: "Reprise durable au retour confirmé du worker, sur le même run, son contrat figé et son workspace. Trois reprises automatiques au plus sur 24 h, sans doublon après redémarrage. Maître permanent unique et décisions d'approbation hors file longue. Recette déterministe du vrai runner et tests de disponibilité WebSocket validés.", fichiers: ["AO src/run-waits.js", "AO src/maitre.js", "BP bin/commande-runner.js", "BP test/reprises-runs.test.js"], statut: "fait" },
      { id: "2.8", titre: "Reprise automatique après un quota", detail: "Le même run reprend à l'échéance fiable du fournisseur ou, sans date, après cinq heures de prudence. Trois reprises au plus par run et par compte, dates persistées et anciennes attentes adoptées une seule fois. Planificateur et file partagent le même blocage. Recettes sans modèle : même session, workspace et étapes réussies conservés après redémarrage, y compris une attente de 40 h.", fichiers: ["AO src/run-waits.js", "AO src/quota-reprise.js", "BP src/api-plans-missions.js", "BP src/atelier.js"], statut: "fait" },
      { id: "2.9", titre: "Réserve de quota Claude pour l'usage interactif", detail: "Aucun seuil initial : réserve désactivée et champ vide. L'opérateur choisit de 1 à 100 % de la fenêtre Claude de 5 h déjà consommée avant activation, sans redéploiement. Au seuil, les nouveaux départs et reprises Claude attendent ; une étape déjà en cours finit normalement, avec progression et session conservées. Une mesure fraîche sous le seuil autorise la reprise du même run ; le reset seul ne suffit pas. Mesure absente ou périmée : attente explicite si la réserve est active. Réglage et état affichés dans la barre de quota ; les autres runtimes continuent. Le seuil existant de 25 % restants sert toujours uniquement à ordonner la file.", fichiers: ["BP src/quota.js", "BP bin/commande-runner.js", "BP bin/cockpit.js", "BP web/src/vues/Kpis.tsx", "AO src/run-waits.js"], statut: "en-cours" },
      { id: "2.10", titre: "Le planificateur évite un abonnement épuisé", detail: "Le planificateur lit les relevés de quota : un abonnement dont une fenêtre passe sous 10 % restants, réinitialisée dans plus de 20 min, n'est plus proposé. Quand seul ce fournisseur incarne l'agent d'une étape, le même agent tourne chez l'autre abonnement (remplaçant de la page Agents, sinon modèle le plus courant de l'équipe) et le plan est dégradé. Chaque étape lancée reçoit aussi ce relais, que le moteur prend si le quota tombe en cours d'étape. Livré le 4 novembre (release cockpit-20261104-231841) ; vérifié en production avec la fenêtre de 5 h de Codex à 0 % : le plan proposé place l'étape implement sur claude:sonnet, marquée en repli, et le plan est dégradé.", fichiers: ["BP src/api-plans-missions.js", "BP src/planificateur.js", "BP src/missions.js", "BP src/equipe.js"], statut: "fait" },
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
      { id: "4.1", titre: "Arrêt d'urgence", detail: "Pause durable des démarrages, annulation définitive d'un run, confirmation de l'arrêt et conservation des fichiers. Livré et vérifié le 28 octobre 2026.", fichiers: ["AO packages/schemas/commandes.js", "BP bin/commande-runner.js"], statut: "fait" },
      { id: "4.2", titre: "Alertes hors du cockpit", detail: "Alertes e-mail installées sur le NAS, envois repris après une panne ; réception et restauration du journal vérifiées.", fichiers: ["BP src/alerteur.js", "BP bin/alerteur.js", "BP docker-compose.yaml"], statut: "fait" },
      { id: "4.3", titre: "Santé de la plateforme", detail: "API de santé avec contrôle d’accès, huit services surveillés et journaux bornés. Livré et vérifié en production le 1er novembre 2026.", fichiers: ["BP bin/cockpit.js:590-592"], statut: "fait" },
      { id: "4.4", titre: "Budgets", detail: "Abandonné le 24 octobre 2026 : le coût d'un run n'est plus pris en compte et n'ouvre plus d'approbation, les agents tournant sur abonnement. Seuls les tours bornent un run (moteur 97). Pas de plafond quotidien ni mensuel à construire.", fichiers: ["BP bin/cockpit.js:633-698"], statut: "fait" },
      { id: "4.5", titre: "Sauvegardes", detail: "Sauvegarde quotidienne chiffrée sur le PC : SQLite cohérent avec WAL, specs/ dont workers.json, approbations et projets. Rétention de 14 archives. Premier passage automatique et restauration de deux bases et 42 fichiers vérifiés le 28 octobre 2026.", fichiers: ["BP bin/sauvegarder-etat.js", "BP deploy/backup/exporter-etat.js"], statut: "fait" },
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
      { id: "5.3", titre: "Correcteur des échecs de main", detail: "Préparé avec 1.3 : correcteur isolé sur automation/ci-main-<sha>, réservation unique et PR soumise à la CI normale. Fusion explicite des workflows et recette GitHub attendues.", fichiers: ["ci-autofix.yml:39"], statut: "en-cours" },
      { id: "5.4", titre: "Escalade par changement de modèle", detail: "Politique écrite et validée le 7 novembre 2026 (moteur docs/ESCALADE.md) : une étape arrêtée par sa limite de tours, sans fichier modifié ou dont le cycle atteint sa limite est reprise une fois par un modèle plus fort, choisi au lancement et annoncé dans le plan. Une escalade par étape, deux par run, jamais sur quota ou panne. Moteur et cockpit en revue ; livraison puis recette sur un run réel attendues.", fichiers: ["AO src/escalade.js", "BP src/missions.js", "BP src/equipe.js"], statut: "en-cours" },
    ],
  },
  {
    id: "6",
    titre: "Réviseur GitHub relié au correcteur",
    but: "Une revue qui rend un verdict sur le SHA exact et déclenche une correction bornée.",
    prerequis: "Lot 0.8",
    etapes: [
      { id: "6.1", titre: "Revue avec verdict", detail: "Verdict structuré sur la tête et la base exactes ; erreurs et revue incomplète explicites. Recette GitHub validée : bug détecté puis nouveau commit approuvé (PR204).", fichiers: ["BP .github/workflows/claude-code-review.yml"], statut: "fait" },
      { id: "6.2", titre: "Gate qui exige ce verdict", detail: "Fusion seulement avec une revue sur la tête courante.", fichiers: ["agent-gated-merge.yml"], statut: "a-faire" },
      { id: "6.3", titre: "Correcteur déclenché par la revue", detail: "Actif dans business-pipelines : revue sur SHA exact, correctif du bot puis nouvelle revue validés en PR210. Budget commun de trois appels avec la CI et correcteur isolé.", fichiers: ["ci-autofix.yml"], statut: "fait" },
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
      { id: "7.2", titre: "Contrôle de dérive worker/NAS", detail: "En cours : aligner l’unité systemd sur la copie figée et comparer la release annoncée du worker au moteur du NAS, avec les API existantes.", fichiers: ["AO deploy/systemd/orch-worker.service"], statut: "en-cours" },
      { id: "7.3", titre: "deploy.sh qui respecte les runs vivants", detail: "Livré et vérifié : le livreur prend un verrou de maintenance avant la construction, refuse si un travail est actif, revérifie avant le premier arrêt et libère le verrou après la santé. Modèle de déploiement approuvé par empreinte, première livraison avec contrôles réussie le 6 novembre.", fichiers: ["BP deploy/nas/deploy.sh.modele", "BP Dockerfile", "BP docs/SPEC-livraison-runs-vivants.md", "AO src/controle-execution.js"], statut: "fait" },
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
      { id: "9.1", titre: "N'afficher que les pipelines enregistrés", detail: "Catalogue des pipelines enregistrés du registre, avec versions, projets, renommage et rattachement ; la vue par run attend la page Run (10.1).", fichiers: ["BP web/src/vues/Pipelines.tsx", "BP web/src/donnees/pipelines.ts"], statut: "fait" },
      { id: "9.2", titre: "Servir /pipelines au rechargement", detail: "Livré et vérifié le 29 octobre 2026 : le catalogue et ses fiches /pipelines/<id> s’ouvrent par lien direct et au rechargement, avec paramètres ou slash final. HTML 200 sans cache, derrière les contrôles d’identité et d’hôte existants.", fichiers: ["BP bin/cockpit.js:442"], statut: "fait" },
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
      { id: "10.1", titre: "Page Run", detail: "Page Run sur /run et /run/<runId> : liste des runs à gauche, graphe au centre, inspecteur à droite. Livré le 4 novembre (release cockpit-20261104-231841) ; vérifié en production : /run et /run/<runId> servent la page, /run/x/y reste en 404, et le front servi contient la route.", fichiers: ["BP web/src/vues/RunPipeline.tsx", "BP web/src/App.tsx", "BP bin/cockpit.js:442"], statut: "fait" },
      { id: "10.2", titre: "Changer l'agent d'une étape", detail: "Remplacer un agent sans quota ou occupé sur un run en cours.", fichiers: ["AO src/maitre.js", "BP bin/cockpit.js"], statut: "a-faire" },
      { id: "10.3", titre: "Agents de secours sur un run", detail: "Ajouter ou réordonner les secours d'un run en cours ; reprise automatique sur le suivant quand le principal n'a plus de quota.", fichiers: ["AO src/maitre.js", "BP web/src/vues/EnCours.tsx"], statut: "a-faire" },
      { id: "10.4", titre: "Interrompre un run", detail: "Pause et arrêt avec leur route serveur ; le panneau En cours n'en propose aucun aujourd'hui.", fichiers: ["AO src/maitre.js", "BP bin/cockpit.js", "BP web/src/vues/EnCours.tsx:4-6"], statut: "a-faire" },
      { id: "10.5", titre: "Discuter avec l'équipe ou un agent", detail: "Fil de l'équipe du run, ou d'un agent précis.", fichiers: ["BP src/discussions-equipe.js", "BP web/src/vues/ActionsChat.tsx"], statut: "a-faire" },
      { id: "10.6", titre: "Le conseiller discute avec l'équipe", detail: "Même accès pour le conseiller du PC.", fichiers: ["BP src/conseiller.js", "BP src/api-conseiller.js"], statut: "a-faire" },
    ],
  },
  {
    id: "11",
    titre: "TaskBoard : attribution des tâches",
    but: "Attribuer un objectif en choisissant qui, quand et avec quelle urgence.",
    etapes: [
      { id: "11.2", titre: "Choisir l'agent dans Attribuer", detail: "Chaque rôle du plan permet le choix automatique ou un membre compatible. Un choix explicite est vérifié, puis le plan doit être recalculé et relu avant le départ immédiat ou planifié.", fichiers: ["BP web/src/avenir/AVenir.tsx", "BP src/planificateur.js", "AO packages/schemas/plan.js"], statut: "fait" },
      { id: "11.3", titre: "Interrupteur Prioritaire", detail: "Un interrupteur Run prioritaire remplace les trois niveaux dans À venir et le Calendrier ; la file existante applique haute ou normale, après les reprises admissibles.", fichiers: ["BP web/src/InterrupteurPrioritaire.tsx", "BP web/src/avenir/AVenir.tsx", "BP web/src/calendrier/Calendrier.tsx"], statut: "fait" },
      { id: "11.4", titre: "Label Sensible décidé par l'orchestrateur", detail: "Le serveur impose la sensibilité des fichiers annoncés et du risque de cadrage. Raphaël peut ajouter une revue de sécurité ; les critères renforcés et la revue indépendante sont figés dans le contrat, y compris pour un départ planifié.", fichiers: ["BP web/src/avenir/AVenir.tsx", "BP src/objectifs-avenirs.js", "BP src/missions.js"], statut: "fait" },
      { id: "11.5", titre: "Planifier une tâche", detail: "Placer l'objectif dans le calendrier (lot 12) au lieu de le lancer tout de suite.", fichiers: ["BP web/src/avenir/AVenir.tsx"], statut: "fait", raisonSensibilite: "Planifier une tâche autorise un lancement différé." },
    ],
  },
  {
    id: "12",
    titre: "Calendrier",
    but: "Voir et préparer les runs prévus.",
    etapes: [
      { id: "12.1", titre: "Page Calendrier", detail: "Les runs prévus par jour de la semaine ; déclenchement par le moteur à l'heure dite.", fichiers: ["BP web/src/calendrier/Calendrier.tsx", "BP src/atelier.js", "BP bin/commande-runner.js", "BP bin/cockpit.js", "AO src/event-store.js"], statut: "fait" },
      { id: "12.2", titre: "Unifier À venir et le calendrier", detail: "Réunir la liste À venir et le calendrier sur une page, avec le calendrier comme vue principale, les filtres existants, les vues semaine et mois, et le glisser-déposer des tâches À venir sur une date. Déposer une tâche crée un run agent programmé pour cette journée, sans demander d'heure : il devient éligible dès que quota et worker sont disponibles, puis reprend automatiquement dès le retour du quota, sans plafond de tentatives propre au calendrier. Aucun arrêt à minuit : les runs actifs continuent tant que le quota le permet et les runs inachevés reprennent aussi les jours suivants. En déplaçant un run déjà programmé, conserver son heure ; les tâches récurrentes gardent leur récurrence. Les tâches système sont planifiables comme les objectifs projet ; pour une tâche multi-dépôts, l'orchestrateur propose un plan qui doit être validé avant lancement. Mettre immédiatement en file tous les runs prêts et les exécuter en parallèle dans les limites de capacité des workers et des quotas disponibles, sans sérialiser les objectifs. Quand le quota restant le plus bas d'une fenêtre Claude Code ou Codex passe strictement sous 25 %, ordonner les reprises, puis les runs prioritaires, puis les autres en FIFO, sans interrompre les runs actifs ; à 25 % ou plus, revenir à l'ordre normal. Si le quota est inconnu, conserver l'ordre normal et signaler l'état inconnu. Exclure le run 2.6 de ce lot.", fichiers: ["BP web/src/TaskBoard.tsx", "BP web/src/avenir/AVenir.tsx", "BP web/src/calendrier/Calendrier.tsx", "BP src/taskboard.js", "BP src/atelier.js", "BP bin/commande-runner.js", "AO src/run-waits.js", "AO src/worker.js"], statut: "fait" },
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
  {
    // Document « Setup agentique » du 31 octobre : 14.1 à 14.15 suivent son ordre conseillé,
    // 14.16 à 14.18 reprennent les garde-fous de sa section 4 absents de cet ordre.
    id: "14",
    titre: "Setup agentique : règles communes, garde-fous et providers",
    but: "Chaque règle vit dans un seul fichier lu par Claude Code et Codex, et chaque invariant critique est doublé par un garde-fou qui ne dépend pas du modèle.",
    etapes: [
      { id: "14.1", titre: "AGENTS.md commun dans le registre", detail: "Créer shared/AGENTS.md (communication, approbations, invariants de sécurité, contenu externe traité comme une donnée), l'importer par une ligne @ dans ~/.claude/CLAUDE.md et en faire le lien ~/.codex/AGENTS.md depuis WSL. Vérifier avec /context côté Claude Code et en demandant ses règles d'approbation à Codex. Une ligne n'y entre que si, sans elle, un agent ferait une erreur. Fait le 4 novembre (registre #27) : import en tête de ~/.claude/CLAUDE.md et lien ~/.codex/AGENTS.md vers un worktree du registre sur main ; Claude Code et Codex citent la règle d'accord du fichier commun.", fichiers: ["REG shared/AGENTS.md", "~/.claude/CLAUDE.md", "~/.codex/AGENTS.md"], statut: "fait" },
      { id: "14.2", titre: "Skill agentic-os versionné dans le registre", detail: "Le skill existe, synchronisé depuis claude.ai. Le placer dans skills/agentic-os/SKILL.md du registre, le lier pour Claude Code et Codex, vérifier avec /skills. Compléter ses points ouverts : sens des labels des tâches planifiées, règles de correction du registre. Tout changement d'architecture met à jour le skill dans le même commit. Fait le 7 novembre (registre #29 et #32) : skill lié pour Claude Code et Codex depuis une copie de main, lu par les deux ; labels = statut de la tâche dans le TaskBoard ; règles de correction reprises du README du registre. Reste hors dépôt : retirer la copie synchronisée claude.ai.", fichiers: ["REG skills/agentic-os/SKILL.md", "~/.claude/skills/agentic-os/", "~/.codex/skills/agentic-os/"], statut: "fait" },
      { id: "14.3", titre: "Liste sensible protégée par elle-même", detail: "deploy/fichiers-sensibles.json est couvert par le motif deploy/ de la liste et du workflow de fusion : le modifier impose une fusion explicite. La règle locale qui en interdit l'édition est suivie en 14.16.", fichiers: ["BP deploy/fichiers-sensibles.json", "BP .github/workflows/agent-gated-merge.yml"], statut: "fait" },
      { id: "14.4", titre: "Hook de fusion qui lit le champ sensibles", detail: "Hook PreToolUse dans settings.json, sur Bash et sur les outils MCP capables de fusionner. Si la commande fusionne (gh pr merge, git merge, push vers une branche protégée), il lit le champ sensibles de la PR et bloque avec la raison quand la règle du AGENTS.md commun l'interdit. L'instantané etat/pull-requests.json n'est dans aucun dépôt : le publieur l'écrit dans le dossier etat/ du cockpit sur le NAS, et GET /api/pull-requests l'expose ; le hook le lit par cette route. Le mod garde-fou retient déjà les gh pr merge sans --squash ni --match-head-commit, sans lire sensibles. Tester par une fusion volontairement interdite.", fichiers: ["~/.claude/settings.json", "BP src/api-pull-requests.js", "BP bin/publieur.js"], statut: "a-faire" },
      { id: "14.5", titre: "Garde-fou de livraison", detail: "Identifier la commande qui déclenche un déploiement, puis la bloquer hors du cockpit par un hook ou une règle permissions.deny. Bloqué tant que la commande n'est pas identifiée.", fichiers: ["~/.claude/settings.json", "BP src/livreur.js"], statut: "a-faire" },
      { id: "14.6", titre: "AGENTS.md et CLAUDE.md dans les trois dépôts", detail: "AGENTS.md à la racine de business-pipelines, agent-orchestrator et agent-registry, et un CLAUDE.md qui l'importe avec le seul spécifique à Claude Code. Partir de /init puis élaguer sous 200 lignes : commandes, conventions qui diffèrent des défauts, pièges, raisons des choix. Une ligne entre quand un agent refait la même erreur. Les règles limitées à un dossier vont dans .claude/rules/ avec un champ paths.", fichiers: ["BP AGENTS.md", "BP CLAUDE.md", "AO AGENTS.md", "REG AGENTS.md"], statut: "a-faire" },
      { id: "14.7", titre: "Confidentialité des providers candidats", detail: "Avant toute évaluation : entraînement sur les requêtes et possibilité de le refuser, durée de conservation, relecture humaine. Noter un niveau de confiance par provider à côté de la liste blanche, par une PR validée. Données publiques : tous ; internes : providers de confiance ; sensibles : aucun provider externe sans validation explicite.", fichiers: ["REG liste blanche des providers"], statut: "a-faire" },
      { id: "14.8", titre: "Champs modèle et profil dans le registre", detail: "Chaque étape de pipeline déclare son profil (mécanique ou jugement), ses providers autorisés et un modèle par défaut à l'identifiant exact, jamais un alias de type latest. Un modèle disparu est traité comme une panne.", fichiers: ["REG pipelines/", "REG agents/"], statut: "a-faire" },
      { id: "14.9", titre: "--model dans le moteur, modèle enregistré par run", detail: "Le moteur choisit le modèle parmi les providers autorisés, lance l'agent avec --model et enregistre le modèle réellement utilisé dans le résultat du run ; le cockpit peut le surcharger au lancement. Pas de repli silencieux : un provider en échec arrête le run et demande une approbation. Un seul modèle par run ; sur « trop de requêtes », nouvelle tentative avec attente progressive sur le même provider.", fichiers: ["AO src/agent-runner.js", "BP bin/cockpit.js"], statut: "a-faire" },
      { id: "14.10", titre: "Pipeline d'évaluation par provider", detail: "Lancé à la main : 2 ou 3 candidats par profil, les mêmes tâches tirées des vrais pipelines (dont une tâche avec outils), 3 passages par tâche pour un taux de réussite, budget maximum affiché avant lancement, code non sensible ou anonymisé. Les résultats sont écrits dans le registre comme des mesures ; la liste blanche ne change que par PR.", fichiers: ["REG pipelines/"], statut: "a-faire" },
      { id: "14.11", titre: "Séparer lecture externe et outils dangereux", detail: "Dans le registre, un agent qui lit du contenu externe n'a ni fusion, ni écriture hors du dépôt, ni accès aux secrets ; l'agent qui agit est un autre agent. C'est la défense structurelle contre l'injection de prompt.", fichiers: ["REG agents/"], statut: "a-faire" },
      { id: "14.12", titre: "Journal d'audit par hook PostToolUse", detail: "Pour chaque run : agent, modèle, commandes exécutées, approbations demandées et accordées, écrits par un hook sans intervention de l'agent. Sert à comprendre un incident et alimente les KPI du cockpit.", fichiers: ["~/.claude/settings.json"], statut: "a-faire" },
      { id: "14.13", titre: "Pipeline de test des garde-fous", detail: "Un pipeline du registre tente les actions interdites (fusion sensible, lecture d'un secret, livraison, instruction cachée dans un contenu externe) et vérifie que chacune est refusée avec un message clair. Relancé à chaque modification d'AGENTS.md, des hooks ou de deploy/fichiers-sensibles.json.", fichiers: ["REG pipelines/"], statut: "a-faire" },
      { id: "14.14", titre: "Un worktree git par run", detail: "Deux runs ne se marchent pas dessus et un run raté se jette sans toucher au checkout principal. pnpm et son cache partagé évitent un node_modules complet par worktree. Les dépôts restent dans le système de fichiers WSL, jamais sous /mnt/c.", fichiers: ["AO src/checkpoints.js"], statut: "a-faire" },
      { id: "14.15", titre: "Snapshots Btrfs sur le NAS", detail: "Activer les snapshots Synology sur les dossiers que les agents touchent : un retour arrière que le rewind de Claude Code n'offre pas.", fichiers: ["NAS dossiers partagés touchés par les agents"], statut: "a-faire" },
      { id: "14.16", titre: "Règles permissions.deny", detail: "Interdire l'édition de deploy/fichiers-sensibles.json et la lecture des fichiers de secrets. Valider la syntaxe des chemins avec /permissions, puis tester chaque règle par une action volontairement interdite.", fichiers: ["~/.claude/settings.json", "BP deploy/fichiers-sensibles.json"], statut: "a-faire" },
      { id: "14.17", titre: "/sandbox pour les runs", detail: "Deuxième niveau d'isolation, après le worktree : système de fichiers et réseau limités par l'OS. Vérifier sa disponibilité sous WSL ; au début, un accès bloqué fait échouer une étape.", fichiers: ["AO src/agent-runner.js"], statut: "a-faire" },
      { id: "14.18", titre: "Un conteneur Docker par run", detail: "Troisième niveau d'isolation : le run ne voit que le dépôt concerné. Image avec les dépendances déjà installées, environ une seconde au démarrage.", fichiers: ["AO src/worker.js"], statut: "a-faire" },
    ],
  },
  {
    // Même document, sections 3, 5 et 6 : idées, « plus tard » et options écartées pour l'instant.
    // Chaque détail nomme le déclencheur qui justifie de lancer l'étape.
    id: "15",
    titre: "Setup agentique : idées à déclencher",
    but: "Garder visibles les idées du document « Setup agentique » qui attendent un déclencheur, pour les lancer au bon moment sans les perdre.",
    prerequis: "Le fichier commun (14.1) et le skill versionné (14.2) passent avant ces idées.",
    etapes: [
      { id: "15.1", titre: "Préférence d'apprentissage dans le CLAUDE.md global", detail: "Sous l'import du fichier commun, une ligne pour les dossiers d'apprentissage comme Transformer from scratch : expliquer avant de coder et proposer des indices plutôt que la solution complète. Claude Code n'écrit alors pas tout sur un projet dont le but est d'apprendre.", fichiers: ["~/.claude/CLAUDE.md"], statut: "a-faire" },
      { id: "15.2", titre: "Habitudes de contexte", detail: "La règle /compact est dans ~/.claude/CLAUDE.md depuis le 30 octobre : le résumé garde le plan validé et les fichiers modifiés, et /compact est proposé après un plan validé ou entre deux étapes, jamais en plein travail. Restent : /clear entre deux tâches sans rapport, /clear et un meilleur prompt après deux corrections ratées sur le même point, un sous-agent pour une exploration lourde.", fichiers: ["~/.claude/CLAUDE.md"], statut: "en-cours" },
      { id: "15.3", titre: "Conventions /model en session", detail: "/model <nom OmniRoute> change de provider ; pour une seule session, /model sans argument puis s sur la ligne choisie. Les alias sonnet, opus et haiku restent Claude : les lanceurs OmniRoute du PC les redéfinissent encore et sont à corriger. Pas d'availableModels restrictif dans les settings (absent aujourd'hui), sinon /model refuse de changer. /model ne vérifie pas la liste blanche : pas de provider non autorisé pour des données internes ou sensibles, même en session.", fichiers: ["~/.claude/settings.json", "~/.local/bin/claude-omni", "~/.zshrc"], statut: "a-faire" },
      { id: "15.4", titre: "Skills à effets de bord en invocation explicite", detail: "Un skill qui déploie ou publie prend disable-model-invocation: true côté Claude Code et allow_implicit_invocation: false côté Codex : il ne s'exécute que si on l'appelle. Recenser les skills concernés quand ils passent dans le registre.", fichiers: ["REG skills/", "~/.claude/skills/"], statut: "a-faire" },
      { id: "15.5", titre: "Skill db-schema", detail: "Schéma Supabase et patterns de requêtes. Déclencheur : le schéma est recollé à la main dans une session.", fichiers: ["REG skills/db-schema/SKILL.md"], statut: "a-faire" },
      { id: "15.6", titre: "Skill new-endpoint", detail: "Ajout d'une route FastAPI : schéma Pydantic, test pytest, documentation. Déclencheur : un troisième endpoint ajouté à la main.", fichiers: ["REG skills/new-endpoint/SKILL.md"], statut: "a-faire" },
      { id: "15.7", titre: "Skill de conventions Obsidian", detail: "Format des notes du vault. Déclencheur : une note mal formatée de trop.", fichiers: ["REG skills/conventions-obsidian/SKILL.md"], statut: "a-faire" },
      { id: "15.8", titre: "Relecture par un modèle non-Claude", detail: "Écarté en général : des sous-agents Claude Code sur un autre provider doubleraient agent-registry. À reconsidérer pour une relecture interactive par un modèle qui ne partage pas les angles morts de l'auteur du code : champ model d'un fichier .claude/agents/<nom>.md, avec un nom de modèle OmniRoute à tester. Les sous-agents intégrés comme Explore restent sur Claude et son quota.", fichiers: ["~/.claude/agents/"], statut: "a-faire" },
      { id: "15.9", titre: "Page d'évaluation des providers dans le cockpit", detail: "À construire quand l'historique d'évaluation (14.10) le justifie. Lecture seule : tableau provider × profil avec taux de réussite, coût, durée, niveau de confiance, version épinglée et date d'évaluation. Lancement d'une évaluation avec le budget estimé affiché avant confirmation. La liste blanche change par une PR créée depuis la page, jamais par écriture directe ; la logique d'évaluation reste dans le pipeline.", fichiers: ["BP web/src/vues/", "REG résultats d'évaluation"], statut: "a-faire" },
      { id: "15.10", titre: "Design system tiré du front React", detail: "Avec /design-sync, pour que les écrans, slides et visuels partagent la même identité. Pour le cockpit, partir de la palette et de la police Cyberpunk 2077 déjà choisies. Déroulé : brief, design sur le canvas, handoff vers Claude Code, vérification visuelle contre le canvas.", fichiers: ["BP web/src/style.css", "BP web/src/taskboard.css"], statut: "a-faire" },
      { id: "15.11", titre: "Versionner la config locale de Claude Code", detail: "~/.claude/settings.json, les scripts de hooks et ~/.claude/CLAUDE.md dans le registre, avec un petit script d'installation qui crée les liens. Les garde-fous survivent à une panne du PC, et c'est la base du plugin (15.12).", fichiers: ["REG config locale et script d'installation", "~/.claude/settings.json", "~/.claude/CLAUDE.md"], statut: "a-faire" },
      { id: "15.12", titre: "Plugin du setup", detail: "Quand le setup est stable : AGENTS.md, skills et hooks emballés dans un plugin versionné dans le registre, réinstallable en une commande, par exemple sur le futur homelab.", fichiers: ["REG plugin du setup"], statut: "a-faire" },
      { id: "15.13", titre: "Règles communes pour un modèle local", detail: "Un modèle local peut recevoir AGENTS.md et le skill par le prompt système que l'orchestrateur lui passe. Il n'est jamais le seul garde-fou : les règles critiques restent appliquées par le code.", fichiers: ["AO src/agent-runner.js"], statut: "a-faire" },
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
  { id: "F1", severite: "critique", titre: "Identité Tailscale du cockpit forgeable par un agent du runner", fichiers: "BP docker-compose.yaml ; src/acces.js ; deploy/nas/cockpit-relais.js", correctif: "Lot 0.1", statut: "fait" },
  { id: "F2", severite: "critique", titre: "Commandes de fusion, livraison et chat non signées", fichiers: "BP docker-compose.yaml:87 ; bin/publieur.js:197 ; bin/livreur.js:94-99", correctif: "Lot 0.2", statut: "fait" },
  { id: "F3", severite: "haute", titre: "Fusion non stricte puis deploy.sh de la release exécuté en root", fichiers: "BP bin/publieur.js:223 ; src/livreur.js:167-176", correctif: "Lot 0.7", statut: "fait" },
  { id: "F4", severite: "haute", titre: "Liste sensible du gate trop courte", fichiers: "agent-gated-merge.yml:228 ; BP src/pull-requests.js:30-43", correctif: "Lot 0.3", statut: "fait" },
  { id: "F5", severite: "haute", titre: "Outils d'écriture du chat déclenchables par du contenu non fiable", fichiers: "AO src/chat.js:66-85", correctif: "Lot 0.4", statut: "fait" },
  { id: "F6", severite: "haute", titre: "Worker PC qui n'authentifie pas le maître", fichiers: "AO src/worker.js:127-131 ; src/worker-exec.js:99,133", correctif: "Lot 0.5 : limites locales du worker (moteur #98), agents sous l'uid 1100 (#101), maître sur le port 650 réservé à root (cockpit #187), vérifié le 2026-10-25", statut: "fait" },
  { id: "F7", severite: "haute", titre: "Bash hors hook de périmètre, héritage de process.env", fichiers: "AO src/agent-runner.js:216,245,249", correctif: "Lot 0.6 : agents et nœuds script sous l'uid 1100 (moteur #101, cockpit #185), vérifié en production le 2026-10-25", statut: "fait" },
  { id: "F8", severite: "haute", titre: "GITHUB_TOKEN_FUSION sur tous les dépôts", fichiers: "BP specs/publieur.env.example", correctif: "Lot 0.7", statut: "fait" },
  { id: "R1", severite: "haute", titre: "Attente sans borne dans MaitreDistant.executer", fichiers: "AO src/maitre-distant.js:62-81", correctif: "Lot 2.1", statut: "fait" },
  { id: "R2", severite: "haute", titre: "File unique sans délai (orch.js, scripts, git, fetch)", fichiers: "BP bin/commande-runner.js ; AO src/graphe.js ; BP deploy/nas/deploy.sh.modele", correctif: "Lot 2.6 livré : opérations bornées, diagnostic des runs longs sans interruption", statut: "fait" },
  { id: "R3", severite: "haute", titre: "Étape Codex sans borne d’actions ni durée", fichiers: "AO src/codex-runner.js:189-198, 244-245", correctif: "Lot 2.5", statut: "fait" },
  { id: "R4", severite: "haute", titre: "Aucune sauvegarde de l'event store ni de specs/", fichiers: "BP deploy/nas/deploy.sh.modele:45-55", correctif: "Lot 4.5 livré : copie quotidienne chiffrée hors NAS et restauration vérifiée", statut: "fait" },
  { id: "R5", severite: "moyenne", titre: "Arrêts machine routés comme un échec métier", fichiers: "AO src/graphe.js:353,468-472", correctif: "Lot 2.2", statut: "fait" },
  { id: "R6", severite: "moyenne", titre: "Cycle épuisé = Error générique", fichiers: "AO src/graphe.js:523-530", correctif: "Lot 2.3", statut: "fait" },
  { id: "R7", severite: "moyenne", titre: "Relais qui masque l'erreur réelle, sans test", fichiers: "AO src/relais.js:155-167", correctif: "Lot 2.4", statut: "fait" },
  { id: "C1", severite: "moyenne", titre: "CI rouge sur main jamais transmise, base rouge imputée à la PR", fichiers: "ci-autofix.yml:39", correctif: "Lots 1.3 et 5.3", statut: "en-cours" },
  { id: "C2", severite: "moyenne", titre: "Gate ancien dans Steam, tcg, Saas ; Steam refuse agent/*", fichiers: "agent-gated-merge.yml", correctif: "Lot 1.2 : preuve du triplet exact, parents vérifiés et agent/ soumis aux mêmes contrôles ; trois PR fusionnées", statut: "fait" },
  { id: "C3", severite: "moyenne", titre: "Gate aveugle à CHANGES_REQUESTED sans fil inline", fichiers: "agent-gated-merge.yml:203-214", correctif: "Lot 1.2 : revues paginées et dernière décision par auteur, relues avant fusion ; une demande active bloque sans fil inline", statut: "fait" },
  { id: "C4", severite: "moyenne", titre: "Revue GitHub muette, en échec sur les commits de claude[bot]", fichiers: "BP claude-code-review.yml", correctif: "Lot 6.1", statut: "fait" },
  { id: "F11", severite: "moyenne", titre: "Workflows Claude non épinglés, id-token: write, déclenchés par issue", fichiers: "BP claude.yml:3-37", correctif: "Lot 0.8 ; id-token: write gardé, requis par claude-code-action pour son jeton", statut: "fait" },
  { id: "F12", severite: "moyenne", titre: "passage-extractor cumule WebFetch, Bash et Write", fichiers: "REG agents/passage-extractor/v1/agent.md:8-14", correctif: "Lot 0.6 : passage-extractor v2 sans Bash (registre #25)", statut: "fait" },
  { id: "F9", severite: "moyenne", titre: "Vaultwarden en latest, inscriptions ouvertes au dernier constat", fichiers: "BP nas/vaultwarden/docker-compose.yaml:15", correctif: "Vaultwarden 1.37.4 épinglé par digest, inscriptions fermées dans le compose, durcissement d'agent-secrets (cockpit #189), en production le 2026-10-25 ; double authentification à garder active sur le compte", statut: "fait" },
  { id: "F10", severite: "moyenne", titre: "IP_HEADER=X-Forwarded-For contournable depuis le loopback", fichiers: "BP nas/vaultwarden/docker-compose.yaml:34", correctif: "IP_HEADER=none : plus d'adresse forgeable, limites d'essais partagées (cockpit #189), en production le 2026-10-25", statut: "fait" },
  { id: "O1", severite: "moyenne", titre: "Événements alerte sans lecteur, alerter.js jamais lancé", fichiers: "AO src/maitre.js:483 ; BP bin/alerter.js", correctif: "Lot 4.2", statut: "fait" },
  { id: "O2", severite: "moyenne", titre: "deploy.sh coupe le runner sans vérifier les runs", fichiers: "BP deploy/nas/deploy.sh.modele:106-110", correctif: "Lot 7.3", statut: "a-faire" },
  { id: "O3", severite: "moyenne", titre: "POST /api/runs sans contrôle du budget mensuel", fichiers: "BP bin/cockpit.js:633-698", correctif: "Sans objet : budget des runs abandonné le 24 octobre (4.4)", statut: "fait" },
  { id: "O4", severite: "moyenne", titre: "Tag de pipeline inconnu ignoré sans message", fichiers: "BP src/planificateur.js:26-33", correctif: "Lot 3.2", statut: "fait" },
  { id: "O5", severite: "moyenne", titre: "Hook Stop qui injecte un log brut de PR", fichiers: "~/.claude/hooks/ci-pr/stop_ci.py:53-64", correctif: "Lot 6.5", statut: "a-faire" },
  { id: "F13", severite: "basse", titre: "Actions GitHub épinglées par tag", fichiers: "ci.yml ; ci-autofix.yml", correctif: "Lot 0.8", statut: "fait" },
  { id: "F14", severite: "basse", titre: "Jetons Codex et Claude lisibles par les agents du runner", fichiers: "BP docker-compose.yaml:110,133", correctif: "Lot 0.6 : jeton Codex protégé dans le home root ; jeton Claude conservé côté maître par un relais local éphémère, environnement du CLI filtré avant le lancement", statut: "fait" },
  { id: "F15", severite: "basse", titre: "runId joint au chemin sans validation", fichiers: "AO src/worker-exec.js:59-60", correctif: "Lot 0.5", statut: "fait" },
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
  "Écrire la politique d'escalade (profondeur de missions dérivées, modèles de secours, tours cumulés) avant de coder le superviseur.",
  "Garder deux clics humains : fusion d'un fichier sensible et mise en production.",
  "Afficher dans la carte de livraison les commits auto-fusionnés depuis la dernière release.",
  "Ventiler le verdict des reviewers par critère d'acceptation.",
  "Faire des findings P2 et P3 une file de dette consultable avant d'en faire des missions automatiques.",
  "Séparer l'abonnement Claude de la CI de celui du poste local.",
  "Ouvrir une concurrence par projet quand le superviseur tournera.",
  "Retirer le chemin legacy marketing (orchestrator.js, pipelines/marketing.json) et le code eBay.",
  "Remplir les dossiers evals/ du registre.",
];
