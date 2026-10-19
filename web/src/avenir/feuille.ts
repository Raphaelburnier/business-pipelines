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
  sensible?: boolean;
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

export function estAttribuable(etape: Pick<Etape, "id" | "statut">): boolean {
  return etape.statut === "a-faire" && IDS_ATTRIBUABLES.has(etape.id);
}

export function revisionObjectif(id: string): number | null {
  return REVISION_OBJECTIFS.get(id) ?? null;
}

export const DATE_AUDIT = "2026-10-17";

export const LOTS: Lot[] = [
  {
    id: "0",
    titre: "Sécurité : fermer les failles critiques",
    but: "Retirer à un agent détourné tout chemin vers une fusion ou une livraison au nom de Raphaël, avant d'ajouter de l'autonomie.",
    etapes: [
      { id: "0.1", titre: "Sortir le runner du réseau hôte (F1)", detail: "Identité par en-tête Tailscale refusée sans preuve du proxy ; canal local refusé en écriture dans le conteneur.", fichiers: ["BP docker-compose.yaml:136", "BP src/acces.js:109-137"], statut: "en-cours", sensible: true },
      { id: "0.2", titre: "Signer les commandes d'autorité (F2)", detail: "HMAC et nonce sur fusion, livraison et actions de chat ; vérification par le publieur et le livreur.", fichiers: ["BP bin/publieur.js:197", "BP bin/livreur.js:94-99", "AO src/event-store.js"], statut: "en-cours", sensible: true },
      { id: "0.3", titre: "Élargir la liste des fichiers sensibles (F4)", detail: "Code d'authentification, runner, chat, worker, .claude/, .mcp.json, package.json et lockfiles.", fichiers: ["agent-gated-merge.yml:228", "BP src/pull-requests.js:30-43"], statut: "en-cours", sensible: true },
      { id: "0.4", titre: "Confirmer les écritures du chat « Demander » (F5)", detail: "Plus d'outil d'écriture après la lecture d'un contenu non fiable dans le même tour.", fichiers: ["AO src/chat.js:66-85", "AO src/cockpit-read.js:228-250"], statut: "en-cours" },
      { id: "0.5", titre: "Authentifier le maître côté worker (F6, F15)", detail: "Vérifier le pair NAS, liste blanche locale, runId validé.", fichiers: ["AO src/worker.js:127-131", "AO src/worker-exec.js:59-133"], statut: "en-cours" },
      { id: "0.6", titre: "Isoler les agents de production (F7, F12, F14)", detail: "Environnement par liste blanche, hook de périmètre étendu à Bash, utilisateur non root.", fichiers: ["AO src/agent-runner.js:216-249", "REG agents/passage-extractor"], statut: "en-cours" },
      { id: "0.7", titre: "Réduire le jeton de fusion et la chaîne de livraison (F3, F8)", detail: "Jeton limité aux dépôts fusionnables ; deploy.sh figé côté livreur.", fichiers: ["BP specs/publieur.env.example", "BP src/livreur.js:167-176"], statut: "a-faire", sensible: true },
      { id: "0.8", titre: "Durcir les workflows Claude (F11, F13)", detail: "Actions épinglées par SHA, déclencheur issues retiré, outils restreints.", fichiers: ["BP .github/workflows/claude.yml", "BP .github/workflows/claude-code-review.yml"], statut: "en-cours", sensible: true },
    ],
  },
  {
    id: "1",
    titre: "Contrat moteur/cockpit et CI croisée",
    but: "Qu'une PR du moteur ne puisse plus casser la compilation du cockpit (cas TS2322 de #58 sans #118).",
    prerequis: "Lot 0",
    etapes: [
      { id: "1.1", titre: "La CI du moteur construit le front du cockpit", detail: "Job qui clone BP origin/main, branche le moteur de la PR, lance tsc et les tests.", fichiers: ["AO .github/workflows/ci.yml"], statut: "a-faire", sensible: true },
      { id: "1.2", titre: "Aligner les gates de fusion", detail: "Preuve par triplet dans Steam, tcg, Saas ; agent/* admis ; CHANGES_REQUESTED bloquant.", fichiers: ["agent-gated-merge.yml:203-214"], statut: "a-faire", sensible: true },
      { id: "1.3", titre: "Détecter une base déjà rouge", detail: "Un échec hérité de main ne consomme pas de tentative de correction.", fichiers: ["ci-autofix.yml:36-50,155-161"], statut: "a-faire", sensible: true },
      { id: "1.4", titre: "Mettre agent-secrets à la norme", detail: "Dépôt GitHub, CI et gate de fusion.", fichiers: ["AS"], statut: "a-faire" },
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
      { id: "2.5", titre: "Borner Codex", detail: "Durée de 15 min et plafond configurable de 100 actions par défaut ; usage partiel conservé, coût équivalent API estimé uniquement si les tarifs sont configurés.", fichiers: ["AO src/codex-runner.js:189-198, 244-245"], statut: "fait" },
      { id: "2.6", titre: "Délais sur la file unique", detail: "orch.js, scripts, git, fetch du publieur et du conseiller, deploy.sh.", fichiers: ["BP bin/commande-runner.js:68-77", "AO src/graphe.js:162-177"], statut: "a-faire" },
      { id: "2.7", titre: "Reprendre waiting_machine", detail: "Reprise programmée au retour du worker ; approval.decide hors file longue.", fichiers: ["AO src/run-waits.js", "BP bin/commande-runner.js:281-286"], statut: "a-faire" },
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
      { id: "3.4", titre: "UI générique et page Branche", detail: "Natures servies par l'API pour la navigation et les vues.", fichiers: ["BP web/src/App.tsx", "BP web/src/vues/PlanMission.tsx"], statut: "a-faire" },
      { id: "3.5", titre: "Discussions d'équipe par nature", detail: "Compétences et gabarit déclarés dans la nature.", fichiers: ["BP src/discussions-equipe.js:9,41,217"], statut: "a-faire" },
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
      { id: "4.1", titre: "Arrêt d'urgence", detail: "run.cancel et pause globale de la file.", fichiers: ["AO packages/schemas/commandes.js", "BP bin/commande-runner.js"], statut: "a-faire", sensible: true },
      { id: "4.2", titre: "Alertes hors du cockpit", detail: "Consommateur des événements alerte, run.failed et budgets.", fichiers: ["AO src/maitre.js:483,549,556", "BP src/alerte.js"], statut: "a-faire" },
      { id: "4.3", titre: "Santé de la plateforme", detail: "/api/sante, healthcheck Docker, rotation des logs.", fichiers: ["BP bin/cockpit.js:590-592"], statut: "a-faire" },
      { id: "4.4", titre: "Budgets", detail: "Plafond quotidien, budget mensuel aussi sur POST /api/runs.", fichiers: ["BP bin/cockpit.js:633-698"], statut: "a-faire" },
      { id: "4.5", titre: "Sauvegardes", detail: "events.sqlite, specs/ et workers.json hors NAS.", fichiers: ["BP deploy/nas/deploy.sh.modele", "AO scripts/nas/nettoyer-runs.sh:11"], statut: "a-faire", sensible: true },
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
      { id: "6.1", titre: "Revue avec verdict", detail: "Diagnostiquer la revue muette, allowed_bots: claude.", fichiers: ["BP .github/workflows/claude-code-review.yml"], statut: "a-faire", sensible: true },
      { id: "6.2", titre: "Gate qui exige ce verdict", detail: "Fusion seulement avec une revue sur la tête courante.", fichiers: ["agent-gated-merge.yml"], statut: "a-faire", sensible: true },
      { id: "6.3", titre: "Correcteur déclenché par la revue", detail: "Mêmes bornes et même isolement que ci-autofix.", fichiers: ["ci-autofix.yml"], statut: "a-faire", sensible: true },
      { id: "6.4", titre: "Relance bornée après arrêt", detail: "Une tentative de plus si l'échec porte sur une autre étape (cas #120).", fichiers: ["ci-autofix.yml"], statut: "en-cours", sensible: true },
      { id: "6.5", titre: "Hook Stop local nettoyé", detail: "Log assaini, échec de revue dû au quota ignoré.", fichiers: ["~/.claude/hooks/ci-pr/stop_ci.py"], statut: "a-faire" },
    ],
  },
  {
    id: "7",
    titre: "Basculement machine et versions",
    but: "Ne plus dépendre d'un seul PC et éviter la dérive entre NAS et worker.",
    etapes: [
      { id: "7.1", titre: "Machine de remplacement par nœud", detail: "Wake-on-LAN réactivé si le PC reste seul.", fichiers: ["BP docker-compose.yaml:117-119"], statut: "a-faire", sensible: true },
      { id: "7.2", titre: "Contrôle de dérive worker/NAS", detail: "Unité systemd versionnée sur la copie figée.", fichiers: ["AO deploy/systemd/orch-worker.service"], statut: "a-faire" },
      { id: "7.3", titre: "deploy.sh qui respecte les runs vivants", detail: "Refuser de couper un run ; npm ci dans le Dockerfile.", fichiers: ["BP deploy/nas/deploy.sh.modele:106-110", "BP Dockerfile"], statut: "a-faire", sensible: true },
    ],
  },
];

export const DEFAUTS: Defaut[] = [
  { id: "F1", severite: "critique", titre: "Identité Tailscale du cockpit forgeable par un agent du runner", fichiers: "BP docker-compose.yaml:136 ; src/acces.js:109-116", correctif: "Lot 0.1", statut: "en-cours" },
  { id: "F2", severite: "critique", titre: "Commandes de fusion, livraison et chat non signées", fichiers: "BP docker-compose.yaml:87 ; bin/publieur.js:197 ; bin/livreur.js:94-99", correctif: "Lot 0.2", statut: "en-cours" },
  { id: "F3", severite: "haute", titre: "Fusion non stricte puis deploy.sh de la release exécuté en root", fichiers: "BP bin/publieur.js:223 ; src/livreur.js:167-176", correctif: "Lot 0.7", statut: "a-faire" },
  { id: "F4", severite: "haute", titre: "Liste sensible du gate trop courte", fichiers: "agent-gated-merge.yml:228 ; BP src/pull-requests.js:30-43", correctif: "Lot 0.3", statut: "en-cours" },
  { id: "F5", severite: "haute", titre: "Outils d'écriture du chat déclenchables par du contenu non fiable", fichiers: "AO src/chat.js:66-85", correctif: "Lot 0.4", statut: "en-cours" },
  { id: "F6", severite: "haute", titre: "Worker PC qui n'authentifie pas le maître", fichiers: "AO src/worker.js:127-131 ; src/worker-exec.js:99,133", correctif: "Lot 0.5", statut: "a-faire" },
  { id: "F7", severite: "haute", titre: "Bash hors hook de périmètre, héritage de process.env", fichiers: "AO src/agent-runner.js:216,245,249", correctif: "Lot 0.6", statut: "en-cours" },
  { id: "F8", severite: "haute", titre: "GITHUB_TOKEN_FUSION sur tous les dépôts", fichiers: "BP specs/publieur.env.example", correctif: "Lot 0.7", statut: "a-faire" },
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
