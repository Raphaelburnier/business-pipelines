# Tâche CI planifiée : passage nocturne sur `main`

Cette fiche décrit la tâche planifiée qui existe déjà dans `.github/workflows/ci.yml`. Elle reprend
le workflow et n'ajoute aucun comportement. Si le workflow change, cette fiche doit changer avec lui.

**Pourquoi.** Une PR du moteur (`agent-orchestrator`) peut casser le cockpit sans toucher à ce
dépôt. C'est arrivé le 2026-10-15 : le moteur #54 a été fusionné sans le cockpit #108. Le passage
nocturne repère ce genre de casse avant la livraison suivante.

## 1. Outil CI

**GitHub Actions.**
- Fichier : `.github/workflows/ci.yml`, workflow `CI`, job `test`.
- Le même workflow sert aussi aux PR (`pull_request`), à chaque fusion sur `main` (`push`) et aux
  lancements manuels (`workflow_dispatch`).

## 2. Expression cron et fuseau horaire

```yaml
schedule:
  - cron: "17 4 * * *"
```

- Fréquence : tous les jours à **04:17 UTC**. GitHub Actions interprète toujours le cron en UTC.
- À Paris, cela donne 05:17 en hiver (CET) et 06:17 en été (CEST).
- La minute 17 évite le pic de l'heure pile sur les runners partagés. GitHub peut quand même
  retarder un passage, ou l'abandonner en cas de forte charge.
- GitHub désactive les workflows planifiés après 60 jours sans activité dans le dépôt.

## 3. Processus, dans l'ordre

Tout tourne sans intervention humaine :

| # | Étape | Commande / action | Répertoire |
|---|-------|-------------------|------------|
| 1 | Récupérer le cockpit | `actions/checkout@v4.4.0` (épinglé par SHA), `fetch-depth: 2` | `business-pipelines/` |
| 2 | Vérifier le merge testé | ignorée en planifié (seulement pour `pull_request`) | — |
| 3 | Récupérer le moteur privé, en lecture seule | `actions/checkout` sur `Raphaelburnier/agent-orchestrator`, branche par défaut, clé SSH, `persist-credentials: false` | `agent-orchestrator/` |
| 4 | Installer Node.js | `actions/setup-node@v4.4.0`, `node-version: 22` | — |
| 5 | Installer les dépendances du moteur | `npm ci` | `agent-orchestrator/` |
| 6 | Installer les dépendances du cockpit | `npm ci` | `business-pipelines/` |
| 7 | Installer les dépendances du front | `npm ci` | `business-pipelines/web/` |
| 8 | Lancer les tests serveur | `npm test` | `business-pipelines/` |
| 9 | Vérifier la sauvegarde hors NAS et la restauration isolée | `npm run test:sauvegardes` | `business-pipelines/` |
| 10 | Lancer les tests et le typecheck du front | `npm run web:test` | `business-pipelines/` |
| 11 | Construire le front | `npm run build` | `business-pipelines/web/` |
| 12 | Vérifier l'image Docker | `bash bin/preparer-image.sh`, puis `docker build --target verification`. L'étape ne tourne que si `git diff HEAD^1 HEAD` touche l'image, les dépendances, `test/` ou `ci.yml`. | `business-pipelines/` |

**Notifications.** La tâche n'envoie aucun email elle-même. En cas d'échec :
- GitHub prévient selon les réglages de notification du compte.
- `CI autofix` (`.github/workflows/ci-autofix.yml`, déclenché par `workflow_run`) prend un échec
  `schedule` sur la tête courante de `main` et propose un correctif sur
  `automation/ci-main-<sha>`. Voir `docs/CI-AUTOFIX.md` et `docs/SPEC-ci-base-main.md`.

**Concurrence.** Groupe `ci-<dépôt>-<ref>` avec `cancel-in-progress: true`. Un `push` sur `main`
qui arrive pendant le passage nocturne annule ce passage, puis le remplace.

## 4. Environnement cible

- Runner : `ubuntu-latest`, hébergé par GitHub. Pas de conteneur de job.
- Node.js 22.
- Outils du runner utilisés : `git`, `jq`, Docker (étape 12), Python et `flock` (tests de
  sauvegarde, étape 9). L'image Alpine servie n'a pas ces outils de sauvegarde, d'où leur passage
  sur le runner.
- Le build Docker cible l'étage `verification` du `Dockerfile` racine, le même que la livraison.

## 5. Périmètre de branche

- GitHub n'exécute le déclencheur `schedule` que sur la **branche par défaut (`main`)**. Les
  branches de travail (`claude/*`, `codex/*`, `agent/*`, `automation/*`) ne lancent donc jamais de
  passage planifié.
- Le moteur est testé sur **sa** branche par défaut, celle que la livraison construit. Ce n'est pas
  un SHA épinglé.
- Les passages hors planning restent limités : `push` seulement sur `main` ; `pull_request` pour les
  PR, quelle que soit leur base.

## 6. Accès et secrets

| Nom | Type | Utilisé par | Rôle |
|-----|------|-------------|------|
| `AGENT_ORCHESTRATOR_DEPLOY_KEY` | secret du dépôt (clé SSH privée) | `ci.yml`, étape 3 | Clé de déploiement **en lecture seule** sur `Raphaelburnier/agent-orchestrator`. Elle n'est pas conservée après le checkout. |
| `GITHUB_TOKEN` | jeton automatique | `ci.yml` | Limité à `permissions: contents: read`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | secret du dépôt | `ci-autofix.yml` seulement | Correcteur lancé après un échec. Le passage nocturne lui-même ne s'en sert pas. |

`ci.yml` ne déclare aucune autre variable d'environnement et aucun autre secret. Si un test a un
jour besoin d'un nouvel accès, il faut l'ajouter au workflow et à ce tableau.

## Lancer et contrôler à la main

- Lancement manuel : onglet *Actions* → *CI* → *Run workflow* sur `main` (`workflow_dispatch`).
- Dernier passage nocturne : filtrer les runs du workflow `CI` sur l'événement `schedule`.
