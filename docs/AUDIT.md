# Audit, phase 0 du cockpit agentique (spec du 2026-09-18)

Audit du 2026-09-18, fait contre la nouvelle version de `SPEC-cockpit-agentique.md` (780 lignes,
glossaire §1.1 compris, lue en entier). Aucun fichier de code n'a été modifié : ce document est
le seul livrable de la phase.

Il remplace l'audit du 2026-09-16, qui reste lisible dans l'historique git. Les décisions prises
à la suite de ce premier audit sont reprises en §6, parce que la nouvelle spec en contredit
plusieurs.

| Dépôt | Branche lue | Commit |
|---|---|---|
| `agent-orchestrator` | `master` | `c3e97bc` |
| `agent-registry` | `main` | `bd5421e` |
| `business-pipelines` | `main` | `9cee431` |

Lus aussi, en lecture seule : `claude --help` (Claude Code 2.1.276), les types du SDK
`@anthropic-ai/claude-agent-sdk` 0.3.273, la configuration OmniRoute consignée en mémoire, le
vault Obsidian, et sur le NAS `tailscale serve status`, les ports en écoute et `docker ps`.

## 1. Résumé

Le contexte a changé depuis le premier audit : les phases 1 à 4 de l'ancienne spec sont codées
et fusionnées. Cette nouvelle version a été rédigée, comme la précédente, sans lire le code. Elle
revient donc sur des décisions déjà appliquées, et ajoute un périmètre neuf (connecteurs MCP,
vault, chat, bibliothèque, Phase 8, maquette sur fixtures).

Les points qui changent la forme du travail, du plus structurant au moins structurant :

1. **Le runner.** Le glossaire définit le runner comme « le module qui lance `claude -p` », et
   §6 décrit un binaire lancé en sous-processus, un faux binaire `CLAUDE_BIN` pour les tests,
   `SIGTERM` puis `SIGKILL` pour l'arrêt. Le moteur passe par l'Agent SDK depuis la décision du
   2026-09-16. Le SDK lance le même binaire Claude Code, mais les tests injectent un faux `query`
   et l'arrêt passe par un `AbortController`. Conflit C1.
2. **Le nœud humain s'appelle `gate` dans la spec, `approval` dans le code.** Le premier audit a
   tranché l'inverse du glossaire actuel : `approval` pour l'humain, `gate` réservé au juge
   automatique. Conflit C2.
3. **`maxLoops` est posé sur l'arête dans la spec, sur le cycle dans le code** (décision 3c du
   2026-09-16). Conflit C3.
4. **TypeScript partout** (§0, annexe A : « aucun `any` », types par `z.infer`). Le code est en
   JavaScript CommonJS, vérifié par `tsc` fichier par fichier (`// @ts-check` et JSDoc), et le
   front est en JSX. Conflit C5.
5. **Le front décrit par la spec n'est pas celui qui existe.** La spec veut React Flow, une
   topologie en arbre à quatre rangs calculée par dagre, du CSS simple et une maquette sur
   fixtures avant tout branchement. Le front livré est en Tailwind, branché directement sur l'API,
   et sa « topologie » est une timeline d'exécution par machine. L'acceptation de la phase 4 n'est
   donc pas atteinte au sens de la nouvelle spec. Conflit C6.
6. **Deux faits constatés pendant l'audit bloquent des acceptations déjà annoncées :**
   - le service Tailscale de Windows est désactivé (`START_TYPE 4`, arrêté) : le PC n'est pas
     sur le tailnet, donc aucun worker ne peut joindre le maître par le tailnet ;
   - le commit `2da026b` (refonte du front après essai dans Chrome, et correctif de `/app?v=…`
     qui répondait « route inconnue ») a été poussé sur `feat/cockpit-api` après la fusion de la
     PR #12. Il n'est pas dans `main`.

## 2. État actuel

### 2.1 `agent-orchestrator` (moteur)

- Node 22, CommonJS. `tsc` en `allowJs` : seuls les fichiers marqués `// @ts-check` sont
  vérifiés. Dépendances épinglées : SDK 0.3.273, `zod` 4.6.5, `yaml` 2.9.1, `ws` 8.21.3. Base
  `node:sqlite` en WAL. 42 tests Vitest, plus 9 scripts de tests historiques.
- `packages/schemas` : agent, pipeline en graphe, projet, outcome, rapport d'impact, messages du
  protocole maître/worker. Export JSON Schema pour la CI du registre.
- Moteur en graphe (`graphe.js`) : nœuds `agent`, `script`, `approval` ; `model` refusé
  (« phase 7 ») ; arêtes conditionnées par l'issue ; cycles bornés ; lots parallèles ;
  checkpoints git par lot sur `run/<runId>` ; relance `--depuis` ; budget dépassé qui ouvre une
  approbation.
- Event store : `machines`, `runs`, `steps`, `events`, `approvals`, `approval_decisions`. Pas de
  `eval_results`, `chat_threads`, `chat_messages`.
- Maître et worker (`maitre.js`, `worker.js`, `worker-exec.js`) : WebSocket, jeton haché plus
  `tailscale whois`, `seq` acquittés et rejeu, WoL, veille. Le maître vit le temps d'un run
  (`orch projet --distribue`), il n'est pas encore un service.
- L'ancien moteur en stages (`engine.js`) reste en place pour le générateur SaaS.

### 2.2 `agent-registry`

21 agents en v1, un pipeline (`marketing@1`, en graphe), schémas exportés, CI de validation qui
refuse la modification d'une version publiée. Pas de `models/` rempli, pas de `connectors/`, pas
d'`evals/` au-delà des dossiers vides.

### 2.3 `business-pipelines` (cockpit, déploiement)

- Serveur HTTP natif (`http`), pas Express. Page d'approbation en HTML généré côté serveur à la
  racine. Approbations en SQLite (`src/store.js`).
- Phase 4 fusionnée : API de lecture (`/api/tableau-de-bord`, `/api/runs`, `/api/runs/<id>`,
  `/api/machines`, `/api/flux` en SSE avec reprise par `Last-Event-ID`) et front React + Vite +
  Tailwind sous `/app`. 145 tests en scripts Node (`assert`), pas en Vitest.
- Accès : `src/acces.js` (ancienne branche `feat/tailnet-acces`, fusionnée) lit l'identité dans
  l'en-tête `Tailscale-User-Login` injecté par `tailscale serve`, en n'écoutant que sur la boucle
  locale.
- Pas de dossier `projects/` : aucun `project.json` n'existe encore.

### 2.4 NAS

- `tailscale serve` actif, Tailscale DSM 1.58.2 : `https://nas.tail8296f6.ts.net` (« tailnet
  only ») relaie vers `127.0.0.1:4600`. Funnel inactif.
- Ports en écoute : cockpit sur `127.0.0.1:4600` (conforme) ; `0.0.0.0:4700` publié par le
  conteneur `saas_tcg-generator` ; SSH et DSM sur `0.0.0.0:22` et `:443`.
- Dépôts git sous `/volume1/docker/git` : bare `marketing.git` avec hook de miroir, sauvegardes
  des trois dépôts d'outillage rafraîchies depuis GitHub par des clés de déploiement en lecture.

### 2.5 PC

- Claude Code 2.1.276 (`~/.local/bin/claude`), derrière un alias `claude=claude-auto` qui gère la
  bascule OmniRoute. Le SDK embarque son propre binaire, en 2.1.273.
- OmniRoute tourne dans WSL (service user, `127.0.0.1:20128`).
- `WslService` en démarrage automatique. `Tailscale` : désactivé et arrêté (voir §1, point 6).

## 3. Ce qui est réutilisable

| Spec | Couvert par | Écart |
|---|---|---|
| §1.1 maître, worker, run, étape, outcome | `maitre.js`, `worker.js`, event store | noms d'événements (C8) |
| §3.1 définitions dans git, état en base | registre + event store | les approbations copient le rapport et les actions (C24) |
| §3.3 versions épinglées | `registre.js`, aucun repli | aucun |
| §3.5 quota ≠ erreur | `waiting_quota`, reprise de session | pas d'heure de reprise (§4, point 5) |
| §3.6 boucles bornées | `validerPipeline`, cycle sans borne refusé | borne par cycle, pas par arête (C3) |
| §5.2 `agent.md` | schéma `agent` : `defaultLlm`, `allowedTools`, `skills`, `outcome` | identique |
| §5.4 pipeline | schéma `pipeline` | pas de `title` ni `tags` (C15) ; `gate` (C2) |
| §5.5 `project.json` | schéma `projet`, `resoudreProjet`, priorité du LLM | défaut `homeMachine` (C16) |
| §6.2 parsing, sortie brute | `agent-runner.js`, `journaux/<runId>/` | via le SDK (C1) |
| §6.3 stop, reprise, relance depuis une étape | abort, `resume`, `--depuis` | pas de pause (phase 5) |
| §7.1 à 7.4 heartbeat, états, dispatch, WoL, auth, `seq` | phase 3 | initiative de la veille (C19), ping/pong (C20) |
| §7.3 bare NAS, miroir, nettoyage | `scripts/nas/`, installé | commit par lot (C13) |
| §8 budget dépassé → `waiting_approval` raison `budget` | `controlerBudget` | identique |
| §9 event store | tables et statuts | `approvals` diffère (C9), pas d'`eval_results` |
| §10 SSE avec `Last-Event-ID` | `src/flux.js` | route `/api/flux` au lieu de `/api/stream` (C7) |
| §10 test hors tailnet | `cockpit-routes.test.js` refuse un hôte inconnu | pas de test depuis une vraie machine hors tailnet |

Non commencé : pause, lancement depuis le cockpit, connecteurs (§5.6), serveur de modèles (§7.5),
vault (§7.6), éditeur, bibliothèque et lancement rapide (§11.3 à 11.6), chat (§11.7), évals.

## 4. Les [À VÉRIFIER], tranchés quand c'était possible

| # | Point | Verdict | Constat |
|---|---|---|---|
| 1 | §5.2 syntaxe de `--allowedTools`, alias de modèles | tranché | `--allowedTools, --allowed-tools <tools...>`, liste séparée par virgules ou espaces, motifs du type `Bash(git *)`. `--tools` restreint l'ensemble disponible, ce que le code utilise déjà. `--model` accepte `fable`, `opus`, `sonnet` ou un nom complet. La forme `Bash(npm test:*)` de l'exemple de la spec reste à confirmer à l'exécution : l'aide ne montre que la forme à espace. |
| 2 | §6.1 injection du prompt système | tranché | `--system-prompt` remplace, `--append-system-prompt` ajoute (et leurs variantes `-file`). Point à connaître : `--system-prompt-snapshot` est actif par défaut, donc une session reprise renvoie le prompt enregistré au premier tour, même si le brief de l'agent a changé depuis. |
| 3 | §6.1 variables pour OmniRoute | tranché | `ANTHROPIC_BASE_URL=http://127.0.0.1:20128` et `ANTHROPIC_AUTH_TOKEN`, plus `ANTHROPIC_DEFAULT_*_MODEL` pour choisir un combo. Fonctionne avec Claude Code (vérifié le 2026-09-15 et le 2026-09-17). OmniRoute n'écoute que sur la boucle locale du PC : un worker sur le NAS ne peut pas l'utiliser. |
| 4 | §6.5 sous-agents d'un workflow dans `stream-json` | partiel | `--forward-subagent-text` renvoie le texte des sous-agents avec `parent_tool_use_id` (seulement avec `--print` et `stream-json`) ; les types du SDK déclarent `task_started`, `task_progress` et `task_notification`. Pas vérifié à l'exécution, pour ne pas consommer de quota. |
| 5 | §8 forme de la limite de quota | partiel, forme connue | Les types déclarent trois signaux : `error: "rate_limit"` sur un message assistant ; un message `rate_limit_event` avec `status: "rejected"`, `resetsAt` et `rateLimitType` (`five_hour`, `seven_day`…) ; `getUsage()` qui rend l'utilisation et `resets_at` par fenêtre. Un cas réel a été observé le 2026-09-17 dans un transcript (`quotaLimits.status: rejected`). Le runner actuel ne lit que le premier signal et ignore `resetsAt` : l'heure de reprise n'est pas exploitée. `getUsage()` suffit pour la jauge de quota de la phase 5. |
| 6 | §11.4 plugins, MCP, skills | tranché | `--mcp-config <configs...>` (fichiers ou JSON), `--strict-mcp-config`, `--plugin-dir` (répétable), `--plugin-url`, `--settings`, `--setting-sources`, `--add-dir`, `--agents <json>`. Pas d'option pour les skills : elles viennent de `.claude/skills` du répertoire de travail avec `--setting-sources project`, ce que le code fait déjà. |
| 7 | §5.6 connecteurs OAuth en headless | non tranché | Rien de vérifiable sans s'authentifier. Point voisin : `claude setup-token` fournit un jeton longue durée lié à l'abonnement, c'est la piste pour authentifier un worker headless auprès de Claude. |
| 8 | §7.2 `network_mode: host` pour le WoL | non vérifié | Demande un essai de broadcast depuis un conteneur. Le compose actuel n'utilise pas ce mode. |
| 9 | §7.3 SSH ou Git Server | tranché | SSH suffit : git 2.39.1 est présent sur DSM, les bares vivent sous `/volume1/docker/git` (la racine du volume n'est pas accessible en écriture au compte). Deux pièges : `scp` doit passer par `-O` (pas de sftp), et un bare créé par `git init` pointe sur `master`. |
| 10 | §7.5 montage SMB ou NFS | non vérifié | Dépend de la configuration du NAS. |
| 11 | §7.6 `wiki/` indexé comme `notes/` | tranché par la spec elle-même | §11.7 le classe déjà en source secondaire. Mesure : `notes/` compte 103 fichiers `.md`, `wiki/` en compte 918. Écart de chemin : la spec écrit `_context/projects/<projet>.md`, le vault range `_context/projects/<projet>/<projet>.md`. |
| 12 | §7.7 WSL (démarrage, réseau, WoL, veille) | partiel | `WslService` démarre seul. Le service Tailscale de Windows est désactivé et arrêté, donc la liaison WSL vers l'IP tailnet du NAS n'est pas vérifiable aujourd'hui. WSL ne résout pas les noms MagicDNS (réseau NAT). La liaison par le LAN (`192.168.1.18`) fonctionne. WoL dans le BIOS : non vérifiable depuis le système. |
| 13 | §10 `tailscale serve` avec le paquet DSM | tranché | Fonctionne (DSM 1.58.2), en « tailnet only », vers `127.0.0.1:4600`. Funnel inactif. |

## 5. Conflits entre la spec et le code

Chaque conflit dit ce que dit la spec, ce que fait le code, et d'où vient l'écart. Rien n'est
tranché ici. Une recommandation accompagne certains points, la décision reste à Raphaël.

**C1. Runner : CLI ou SDK.** Spec §1.1, §6.1, §6.3, §6.4 : sous-processus `claude -p
--output-format stream-json`, faux binaire `test/fixtures/fake-claude.mjs` sélectionné par
`CLAUDE_BIN`, arrêt par `SIGTERM` puis `SIGKILL`. Code : `query()` de l'Agent SDK, qui lance le
même binaire mais expose un flux de messages typés ; tests par un faux `query` injecté ; arrêt par
`AbortController`. Décision 1 du 2026-09-16 : SDK. Recommandation : garder le SDK (le parsing et
la reprise sont déjà testés) et, si le faux binaire est tenu pour obligatoire, le brancher par
`pathToClaudeCodeExecutable` du SDK plutôt que de réécrire le runner.

**C2. Nom du nœud humain.** Glossaire et §5.4 : `gate` = attente d'une décision humaine ; arêtes
`approved` / `rejected` ; événements `gate.opened`, `gate.decided`. Code : type de nœud
`approval`, événements `approval.opened`, `approval.decided` ; `gate` désigne dans l'ancien
moteur le juge automatique d'un stage. Décision 3b du 2026-09-16 : `approval` pour l'humain.

**C3. Emplacement de `maxLoops`.** Spec §5.4 : `maxLoops` sur l'arête qui revient. Code : tableau
`cycles` (`id`, `nodes`, `maxLoops`) ; deux arêtes qui reviennent dans le même cycle partagent la
même borne. Décision 3c du 2026-09-16 : par cycle.

**C4. Issues d'une décision humaine.** Spec : `approved` ou `rejected`, plus une note. Code :
`approved`, `rejected`, `oriented` (consigne libre, note obligatoire), avec une décision par
action. Décision du 2026-09-17 : garder ce détail.

**C5. Langage.** Spec §0.5 et annexe A : TypeScript côté Node et React, types par `z.infer`,
aucun `any`, migration progressive de `cockpit.js` et `cycle.js`. Code : JavaScript CommonJS
vérifié par JSDoc et `@ts-check` dans le moteur, JSX dans le front, `cockpit.js` sans typage.
`cycle.js` n'existe plus : il a été retiré le 2026-09-16 (décision 9).

**C6. Front de la phase 4.** Spec §11 et annexe A : React Flow et dagre, topologie en arbre
maître → machines → catégories → projets, pliage, panneau latéral, CSS simple sans librairie,
maquette `src/mock/` sur fixtures avant branchement. Code : Tailwind (conforme aux préférences
globales de Raphaël, contraire à « CSS simple »), pas de React Flow, pas de mock, et une timeline
d'exécution par machine à la place de l'arbre. Acceptation de la phase 4 : non atteinte au sens
de la nouvelle spec (ni arbre, ni essai depuis le téléphone).

**C7. Routes de l'API.** Spec : `/api/stream`, `/api/topology`, `/api/projects`,
`/api/runs?project=&status=`. Code : `/api/flux`, `/api/tableau-de-bord`, `/api/runs?projet=`,
`/api/machines`. Pas de `/api/topology` : il n'existe encore aucun `project.json` d'où tirer
catégories et projets.

**C8. Noms d'événements.** Spec §9 : `run.queued`, `run.started`, `run.finished`,
`step.dispatched`, `gate.opened`, `machine.state_changed`, `budget.exceeded`, `quota.reset`…
Code : `run.start`, `node.done`, `cycle.loop`, `approval.opened`, `machine.online`,
`machine.offline`, `machine.sleeping`, `machine.waking`, plus les événements historiques du
moteur en stages (`agent.start`, `gate.fail`). `step.dispatched`, `step.started`,
`step.progress`, `step.finished`, `step.failed`, `step.cancelled` et `quota.hit` concordent.

**C9. Table `approvals`.** Spec : `(id, run_id, step_id, reason, status, decided_at, note)`.
Code : `node_id` au lieu de `step_id`, plus `empreinte`, `rapport_json`, `actions_json`, `par`,
`canal`, et une table `approval_decisions` (une ligne par action).

**C10. Écoute réseau.** Spec §10 : jamais `0.0.0.0`. Code : dans le conteneur, le cockpit écoute
`0.0.0.0` (`COCKPIT_HOTE=0.0.0.0`, `COCKPIT_CONTENEUR=1`) parce qu'une boucle locale de conteneur
est injoignable ; le confinement tient à la publication `127.0.0.1:4600` de l'hôte, vérifiée sur
le NAS. Le port par défaut du maître (4700) est déjà pris sur le NAS par `saas_tcg-generator`,
publié sur toutes les interfaces. Ce dernier sort du périmètre de la spec, mais c'est le seul
service de la liste publié hors boucle locale.

**C11. Où vit le maître.** Spec §4 : service permanent sur le NAS, sous l'API du cockpit, qui
planifie les runs. Code : le maître naît et meurt avec le run (`orch projet --distribue`),
lancé depuis la ligne de commande. Choix de la phase 3, en attendant l'API.

**C12. OmniRoute et le NAS.** Spec §11.7 : le chat utilise par défaut un modèle économique via
OmniRoute ; §7.6 : le chat ne dépend pas de la veille du PC. Décision 5 du 2026-09-16 : OmniRoute
reste sur le PC, et il n'écoute qu'en local. Les deux ne tiennent pas ensemble : un chat sur le
NAS via OmniRoute demande le PC éveillé. Spec §8 : « OmniRoute = dépense réelle, à suivre à
part ». Constat : les combos utilisés passent surtout par des offres gratuites ou des comptes
(agy, codex, gemini), aucun fournisseur n'a de suivi de quota dans OmniRoute, et le
`total_cost_usd` affiché via OmniRoute est une estimation au tarif public.

**C13. Granularité des checkpoints.** Spec §7.3 : un commit après chaque étape réussie. Code : un
commit par lot de nœuds lancés ensemble, pour ne pas attribuer à un nœud le travail d'un autre ;
la relance remonte au lot précédent.

**C14. Vault sous git sur le NAS.** Spec §7.3 et §7.6 : bare sur le NAS, push depuis le PC, copie
en lecture seule côté NAS. Rien n'est en place. Le vault est bien un dépôt git sur le PC.

**C15. Champs d'un template.** Spec §5.4 : `title`, `tags`, `name` figé, modification du titre
sans nouvelle version. Code : `name`, `version`, `description`, `notes`, `budget`, `cycles`,
`layout`. Pas de `title` ni de `tags`.

**C16. `homeMachine` par défaut.** Spec : l'exemple porte `"nas"`, et « le NAS décide, le PC
calcule ». Code : défaut `pc`, posé par la décision 5 (tous les runs sur le PC).

**C17. Nœud `script`.** Spec : `run` (chemin d'un script). Code : `run` avec `args`, ou `handler`
(handler déterministe enregistré par le consommateur, qui porte aujourd'hui `consigne` et
`verify-couverture` du pipeline marketing). Extension, pas contradiction.

**C18. Identité Tailscale.** Spec §1 : « l'identité de l'appelant est vérifiée via la connexion
Tailscale et non via un header ». Code : `src/acces.js` lit l'en-tête `Tailscale-User-Login`
injecté par `tailscale serve`, et n'écoute que sur la boucle locale pour que l'en-tête ne puisse
pas venir d'ailleurs. Le maître, lui, vérifie la connexion (`tailscale whois`).

**C19. Qui initie la veille.** Spec §7.2 : « le maître ne peut demander la veille que si… » ;
§7.4 : seul `sleep.allowed` circule, du maître vers le worker ; glossaire : le worker « ne
décide de rien ». Code : le worker vérifie l'inactivité Windows et envoie `sleep.request`, le
maître répond `sleep.allowed` selon sa file et ses verrous. L'inactivité clavier ne se lit que
sur le PC, d'où ce choix.

**C20. Ping/pong.** Spec : ping/pong toutes les 15 s. Code : un message `heartbeat` applicatif
toutes les 15 s, sans ping WebSocket.

**C21. Tests.** Spec §0.3 : Vitest. `business-pipelines` teste en scripts Node avec `assert`.
`agent-orchestrator` est en Vitest, et y fait tourner ses scripts historiques.

**C22. Répartition de l'API.** Spec §10 : `cockpit.js` sert l'API REST des commandes et du
registre. Il n'y a encore aucune route d'écriture hors `/api/decider` (décisions d'approbation de
l'ancien format marketing), et deux mondes d'approbation coexistent : l'ancien (dossiers
`approvals/`, page racine) et le nouveau (table `approvals` de l'event store, `orch decider`).

**C23. Chemin des fiches projet du vault.** Voir §4, point 11.

**C24. Définitions en base.** Principe §3.1 : la base ne stocke jamais de définition. Une
approbation stocke une copie du rapport d'impact et des actions soumis (`rapport_json`,
`actions_json`). C'est l'état de la décision au moment où elle a été prise, pas une définition,
mais la frontière mérite d'être confirmée.

## 6. Décisions déjà prises, et celles que la spec remet en cause

| # | Décision (2026-09-16 et 17) | Nouvelle spec |
|---|---|---|
| 1 | Agent SDK plutôt que la CLI | contredite (C1) |
| 2 | Runs sur l'abonnement | conforme (§8) |
| 3a | Graphe écrit en fichiers, traduit en étapes | conforme |
| 3b | `approval` = humain, `gate` = automatique | contredite (C2) |
| 3c | `maxLoops` par cycle | contredite (C3) |
| 4 | Aucune décision prise par un agent ; plan d'abord ; décision hors plan remontée avec un rapport d'impact | compatible (gates humaines) |
| 5 | NAS = stockage et API, runs sur le PC, OmniRoute sur le PC seulement | tension avec le chat (C12) et `homeMachine` (C16) |
| 6 | Auth des workers : ACL + jeton haché + nom Tailscale | conforme (§7.4) |
| 7 | Veille, jamais extinction, trois conditions, drapeau serveur dédié | conforme ; initiative différente (C19) |
| 8 | Deux régimes git : projets sur bare NAS, outillage sur GitHub | conforme (§7.3) |
| 9 | Retrait d'eBay, `charger`, `execute`, `cycle.js` | la spec parle encore de `cycle.js` (C5) |
| Q6 | Approbations en SQLite avant le passage du marketing sur le PC | fait |
| §15 | Fiches projet centralisées dans `business-pipelines/projects/` (option A) | la question reste ouverte dans la spec |
| p1 | Liste d'outils de l'agent = périmètre ; compteur de boucles par run ; brief qui remplace le prompt système | compatibles |
| p2 | Registre privé ; détail des approbations gardé ; un dépôt par projet ; générateur SaaS en stages | détail des approbations : C4 |

## 7. Plan ajusté

Le plan de la spec suppose un départ de zéro. Avec quatre phases déjà livrées, il se réduit à :

1. **Trancher les conflits** (§8). Ils conditionnent des renommages qui touchent le schéma, la
   base, les événements et les routes. Mieux vaut les faire en une passe.
2. **Remettre à niveau ce qui est livré**, selon les réponses : renommages (C2, C3, C7, C8, C9),
   `title` et `tags` (C15), faux binaire si exigé (C1), début de migration TypeScript (C5),
   fusion du commit `2da026b`.
3. **Refaire le front de la phase 4 selon §11 et l'annexe A** : maquette sur fixtures d'abord,
   React Flow et dagre, arbre de topologie, panneau latéral, TypeScript. Garder la timeline par
   machine dans le panneau d'un run, où elle a sa place.
4. **Fermer l'acceptation de la phase 4 sur le vrai matériel** : réactiver Tailscale sur Windows,
   déployer le cockpit sur le NAS, ouvrir `/app` depuis le téléphone, et un test depuis une
   machine réellement hors tailnet.
5. Puis la phase 5 telle qu'écrite, avec la jauge de quota sur `getUsage()` et la reprise sur
   `resetsAt` (§4, point 5).

## 8. Questions pour Raphaël

1. Runner (C1) : garder l'Agent SDK, ou revenir à `claude -p` en sous-processus ? Si SDK, le faux
   binaire `CLAUDE_BIN` reste-t-il exigé ?
2. Nom du nœud humain (C2) : `gate` comme dans le glossaire, ou `approval` comme décidé le
   2026-09-16 ?
3. `maxLoops` (C3) : sur l'arête, ou sur le cycle ?
4. Issue `oriented` et décision par action (C4) : garder, ou revenir à `approved` / `rejected` ?
5. TypeScript (C5) : migration maintenant, avant la suite, ou progressive fichier par fichier au
   fil des phases ?
6. Front (C6) : refaire la phase 4 selon l'annexe A (React Flow, maquette sur fixtures) ? Et pour
   le style : Tailwind (préférences globales) ou CSS simple (annexe A) ?
7. Noms de routes et d'événements (C7, C8) : aligner le code sur la spec ?
8. Maître (C11) : le passer en service permanent sous l'API dès maintenant, ou à la phase 5 ?
9. Chat et OmniRoute (C12) : accepter que le chat réveille le PC, déplacer une instance OmniRoute
   sur le NAS, ou choisir un autre modèle économique joignable depuis le NAS ?
10. Checkpoints (C13) : un commit par étape comme la spec, ou par lot comme aujourd'hui ?
11. Veille (C19) : le worker peut-il continuer à demander la veille, puisque lui seul voit
    l'inactivité Windows ?
12. `homeMachine` par défaut (C16) : `pc` ou `nas` ?
13. Tailscale sur Windows : qui l'a désactivé, et peut-on le remettre en démarrage automatique ?
    Sans lui, rien de la phase 3 ne fonctionne en vrai.
14. Port 4700 sur le NAS : changer le port par défaut du maître, ou déplacer `saas_tcg-generator`
    (qui est aussi publié sur toutes les interfaces) ?
15. La copie `docs/SPEC-cockpit-agentique.md` du dépôt est l'ancienne version : la remplacer par
    celle du 2026-09-18 ?

## 9. Décisions du 2026-09-18

Réponses de Raphaël aux questions du §8. Là où elles s'écartent de la spec, elles l'emportent
sur elle.

| # | Question | Décision |
|---|---|---|
| 1 | Runner (C1) | Garder l'Agent SDK. Le faux binaire `CLAUDE_BIN` n'est pas exigé : les tests gardent le faux `query` injecté. |
| 2 | Nœud humain (C2) | `approval`. `gate` reste le juge automatique. |
| 3 | `maxLoops` (C3) | Par cycle. |
| 4 | Issue `oriented` (C4) | Gardée pour l'instant. |
| 5 | TypeScript (C5) | Laissé à Claude. Voir ci-dessous. |
| 6 | Front (C6) | Refait selon l'annexe A (maquette sur fixtures, React Flow, dagre, arbre de topologie), avec Tailwind ou une autre librairie à la place du « CSS simple ». |
| 7 | Routes et événements (C7, C8) | Alignés sur la spec. |
| 8 | Maître (C11) | Service permanent à la phase 5. |
| 9 | Chat et OmniRoute (C12) | Le chat peut réveiller le PC. |
| 10 | Checkpoints (C13) | Par lot. |
| 11 | Veille (C19) | Le worker continue de la demander. |
| 12 | `homeMachine` par défaut (C16) | `pc`. |
| 13 | Tailscale sur Windows | À remettre en démarrage automatique. |
| 14 | Port 4700 | Changer le port par défaut du maître. |
| 15 | Copie de la spec | Remplacée par la version du 2026-09-18. |

Décision 5, prise par Claude : le front passe en TypeScript strict tout de suite, puisqu'il est
refait (Vite le compile sans étape en plus). Le moteur reste en JavaScript vérifié par `tsc`
(`@ts-check` et JSDoc) : ses types viennent déjà des schémas zod par `z.infer` dans le JSDoc, sans
duplication. Un fichier du moteur passe en `.ts` quand il est réécrit, pas avant. Réécrire du code
testé et fusionné pour changer son extension coûterait des jours sans rien corriger.
