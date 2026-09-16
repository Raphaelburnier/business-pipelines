# SPEC — Cockpit agentique (business-pipelines)

> Document destiné à Claude Code. Lis-le en entier avant toute action.
> **Règle de travail : une phase à la fois. Tu ne passes à la phase suivante qu'après validation explicite de Raphaël.**

---

## 0. Instructions pour Claude Code

1. **Commence par la Phase 0 (audit).** Ne modifie aucun fichier avant d'avoir produit `docs/AUDIT.md` et reçu une validation.
2. Cette spec a été rédigée **sans lire le code existant**. Si elle entre en conflit avec ce que tu trouves dans les repos, **signale le conflit** dans l'audit au lieu de trancher seul.
3. Pour chaque phase :
   - propose un plan court (fichiers touchés, choix techniques) avant de coder ;
   - écris les tests en même temps que le code (Vitest) ;
   - termine par un récap : ce qui est fait, ce qui ne l'est pas, les critères d'acceptation vérifiés.
4. **Ne consomme pas le quota Claude dans les tests.** Utilise un faux binaire `claude` (voir §6.4).
5. Langage : **TypeScript** côté Node et React. Migration **progressive** de `cockpit.js` / `cycle.js` (`allowJs`), pas de réécriture en bloc. Les types sont dérivés des schémas zod (`z.infer`), jamais dupliqués à la main. **Python (FastAPI)** uniquement pour le serveur de modèles ML maison.
6. Tout ce qui est marqué **[À VÉRIFIER]** doit être confirmé (doc, test empirique) avant d'être codé en dur.

---

## 1. Contexte et objectif

Raphaël fait tourner des pipelines d'agents (agentic loops) pour plusieurs business/projets, sur deux machines :

- **NAS Synology** : toujours allumé, héberge déjà `business-pipelines` (services `cockpit.js` et `cycle.js`, déployés via Docker Compose / Container Manager).
- **PC homelab** (ROG G10CE) : machine de calcul, **se met en veille** quand il n'y a pas de travail, réveillée par **Wake-on-LAN depuis le NAS**.

Accès distant (téléphone, PC principal) via **Tailscale** — travail déjà commencé sur la branche `feat/tailnet-acces` (le service écoute en local, l'identité de l'appelant est vérifiée via la connexion Tailscale et non via un header).

**Objectif :** faire évoluer `cockpit.js` en une interface unique pour **gérer et observer** tout le système :

1. une **topologie interactive** des projets (style graphe OmniRoute) ;
2. un **dashboard live** des agents (qui travaille, qui est en pause, sur quel projet, coûts/quota) ;
3. un **éditeur de pipelines** visuel et JSON synchronisés ;
4. un **registre d'agents et de modèles versionnés**, réutilisables entre projets ;
5. le **choix du modèle** par étape (Claude, modèles via OmniRoute, Ollama, modèles ML maison).

---

## 2. Existant à auditer (Phase 0)

| Élément | Ce qu'on sait | À vérifier |
|---|---|---|
| `business-pipelines` (repo privé) | `cockpit.js`, `cycle.js`, Docker Compose sur le NAS | stack serveur (Express ? http natif ?), front actuel, état de `feat/tailnet-acces` |
| `agent-orchestrator` (repo privé, dépendance locale) | exécute des agents via **Claude Code headless (CLI)** | API exposée, gestion des sessions, logs, format des sorties |
| Format agents du SaaS generator (autre repo) | définitions de rôles en `.md`, pipelines en JSON, spec projet en JSON | réutilisable tel quel ou à adapter |
| OmniRoute | proxy multi-providers (Anthropic, Gemini, Kimi, Groq, Ollama…) | URL, auth, compatibilité avec `ANTHROPIC_BASE_URL` |

**Répartition décidée (trois repos) :**
- `agent-orchestrator` = **moteur** : runner, scheduler, protocole maître/worker, et le package partagé `packages/schemas` (zod → types TS + export JSON Schema) ;
- `agent-registry` (**nouveau repo dédié**) = définitions réutilisables : agents, modèles, templates de pipelines, évals d'agents. Sa CI valide chaque fichier avec `schemas` ;
- `business-pipelines` = **déploiement + cockpit + manifestes de projets** (`projects/`).

Les workers ne clonent pas `agent-registry` : le maître résout `agent@version` et envoie la **définition complète** dans le message de dispatch.

---

## 3. Principes non négociables

1. **Une seule source de vérité par donnée.** Pipelines, agents, modèles et projets sont des **fichiers dans git**. La base SQLite stocke l'**état d'exécution** (runs, étapes, événements), jamais les définitions.
2. **Le JSON du pipeline est la source de vérité.** L'éditeur visuel n'est qu'une vue qui lit/écrit ce JSON. Même schéma zod des deux côtés.
3. **Versions épinglées.** Un pipeline référence `agent@version`, jamais « la dernière ». Modifier un agent ne doit jamais casser silencieusement un autre projet.
4. **Tout est observable.** Chaque action du moteur émet un événement structuré. Si ce n'est pas dans l'event store, le cockpit ne le montre pas.
5. **Une limite de quota n'est pas une erreur.** Le pipeline passe en attente, il n'échoue pas.
6. **Les boucles sont bornées.** Toute arête qui crée un cycle doit être couverte par un `maxLoops`.
7. **Jamais sur internet.** Cockpit, maître et serveur de modèles ne sont joignables que depuis le tailnet Tailscale. Aucune exception (voir §10, isolation réseau).

---

## 4. Architecture

```
┌──────────────── NAS (toujours allumé) ────────────────┐
│  Cockpit UI (React, servi en statique)                │
│        │ REST + SSE                                   │
│  cockpit.js (API)                                     │
│        │                                              │
│  Orchestrateur MAÎTRE ── Event store (SQLite)         │
│        │  lit les registres (git)                     │
│        ├── Worker NAS (étapes runsOn: nas)            │
│        └── Wake-on-LAN ─┐                             │
└─────────────────────────┼─────────────────────────────┘
                          ▼
┌──────────── PC homelab (veille possible) ─────────────┐
│  Worker PC (runsOn: pc) ── WebSocket sortant → maître │
│  Serveur de modèles (FastAPI) ← poids lus sur le NAS  │
└───────────────────────────────────────────────────────┘
État de travail partagé : git (remote principal = dépôt bare sur le NAS, miroir GitHub).
Maître ↔ workers : WebSocket. cockpit.js → navigateur : SSE.
```

- **Maître (NAS)** : planifie les runs, dispatche chaque étape vers le bon worker selon `runsOn`, réveille le PC si besoin, applique budgets/quotas/gates, écrit dans l'event store.
- **Workers (NAS, PC)** : processus légers. Ils **ouvrent eux-mêmes** une connexion WebSocket vers le maître (le maître n'a jamais besoin de joindre le PC, sauf pour le WoL). Ils reçoivent une étape, font `git pull`, l'exécutent, font `git push`, renvoient les événements et un **heartbeat** (§7.4).
- **cockpit.js** : API REST (commandes) + flux SSE (événements) vers le navigateur, au-dessus de l'event store (§10).

---

## 5. Formats de fichiers

### 5.1 Arborescence

```
agent-registry/                 # repo dédié
  agents/<agent-name>/
    v1/agent.md
    v2/agent.md
    evals/                      # cas curés par Raphaël, partagés entre versions
    CHANGELOG.md
  models/<model-name>/
    v1/model.json
    v1/input.schema.json
    v1/output.schema.json       # pas de poids ici : voir §7.5
  pipelines/<pipeline-name>/
    v1/pipeline.json

business-pipelines/
  projects/<project-id>/project.json
```

Le cockpit écrit dans `agent-registry` via une copie de travail sur le NAS : chaque sauvegarde = un commit.

Les fichiers de modèles (poids) ne sont **jamais dans git** : ils sont stockés sur un partage du NAS. Le registre ne contient que les métadonnées, les schémas et le checksum.

### 5.2 Agent (`agent.md`)

```markdown
---
name: code-reviewer
version: 2
description: Revue de code, renvoie approved ou changes_requested
defaultLlm: { via: "claude", model: "sonnet" }
allowedTools: ["Read", "Grep", "Glob", "Bash(npm test:*)"]
skills: []
outcome: { values: ["approved", "changes_requested"] }
---

(Prompt système de l'agent)
```

**[À VÉRIFIER]** : syntaxe exacte de `--allowedTools` et des alias de modèles acceptés par la version installée de Claude Code (`claude --help`).

### 5.3 Modèle maison (`model.json`)

```json
{
  "name": "price-predictor",
  "version": 1,
  "kind": "sklearn",
  "artifact": {
    "path": "price-predictor/v1/model.joblib",
    "sha256": "<checksum>"
  },
  "device": "cpu",
  "input": { "$ref": "./input.schema.json" },
  "output": { "$ref": "./output.schema.json" }
}
```

Les modèles sont servis par **un serveur FastAPI unique, sur le PC**. `artifact.path` est relatif au partage de modèles du NAS. Voir §7.5.

### 5.4 Template de pipeline (`pipeline.json`)

```json
{
  "name": "saas-build",
  "version": 3,
  "nodes": [
    { "id": "collect", "type": "script", "run": "scripts/collect.py", "runsOn": "nas" },
    { "id": "score",   "type": "model",  "model": "price-predictor@1" },
    { "id": "code",    "type": "agent",  "agent": "coder@2", "runsOn": "pc" },
    { "id": "review",  "type": "agent",  "agent": "code-reviewer@2", "runsOn": "pc",
      "llm": { "via": "omniroute", "model": "gemini-flash-lite-latest" } },
    { "id": "approve", "type": "gate" }
  ],
  "edges": [
    { "from": "collect", "to": "score" },
    { "from": "score",   "to": "code" },
    { "from": "code",    "to": "review" },
    { "from": "review",  "to": "code",    "on": "changes_requested", "maxLoops": 3 },
    { "from": "review",  "to": "approve", "on": "approved" }
  ],
  "layout": { "collect": [0, 0], "score": [220, 0], "code": [440, 0] }
}
```

**Types de nœuds :**

| type | Exécuté par | Champs clés |
|---|---|---|
| `agent` | runner Claude Code | `agent`, `runsOn`, `llm?` |
| `model` | appel HTTP au serveur de modèles (toujours sur le PC) | `model` |
| `script` | process local (node/python/bash) | `run`, `runsOn` |
| `gate` | humain, via le cockpit | — |

**Arêtes :** `on` est optionnel (absent = toujours). Valeurs possibles : outcomes déclarés par l'agent, `approved` / `rejected` pour une gate, `failed`. Un cycle sans `maxLoops` doit être **rejeté à la validation**.

**Signal de sortie d'un agent :** l'agent écrit `.orchestrator/outcome.json` dans le repo de travail :
```json
{ "status": "changes_requested", "notes": "Tests manquants sur le parser" }
```
Le runner lit ce fichier après l'étape. Fichier absent ou `status` hors de la liste déclarée → étape en échec.

`layout` ne contient que les positions de l'éditeur. Il est ignoré par le moteur.

### 5.5 Projet (`project.json`)

```json
{
  "id": "otp-relay",
  "name": "Relais OTP",
  "business": "infra-perso",
  "homeMachine": "nas",
  "repo": "git@.../otp-relay.git",
  "pipelines": [
    {
      "extends": "saas-build@3",
      "overrides": {
        "nodes": { "review": { "llm": { "via": "claude", "model": "opus" } } }
      },
      "budget": { "usdPerRun": 2, "usdPerMonth": 20 }
    }
  ]
}
```

**Priorité du modèle :** `defaultLlm` de l'agent < `llm` du nœud dans le template < `overrides` du projet < choix au lancement du run.

---

## 6. Runner Claude Code

### 6.1 Invocation

```
claude -p "<prompt>" --output-format stream-json --verbose --model <model> [--resume <session_id>]
```

- Le prompt système de l'agent est injecté selon le mécanisme le plus propre supporté par la CLI **[À VÉRIFIER : `--append-system-prompt` ou équivalent]**.
- `cwd` = copie de travail du repo du projet.
- **Via OmniRoute ou Ollama** : même binaire, avec `ANTHROPIC_BASE_URL` pointé sur OmniRoute et l'auth adaptée dans l'environnement du process **[À VÉRIFIER : variables exactes et compatibilité OmniRoute]**. Ollama passe par OmniRoute (déjà configuré comme provider).

### 6.2 Parsing

Lecture de stdout ligne par ligne (JSON par ligne). Les lignes non-JSON sont ignorées et loggées.

| Message | Événement émis |
|---|---|
| `type: system, subtype: init` | `step.started` (session_id, modèle effectif) |
| `type: assistant` | `step.progress` (contenu, tool_use) |
| `type: result` | `step.finished` (`total_cost_usd`, `usage`, `is_error`, `subtype`, durée) |

Stocker **aussi la sortie brute** (fichier par étape) pour le debug.

### 6.3 Contrôles

| Action | Implémentation |
|---|---|
| **Pause** | flag `pause_requested` : l'étape en cours se termine, la suivante n'est pas lancée → `paused` |
| **Stop** | `SIGTERM` sur le process, `SIGKILL` après timeout → étape `cancelled` |
| **Reprise** | relance de l'étape interrompue avec `--resume <session_id>` |
| **Relancer depuis une étape** | reset du repo au commit de checkpoint précédant l'étape (§7.3), puis exécution à partir de ce nœud |

Pas de « vraie » pause au milieu d'une génération : c'est volontaire.

### 6.4 Tests sans quota

Crée `test/fixtures/fake-claude.js`, un exécutable qui imite `claude -p` : il émet une séquence `stream-json` scriptée (succès, erreur, limite de quota, sortie lente pour tester le stop) et écrit `.orchestrator/outcome.json`. Le runner accepte un chemin de binaire configurable (`CLAUDE_BIN`).

---

## 7. Maître, workers, machines

### 7.1 Heartbeat et états

Chaque worker envoie un heartbeat toutes les N secondes (configurable).

États d'une machine : `online` · `busy` · `sleeping` · `waking` · `offline` · `error`.
- `sleeping` = PC mis en veille volontairement (distinct de `offline`).
- `offline` = heartbeat perdu sans mise en veille demandée.

### 7.2 Dispatch et réveil

1. Une étape `runsOn: pc` est prête et le PC est `sleeping` → le maître envoie un **magic packet WoL** → état `waking`.
2. Il attend le heartbeat du worker PC (timeout configurable) puis dispatche.
3. Timeout dépassé → étape en attente + alerte dans le cockpit.
4. Mise en veille du PC : le worker PC la demande après X minutes sans travail, **seulement si le maître n'a rien en file pour lui**.

Note Docker/Synology : l'envoi du broadcast WoL depuis un conteneur nécessite probablement `network_mode: host` **[À VÉRIFIER]**.

Concurrence : configurable par worker (défaut **1**, pour ménager le quota d'abonnement).

### 7.3 Checkpoints git (état partagé)

Deux régimes, selon la nature du dépôt (décision du 2026-09-16).

#### 7.3.1 Projets gérés par les pipelines

Les dépôts des projets sur lesquels les pipelines travaillent (`project.json` → `repo`).

- Un run travaille sur une branche `run/<runId>`.
- Avant chaque étape : `git pull`. Après chaque étape réussie : commit `[run <runId>] step <nodeId>` puis `git push`.
- Le hash du commit est stocké dans l'étape (`steps.checkpoint_sha`).
- **Remote principal : dépôt bare sur le NAS** (SSH, ou le paquet Git Server de Synology **[À VÉRIFIER]**). Les workers poussent **uniquement** vers ce remote : ça marche sans internet et évite toute divergence.
- **Miroir GitHub** : un hook `post-receive` sur le NAS pousse vers GitHub en asynchrone. Un échec du miroir émet `mirror.failed` mais ne bloque **jamais** un run. Par défaut : `main`, les tags **et les branches `run/*`**.
- **Nettoyage** : les branches `run/*` fusionnées, ou plus vieilles que N jours (configurable), sont supprimées des deux remotes.
- Fusion de la branche du run : uniquement après une gate ou une étape finale explicite.

#### 7.3.2 Dépôts d'outillage : `agent-orchestrator`, `agent-registry`, `business-pipelines`

- **Remote principal : GitHub**, parce que la CI (GitHub Actions) y tourne.
- **Le NAS ne garde qu'une copie de sauvegarde** de ces dépôts. Personne ne pousse vers elle pour travailler, elle ne sert qu'à restaurer.
- Aucun run de pipeline ne crée de branche `run/*` dans ces dépôts.

#### 7.3.3 Cas particulier : les écritures du cockpit dans `agent-registry`

- Le cockpit commite sur **sa copie de travail sur le NAS** (chaque sauvegarde de l'éditeur = un commit local).
- Le push vers GitHub est **asynchrone**, avec retry et backoff tant que le réseau manque. Les commits en attente restent visibles dans le cockpit (compteur, dernier échec).
- **Une sauvegarde ne doit jamais être perdue faute d'internet** : le commit local fait foi dès qu'il est écrit, avant tout push.
- Conflit au push (GitHub a avancé entre-temps, par exemple une PR fusionnée) : pas de force-push. Le push s'arrête, le conflit s'affiche dans le cockpit et attend une décision.

### 7.4 Transport maître ↔ workers (WebSocket)

- Lib `ws`. `ws://` suffit sur le tailnet (trafic déjà chiffré par WireGuard).
- **Auth** : identité Tailscale vérifiée au moment de l'upgrade HTTP (réutiliser le mécanisme de `feat/tailnet-acces`) + liste blanche des machines autorisées. Restreindre aussi le port du maître via les ACL Tailscale.
- **Messages** : JSON, schémas zod avec discriminant `type`.

| Sens | type | Contenu |
|---|---|---|
| worker → maître | `hello` | machineId, version, capacités, dernier `seq` acquitté |
| worker → maître | `heartbeat` | état, étapes en cours, charge |
| worker → maître | `event` | `seq`, événement (§9) |
| worker → maître | `step.result` | stepId, statut, outcome, checkpoint_sha, coûts |
| maître → worker | `step.dispatch` | stepId, runId, nœud **résolu** (définition complète), repo, branche, llm, env |
| maître → worker | `step.cancel` | stepId |
| maître → worker | `ack` | dernier `seq` reçu |
| maître → worker | `sleep.allowed` | booléen (file vide pour ce worker) |

- **Fiabilité** : chaque événement worker porte un `seq` croissant. Le worker garde sur disque les événements non acquittés et les **rejoue** après reconnexion. Reconnexion avec backoff exponentiel. Ping/pong toutes les 15 s.
- Une étape en cours **continue** si la connexion tombe. À la reconnexion, le worker annonce son état réel dans `hello`.

### 7.5 Serveur de modèles maison (calcul sur le PC, stockage sur le NAS)

- **Un seul serveur FastAPI, dans WSL sur le PC.** Le NAS (DS1522+, 8 Go de RAM) ne sert que de stockage pour les poids.
- Endpoints : `GET /health`, `GET /models`, `POST /models/{name}/{version}/predict`.
- **Stockage** : partage dédié sur le NAS (ex. `models/`), monté **en lecture seule** dans WSL **[À VÉRIFIER : méthode de montage la plus fiable, SMB/CIFS ou NFS]**.
- **Cache local obligatoire** : au premier chargement, l'artefact est copié sur le NVMe du PC, son `sha256` est vérifié, puis il est chargé depuis ce cache. Les poids ne sont jamais chargés directement depuis le partage réseau.
- Chargement à la demande, déchargement LRU au-delà d'un plafond RAM configurable.
- `device` : `cpu` par défaut. Le GPU (RTX 3060) est utilisable pour PyTorch via CUDA dans WSL, mais reste optionnel : **fallback CPU obligatoire** si CUDA est indisponible ou instable.
- **Tout nœud `model` s'exécute sur le PC.** Si le PC dort, le maître le réveille (§7.2), même quand les autres étapes du pipeline sont sur le NAS.
- Validation entrée/sortie via les JSON Schema du registre. Timeout et `try/except` par requête : un modèle qui plante renvoie une erreur, il ne tue pas le serveur.
- Écoute uniquement en local ou sur le tailnet (§10).
- Évolution possible : exposer aussi ces modèles comme outils MCP pour que les agents les appellent directement.

### 7.6 Particularités du PC (Windows 11 + WSL)

Le PC tourne sous Windows 11. Le worker, Claude Code et le serveur de modèles tournent dans WSL (Ubuntu). Points **[À VÉRIFIER]** avant la Phase 3 :

- **Démarrage automatique** : après un démarrage ou une sortie de veille, le worker et le serveur de modèles doivent se relancer seuls (tâche planifiée Windows qui lance `wsl`). WSL ne doit pas s'arrêter tant qu'ils tournent.
- **Réseau** : Tailscale est installé côté Windows. Vérifier que la connexion **sortante** WSL → IP tailnet du NAS fonctionne (le worker n'a besoin que de sortant, c'est l'intérêt du WebSocket initié par le worker).
- **Wake-on-LAN** : activé dans le BIOS et dans les propriétés de la carte réseau Windows.
- **Mise en veille** : déclenchée côté Windows (commande lancée depuis WSL) uniquement après `sleep.allowed` du maître.

---

## 8. Quota, coûts, budgets

Raphaël utilise un **abonnement Claude (Pro/Max)**.

- Avec un abonnement, `total_cost_usd` est une **estimation**. L'afficher comme « coût équivalent API », pas comme une dépense réelle.
- La contrainte réelle est la **limite d'usage par fenêtre de temps**. Quand un run la touche :
  - l'étape passe en `waiting_quota` (pas `failed`) ;
  - le maître suspend les nouvelles étapes Claude ;
  - reprise automatique après réinitialisation (heure estimée si l'info est disponible).
  - **[À VÉRIFIER]** : forme exacte du message/erreur de limite dans la sortie `stream-json`. Logger les sorties brutes et construire le détecteur à partir de cas réels.
- Les appels via OmniRoute sont de la **dépense réelle** : les suivre séparément.
- Budgets par run et par projet (`project.json`). Dépassement → le run passe en **gate automatique** (`waiting_approval`, raison `budget`).

Vérifier que l'usage automatisé prévu est conforme aux conditions de l'abonnement.

---

## 9. Event store (SQLite)

Tables minimales (à affiner) :

```
machines(id, name, state, last_heartbeat_at, meta_json)
runs(id, project_id, pipeline_ref, status, started_at, finished_at,
     est_cost_usd, real_cost_usd, trigger)
steps(id, run_id, node_id, type, machine_id, status, llm_via, llm_model,
      session_id, attempt, loop_index, checkpoint_sha,
      started_at, finished_at, est_cost_usd, real_cost_usd, tokens_in, tokens_out,
      outcome, raw_log_path)
events(id, ts, run_id, step_id, machine_id, type, payload_json)
approvals(id, run_id, step_id, reason, status, decided_at, note)
eval_results(id, agent_ref, llm_via, llm_model, passed, total, ran_at, report_path)
```

**Statuts de run :** `queued` · `running` · `paused` · `waiting_approval` · `waiting_quota` · `waiting_machine` · `succeeded` · `failed` · `cancelled`.

**Types d'événements :** `run.queued`, `run.started`, `run.paused`, `run.resumed`, `run.finished`, `step.dispatched`, `step.started`, `step.progress`, `step.finished`, `step.failed`, `step.cancelled`, `gate.opened`, `gate.decided`, `quota.hit`, `quota.reset`, `budget.exceeded`, `machine.state_changed`.

Chaque événement porte `run_id` / `step_id` / `machine_id` quand ils s'appliquent.

---

## 10. API cockpit.js

### Isolation réseau (obligatoire)

Le cockpit, le port WebSocket du maître et le serveur de modèles ne doivent **jamais** être joignables depuis internet.

- Les services écoutent sur `127.0.0.1` ou sur l'IP Tailscale (`100.x.y.z`), **jamais sur `0.0.0.0`**.
- Docker Compose : `ports: ["127.0.0.1:PORT:PORT"]`, jamais `["PORT:PORT"]` (qui publie sur toutes les interfaces).
- Exposition au tailnet via `tailscale serve` ou bind direct sur l'IP Tailscale **[À VÉRIFIER avec le paquet Tailscale de DSM]**.
- **`tailscale funnel` est interdit** : il publie le service sur internet.
- Aucune redirection de port sur la box, pas de QuickConnect, pas de reverse proxy DSM public pour ces services.
- ACL Tailscale : seuls les appareils de Raphaël accèdent au cockpit ; seul le PC accède au port WebSocket du maître.
- **Test automatisé** : un script vérifie que les ports ne répondent pas depuis une machine hors tailnet.

### REST

```
GET  /api/topology                      # maître → machines → business → projets (+ badges)
GET  /api/machines
POST /api/machines/:id/wake

GET  /api/projects
GET  /api/projects/:id
GET  /api/runs?project=&status=
GET  /api/runs/:id                      # run + étapes
POST /api/runs                          # { projectId, pipelineIndex, llmOverrides? }
POST /api/runs/:id/pause
POST /api/runs/:id/resume
POST /api/runs/:id/stop
POST /api/runs/:id/rerun                # { fromNodeId }
POST /api/approvals/:id                 # { decision: "approved"|"rejected", note? }

GET  /api/registry/agents               # + versions + évals par modèle
GET  /api/registry/models
GET  /api/registry/pipelines
PUT  /api/registry/pipelines/:name/:version   # validation zod, écriture fichier + commit
POST /api/registry/pipelines/validate

GET  /api/usage                         # quota abonnement + dépense OmniRoute + budgets
```

### Temps réel : SSE vers le navigateur

```
GET /api/stream           # tous les événements
GET /api/stream?run=:id   # filtré
```

- L'`id` SSE = l'id de l'événement en base. À la reconnexion, le navigateur renvoie `Last-Event-ID` et le serveur rejoue les événements manqués.
- **Pourquoi SSE et pas WebSocket ici** : le navigateur ne fait que recevoir, les commandes passent par REST. SSE gère nativement la reconnexion et la reprise, ce qui compte sur mobile. Le WebSocket est réservé au lien maître ↔ workers (§7.4). Passer l'UI en WebSocket reste possible si Raphaël le confirme : il faudra alors implémenter reconnexion + reprise par curseur d'événement.

Auth : identité Tailscale (réutiliser le travail de `feat/tailnet-acces`). Aucune route accessible hors tailnet.

---

## 11. Interface

Stack : React + Vite + **TypeScript**, `@xyflow/react` (React Flow), auto-layout via `dagre` ou `elkjs`. Schémas et types importés du package `schemas` d'`agent-orchestrator`.

### 11.1 Topologie
- Racine : **Orchestrateur maître**. Niveau 2 : **machines** (PC, NAS). Niveau 3 : **business**. Niveau 4 : **projets**.
- Un projet est rangé sous sa `homeMachine`. S'il a des étapes sur l'autre machine : badge « multi-machine » + arête en pointillés vers l'autre machine.
- Couleur d'état sur chaque nœud (actif / récent / erreur / en veille / en attente) et arêtes animées pendant un run.
- Nœud machine : état + bouton **Réveiller** si `sleeping`.
- Clic sur un projet → panneau latéral : pipelines attachés, derniers runs, bouton lancer.

### 11.2 Dashboard agents (panneau latéral, style « Recent requests » d'OmniRoute)
- Liste live des étapes : agent@version, projet, machine, modèle, statut, durée, tokens, coût (estimé ou réel).
- Actions : pause, reprise, stop, relancer depuis une étape, approuver/rejeter une gate.
- Jauge quota abonnement + dépense OmniRoute du mois + budgets par projet.

### 11.3 Éditeur de pipelines
- Vue graphe et vue JSON côte à côte, synchronisées. Le JSON fait foi.
- Palette de nœuds : agent / model / script / gate. Sélecteurs d'agents et de modèles **avec version**.
- Validation live (zod + cycles sans `maxLoops` + références inexistantes).
- **Avertissement** si un nœud utilise un couple (agent@version, modèle) sans évals réussies.
- Sauvegarde = nouvelle version du template (pas d'écrasement d'une version utilisée par un projet).

### 11.4 Mobile
Topologie + dashboard + actions. **Pas d'éditeur de pipelines sur mobile.**

---

## 12. Phases recommandées

Chaque phase se termine par une démo et une validation de Raphaël.

### Phase 0 — Audit (aucune modification de code)
- Lire `business-pipelines` et `agent-orchestrator`.
- Produire `docs/AUDIT.md` : stack actuelle, ce qui est réutilisable, conflits avec cette spec, réponses aux **[À VÉRIFIER]** faciles à trancher (`claude --help`), plan ajusté.

### Phase 1 — Runner + event store (une seule machine)
- Runner Claude Code (§6), faux binaire, parsing, SQLite (§9), stop/reprise, détection de quota (stub si format inconnu).
- **Acceptation :** un pipeline linéaire de 2 étapes tourne avec le faux binaire ; tous les événements sont en base ; le stop tue le process ; la reprise utilise `--resume` ; tests verts.

### Phase 2 — Moteur de pipeline
- Package `schemas` (zod, §5) dans `agent-orchestrator`, création du repo `agent-registry` avec sa CI de validation, résolution template + overrides, types `agent` / `script` / `gate`, arêtes conditionnelles, `maxLoops`, `outcome.json`, checkpoints git, relance depuis une étape, budgets.
- **Acceptation :** la boucle `code ↔ review` s'arrête à `maxLoops` ; une gate bloque le run jusqu'à décision ; la relance depuis `review` restaure le bon commit ; un cycle sans `maxLoops` est refusé.

### Phase 3 — Maître + workers
- Protocole maître/worker en WebSocket (§7.4), heartbeat, états machines, dispatch `runsOn`, WoL, mise en veille, démarrage auto du worker WSL (§7.6), remote bare NAS + miroir GitHub (§7.3).
- **Acceptation :** un pipeline avec une étape NAS puis une étape PC s'exécute de bout en bout avec le PC initialement en veille ; une coupure réseau de 30 s pendant une étape ne perd aucun événement ; la perte du worker PC est visible et n'échoue pas silencieusement ; un échec du miroir GitHub ne bloque pas le run.

### Phase 4 — Cockpit en lecture
- Migration de `cockpit.js` en API REST + SSE ; front React : topologie + dashboard live.
- **Acceptation :** un run lancé en CLI apparaît en temps réel dans la topologie et le dashboard, depuis le téléphone via Tailscale ; le cockpit ne répond pas depuis une machine hors tailnet (test automatisé).

### Phase 5 — Cockpit en action
- Lancer un run, pause/reprise/stop, gates, relance depuis une étape, jauge de quota, budgets.
- **Acceptation :** toutes les actions fonctionnent depuis le mobile ; un dépassement de budget ouvre une gate visible.

### Phase 6 — Registres + éditeur
- Registre d'agents/pipelines versionné, éditeur visuel/JSON synchronisé, sauvegarde en nouvelle version.
- **Acceptation :** créer un template dans l'éditeur, l'attacher à un projet, le lancer ; le JSON produit est identique à celui écrit à la main pour le même graphe (hors `layout`).

### Phase 7 — Multi-modèles
- Routage OmniRoute/Ollama, nœuds `model` (serveur FastAPI sur le PC, poids stockés sur le NAS avec cache local, §7.5), évals par (agent@version, modèle) basées sur le harness existant (Vitest/Playwright), avertissements dans l'éditeur.
- **Plus tard — agent `test-writer`** (Vitest + Playwright) pour les tests des projets. Règles :
  - il écrit les tests **à partir de la spec, avant le code** ;
  - l'agent codeur n'a pas le droit de modifier les tests (nœud `script` qui échoue si le diff touche les fichiers de test) ;
  - gate humaine sur les tests générés.
  - Les évals **des agents eux-mêmes** restent curées par Raphaël, pas générées.
- **Acceptation :** une même étape tourne sur Claude puis sur un modèle OmniRoute via override ; un nœud `model` maison est appelé dans un pipeline ; l'éditeur signale un couple non évalué.

---

## 13. Hors scope (pour l'instant)

- Fine-tuning de modèles de langage.
- Exposition publique du cockpit.
- Multi-utilisateur / gestion de rôles.
- Plus de deux machines (le design ne doit pas l'empêcher, mais on ne le code pas).

## 14. Décisions prises

1. **Git** : remote principal = dépôt bare sur le NAS, miroir GitHub asynchrone incluant les branches `run/*`, avec nettoyage (§7.3).
2. **Registres** : repo dédié `agent-registry` (§2, §5.1).
3. **Transport** : WebSocket maître ↔ workers (§7.4), SSE cockpit → navigateur (§10).
4. **Modèles maison** : un serveur FastAPI unique sur le PC (CPU/RAM du PC), poids stockés sur le NAS (§7.5).
5. **Évals** : harness existant Vitest/Playwright pour l'instant ; agent `test-writer` plus tard avec garde-fous (§12, Phase 7).
6. **Langage** : TypeScript pour Node et React, migration progressive (§0).
7. **Exposition** : jamais sur internet, tailnet uniquement (§3, §10).

## 15. Questions ouvertes

1. Emplacement des fiches projet (`project.json`) : **A)** toutes centralisées dans `business-pipelines/projects/`, ou **B)** une fiche `.orchestrator/project.json` dans chaque repo projet + une simple liste des repos dans `business-pipelines`. Recommandation : A.
