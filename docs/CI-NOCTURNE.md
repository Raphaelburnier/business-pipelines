# CI nocturne planifiée

Fiche de la tâche planifiée portée par `.github/workflows/ci.yml` (déclencheur `schedule`). Le même workflow tourne aussi sur les PR, sur chaque `push` vers `main` et à la demande (`workflow_dispatch`) ; cette fiche ne décrit que le passage planifié.

Pourquoi : une PR du moteur (`agent-orchestrator`) peut casser le cockpit sans toucher à ce dépôt (2026-10-15, moteur #54 sans cockpit #108). Le passage de nuit reteste `main` contre la branche par défaut du moteur, avant la prochaine livraison.

## 1. Outil CI

GitHub Actions. Fichier : `.github/workflows/ci.yml`, workflow `CI`, job unique `test`.

## 2. Fréquence

| Élément | Valeur |
| --- | --- |
| Expression cron | `17 4 * * *` |
| Fuseau | UTC (GitHub Actions n'interprète le cron qu'en UTC) |
| Heure de Paris | 05:17 en hiver (UTC+1), 06:17 en été (UTC+2) |

La minute 17 évite le pic des tâches lancées à l'heure pile. GitHub peut retarder un passage planifié lors de fortes charges, voire l'abandonner ; un retard de quelques dizaines de minutes est normal.

## 3. Processus

Étapes du job `test`, dans l'ordre (l'étape `Verify tested merge` est sautée hors PR) :

1. Checkout de `business-pipelines` dans `business-pipelines/`, `fetch-depth: 2`.
2. Checkout en lecture seule de `Raphaelburnier/agent-orchestrator` (branche par défaut, non épinglée) dans `agent-orchestrator/`, par clé de déploiement SSH, `persist-credentials: false`.
3. Node.js 22 (`actions/setup-node`).
4. `npm ci` dans `agent-orchestrator/`.
5. `npm ci` dans `business-pipelines/`.
6. `npm ci` dans `business-pipelines/web/`.
7. `npm test` : tests serveur.
8. `npm run test:sauvegardes` : sauvegarde hors NAS et restauration isolée.
9. `npm run web:test` : typecheck et tests Vitest du front.
10. `npm run build` dans `web/`.
11. Build Docker de l'étage `verification` (`bin/preparer-image.sh`, puis `docker build --target verification`), seulement si le dernier commit de `main` (`HEAD^1..HEAD`) touche `Dockerfile`, `.dockerignore`, les `package*.json`, `test/` ou `ci.yml`. La nuit, l'étape est donc le plus souvent sautée.

Aucune notification n'est envoyée par le job lui-même. En cas d'échec :

- GitHub prévient selon les réglages de notification Actions du compte ;
- `ci-autofix.yml` (déclencheur `workflow_run`) prend le relais pour la branche par défaut : il propose une correction sur `automation/ci-main-<sha>`, une seule réservation par SHA, sans relance illimitée par la CI nocturne. Voir [SPEC-ci-base-main.md](SPEC-ci-base-main.md) et [CI-AUTOFIX.md](CI-AUTOFIX.md).

## 4. Environnement

- Runner : `ubuntu-latest` (hébergé par GitHub), sans conteneur de job.
- Node.js 22 ; `jq`, `bash` et Docker sont fournis par l'image du runner.
- L'étape Docker construit l'image Alpine de livraison jusqu'à l'étage `verification`.
- Actions tierces épinglées par SHA (`actions/checkout` v4.4.0, `actions/setup-node` v4.4.0).

## 5. Périmètre

- Un déclencheur `schedule` s'exécute toujours sur la dernière révision de la branche par défaut (`main`) et lit le workflow de cette branche. Aucun filtre de branche n'est nécessaire : les branches de travail ne lancent jamais de passage planifié.
- Modifier le cron sur une branche n'a pas d'effet avant la fusion dans `main`.
- `concurrency` : le groupe vaut `ci-<dépôt>-refs/heads/main`, partagé avec les passages `push` sur `main`, et `cancel-in-progress: true`. Une fusion vers 04:17 UTC annule le passage nocturne en cours ; le passage `push` qui le remplace teste une révision plus récente, donc rien n'est perdu.
- Le dépôt est public : GitHub désactive les workflows planifiés après 60 jours sans activité sur le dépôt. Il faut alors les réactiver dans l'onglet Actions.

## 6. Accès et secrets

| Nom | Type | Usage | Droits |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` | jeton automatique | checkout de ce dépôt | `contents: read` (bloc `permissions` du workflow) |
| `AGENT_ORCHESTRATOR_DEPLOY_KEY` | secret du dépôt, clé SSH privée | checkout du moteur privé | clé de déploiement en lecture seule sur `agent-orchestrator` |

Aucune autre variable ni clé : le job ne publie rien, n'écrit rien et ne joint aucun service externe hors registres npm et Docker.

Côté relais d'échec, `ci-autofix.yml` utilise en plus `CLAUDE_CODE_OAUTH_TOKEN` (étape de correction seulement) et le jeton de l'app Claude obtenu par OIDC au moment de publier ; ses droits par étape sont dans [CI-AUTOFIX.md](CI-AUTOFIX.md).

Si la clé de déploiement expire ou est révoquée, l'étape 2 échoue chaque nuit : régénérer la paire, déposer la clé publique en lecture seule sur `agent-orchestrator` (Settings → Deploy keys), la clé privée dans le secret `AGENT_ORCHESTRATOR_DEPLOY_KEY` de ce dépôt.

## Relancer à la main

Onglet Actions → workflow `CI` → *Run workflow* sur `main` (`workflow_dispatch`) : même job, mêmes secrets.
