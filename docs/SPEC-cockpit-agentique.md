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

### 1.1 Glossaire

Termes employés dans toute la spec. Ils ne sont pas interchangeables.

| Terme | Définition |
|---|---|
| **Maître** | Le planificateur, sur le NAS. **Du code, pas un LLM** : il décide quelle étape lancer, où, et applique budgets, quotas et gates |
| **Worker** | Un petit programme par machine qui exécute ce que le maître lui envoie et rend compte. Il ne décide de rien |
| **Runner** | Le module d'un worker qui lance `claude -p`, lit sa sortie et la traduit en événements |
| **Agent** | Une définition versionnée (prompt, skills, outils, modèle par défaut) exécutée par un process Claude Code. Un worker exécute des dizaines d'agents différents |
| **Nœud** | Une case d'un pipeline : `agent`, `model`, `script` ou `gate` |
| **Outcome** | Le verdict d'une étape (`approved`, `changes_requested`…), déclaré par l'agent et lu dans `.orchestrator/outcome.json` |
| **Template** | Un pipeline réutilisable et versionné, dans `agent-registry` |
| **Instance** | L'usage d'un template par un projet (`extends` + overrides), dans `project.json` |
| **Run** | Une exécution d'un pipeline. Une **étape** est l'exécution d'un nœud dans ce run |
| **Gate** | Un point d'arrêt qui attend une décision humaine dans le cockpit |

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

### Répartition de la charge

**Le maître n'est pas un modèle d'IA.** C'est du code (scheduler, règles, SQLite, WebSocket). Il consomme très peu et tourne sur le NAS parce que le NAS est toujours allumé : si le maître était sur le PC, personne ne pourrait réveiller le PC, lancer les runs planifiés ni afficher le cockpit pendant sa veille.

| Charge | Où elle tourne | Poids |
|---|---|---|
| Maître, event store, cockpit | NAS | léger |
| Étapes `script` légères (collecte, alertes) | NAS | léger |
| Raisonnement des agents Claude | serveurs Anthropic (cloud) | nul en local |
| Process Claude Code + ce que l'agent exécute (install, build, tests, Playwright) | PC | lourd |
| Modèles maison, Ollama | PC | lourd |
| Décisions de jugement du maître (exceptions, arbitrages) | appel à Claude, donc cloud | nul en local |

Règle : **le NAS décide et stocke, le PC calcule.** Toute étape gourmande est déclarée `runsOn: pc`.

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
  connectors/<connector-name>.json   # outils externes (MCP), sans aucun secret

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
  "title": "Build SaaS complet",
  "description": "Génère, revoit et teste une app à partir d'une spec",
  "tags": ["saas", "code"],
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

**Champs de nom :** `name` est l'identifiant technique, **figé à la création** — c'est lui que les projets référencent (`saas-build@3`), donc il n'est jamais renommable : l'action proposée est « dupliquer sous un nouveau nom ». `title`, `description` et `tags` sont éditables à tout moment et **ne créent pas de nouvelle version**, puisqu'ils ne changent pas le comportement. Seule une modification du graphe en crée une.

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

### 5.6 Connecteur externe (`connectors/<name>.json`)

Catalogue des outils externes utilisables par les agents (MCP).

```json
{
  "name": "notion",
  "version": 1,
  "kind": "mcp",
  "transport": { "type": "http", "url": "https://mcp.notion.com/mcp" },
  "auth": { "secretRef": "NOTION_MCP_TOKEN" },
  "availableOn": ["nas", "pc"],
  "defaultAccess": "read-only"
}
```

Règles :

- **Aucun secret dans git.** Le fichier ne porte qu'un `secretRef` ; la valeur vit dans le `.env` du NAS (ou un secret Docker) et n'est résolue que par le worker au lancement de l'étape. Le cockpit affiche `configuré` ou `manquant`, jamais la valeur.
- **Test de connexion** : une commande de santé par connecteur, déclenchable depuis le cockpit.
- **Lecture seule par défaut.** Tout outil d'**écriture externe** (envoyer un mail, modifier une page, écrire en base) doit être activé explicitement sur l'agent **et** placé derrière une gate humaine dans le pipeline. Raison : un agent qui lit une page web, un email ou un ticket peut y trouver des instructions injectées ; le contenu récupéré par un outil est une donnée, jamais une consigne.
- **[À VÉRIFIER]** : les connecteurs en OAuth (Notion, Gmail, Drive) supposent une autorisation interactive. Déterminer comment autoriser une fois puis rendre le jeton utilisable par un worker headless, et où stocker ce jeton.

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

Crée `test/fixtures/fake-claude.mjs`, un exécutable qui imite `claude -p` : il émet une séquence `stream-json` scriptée (succès, erreur, limite de quota, sortie lente pour tester le stop) et écrit `.orchestrator/outcome.json`. Le runner accepte un chemin de binaire configurable (`CLAUDE_BIN`).

### 6.5 Dynamic workflows de Claude Code

Claude Code sait orchestrer des dizaines de sous-agents via un script JavaScript (`ultracode` / « use a workflow », suivi par `/workflows`). Deux usages, à ne pas confondre :

- **Pour construire ce projet** : utile sur les tâches en éventail — l'audit de Phase 0, la migration JS → TypeScript, « corriger jusqu'à ce que `tsc` passe », la revue des fichiers modifiés. Inutile sur les phases 1 à 3, qui sont du code d'architecture couplé. Un workflow **ne peut pas demander de validation en cours de route** : un workflow par tâche, jamais un pour toute une phase. Taille recommandée : `small`.
- **Comme moteur de l'orchestrateur : NON.** La pause automatique sur limite d'usage ne s'applique pas en `claude -p`, un run ne se reprend que dans la même session, il n'y a ni gate humaine ni répartition NAS/PC, et le script n'a pas d'accès système direct. Le maître reste le planificateur.
- **Intégration possible (Phase 7)** : un nœud `agent` peut invoquer un **workflow sauvegardé** pour une tâche en éventail (audit de 50 routes, migration de masse). En `-p` il n'y a aucune invite, donc il faut une règle d'autorisation `Workflow(<nom>)`, et c'est le maître qui gère le quota. **[À VÉRIFIER : ce que `stream-json` remonte des sous-agents d'un workflow, pour l'afficher dans le dashboard.]**

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
4. **Veille, jamais extinction.** Le Wake-on-LAN depuis une machine éteinte est peu fiable sous Windows (le démarrage rapide le casse souvent) ; depuis la veille il fonctionne bien.
5. **Contexte à connaître** : le ROG G10CE est encore le poste de développement de Raphaël et deviendra un serveur homelab dédié quand il aura acheté sa nouvelle machine principale. Tant que ce n'est pas le cas, le maître ne peut demander la veille que si **toutes** ces conditions sont réunies :
   - aucune étape en file pour le PC ;
   - aucune activité clavier/souris Windows depuis X minutes (configurable) ;
   - aucun verrou « ne pas endormir » actif dans le cockpit (interrupteur à prévoir dans l'UI).
   Un drapeau de configuration (`dedicatedHomelab: true`) ne laissera plus que la première condition.

Note Docker/Synology : l'envoi du broadcast WoL depuis un conteneur nécessite probablement `network_mode: host` **[À VÉRIFIER]**.

Concurrence : configurable par worker (défaut **1**, pour ménager le quota d'abonnement).

### 7.3 Checkpoints git (état partagé)

- Un run travaille sur une branche `run/<runId>`.
- Avant chaque étape : `git pull`. Après chaque étape réussie : commit `[run <runId>] step <nodeId>` puis `git push`.
- Le hash du commit est stocké dans l'étape (`steps.checkpoint_sha`).
- **Remote principal : dépôt bare sur le NAS** (SSH, ou le paquet Git Server de Synology **[À VÉRIFIER]**). Les workers poussent **uniquement** vers ce remote : ça marche sans internet et évite toute divergence.
- **Miroir GitHub** : un hook `post-receive` sur le NAS pousse vers GitHub en asynchrone. Un échec du miroir émet `mirror.failed` mais ne bloque **jamais** un run. Par défaut : `main`, les tags **et les branches `run/*`**.
- **Nettoyage** : les branches `run/*` fusionnées, ou plus vieilles que N jours (configurable), sont supprimées des deux remotes.
- **Ne s'applique qu'aux repos de projets.** Pour les trois repos d'outillage (`agent-orchestrator`, `agent-registry`, `business-pipelines`), **GitHub reste le remote principal** — Raphaël les développe lui-même et la CI d'`agent-registry` tourne sur GitHub Actions ; le NAS n'en garde qu'une copie de sauvegarde. Cas particulier d'`agent-registry` : le cockpit commite sur sa copie de travail NAS puis pousse vers GitHub en asynchrone, avec réessai. **Une sauvegarde de pipeline ne doit jamais être perdue faute d'internet.**
- **Le vault Obsidian** suit le modèle des projets : bare sur le NAS, push depuis le PC (§7.6).
- Fusion de la branche du run : uniquement après une gate ou une étape finale explicite.

### 7.4 Transport maître ↔ workers (WebSocket)

- Lib `ws`. `ws://` suffit sur le tailnet (trafic déjà chiffré par WireGuard).
- **Auth : les deux niveaux, pas un seul.** (1) ACL Tailscale : seuls le PC et le NAS atteignent le port WebSocket du maître — le tailnet contient aussi le téléphone et le futur PC principal, donc Tailscale seul ne suffit pas à identifier un worker. (2) **Un jeton par worker**, hors git (`.env` ou secret Docker) ; le maître n'en stocke que le hash. À la connexion, il vérifie le jeton **et** que le nom de machine Tailscale correspond au worker annoncé. Chaque worker est ainsi révocable indépendamment.
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

### 7.6 Base de connaissance (vault Obsidian)

Le chat du cockpit (§11.7) s'appuie en priorité sur le vault Obsidian de Raphaël pour les questions de connaissance.

- **Miroir sur le NAS.** Le vault est déjà versionné avec git, mais vit sur le PC (OneDrive, Windows). Même dispositif que pour les projets : dépôt bare sur le NAS, push depuis le PC, copie de travail **en lecture seule** côté NAS. Le chat ne dépend donc ni de OneDrive ni de l'état de veille du PC.
- **Le plugin Karpathy n'est pas réutilisable** : c'est un plugin Obsidian, pas un service. Le cockpit a sa propre recherche sur la copie du NAS.
- **Index : SQLite FTS5** sur les fichiers `.md`, réindexé par un hook `post-receive` (seuls les fichiers modifiés). Pas d'embeddings au départ : le format de note utilisé (bloc « Quand consulter cette note », « Termes couverts (FR/EN) », tables symptôme→cause→remède) se prête bien à la recherche lexicale.
- **Embeddings : plus tard, et seulement si le lexical rate des questions.** Indexation en lot sur le PC, recherche sur le NAS.
- **Outil MCP `vault-search`**, local et **strictement en lecture** : `vault_search(query, k, folder?)`, `vault_read(path, section?)`, `vault_list(folder)`. Le chat n'écrit jamais dans le vault (édité en parallèle par Raphaël et sous git).
- **[À VÉRIFIER]** : le dossier `wiki/` généré par le plugin est-il indexé au même titre que `notes/`, ou traité comme source secondaire ?

### 7.7 Particularités du PC (Windows 11 + WSL)

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
- **Les runs ad hoc (§11.6) n'appartiennent à aucun template et échappent donc aux budgets de pipeline.** Ils ont leur propre plafond, par run et par mois, sinon ils deviennent la porte de sortie qui vide le quota sans qu'aucun pipeline n'en soit responsable.
- **Le chat (§11.7) a lui aussi son plafond mensuel séparé**, compté hors budgets de projet.

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
POST /api/runs/adhoc                    # { projectId, agent, llm?, prompt, tools? } → run à un seul nœud
POST /api/pipelines/from-run/:runId     # sauver un run (ad hoc ou non) comme template versionné
POST /api/runs/:id/pause
POST /api/runs/:id/resume
POST /api/runs/:id/stop
POST /api/runs/:id/rerun                # { fromNodeId }
POST /api/approvals/:id                 # { decision: "approved"|"rejected", note? }

GET  /api/registry/agents               # + versions + évals par modèle
GET  /api/registry/connectors           # + état : configuré / manquant / test OK
POST /api/registry/connectors/:name/test
GET  /api/registry/models
GET  /api/registry/pipelines            # + usedBy : projets et version épinglée par chacun
PATCH /api/registry/pipelines/:name     # title, description, tags — sans nouvelle version
PUT  /api/registry/pipelines/:name/:version   # validation zod, écriture fichier + commit
POST /api/registry/pipelines/validate

GET  /api/usage                         # quota abonnement + dépense OmniRoute + budgets

GET  /api/chat/threads
POST /api/chat/threads                  # { projectId? }
POST /api/chat/threads/:id/messages     # { text, context?, llm? } → réponse en SSE
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

Stack : React + Vite + **TypeScript**, `@xyflow/react` (React Flow), auto-layout via `dagre` (mode top-bottom). Schémas et types importés du package `schemas` d'`agent-orchestrator`.

Trois vues : **Topologie**, **Éditeur de pipelines**, **Agents** (dashboard). Barre supérieure commune : runs actifs, jauge de quota, dépense du mois.

### 11.1 Topologie — arbre descendant

Forme d'arbre de décision, quatre rangs, de haut en bas :

```
rang 0   orchestrateur maître
rang 1   machines            PC homelab · NAS
rang 2   catégories          business ou type de projet
rang 3   projets
```

- **Layout automatique** (dagre, `rankdir: TB`), recalculé à chaque changement. Les nœuds **ne se déplacent pas à la main** et aucune position n'est persistée dans cette vue.
- **Pliage** : chaque nœud de rang 1 et 2 se plie/déplie. L'état plié est mémorisé côté navigateur, par utilisateur.
- **Ce n'est pas un arbre strict** : un projet avec des étapes sur les deux machines a un trait plein vers sa `homeMachine` et une **arête en pointillés** vers l'autre machine, plus un badge multi-machine.
- **Arêtes** : pas de conditions (contrairement à un arbre de décision). Étiquette optionnelle : nombre de pipelines ou état du dernier run.
- **États** (couleur de bordure + pastille) : actif, en pause, en attente (gate, quota, machine), erreur, inactif. Machine : en ligne, occupée, en veille, réveil en cours, hors ligne. Arêtes animées pendant un run.
- **Interactions** : clic = panneau latéral ; double-clic = plier/déplier ; clic droit = menu contextuel (lancer un pipeline, pause, stop, ouvrir dans l'éditeur, voir les logs) ; nœud machine en veille = bouton réveiller.
- Mise à jour en direct par SSE : un événement ne recalcule que les nœuds concernés, jamais tout l'arbre.

### 11.2 Panneau latéral

Ouvert par un clic sur un nœud, jamais en modale (on garde l'arbre visible).

- **Projet** : machine, catégorie, pipelines attachés, 5 derniers runs, budget consommé, boutons lancer / éditer.
- **Run en cours** : liste des étapes avec agent@version, modèle, statut, durée, tokens, coût ; actions pause, stop, relancer depuis une étape, approuver/rejeter une gate.
- **Machine** : état, workers connectés, étapes en cours, dernier heartbeat, bouton réveiller.

### 11.3 Éditeur de pipelines (inspiration n8n)

- **Canvas React Flow**, positions manuelles **persistées** dans le champ `layout` du pipeline (à l'inverse de la topologie).
- **Palette de nœuds** par catégorie : Agents (registre, avec version), Modèles (registre), Scripts, Gates, **Sous-pipelines** (un pipeline utilisé comme nœud, c'est le mécanisme de réutilisation).
- **Ports explicites** : une entrée, une ou plusieurs sorties nommées par les outcomes déclarés de l'agent (`approved`, `changes_requested`, `failed`). Les arêtes conditionnelles se dessinent en tirant depuis la bonne sortie.
- **Panneau de configuration** à droite du nœud sélectionné (§11.4).
- **Vue JSON** synchronisée côte à côte. Le JSON fait foi ; le canvas n'est qu'une vue.
- **Overlay d'exécution** : pendant un run, chaque nœud affiche son statut et chaque arête le volume passé (tokens, coût, durée), à la manière des compteurs d'items de n8n.
- **Validation live** : zod, références de version inexistantes, cycle sans `maxLoops`, sortie non déclarée, nœud orphelin.
- **Sauvegarde = nouvelle version** du template. Jamais d'écrasement d'une version utilisée par un projet. Verrouillage optimiste : si le fichier a changé depuis le chargement, l'éditeur propose la fusion au lieu d'écraser.
- **Hors périmètre** : pas de moteur d'expressions façon n8n, pas de catalogue d'intégrations généraliste. Les apps tierces passent par les connecteurs MCP attachés aux agents.

### 11.4 Configuration d'un agent dans un nœud

Le panneau d'un nœud `agent` expose, par onglets :

| Onglet | Contenu |
|---|---|
| Général | agent + version, libellé du nœud, `runsOn` |
| Modèle | via (claude / omniroute / ollama) + modèle, avec avertissement si le couple (agent@version, modèle) n'a pas d'évals réussies |
| Skills | skills disponibles dans le registre et les plugins installés, cases à cocher |
| Outils | outils autorisés, connecteurs MCP (Notion, Gmail, Drive, Supabase…) |
| Avancé | timeout, `maxLoops` des arêtes sortantes, budget du nœud |

**Niveau d'attachement** : skills, plugins, outils et serveurs MCP appartiennent d'abord à la **définition versionnée** de l'agent (`agent.md`). Les modifier depuis un nœud crée un **override de pipeline**, affiché explicitement comme « configuration non évaluée ». L'éditeur propose alors de figer l'override dans une nouvelle version de l'agent.

**Exécution** : avant de lancer l'étape, le worker prépare un espace de travail temporaire — skills sélectionnés dans `.claude/skills/`, `settings.json` avec les outils autorisés, configuration MCP passée à la CLI. **[À VÉRIFIER : options exactes de la version installée de Claude Code, notamment pour les plugins et `--mcp-config`.]**

### 11.5 Dashboard agents

Liste live des étapes (agent@version, projet, machine, modèle, statut, durée, tokens, coût), filtrable par projet et par machine. Jauge de quota d'abonnement, dépense OmniRoute du mois, budgets par projet. Actions identiques au panneau latéral.

### 11.6 Bibliothèque, outils et lancement rapide

**Bibliothèque de pipelines** : une carte par template, avec :

- **Vignette du graphe**, façon n8n. Rendue par une **fonction pure SVG**, jamais par une instance React Flow (trop lourd à multiplier) : coordonnées de `layout` normalisées dans un `viewBox`, un rectangle par nœud coloré selon son type, une ligne par arête. Pas d'interaction ; le clic ouvre l'éditeur. Si `layout` est absent, positions calculées avec dagre (`rankdir: LR`) et mises en cache par `name@version`. Au-delà de 8 nœuds, afficher les premiers puis un `+N`.
- **`title` éditable en place**, avec le `name` technique, la version courante et le nombre de nœuds en sous-titre. `description` et `tags` éditables, filtres par tag et recherche.
- **Projets utilisateurs** : un badge par projet, portant la version qu'il épingle (`storia · v3`). Les versions peuvent différer d'un projet à l'autre et doivent rester visibles. Un template sans aucun projet est marqué comme tel, pour permettre le ménage. Clic sur un badge = navigation vers ce projet dans la topologie.
- **Actions** : ouvrir dans l'éditeur, dupliquer en nouvelle version, dupliquer sous un nouveau nom, **utiliser dans un projet** (crée l'instance avec ses overrides).

L'index `usedBy` est construit par le cockpit à partir des `extends` des `project.json` ; il n'est jamais stocké dans le template. Supprimer ou écraser une version encore référencée est refusé.

**Page Outils** : catalogue des connecteurs (§5.6) avec leur état (`configuré`, `manquant`, dernier test), les machines où ils sont disponibles, et la liste des agents qui les utilisent. Bouton tester la connexion. Les outils d'écriture externe sont marqués d'un avertissement explicite.

**Lancement rapide** (palette de commandes, raccourci clavier) : choisir un agent@version **ou** un pipeline sauvegardé, un projet, un modèle, écrire une consigne, lancer. Un run ad hoc est un run à un seul nœud, tracé comme les autres (étapes, coût, logs, contrôles).

**Sauver comme pipeline** : bouton disponible sur tout run, ad hoc ou non. Il crée un template versionné à partir du run et l'ouvre dans l'éditeur. C'est le chemin prévu entre bricoler et industrialiser.

### 11.7 Chat intégré (lecture seule)

Un panneau de conversation pour **comprendre ce qui se passe** : pourquoi un run a échoué, ce qu'a fait une étape, où part le budget. Il n'agit pas.

**Moteur** : agent `cockpit-assistant@1` du registre, exécuté par le runner existant. Aucun moteur séparé.

**Modèle** : par défaut un **modèle économique via OmniRoute**, pour ne pas consommer le quota d'abonnement dont les agents de code ont besoin. Sélecteur dans l'interface pour basculer sur Claude quand une question est difficile. La dépense du chat est suivie **à part** dans `/api/usage`, avec un plafond mensuel : au-delà, le chat est désactivé avec un message clair, jamais en silence.

**Outils** : un serveur MCP local `cockpit-read`, **strictement en lecture**, exposant :

| Outil | Retour |
|---|---|
| `get_topology` | machines, catégories, projets, états |
| `list_runs` | runs filtrés par projet, statut, période |
| `get_run` | run + étapes + coûts + outcomes |
| `get_step_log` | log d'une étape, avec `tail` et `grep` (jamais le log entier) |
| `get_usage` | quota, dépense, budgets |
| `get_registry` | agents, modèles, pipelines, connecteurs |

Et un second serveur MCP local, `vault-search` (§7.6), pour la base de connaissance.

**Rôle et sources** — le chat est d'abord **opérationnel** (comprendre les runs, les coûts, les échecs), mais il dispose en permanence du **contexte projet** issu du vault, pour pouvoir proposer des pistes. Ordre imposé par le prompt système de `cockpit-assistant` :

1. **Contexte permanent, chargé hors recherche** : `_context/PROFILE.md` et l'entrée du projet sélectionné dans `_context/PROJECTS.md`. Quand un projet est sélectionné dans la topologie, sa spec `_context/projects/<projet>.md` est chargée en plus.
2. **État réel** : `cockpit-read`, seule source pour les runs, étapes, logs, coûts et budgets.
3. **Connaissance à la demande** : `vault-search` sur `notes/` quand une question technique le justifie, pas systématiquement. `wiki/` est une source **secondaire** (contenu dérivé des notes).

**Budget de contexte** : profil et statut du projet sont courts et restent chargés ; les specs détaillées et les notes sont lues à la demande via `vault_read`. Ne jamais injecter tout le vault dans un fil — le modèle économique s'y noie et le coût grimpe.

**Attribution et divergences** : `PROJECTS.md` est tenu à la main, l'event store reflète ce qui a réellement tourné ; les deux divergeront. Le chat **attribue chaque affirmation à sa source** (« ta note du 12/08 dit X, les trois derniers runs montrent Y ») et **signale explicitement la divergence** au lieu d'en choisir une. Il peut rédiger la mise à jour de la note ; Raphaël la commite lui-même, le chat n'écrit pas dans le vault.

**Suggestions sans action** : une proposition se matérialise par une carte (ce qui est proposé, pourquoi, bouton). Le clic crée un run ad hoc ou ouvre l'éditeur pré-remplis. Rien ne part sans ce clic, y compris quand la suggestion découle d'un contenu lu dans un log.

**Sécurité — règle centrale** : le chat n'a **aucun outil d'écriture**, et le cockpit n'expose aucune route POST au modèle. Les logs et sorties d'agents qu'il lit sont du **contenu non fiable** : une consigne injectée dans un log ne doit pouvoir déclencher aucune action. Quand une action semble pertinente, le modèle la **propose** sous forme de carte de confirmation dans l'interface ; l'appel REST n'est déclenché que par le clic de Raphaël. Pas d'outil web dans cette phase.

**Contexte** : la vue courante (projet ou run sélectionné) est passée en en-tête de contexte. Les fils de conversation sont stockés en base (`chat_threads`, `chat_messages`), éventuellement rattachés à un projet. Boutons « expliquer cette étape » depuis le panneau latéral, qui pré-remplissent le chat.

**Mobile** : le chat est prioritaire sur mobile, c'est le meilleur moyen de comprendre un échec sans faire défiler des logs.

### 11.8 Mobile

Topologie (pliée par défaut au rang 2), dashboard et actions. **Pas d'éditeur de pipelines sur mobile.**

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
- Bibliothèque de pipelines, page Outils (connecteurs), lancement rapide, run ad hoc, bouton sauver comme pipeline (§11.6).
- **Acceptation :** créer un template dans l'éditeur, l'attacher à un projet, le lancer ; le JSON produit est identique à celui écrit à la main pour le même graphe (hors `layout`) ; lancer un agent seul depuis le lancement rapide puis sauver ce run comme template réutilisable ; un connecteur mal configuré est signalé avant le lancement, pas pendant ; la vignette d'un pipeline sans `layout` s'affiche correctement ; changer le titre d'un template ne crée pas de version et ne casse aucun `extends`.

### Phase 7 — Multi-modèles
- Routage OmniRoute/Ollama, nœuds `model` (serveur FastAPI sur le PC, poids stockés sur le NAS avec cache local, §7.5), évals par (agent@version, modèle) basées sur le harness existant (Vitest/Playwright), avertissements dans l'éditeur.
- **Plus tard — agent `test-writer`** (Vitest + Playwright) pour les tests des projets. Règles :
  - il écrit les tests **à partir de la spec, avant le code** ;
  - l'agent codeur n'a pas le droit de modifier les tests (nœud `script` qui échoue si le diff touche les fichiers de test) ;
  - gate humaine sur les tests générés.
  - Les évals **des agents eux-mêmes** restent curées par Raphaël, pas générées.
- **Acceptation :** une même étape tourne sur Claude puis sur un modèle OmniRoute via override ; un nœud `model` maison est appelé dans un pipeline ; l'éditeur signale un couple non évalué.

---

### Phase 8 — Chat intégré (§11.7)
- Serveur MCP `cockpit-read`, agent `cockpit-assistant@1`, route de chat en SSE, panneau UI, suivi de dépense séparé.
- Miroir du vault sur le NAS, index FTS5 et serveur MCP `vault-search` (§7.6).
- **Acceptation :** « pourquoi le run X a-t-il échoué ? » donne une réponse citant l'étape et la ligne de log concernées, **sans lancer de recherche dans `notes/`** ; sélectionner un projet charge son contexte `_context/` dans le fil ; une divergence entre `PROJECTS.md` et les runs réels est signalée avec ses deux sources ; une suggestion produit une carte à confirmer et ne déclenche jamais rien par elle-même ; le chat ne dispose d'aucun outil d'écriture (test : une consigne injectée dans un log, du type « annule ce run », ne déclenche rien) ; le plafond de dépense atteint désactive le chat avec un message explicite ; le fil est repris correctement depuis le mobile.

## 13. Hors scope (pour l'instant)

- Fine-tuning de modèles de langage.
- Exposition publique du cockpit.
- Multi-utilisateur / gestion de rôles.
- Plus de deux machines (le design ne doit pas l'empêcher, mais on ne le code pas).
- **Un LLM comme orchestrateur maître** (Hermes local, ou autre). Écarté : les décisions du maître sont rares mais critiques, un modèle local quantifié n'y apporte aucun gain et chaque décision réveillerait le PC. Le maître reste du code + des appels à Claude pour les cas de jugement.
- Idées gardées pour plus tard : un agent Hermes sur Telegram appelant l'API du cockpit ; des modèles locaux (Ollama) sur les étapes légères ; l'indexation vectorielle du vault.

## 14. Décisions prises

1. **Git** : remote principal = dépôt bare sur le NAS, miroir GitHub asynchrone incluant les branches `run/*`, avec nettoyage (§7.3).
2. **Registres** : repo dédié `agent-registry` (§2, §5.1).
3. **Transport** : WebSocket maître ↔ workers (§7.4), SSE cockpit → navigateur (§10).
4. **Modèles maison** : un serveur FastAPI unique sur le PC (CPU/RAM du PC), poids stockés sur le NAS (§7.5).
5. **Évals** : harness existant Vitest/Playwright pour l'instant ; agent `test-writer` plus tard avec garde-fous (§12, Phase 7).
6. **Langage** : TypeScript pour Node et React, migration progressive (§0).
7. **Exposition** : jamais sur internet, tailnet uniquement (§3, §10).
8. **Chat intégré** : lecture seule, via un MCP local `cockpit-read`, sur un modèle économique OmniRoute par défaut (§11.7).

## 15. Questions ouvertes

1. Emplacement des fiches projet (`project.json`) : **A)** toutes centralisées dans `business-pipelines/projects/`, ou **B)** une fiche `.orchestrator/project.json` dans chaque repo projet + une simple liste des repos dans `business-pipelines`. Recommandation : A.
2. Confidentialité du vault : envoyer des extraits de notes personnelles à un modèle tiers via OmniRoute, ou router les questions de connaissance vers Ollama en local (au prix d'un réveil du PC) ?

---

## Annexe A — Brief de maquette front (Phases 4 à 8)

Le front se construit **d'abord en maquette alimentée par des fixtures**, avant tout branchement réseau. Un module `src/mock/` expose les mêmes types que le package `schemas` et simule le flux d'événements avec un timer. On valide l'interface visuellement, puis on remplace la seule couche mock par l'API réelle.

### Règles d'implémentation

- React + Vite + TypeScript ; `@xyflow/react` pour les deux canvas ; `dagre` pour la topologie ; `zod` pour les schémas. **Aucun `any`.**
- Les types des fixtures viennent des schémas zod (`z.infer`), jamais écrits à la main.
- Pas de librairie de composants lourde. CSS simple, thème sombre.
- **Topologie : positions calculées, non persistées, nœuds non déplaçables.** Éditeur : positions manuelles, persistées dans `layout`.
- **Le JSON du pipeline est la source de vérité** ; le canvas est une vue.
- Pas de moteur d'expressions façon n8n, pas de catalogue d'intégrations : les apps tierces sont des connecteurs MCP attachés aux agents.
- Vignettes de la bibliothèque : **fonction pure SVG**, jamais une instance React Flow par carte.
- Le chat **propose**, l'utilisateur clique : aucun appel POST déclenchable par le modèle.

### Fixtures à créer

Elles sont volontairement tordues : ce sont les cas où une implémentation naïve casse.

| Domaine | Contenu |
|---|---|
| Topologie | 2 machines (dont le PC en veille), 3 catégories, 6 projets dont **un multi-machine** |
| Registre | 3 agents versionnés avec outcomes, skills et connecteurs déclarés ; 1 modèle maison |
| Pipelines | un template à 5 nœuds **avec `layout`**, boucle `code ↔ review` (`maxLoops`), une gate et un nœud `model` ; un template à 3 nœuds **sans `layout`** (repli dagre) ; un template à **12 nœuds** (test du `+N`) ; un template **utilisé par aucun projet** |
| Versions | deux projets qui **épinglent des versions différentes** du même template |
| Connecteurs | 4 connecteurs dont un **`manquant`** et un **en écriture externe** (avertissement visible) |
| Runs | un run rejoué en ~30 s (topologie, éditeur et panneau latéral animés de façon cohérente) ; un run ad hoc terminé ; un run en `waiting_quota` |
| Chat | un fil de 4 échanges dont une réponse citant une étape et une ligne de log, une **divergence** entre `PROJECTS.md` et les runs réels, une carte de suggestion non confirmée, un état « plafond atteint » |

### Critères d'acceptation transverses

- L'arbre reste lisible avec 6 projets et se replie correctement.
- Déplacer un nœud dans l'éditeur modifie `layout` dans la vue JSON, et inversement.
- Un cycle sans `maxLoops` est refusé avec un message clair.
- La vignette d'un pipeline sans `layout` s'affiche correctement ; celle d'un pipeline à 12 nœuds affiche un `+N`.
- Changer le `title` d'un template ne crée pas de version et ne casse aucun `extends`.
- Un connecteur mal configuré est signalé **avant** le lancement, pas pendant.
- Le cockpit ne répond pas depuis une machine hors tailnet.
