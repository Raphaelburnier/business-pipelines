# CI nocturne : fiche de la tâche planifiée

Cette fiche décrit la tâche planifiée telle qu'elle existe dans `.github/workflows/ci.yml`.
Elle n'ajoute pas de workflow. Les faits observés ont été relevés le 2026-11-11.

Elle existe parce qu'une PR du moteur (`agent-orchestrator`) peut casser le cockpit sans
toucher à ce dépôt (moteur #54, 2026-10-15). Le passage de nuit reconstruit le cockpit contre
la branche par défaut du moteur et révèle la casse avant la prochaine livraison.

## 1. Outil CI

GitHub Actions. Fichier : `.github/workflows/ci.yml`, workflow `CI`, job unique `test`.
La même définition sert aux déclencheurs `pull_request`, `push` sur `main`, `schedule` et
`workflow_dispatch`. Il n'existe donc pas de fichier de CI propre à la nuit.

## 2. Expression cron et fuseau

```yaml
schedule:
  - cron: "17 4 * * *"
```

- Tous les jours à 04:17 **UTC**. GitHub Actions n'accepte que l'UTC : aucun fuseau ne peut
  être déclaré. Cela correspond à 05:17 à Paris en hiver (CET) et à 06:17 en été (CEST).
- La minute 17 évite le pic de début d'heure. Ce choix ne suffit pas : sur les 27 derniers
  passages planifiés, le démarrage réel s'est fait entre **08:33 et 12:51 UTC**, soit 4 à
  8 h 30 de retard. GitHub peut retarder ou abandonner un déclenchement planifié en cas de
  charge. Il ne faut donc pas compter sur un résultat avant le matin, ni chaîner une
  action horaire sur ce passage.
- Le dépôt est public : GitHub désactive les workflows planifiés après 60 jours sans activité
  sur le dépôt. Si les passages s'arrêtent, il faut réactiver le workflow dans l'onglet Actions.

## 3. Processus exécuté (dans l'ordre)

| # | Étape | Commande |
|---|-------|----------|
| 1 | Checkout du cockpit | `actions/checkout` (épinglé v4.4.0) dans `business-pipelines/`, `fetch-depth: 2` |
| — | Preuve du merge testé | **ignorée** la nuit (`if: github.event_name == 'pull_request'`) |
| 2 | Checkout du moteur privé | `actions/checkout` de `Raphaelburnier/agent-orchestrator`, **branche par défaut** (pas de SHA épinglé), clé de déploiement, `persist-credentials: false` |
| 3 | Node.js | `actions/setup-node`, Node 22 |
| 4 | Dépendances du moteur | `npm ci` dans `agent-orchestrator/` |
| 5 | Dépendances du cockpit | `npm ci` dans `business-pipelines/` |
| 6 | Dépendances web | `npm ci` dans `business-pipelines/web/` |
| 7 | Tests serveur | `npm test` |
| 8 | Sauvegardes hors NAS | `npm run test:sauvegardes` |
| 9 | Tests et types web | `npm run web:test` |
| 10 | Build web | `npm run build` dans `web/` |
| 11 | Image de vérification | `bash bin/preparer-image.sh` puis `docker build --target verification`, **seulement si** le dernier commit de `main` (`HEAD^1..HEAD`) touche `Dockerfile`, `.dockerignore`, les manifestes npm, `test/` ou `ci.yml` |

Aucun appel modèle, aucun e-mail envoyé par le workflow, aucune écriture sur le dépôt et
aucun déploiement.

Après la nuit :

- **En cas d'échec**, `ci-autofix.yml` (`workflow_run` sur `CI`) accepte l'événement
  `schedule` s'il vise la tête courante de `main`. Il réserve
  `automation/ci-main-<sha>`, fait proposer un correctif à Claude et ouvre une PR. Il ne
  fusionne rien. Détails : `docs/CI-AUTOFIX.md`, `docs/SPEC-ci-base-main.md`.
- **Notification** : GitHub envoie l'e-mail d'échec d'un workflow planifié à la personne qui a
  modifié la ligne `cron` en dernier (actuellement le propriétaire du dépôt, commit `8099901`).

Point d'attention : l'étape 11 dépend du dernier commit de `main`. La nuit ne reconstruit donc
pas systématiquement l'image Docker. Une casse de l'image causée uniquement par le moteur passe
inaperçue la nuit si le dernier commit du cockpit ne touche aucun des fichiers listés.

## 4. Environnement cible

- Runner GitHub hébergé `ubuntu-latest`, sans conteneur de job.
- Node 22 installé par `setup-node`. `jq`, `git`, `bash` et Docker sont fournis par l'image du runner.
- L'étape Docker construit l'étage `verification` du `Dockerfile` (image Alpine), le même que
  celui de la livraison.

## 5. Périmètre de branche

- GitHub n'exécute `schedule` que sur la **branche par défaut** (`main`) et avec la version de
  `ci.yml` présente sur cette branche. Aucune branche de travail n'est testée la nuit. Aucun
  filtre `branches` supplémentaire n'est nécessaire.
- Le moteur est toujours pris sur sa branche par défaut.
- Concurrence : `ci-<dépôt>-refs/heads/main`, avec `cancel-in-progress: true`. Ce groupe est
  partagé avec la CI `push` sur `main`. Une fusion pendant le passage de nuit l'annule (conclusion
  `cancelled`, sans autocorrection). Le run `push` couvre alors la nouvelle tête.

## 6. Accès et secrets

| Nom | Où | Usage | Droits |
|-----|----|-------|--------|
| `GITHUB_TOKEN` | implicite | checkout du cockpit | `permissions: contents: read` au niveau du workflow |
| `AGENT_ORCHESTRATOR_DEPLOY_KEY` | secret du dépôt | clé SSH de déploiement pour lire `agent-orchestrator` (privé) | lecture seule attendue, non persistée (`persist-credentials: false`) |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret du dépôt, **workflow `ci-autofix.yml` uniquement** | correcteur après un échec | limité à l'étape Claude (voir `docs/CI-AUTOFIX.md`) |

Le passage de nuit n'a besoin d'aucune autre variable. Si la clé de déploiement expire ou est
révoquée, l'étape 2 échoue, puis l'autocorrection se déclenche sans pouvoir corriger la cause.
Il faut alors faire tourner la clé dans les paramètres du moteur et dans les secrets de ce dépôt.

## Vérifier ou relancer

- Historique : onglet Actions → `CI`, filtre `event:schedule`.
- Relance manuelle équivalente : `workflow_dispatch` sur `main`. Elle suit le même chemin, et
  l'autocorrection l'admet également.
