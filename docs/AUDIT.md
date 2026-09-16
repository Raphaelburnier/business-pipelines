# Audit, phase 0 du cockpit agentique

Audit de `business-pipelines` et `agent-orchestrator` contre `docs/SPEC-cockpit-agentique.md`.
Deuxième version, du 2026-09-17. Aucun fichier de code n'a été modifié.

## Méthode

Workflow `audit-cockpit-spec` (run `wf_8373ca97-bba`), 41 agents, tous en lecture seule.

1. Deux auditeurs en parallèle, un par dépôt. Chacun a lu la spec en entier et les décisions
   déjà prises (sections 8 à 10 ci-dessous), puis a rendu la stack, le code réutilisable, les
   conflits avec preuves (fichier, ligne, extrait lu) et les points [À VÉRIFIER] tranchables.
2. Chaque conflit signalé est passé devant un vérificateur chargé de le **réfuter** : relire
   les preuves et la section de spec citée, chercher ce qui le contredit, et conclure
   `confirmé`, `nuancé` (fond juste, formulation corrigée) ou `réfuté`.
3. Synthèse : seuls les conflits non réfutés figurent ici. Pour un conflit nuancé, c'est la
   formulation corrigée par le vérificateur qui est retenue.

| Dépôt | Branche lue | Conflits signalés | Confirmés | Nuancés | Réfutés |
|---|---|---|---|---|---|
| `business-pipelines` | `main` (`833eb84`) | 16 | 2 | 14 | 0 |
| `agent-orchestrator` | `master` (`5bdafd4`) | 23 | 5 | 18 | 0 |

`business-pipelines` a été lu en tenant compte de la PR #9 (`chore/retirer-ebay`), pas encore
fusionnée : rien de ce qu'elle retire (eBay, `charger`, `execute`, cycle) n'est compté comme
réutilisable ni comme conflit.

**Convention.** « Décision N » renvoie au tableau de la section 8 de ce document, pas à la §14 de
la spec, dont la numérotation est différente. Les vérificateurs ont relevé plusieurs fois cette
confusion. Les identifiants `C1` à `C14` cités dans la section 8 renvoient à la première version
de cet audit (commit `559ab5d`). Les conflits de cette version portent les identifiants `B1` à
`B16` (business-pipelines) et `A1` à `A23` (agent-orchestrator).

## 1. Résumé

Ce qui change la forme du travail, par ordre d'impact :

1. **Le runner ne tourne pas sur le `claude` installé.** Le SDK 0.1.77 lance son CLI embarqué en
   2.0.77, alors que `claude --version` donne 2.1.273. Les réponses tirées de `claude --help` ne
   valent donc pas pour les runs tant que ce choix n'est pas fait (A3).
2. **Une limite de quota n'est détectée nulle part.** Selon la forme réelle de la sortie, elle
   finit en échec, en faux succès silencieux ou en deux relances immédiates dans la même fenêtre
   saturée. Avec l'abonnement (décision 2), c'est le premier cas à traiter en phase 1 (A12).
3. **Une approbation fait échouer le run.** Le stage `approval` lève une exception, le lanceur
   clôt le rapport en `failed`. Il n'y a ni `waiting_approval` ni reprise du même run (B5).
4. **Les approbations passent par un dossier `approvals/` partagé** entre le run et le cockpit, sur
   le même hôte. Déplacer marketing sur le PC (décision 5) casse ce partage : la migration des
   approbations doit précéder ce déplacement, pas attendre la phase 5 (B7).
5. **Le réseau bridge du NAS est un trou d'identité.** Tout conteneur du réseau `business`, dont
   le service marketing qui exécute des agents, peut poster une décision au cockpit, signée du
   compte système ou sous ton nom en forgeant l'en-tête Tailscale (B4).
6. **Le WebSocket du maître ne peut pas vivre derrière `tailscale serve`.** Derrière serve, le
   backend voit `127.0.0.1` et la vérification du nom de machine de la décision 6 devient
   impossible (B3).
7. **La spec n'intègre pas encore les décisions 3a, 3b et 3c.** Le vocabulaire `gate` humain et le
   `maxLoops` par arête reviennent dans les §3, §5.4, §7.3.1, §8 et §12 (B13, A7 à A9).
8. **`allowedTools` n'est pas une restriction.** C'est une liste d'auto-approbation. Le runner ne
   passe pas l'option `tools`, et `acceptEdits` accepte les éditions : un agent « lecture seule »
   ne l'est pas techniquement, seul le hook de périmètre borne ses écritures (A4).

## 2. Stack actuelle

### 2.1 business-pipelines (`main`, `833eb84`)

- **Langage** : JavaScript CommonJS, sans TypeScript ni zod. Node 22 (`node:22-alpine` dans
  l'image, 22.23.1 sur le poste).
- **Dépendances** : `agent-orchestrator` en `file:../agent-orchestrator`, `nodemailer` pour le
  canal d'alerte. Aucune dépendance serveur.
- **Cockpit** : serveur `http` natif (`bin/cockpit.js`, 740 lignes). Routes `GET /`,
  `GET /api/etat`, `POST /api/decider`, plus manifeste, service worker et icônes. Logique sans
  HTTP dans `src/cockpit.js`, contrôle d'accès dans `src/acces.js`, PWA dans `src/pwa.js`,
  modules déployés dans `src/apps.js`.
- **Front** : aucun build. HTML rendu côté serveur dans une chaîne, CSS et JS inline, deux thèmes,
  PWA installable avec un service worker qui ne met rien en cache.
- **État durable** : fichiers JSON dans `approvals/` (boîte `EN-ATTENTE.json`, plan gelé, registre
  de décisions), écrits de façon atomique par `src/durable.js`. Pas de base.
- **Pipelines** : liste de stages (`pipelines/marketing.json` : consigne, analyse en parallèle,
  synthèse, `verify-couverture` avec gate déterministe, `approval`). Agents dans
  `.claude/agents/*.md`, frontmatter `name`, `description`, `tools`, `model`, sans version.
- **Lanceur** : `orchestrator.js <pipeline> <spec>`, workspace jetable recréé à chaque run, sans
  `vcs` ni reprise.
- **Tests** : scripts Node avec `assert` et un mini-runner, enchaînés par `npm test`. Pas de
  Vitest.
- **Déploiement** : Docker Compose sur le NAS. `cockpit` toujours debout, publié sur
  `127.0.0.1:4600`, écoute `0.0.0.0` dans le conteneur (`COCKPIT_HOTE` + `COCKPIT_CONTENEUR=1`),
  réseau bridge `business`, sans clé. `marketing` lancé à la main avec `specs/deploiement.env`
  (`ANTHROPIC_API_KEY`). Moteur copié dans `.moteur/` par `bin/preparer-image.sh`. Exposition par
  `tailscale serve --https=443` vers `localhost:4600`.
- **Branches** : tout est fusionné dans `main` (dont `feat/tailnet-acces`), sauf
  `chore/retirer-ebay` (PR #9), `docs/audit-cockpit` (PR #8) et `worktree-sante-bind-contrat`
  (`cc3f770`, qui ajoute `src/sante.js`). Trois worktrees pointent sur des branches déjà
  fusionnées.

### 2.2 agent-orchestrator (`master`, `5bdafd4`)

- **Langage** : JavaScript CommonJS, pas de build. Un seul paquet, `main: src/index.js`, binaire
  `orch`.
- **Dépendance unique** : `@anthropic-ai/claude-agent-sdk`, déclaré `^0.1.0`, figé en **0.1.77**
  par le lockfile. ESM-only, chargé par `import()`. Il embarque son propre CLI en **2.0.77** et le
  runner ne passe pas `pathToClaudeCodeExecutable`.
- **Absent** : zod, SQLite, serveur HTTP, front. Validation écrite à la main dans `src/loader.js`.
- **Modules** : `agent-runner` (appel `query()`, hook `PreToolUse` de périmètre, retry des crashs
  de process), `engine` (stages, gates automatiques, épisodes de correction bornés),
  `stage-executor` (prompt, contrôle des sorties, retry de format, `must_change`),
  `gate-evaluator` et `router`, `backends`, `budget-tracker` (lève une exception au dépassement),
  `reporter` (événements en mémoire, écrits en fin de run), `resume` (`.orch-resume.json`), `vcs`
  (git, `gh repo create`, branches `generation/*`, merge auto), `workspace`, `resolve`,
  `env-loader`, `slicer`, `artifact-validator`, `report-parser`.
- **Formats** : agents en `.md` au frontmatter plat (compatible sous-agents Claude Code).
  Pipelines en liste de `stages` avec `slicing`, `budget`, `retry`, `gate`. 12 agents et 4
  pipelines livrés.
- **Tests** : 9 fichiers, environ 100 scénarios, tous verts, seul mock `ctx.runAgent`.
- **Config machine** : `~/.config/agent-orchestrator/backends.json`, backends `ollama`,
  `ollama-coder`, `omniroute`, `opus-direct` (OmniRoute sur `localhost:20128`, Ollama sur
  `localhost:11434`).

**Saas-generator, pour comparaison** : même format d'agents et de pipelines, plus des stages typés
(`migrate`, `assemble`, `smoke`), `requires`, `env_contract`, `scope_dir` et des clés de
commentaire `_note`. Il consomme le moteur en `file:` et utilise déjà zod v4.

## 3. Ce qui est réutilisable

### 3.1 business-pipelines

| Élément | Chemin | Sert à | Remarque |
|---|---|---|---|
| Contrôle d'accès (hôtes, origine, identité par canal, bind fail-closed) | `src/acces.js` | §10 auth et isolation | Tel quel pour REST et SSE. Insuffisant pour les workers (B3), repli « local » à revoir (B4) |
| Serveur http et ses défenses (erreurs async, `no-store`, taille du corps, `application/json`) | `bin/cockpit.js` l.613-722 | §10 API REST | Le rendu HTML inline sera remplacé par React |
| Logique d'approbation sans HTTP (empreinte, fusion des décisions, note, réponse libre) | `src/cockpit.js` | §10 approbations, §11.2 | Règles à garder lors de la migration vers SQLite (B6) |
| Juge d'approbation (`EN_ATTENTE`, `ORIENTE`, `APPROUVE`) | `src/approval.js` | nœud `approval` (3b), gate budget | `ORIENTE` n'existe pas dans la spec (B6) |
| Écriture atomique | `src/durable.js` | file disque du worker (§7.4), commits en attente (§7.3.3) | 51 lignes, testé |
| PWA (manifeste, SW sans cache, page hors portée) | `src/pwa.js` | §11.4 mobile | Vérifier le SW avec un flux SSE long avant la phase 4 |
| Registre des modules déployés | `src/apps.js` | §11.1 topologie | Absent de la spec, garder la règle d'origine distincte |
| Canal d'alerte courriel | `src/alerte.js`, `bin/alerter.js` | §7.2 alerte de réveil, §8 quota | Devra lire l'event store |
| Stages `consigne`, `approval`, `verify-couverture` et leurs validateurs | `src/stage-handlers.js` | nœuds script et `approval` | « `approval` ne porte pas de gate » rejoint la décision 4 |
| Pipeline marketing | `pipelines/marketing.json` | test d'équivalence du graphe (3a) | Exerce `parallel`, `slicing`, `output_schema`, gate, `rerun_from` |
| Compose (publication loopback, réseau dédié, secrets en lecture seule, cockpit sans clé) | `docker-compose.yaml` | §10 | Voir B1 et B4 |
| Image et préparation du moteur | `Dockerfile`, `bin/preparer-image.sh` | §4 | `npm install --omit=dev` n'installera pas TypeScript : compiler `schemas` avant la copie ou passer en multi-stage |
| Relais `tailscale serve` | `bin/tailnet-relais.sh` | §10 exposition | Cherche tailscale dans le PATH ou côté Windows, pas dans le paquet DSM. Jamais `funnel` |
| Contrat de contrôle de santé (`INCONNU`, champ `attendue`) | `src/sante.js` sur `worktree-sante-bind-contrat` | §7.1 `sleeping` contre `offline` | Ne récupérer que ce fichier |
| Tests cockpit, accès, PWA, apps, approbation | `test/` | non-régression phases 4 et 5 | `acces.test.js` seul porte 113 assertions |

### 3.2 agent-orchestrator

| Élément | Chemin | Sert à | Remarque |
|---|---|---|---|
| Runner Agent SDK | `src/agent-runner.js` | §6 (décision 1) | Base de la phase 1. Ne garde que `result` (l.126). `abortController` est branché et le SDK envoie SIGTERM puis SIGKILL après 5 s |
| Hook `PreToolUse` de périmètre | `src/agent-runner.js` l.48-72 | cwd, garde-fou du test-writer | Seule borne réelle des écritures aujourd'hui (A4) |
| Détection des crashs transitoires | `isTransientSdkCrash`, `describeFailure` | §6.2, §8 | À compléter par le classement `rate_limit` avant tout retry (A12) |
| Backends et `_billed` | `src/backends.js` | `llm.via`, coût estimé contre réel | `via` se traduit en nom de backend. Facturation à porter autrement (A14) |
| Budget par appel (USD, tours, `avoidedUsd`) | `src/budget-tracker.js` | §8 | Remplacer le `throw` par `budget.exceeded` et une approbation (A13) |
| Reporter d'événements typés | `src/reporter.js` | §3.4, §9 | Appelé partout. À brancher sur SQLite, noms `a:b` à passer en `a.b`. Aujourd'hui un process tué perd tous les événements |
| Épisodes de correction bornés | `src/engine.js` l.95-109 | décision 3c | Sémantique déjà par cycle, à reprendre dans le compilateur |
| Gate automatique et routage par composant | `src/gate-evaluator.js`, `src/router.js` | décision 3b | Verdict hors liste = exception |
| Contrôle des sorties, `must_change`, `forbidden_keys` | `src/stage-executor.js`, `src/artifact-validator.js` | garde-fous d'agent | `must_change` empêche de déclarer un travail non fait |
| Tolérance JSON des artefacts | `src/report-parser.js` | lecture d'`outcome.json` | Jamais sur les registres |
| Validation fail-fast au chargement | `src/loader.js` | §5.4, §11.3, paquet `schemas` | Règles à porter en zod avec `superRefine` |
| Journal de reprise avec empreinte | `src/resume.js` | §6.3, §9 | Garder l'empreinte de la définition résolue dans `runs` |
| Commit par étape, scan de secrets, push best-effort | `src/vcs.js` | §7.3.1 | « Le commit local fait foi » correspond à la spec. Le reste est à refaire (A18) |
| Harness à `runAgent` scripté | `test/harness.js`, `test/fixtures/generic.json` | §6.4, acceptations phases 1 et 2 | Teste le moteur sans quota |
| Types du SDK | `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/sdk/*.d.ts` | §6.2, §8, `schemas` | `init` (session_id, model, apiKeySource), `result` (total_cost_usd, usage, subtypes), `error: 'rate_limit'`, options `resume`, `maxBudgetUsd`, `pathToClaudeCodeExecutable`, `stderr` |
| Agents et pipelines livrés | `agents/*.md`, `pipelines/*.json` | contenu initial d'`agent-registry` | Candidats `v1` après conversion du frontmatter |
| Agents et pipelines du SaaS generator | `Saas-generator/.claude/agents`, `pipelines/web-app.json` | registre, test du compilateur | `web-app.json` est le meilleur cas de test : stages typés, `requires`, plusieurs gates vers le même `rerun_from`, `scope_dir` |

## 4. Conflits vérifiés

État : **tranché** (une décision le règle, la spec ou un document reste parfois à mettre à jour),
**partiel** (une partie est tranchée), **ouvert** (décision à prendre, voir section 6).

### 4.1 business-pipelines

| Id | Conflit | Vérif. | État |
|---|---|---|---|
| B1 | Le cockpit écoute sur `0.0.0.0` dans son conteneur | confirmé | ouvert |
| B2 | WoL en `network_mode: host` contre l'isolation du compose | nuancé | ouvert |
| B3 | Identité par en-tête, inutilisable pour les workers | confirmé | partiel |
| B4 | Décisions postables depuis le réseau bridge du NAS | nuancé | ouvert |
| B5 | Une approbation fait échouer le run | nuancé | ouvert |
| B6 | Décision par action et réponse libre contre décision unique | nuancé | partiel |
| B7 | `approvals/` partagé par fichiers et chemins absolus | nuancé | ouvert |
| B8 | Identité d'approbation codée en dur dans le template | nuancé | ouvert |
| B9 | Workspace jetable, sans checkpoint ni relance depuis une étape | nuancé | partiel |
| B10 | PLAN.md verrouille encore l'accès API direct | nuancé | tranché |
| B11 | Deux numérotations de phases qui se recouvrent | nuancé | ouvert |
| B12 | Agents non versionnés, embarqués dans l'image | nuancé | ouvert |
| B13 | La spec n'intègre pas les décisions 3a, 3b, 3c | nuancé | tranché |
| B14 | Budget porté par le template, qui tue le run | nuancé | partiel |
| B15 | Le cockpit commandera de la dépense sans canal défini | nuancé | partiel |
| B16 | Pas de point d'injection pour un faux binaire | nuancé | tranché |

**B1. Écoute sur `0.0.0.0` dans le conteneur** (§10). *Confirmé.*
La spec : « Les services écoutent sur 127.0.0.1 ou sur l'IP Tailscale, jamais sur 0.0.0.0 ». Le
compose force `COCKPIT_HOTE=0.0.0.0` avec `COCKPIT_CONTENEUR=1`, et c'est voulu : un bind sur
`127.0.0.1` dans un conteneur a rendu le cockpit injoignable dix jours. Le confinement vient de la
publication `127.0.0.1:4600:4600`, qui respecte la règle Compose de la spec. Le test automatisé de
la §10 mesure les ports depuis une machine hors tailnet et passerait sur l'installation actuelle.
Preuves : `docker-compose.yaml:16, 44-45`, `src/acces.js:30-36`.
Recommandation : reformuler la règle au niveau de l'hôte (aucun port publié hors `127.0.0.1` ou IP
tailnet), le bind interne au conteneur restant libre s'il est déclaré.

**B2. Wake-on-LAN et isolation** (§7.2, §10). *Nuancé.*
La spec envisage `network_mode: host` pour le magic packet. En host, Docker ignore la section
`ports` : un cockpit qui partagerait ce conteneur serait joignable sur toutes les interfaces du
NAS, LAN compris, là où l'en-tête Tailscale se forge. Avec la décision 5, le WoL sert à chaque
étape lancée pendant que le PC dort.
Preuves : `docker-compose.yaml:17-21`, `src/acces.js:43-47`.
Recommandation : le processus qui envoie le WoL ne porte jamais le port du cockpit. Petit
conteneur dédié en host sans port d'écoute, ou script sur l'hôte DSM appelé par le maître. Tester
sur le NAS avant la phase 3.

**B3. Identité Tailscale** (§1, §7.4, §10). *Confirmé.*
La §1 dit « vérifiée via la connexion Tailscale et non via un header » et parle d'un travail
commencé sur `feat/tailnet-acces`. Le mécanisme fusionné lit `Tailscale-User-Login`, qui nomme un
utilisateur, et n'est fiable que parce que le service reste en loopback derrière `tailscale serve`.
Derrière serve, le backend voit `127.0.0.1` : aucun `tailscale whois` possible sur l'IP du pair.
Preuves : `src/acces.js:109-116`, `README.md:575-578`, `bin/tailnet-relais.sh:78`.
Recommandation : WebSocket du maître sur un listener distinct du cockpit, lié à l'IP tailnet,
jamais derrière serve. Jeton par worker, whois sur l'IP source, ACL. L'en-tête reste au cockpit.
Corriger la phrase de la §1.
État : la décision 6 fixe les contrôles. La séparation des listeners reste à acter.

**B4. Décisions postables depuis le réseau bridge** (§10, §3.7). *Nuancé.*
Le cockpit écoute sur `0.0.0.0` dans le réseau `business`, que le service marketing partage. Tout
conteneur de ce réseau peut poster une décision sans passer par le tailnet, de deux façons : sans
en-tête et avec `Host: 127.0.0.1:4600`, la décision est signée du compte système du conteneur
(root, faute de `USER` dans le Dockerfile) ; en forgeant `tailscale-user-login`, elle est signée
sous ton nom, canal « tailnet ». Le loopback de l'hôte NAS n'est pas en cause, `acces.js` assume ce
cas. Le conteneur marketing monte déjà `approvals/` en écriture : la route HTTP ajoute une porte,
elle n'ouvre pas l'accès au registre.
Preuves : `src/acces.js:130-137`, `docker-compose.yaml:76-78`.
Recommandation : sortir marketing du réseau `business`. Refuser le canal local ne suffit pas,
l'en-tête se forge aussi. Mettre à jour le commentaire périmé du compose (l.17-19).

**B5. Une approbation fait échouer le run** (§9, §12 phase 2). *Nuancé.*
Le stage `approval` lève une exception quand des actions attendent une décision
(`stage-handlers.js:711-720`) ou après une réponse libre (l.656-661). `orchestrator.js:93-97` clôt
le rapport en `failed` et sort en code 1. Aucun `waiting_approval`, `gate.opened` ni
`gate.decided`. Un event store alimenté tel quel afficherait chaque tour marketing arrivé à la
décision comme un run échoué. Après une approbation, relancer marketing échoue volontairement au
stage `consigne`. Le moteur a un journal de reprise que le lanceur ne branche pas.
Recommandation : arrêt typé (`waiting_approval`, événement d'ouverture) qui garde gel, empreinte et
péremption. Après la décision, poursuivre le même run, ou marquer le run terminé en attente
d'application quand l'approbation est le dernier nœud.

**B6. Granularité des approbations** (§5.4, §9, §10). *Nuancé.*
La spec réduit une approbation à `approved` ou `rejected` avec une note. Le code porte un plan gelé
identifié par son empreinte, une décision signée par action (`approuve`, `refuse`, `motif`, canal,
horodatage) et une réponse libre (`ORIENTE`) qui ne tranche rien et vide les exécutables. Le schéma
et l'API de la spec ne gardent ni l'empreinte, ni la granularité, ni la signature, ni la réponse
libre.
Preuves : `src/approval.js:43-54, 61-78, 94-113`, `src/cockpit.js:151-156, 173-196`.
État : le nom `approval` (3b) et le rapport d'impact imposé (4) sont tranchés. La granularité par
action et la sortie « orientée » restent ouvertes.

**B7. Approbations partagées par fichiers** (§4, §7.4, §9). *Nuancé.*
Le run écrit le plan gelé et la boîte dans `approvals/`, avec des chemins absolus. Le cockpit suit
ces chemins pour lire et écrire. Tout ne marche que parce que cockpit et marketing montent le même
`./approvals` sur le NAS. La spec prévoit la table `approvals` en SQLite et des workers qui ne
parlent au maître que par WebSocket. Avec la décision 5, sans migration préalable, le cockpit du
NAS ne verrait plus les demandes. Trois arbitrages marketing réels attendent dans `approvals/`.
Preuves : `src/stage-handlers.js:688-696`, `src/cockpit.js:54-55`, `docker-compose.yaml:63-66`.
Recommandation : migrer les approbations vers l'event store, ou au minimum les faire transiter par
le protocole maître/worker, **avant** de déplacer marketing sur le PC. Reprendre les trois
arbitrages sans perte, avec un test.

**B8. Identité d'approbation dans le template** (§5.4, §5.5, §9). *Nuancé.*
`marketing.json` fixe `dossier: "marketing"`, `marketing.decisions.json` et `marketing.plan.json`
dans un `approvalsDir` unique par processus. Rien n'entre en collision aujourd'hui, faute de
projets. Quand ce pipeline deviendra un template étendu par plusieurs projets sous un maître
unique, deux projets partageront plan gelé, registre et entrée de boîte, et l'un bloquera l'autre.
Preuves : `pipelines/marketing.json:92-101`, `src/stage-handlers.js:480-486`.
Recommandation : dériver ces noms de `(project_id, pipeline, nœud)` ou de `run_id`, et faire
refuser par le validateur un `dossier` écrit en dur.

**B9. Pas de checkpoint pour un run d'artefacts** (§6.3, §7.3.1). *Nuancé.*
Le lanceur crée un workspace jetable sans git. Un run marketing n'a ni commit par étape, ni
`checkpoint_sha`, ni relance depuis une étape, et le `--resume` du moteur n'y est pas utilisable
(`PLAN.md:142-145`). La §7.3.1 vise les projets gérés qui ont un `repo`. Elle ne dit pas sur quel
dépôt travaille un run qui ne produit que des artefacts.
Preuves : `orchestrator.js:47-53`, `PLAN.md:142-145`.
État : la décision 8 fixe les remotes, pas ce cas. Sans décision, la phase 2 ne pourra pas vérifier
la relance sur le seul pipeline réel.

**B10. PLAN.md contredit la décision 2** (§8). *Nuancé.*
PLAN.md (l.176-177) garde « orchestrateur en accès direct » dans ses décisions verrouillées. La
phrase vise d'abord un abonnement relayé par un outil tiers, mais « accès direct » veut dire clé
API. Le compose fournit encore `ANTHROPIC_API_KEY` au service marketing du NAS, ce qui est cohérent
avec l'ancien PLAN.md et deviendra superflu après le déplacement sur le PC.
Recommandation : mettre à jour PLAN.md, puis retirer la clé du NAS après le déplacement.

**B11. Deux numérotations de phases** (§12). *Nuancé.*
PLAN.md numérote de 01 à 06 le plan du marketing au déploiement, la spec de 0 à 7 le cockpit. Les
périmètres diffèrent, mais « phase 3 », « phase 5 » ou « phase 6 » ne désignent pas la même chose
d'un document à l'autre, et la première version de cet audit mélangeait déjà les deux.
Recommandation : préfixer les phases de la spec (`C0` à `C7`) et dire dans les deux documents
comment ils s'articulent, surtout pour 05 développement et 06 déploiement.

**B12. Agents non versionnés** (§2, §5.1, §5.2, §3.3). *Nuancé.*
Les définitions vivent dans `.claude/agents/<nom>.md`, sans `version` ni `outcome`, avec `tools` et
`model` au lieu de `allowedTools` et `defaultLlm`. Le SDK reçoit quand même `allowedTools` par
conversion (`agent-runner.js:79`). Après un rebuild de l'image, modifier un agent s'applique à tout
pipeline qui l'utilise, sans trace de version. C'est un écart de migration attendu, pas une
violation d'un principe en service.
Preuves : `orchestrator.js:39-45`, `.claude/agents/brand-analyst.md:1-6`, `.dockerignore:12-17`.
Recommandation : importer les trois agents marketing en `v1` dans `agent-registry`, résoudre
`nom@version`, garder `.claude/agents` en repli jusqu'à la bascule.

**B13. La spec n'a pas intégré 3a, 3b, 3c** (§5.4 et suivantes). *Nuancé.*
Le graphe de la §5.4 est bien le format retenu (3a), mais la section ne dit pas qu'il est compilé en
étapes et ne sait pas exprimer ce que `marketing.json` fait déjà : `parallel`, `slicing`,
`inputs`, `outputs`, `output_schema`, routage d'un manque vers l'agent responsable. Elle garde
`gate` pour l'humain et `maxLoops` sur l'arête. Le même vocabulaire revient dans la §3 (principe
6), la §7.3.1, la §8 et la §12 phase 2. Le code actuel n'a qu'une borne globale
`retry.max_fix_cycles` : le `maxLoops` par cycle de 3c est une troisième forme.
Recommandation : réécrire ces sections, avec `marketing.json` réécrit en graphe comme test
d'équivalence. Voir aussi A7, A8, A9.

**B14. Budget du template qui tue le run** (§5.5, §8). *Nuancé.*
Le budget vit dans le template (`max_usd`, `max_total_turns`, `max_turns_per_agent`), qu'un agent
peut surcharger par `max_turns` (`stage-executor.js:206`). La spec met un budget USD par run et par
mois dans le projet, sans plafond de tours. Au dépassement, `BudgetTracker.add` lève une exception
que rien ne rattrape, contre la décision verrouillée de PLAN.md « le garde-fou escalade au lieu de
tuer ». La reprise ajoutée en `8290f4a` évite de repayer les étapes finies, sans remplacer
l'escalade. Avec l'abonnement, seuls les plafonds de tours bornent réellement le temps.
Preuves : `pipelines/marketing.json:9-13`, `agent-orchestrator/src/budget-tracker.js:24-28`,
`PLAN.md:182`. Voir aussi A13.

**B15. Canal de commande du cockpit** (§10, §4). *Nuancé.*
Aujourd'hui le cockpit ne détient aucune clé et ne planifie rien (`docker-compose.yaml:46-49`). La
§10 lui ajoute `POST /api/runs`, `/rerun`, `/resume` : à travers le maître, il pourra commander de
la dépense de quota. La spec sépare déjà cockpit et maître, mais ne dit ni comment une commande
passe de l'un à l'autre, ni que le cockpit reste sans clé.
Recommandation : le cockpit écrit une commande, le maître la valide et la dispatche. Le cockpit ne
reçoit aucune clé. Les commandes passent par la même vérification d'identité que les décisions.

**B16. Faux binaire sans point d'injection** (§0.4, §6.4). *Nuancé.*
La spec veut `test/fixtures/fake-claude.js` choisi par `CLAUDE_BIN`. Le runner vit dans
`agent-orchestrator`, appelle `query()` du SDK, et ni `CLAUDE_BIN` ni `pathToClaudeCodeExecutable`
ne sont passés. Les tests mockent `runAgent` (`test/harness.js:85`). Le point d'injection devrait
être dans `agent-orchestrator`, pas dans ce dépôt. Voir A2.

### 4.2 agent-orchestrator

| Id | Conflit | Vérif. | État |
|---|---|---|---|
| A1 | Invocation `claude -p` contre Agent SDK | confirmé | tranché |
| A2 | Le faux binaire de §6.4 ne suffit pas avec le SDK | nuancé | partiel |
| A3 | Le CLI des runs est le 2.0.77 embarqué | nuancé | ouvert |
| A4 | `allowedTools` n'est pas une restriction | nuancé | ouvert |
| A5 | Le parseur de frontmatter ne lit pas le format de la spec | confirmé | ouvert |
| A6 | Résolution par nom, le premier trouvé gagne | nuancé | ouvert |
| A7 | Liste de stages contre graphe | nuancé | tranché |
| A8 | `gate` automatique contre `gate` humaine | confirmé | tranché |
| A9 | `maxLoops` par arête contre plafond par épisode | nuancé | tranché |
| A10 | Le plafond de boucles repart à zéro à chaque reprise | nuancé | ouvert |
| A11 | `outcome.json` unique contre rapports et retry de format | nuancé | partiel |
| A12 | Limite de quota non détectée | nuancé | ouvert |
| A13 | Dépassement de budget : exception, coût d'abonnement compté | confirmé | partiel |
| A14 | OmniRoute n'est pas uniformément payant | nuancé | ouvert |
| A15 | Ollama ne passe pas par OmniRoute | nuancé | ouvert |
| A16 | `llm.model` libre contre étiquette résolue par le backend | nuancé | ouvert |
| A17 | Agents parallèles dans le même workspace | nuancé | ouvert |
| A18 | VCS au modèle Saas-generator | nuancé | partiel |
| A19 | Pas de checkpoint garanti par étape | nuancé | ouvert |
| A20 | Reprise par journal fichier contre `resume` et SQLite | nuancé | ouvert |
| A21 | Clés de commentaire `_note` contre schéma zod | nuancé | ouvert |
| A22 | Saas-generator dépend de la surface CommonJS | nuancé | ouvert |
| A23 | Pas de Vitest | confirmé | ouvert |

**A1. CLI contre SDK** (§6.1, §6.2). *Confirmé.*
La spec lance `claude -p ... --output-format stream-json` et lit stdout ligne par ligne. Le runner
appelle `query()` et itère sur des objets messages. C'est le SDK qui lance le CLI embarqué avec
`--output-format stream-json --verbose --input-format stream-json`. La §6.3 (Stop par `SIGTERM`) et
la §6.4 sont touchées aussi.
Preuves : `src/agent-runner.js:7, 126`, `sdk.mjs:7671-7677`.
État : tranché par la décision 1. Réécrire §6.1 à §6.4 en mapping de messages SDK vers événements,
journal brut = JSONL des messages plus callback `stderr`.

**A2. Faux binaire et SDK** (§6.4). *Nuancé.*
Avec le SDK, `CLAUDE_BIN` ne sert plus de point d'injection. Le SDK lance toujours le CLI en
`--input-format stream-json` et envoie une requête de contrôle `initialize` qui attend une réponse
(`sdk.mjs:8329-8338`). Un faux qui se contente d'écrire sur stdout ne suffit pas. Le vérificateur
n'a pas confirmé que l'itération des messages bloque sans cette réponse.
Recommandation : moteur, garder le mock de `runAgent`. Runner, injecter la fonction `query` avec un
générateur scripté (succès, erreur, `rate_limit`, lent). Faux CLI via
`pathToClaudeCodeExecutable` seulement pour un test d'intégration, qui gère le protocole de
contrôle.

**A3. Version du CLI des runs** (§5.2, §6.1). *Nuancé.*
Le SDK 0.1.77, figé par le lockfile, exécute son `cli.js` en 2.0.77. Les réponses tirées de
`claude --help` (2.1.273) ne valent pas pour les runs : les alias diffèrent (`fable` d'un côté,
`opusplan` et `sonnet[1m]` de l'autre), et le format stream-json et les messages de quota peuvent
différer. Avec `npm ci`, deux workers auraient le même CLI embarqué. La présence de
`claude_code_version` dans `init` n'a pas été confirmée.
Preuves : `cli.js:4`, `claude-agent-sdk/package.json:3`, `package.json:13`.
À décider : monter le SDK et l'épingler, ou passer `pathToClaudeCodeExecutable` vers le `claude`
système.

**A4. `allowedTools` et `acceptEdits`** (§5.2). *Nuancé.*
Le champ `tools` du frontmatter est passé en `allowedTools` (auto-approbation), sans l'option
`tools` qui restreint l'ensemble disponible, avec `permissionMode: "acceptEdits"`. Une déclaration
d'agent ne garantit donc pas l'absence de modification. Seul le hook de périmètre limite les
écritures au workspace. La spec nomme bien le champ `allowedTools` avec des motifs `Bash(...)`, ce
qui correspond à l'auto-approbation : c'est le code qui mélange les deux notions. Le garde-fou du
test-writer (§12 phase 7) repose sur un nœud script et n'est pas concerné.
Preuves : `runtimeTypes.d.ts:257-259`, `src/agent-runner.js:79-80`.
Recommandation : un champ distinct transmis à `tools` (ou `disallowedTools`). Confirmer par un run
court le comportement d'Edit non listé.

**A5. Parseur de frontmatter** (§5.2). *Confirmé.*
Le parseur découpe chaque ligne au premier `:`, garde des chaînes et exige `tools` et `model`. Un
fichier au format spec est rejeté. Aucun des 18 agents existants (12 ici, 6 dans Saas-generator)
n'est lisible par le nouveau schéma.
Preuves : `src/agent-runner.js:23-27`, `Saas-generator/.claude/agents/architect.md:4-5`.
Recommandation : vrai parseur YAML validé par zod, script de migration `model` vers
`defaultLlm { via: "claude", model }`.

**A6. Résolution sans version** (§3.3, §5.1). *Nuancé.*
`resolve.js` cherche `<nom>.md` et `<nom>.json` dans `./`, `./.claude/`,
`~/.config/agent-orchestrator/` puis dans les fichiers livrés. Le premier trouvé masque les autres,
choix documenté. Aucun pipeline ne peut référencer `agent@version`. C'est un écart avec la cible,
`agent-registry` restant à créer.
Preuves : `src/resolve.js:10-16`, `README.md:22-23`.
Recommandation : sur le chemin du maître, résoudre sans repli dans `agent-registry`. Garder la
résolution par nom de `orch run` comme mode développement explicite.

**A7. Stages contre graphe** (§5.4). *Nuancé.*
Le moteur joue un tableau `stages`. `slicing` est obligatoire, les stages d'agents exigent des
`outputs` et acceptent `output_schema` et `scope_dir`, le parallélisme est optionnel
(`parallel`), la boucle passe par `gate.rerun_from` et le routage par `gate.route_by` et
`gate.targets`. Rien ne correspond à `nodes` et `edges`.
Preuves : `src/loader.js:24-25, 37-38`, `src/engine.js:113`, `src/router.js:10-14`.
État : tranché par 3a. Le schéma graphe doit couvrir toutes ces notions. Tests d'équivalence :
`marketing.json` et `Saas-generator/pipelines/web-app.json`.

**A8. Deux sens de `gate`** (§5.4, §9). *Confirmé.*
`stage.gate` est évalué automatiquement sur un rapport JSON. Dans la spec, `gate` est une décision
humaine avec `gate.opened` et `gate.decided`. La §8 étend en plus le mot au dépassement de budget.
Preuves : `src/engine.js:91-92`, `README.md:114-116`.
État : tranché par 3b. Mettre à jour §5.4, §8, §9 (`approval.opened`) et §11.

**A9. Où compter les boucles** (§3, §5.4). *Nuancé.*
La §5.4 place `maxLoops` sur l'arête de retour. Le principe 6 exige seulement qu'un cycle soit
« couvert ». Le moteur compte par épisode de reprise, sous un plafond unique par pipeline (3 par
défaut, `loader.js:147`). Le code documente qu'un comptage par stage a produit deux fois le
plafond réel.
Preuves : `src/engine.js:100-103`.
État : tranché par 3c. Syntaxe où `maxLoops` est porté par le cycle, validation qui rejette un cycle
non couvert, plafond réglable par cycle.

**A10. Compteur de boucles et reprise** (§3, §9). *Nuancé.*
Le moteur remet le compteur de cycles à zéro à chaque `--resume`, choix documenté. La spec ne dit
pas si `steps.loop_index` survit à une reprise. Aujourd'hui la reprise est manuelle. Avec la reprise
automatique après quota, une série d'interruptions permettrait un nombre de cycles non borné.
Preuves : `README.md:44-45`, `src/engine.js:42, 54-56`. Question en section 6.

**A11. Signal de sortie** (§5.4). *Nuancé.*
La spec veut `.orchestrator/outcome.json` `{status, notes}` et un échec immédiat si le fichier
manque. Le code lit le verdict d'un agent juge dans le rapport désigné par la gate automatique, avec
des `items` routés. Une sortie déclarée absente ou hors schéma relance le même agent jusqu'à
`max_format_retries` (2 par défaut, événement `format:retry`). En revanche un verdict manquant ou
inconnu échoue sans retry.
Preuves : `src/stage-executor.js:131-134, 276`, `src/gate-evaluator.js:16`.
État : la décision 4 fixe la règle. Le format (`status` plus `items` optionnels) et le retry restent
à décider.

**A12. Quota non détecté** (§3, §8). *Nuancé.*
`runOnce` ne lit que `result`, ni le champ `error` des messages assistant (`rate_limit`,
`billing_error`), ni `is_error`. Selon la forme réelle de la sortie, qui reste à capturer, une limite
finit en échec du pipeline, en faux succès silencieux (`success` avec `is_error`), ou en deux
relances sans délai si le process meurt.
Preuves : `src/agent-runner.js:131-132, 147`, `coreTypes.d.ts:427-432`.
Recommandation phase 1 : capturer les sorties brutes, classer `rate_limit` et `is_error` en
`quota.hit` avant le test du subtype et avant tout retry, exclure ce cas de
`isTransientSdkCrash`.

**A13. Budget et abonnement** (§8, §5.5). *Confirmé.*
`BudgetTracker.add` lève une exception, `bin/orch.js` clôt en `failed`. Le backend `anthropic` est
facturé par défaut (« mieux vaut surestimer »), donc le coût estimé d'abonnement s'impute sur
`max_usd`. Aucun budget mensuel. Un run sur abonnement peut être tué pour une dépense qui n'existe
pas.
Preuves : `src/budget-tracker.js:21-26`, `src/backends.js:13`, `README.md:69-70`.
Recommandation : trois compteurs (`est_cost_usd`, `real_cost_usd`, `avoided`), budget USD appliqué au
réel seulement, `budget.exceeded` puis approbation. `max_total_turns` reste un garde-fou dur.

**A14. Facturation d'OmniRoute** (§8). *Nuancé.*
La spec assimile « via OmniRoute » à de la dépense réelle. Le même proxy sert au moins deux régimes :
`omniroute` marqué `_billed: false` (combos gratuites) et `opus-direct` payé à l'usage, cette
information ne figurant que dans une `_note`. La note signale aussi un fournisseur `claude` (OAuth)
interne qui consommerait le quota d'abonnement. Un compteur unique compterait les appels gratuits
comme payés. Preuve hors dépôt : `~/.config/agent-orchestrator/backends.json`.
Recommandation : porter `billing: subscription | api | free` sur le backend ou la combo, pas le
déduire de `via`.

**A15. Ollama en direct** (§6.1). *Nuancé.*
La spec dit qu'Ollama passe par OmniRoute. Les backends `ollama` et `ollama-coder` pointent sur
`localhost:11434`, et la note du backend `omniroute` dit qu'Ollama a été retiré de la combo à cause
du préremplissage. Le délai de file a ensuite été porté à 120 s, sans nouveau test documenté.
Preuves : `README.md:53-60`, `backends.json` (hors dépôt).
Recommandation : corriger §6.1, Ollama appelé en direct par son backend.

**A16. Nom de modèle libre** (§5.2, §5.4, §5.5). *Nuancé.*
La spec donne `llm: { via, model }` avec un nom libre et quatre niveaux de priorité. Le moteur garde
`model: opus | sonnet` dans l'agent, le pipeline ne choisit que `backend`, et les
`ANTHROPIC_DEFAULT_*_MODEL` traduisent l'étiquette. Ni override projet, ni choix au lancement.
`opus-direct` montre qu'un nom complet préfixé passe par OmniRoute, mais le fournisseur refuse
points et suffixes d'effort. L'exemple `gemini-flash-lite-latest` n'a pas de préfixe.
Preuves : `README.md:75-78`, `src/stage-executor.js:212-215`. Question en section 6.

**A17. Parallélisme dans un même workspace** (§7.2). *Nuancé.*
Trou de spec plutôt qu'écart : la §7.2 fixe une concurrence par worker sans dire ce qu'elle compte.
Le moteur lance toujours les agents de correction en `Promise.all` dans le même workspace, et les
agents d'un stage si `parallel: true` (activé dans `marketing.json`). Saas-generator a désactivé
`parallel` après une interférence observée entre deux process SDK. Le risque pour les agents de
correction est vraisemblable, pas observé.
Preuves : `src/engine.js:111-114`, `Saas-generator/pipelines/web-app.json:24`.
Recommandation : la limite compte les process d'agents, et le parallélisme dans un run exige des
workspaces isolés.

**A18. VCS** (§7.3.1, §6.3). *Nuancé.*
Le module `vcs` suit le modèle Saas-generator : branche `generation/<horodatage>`, aucun remote bare,
`gh repo create --private --push` seulement s'il n'y a pas de `.git`, `.gitignore` réécrit même sur
un dépôt existant, et `promote` qui fusionne dès que les gates automatiques sont vertes. En mode
`workspace: existing`, le VCS est coupé.
Preuves : `src/vcs.js:111-112, 134`, `src/engine.js:184-185`, `bin/orch.js:186`.
État : la décision 8 fixe les remotes et la décision 4 interdit la fusion par un agent. Nouveau
module pour les projets gérés : clone ou pull depuis le bare, `run/<runId>`, sha retourné, jamais
de `gh repo create` ni d'écriture de `.gitignore` (`.git/info/exclude`), fusion seulement après
une approbation.

**A19. Checkpoints par étape** (§6.3, §7.3.1). *Nuancé.*
`commitStage` ne commite rien si l'étape n'a produit que des artefacts ignorés, les stages typés ne
sont pas commités par le moteur, un échec de gate ne commite jamais, et aucun sha n'est enregistré.
`resume.js` a écarté l'historique git comme source de progression pour cette raison.
Preuves : `src/resume.js:7-12`, `src/vcs.js:202-209`, `src/engine.js:94, 162`.
Recommandation : commit systématique par étape (vide si besoin), artefacts d'échange versionnés sur
`run/*`, sha stocké pour chaque étape.

**A20. Deux stratégies de reprise** (§3.1, §6.3). *Nuancé.*
La spec reprend la session de l'agent (`resume <session_id>`) et met l'état en SQLite. Le moteur
tient `.orch-resume.json` dans le workspace et rejoue en entier un stage tué. Les deux ne s'excluent
pas. Il n'y a pas de concurrence entre deux sources d'état aujourd'hui, faute de SQLite.
Preuves : `src/resume.js:17`, `README.md:30-38`.
Recommandation : migrer vers SQLite la liste des étapes sauvées et l'empreinte. `resume` seulement
sur un workspace intact, reset au checkpoint et rejeu complet sinon.

**A21. Clés de commentaire** (§3.2, §12 phase 6). *Nuancé.*
Les pipelines justifient leurs choix dans des clés `_note`, `_backends_note`, `_parallel_note`. Un
schéma zod strict les rejette, un schéma `strip` les efface à la sauvegarde de l'éditeur, et le
critère « JSON identique hors `layout` » échoue. Les clés `_` des backends sont un autre cas :
`_billed` est fonctionnel.
Preuves : `pipelines/research.json:39`, `pipelines/writing.json:5`,
`Saas-generator/pipelines/web-app.json:87`.
À décider : champ de note explicite par nœud et par pipeline, ou passthrough documenté des clés
`^_`.

**A22. Consommateurs CommonJS** (§0.5, §2). *Nuancé.*
Saas-generator et business-pipelines composent leur orchestrateur à partir de `main: src/index.js`.
La spec ne cite Saas-generator que comme source du format d'agents, jamais comme consommateur, et la
migration TypeScript de la §0.5 porte sur `cockpit.js` et `cycle.js`, pas sur le moteur. Changer
`main`, la structure du dépôt ou l'API exportée casserait Saas-generator.
Preuves : `README.md:8`, `Saas-generator/package.json:18`, `Saas-generator/orchestrator.js:4-14`.
Question en section 6.

**A23. Vitest** (§0.3, §12 phase 7). *Confirmé.*
Ni Vitest ni Playwright dans le dépôt ni dans Saas-generator. Environ 101 tests en scripts Node.
Le « harness existant » de la phase 7 est un harness maison, pas Vitest.
Recommandation : introduire Vitest en phase 1, faire tourner les scripts actuels dans une enveloppe,
ne pas réduire le nombre de vérifications.

## 5. Réponses aux [À VÉRIFIER]

| Point | Statut | Réponse | Source |
|---|---|---|---|
| Syntaxe de `--allowedTools` | tranché | Liste séparée par virgules ou espaces. 2.1.273 donne l'exemple `"Bash(git *) Edit"`, le 2.0.77 embarqué `"Bash(git:*) Edit"`. `Bash(npm run:*)` est marqué « prefix matching (legacy) », `Bash(npm *)` est accepté. Le SDK passe `allowedTools.join(",")`. C'est une auto-approbation, `--tools` restreint | `claude --help`, `cli.js` embarqué, `sdk.mjs` l.7709-7724 |
| Alias de modèles | tranché | 2.1.273 : `fable`, `opus`, `sonnet` ou nom complet. 2.0.77 : `sonnet`, `opus`, `haiku`, `sonnet[1m]`, `opusplan`. Tant que le runner utilise le CLI embarqué, `fable` n'est pas garanti. `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` remappent les étiquettes dans les deux versions | `claude --help`, `cli.js` |
| Injection du prompt système | tranché | CLI : `--system-prompt`, `--append-system-prompt` et leurs variantes `-file`. SDK : `systemPrompt` en chaîne remplace, `{ type: 'preset', preset: 'claude_code', append }` ajoute. Transmis dans la requête `initialize`. Le runner remplace aujourd'hui et charge `settingSources: ["project"]` | `runtimeTypes.d.ts` l.522-541, `src/agent-runner.js` l.81, 87 |
| Messages et options du SDK 0.1.77 | tranché | `session_id` sur tous les messages. `init` : model, tools, cwd, apiKeySource, permissionMode. `result` : total_cost_usd, usage, modelUsage, duration_ms, num_turns, is_error, subtypes `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`. Options `resume`, `resumeSessionAt`, `forkSession`, `maxBudgetUsd`, `pathToClaudeCodeExecutable`, `spawnClaudeCodeProcess`, `stderr`. `interrupt()` exige une entrée en streaming : avec un prompt en chaîne, seul `abortController` sert | `coreTypes.d.ts` l.427-499, `runtimeTypes.d.ts` |
| Options utiles au runner | tranché | `--max-budget-usd`, `--fallback-model`, `--json-schema`, `--session-id`, `--setting-sources`, `--tools`, `--disallowedTools`, `--permission-prompts none`. `--no-session-persistence` empêche `resume`. `--bare` et `--restricted` n'existent qu'en 2.1.273 | `claude --help`, `sdk.mjs` l.7660-7760 |
| Forme du message de quota | partiel | Dans le 2.0.77, un 429 produit un message assistant `error: "rate_limit"` avec un texte (« session limit », « usage limit », heure de réinitialisation dans le texte). Aucun champ structuré pour l'heure. Non tranchable sans run réel : le `result` qui suit, le code de sortie, le format horaire, le comportement du 2.1.273 | `coreTypes.d.ts` l.427-433, chaînes du `cli.js` |
| Variables et compatibilité OmniRoute | partiel | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, et `ANTHROPIC_DEFAULT_*_MODEL` selon le backend. Requête de 25k tokens et 41 outils servie le 2026-09-15, avec un bloc texte parasite `(empty response)`. Non tranchable sans test : noms non Claude, `total_cost_usd` calculé sur la grille Anthropic donc faux, limites côté fournisseur | `backends.json` (noms et notes), `README.md` l.47-78 |
| Facturation API au lieu de l'abonnement | partiel | Le runner fusionne `process.env` et le `.env` du consommateur. Si `ANTHROPIC_API_KEY` y figure, `apiKeySource` bascule et le run est facturé à l'usage. À vérifier sur le PC : lire `apiKeySource` dans `init` et refuser un run `via: claude` hors abonnement | `src/agent-runner.js` l.94, `coreTypes.d.ts` l.479 |
| Edit disponible pour un agent qui ne le liste pas | non tranchable | Les types disent que `allowedTools` n'enlève rien et que `acceptEdits` accepte les éditions. Un run court le confirmera | `runtimeTypes.d.ts` l.257-259, 420-426 |
| Bind dans un conteneur | tranché | En bridge, un bind `127.0.0.1` rend le service injoignable. Bind `0.0.0.0` dans le conteneur, publication `127.0.0.1:4600:4600`, double clé `COCKPIT_HOTE` + `COCKPIT_CONTENEUR`. Non vérifié : publication sur l'IP tailnet, qui suppose l'interface Tailscale présente sur l'hôte DSM (le paquet peut tourner en userspace) | `src/acces.js` l.27-60, `docker-compose.yaml`, commit `cc3f770` |
| `tailscale serve` sur DSM | partiel | Fonctionne pour le cockpit du NAS, monté probablement à la main puisque le script ne cherche pas le binaire DSM. Derrière serve, pas de `whois` sur l'IP du pair et pas d'en-tête pour un appareil tagged. Passage d'un flux SSE long par serve non vérifié | `bin/tailnet-relais.sh` l.31-43, 78, `src/acces.js` l.118-127 |
| Bind direct du WebSocket sur l'IP tailnet | non tranchable | À vérifier sur le NAS : interface `tailscale0` (mode TUN), conservation de l'IP source à travers la publication Docker (DNAT la garde, un userland-proxy la remplace). Sans IP source réelle, seul le jeton authentifie | décision 6 |
| Wake-on-LAN depuis un conteneur | partiel | En bridge, le broadcast limité reste sur le pont Docker. Un broadcast dirigé passe éventuellement par le NAT, sans garantie. Fiable : host, macvlan ou envoi depuis l'hôte DSM, par un émetteur séparé du cockpit (B2). Test sur le NAS avec le PC en veille S3 | `docker-compose.yaml`, `src/acces.js` l.43-47 |

## 6. Questions ouvertes nées de cet audit

Aucune n'est tranchée. Chacune renvoie au conflit qui la motive.

1. **Règle de bind** : on reformule la §10 au niveau des ports publiés de l'hôte (B1) ?
2. **Émetteur WoL** : conteneur dédié en host sans port, ou script sur l'hôte DSM (B2) ?
3. **Listener du maître** : WebSocket sur un listener distinct du cockpit, lié à l'IP tailnet et
   jamais derrière serve (B3) ?
4. **Réseau du NAS** : marketing sort du réseau `business` tout de suite, sans attendre son
   déplacement sur le PC (B4) ?
5. **Approbations** : on garde la décision par action et la réponse libre (sortie `oriented`) dans
   le schéma et l'API (B6) ?
6. **Ordre de migration** : approbations vers l'event store **avant** le déplacement de marketing
   sur le PC, au lieu de la phase 5 (B7) ?
7. **Run d'artefacts** : sur quel dépôt travaille un run qui ne produit que des artefacts, pour
   avoir des checkpoints (B9) ?
8. **Phases** : on préfixe les phases de la spec `C0` à `C7` (B11) ?
9. **CLI des runs** : monter et épingler le SDK, ou `pathToClaudeCodeExecutable` vers le `claude`
   du système (A3) ?
10. **Outils d'agent** : un champ qui restreint (`tools`) séparé de l'auto-approbation
    (`allowedTools`) dans le schéma (A4) ?
11. **Compteur de boucles** : par run, persisté et rechargé à la reprise, ou par tentative (A10) ?
12. **Facturation** : champ `billing: subscription | api | free` sur le backend (A14) ?
13. **Nom de modèle** : alias seulement, nom complet seulement, ou les deux (A16) ?
14. **Concurrence** : la limite compte les process d'agents, et le parallélisme dans un run exige
    des workspaces isolés (A17) ?
15. **Notes dans les pipelines** : champ explicite ou passthrough des clés `^_` (A21) ?
16. **Saas-generator** : suit le nouveau format de graphe, ou reste sur l'ancien avec une version
    figée du moteur (A22) ?
17. **Prompt système** : l'agent remplace le prompt de Claude Code ou s'y ajoute (section 5) ?

## 7. Plan ajusté

Les phases de la spec restent (`C0` à `C7` si la question 8 est acceptée). Changements :

**Phase 0 bis, avant tout code**
- Réécrire la spec : §1 (identité), §5.4 et les sections liées (3a, 3b, 3c), §6.1 à §6.4 (SDK),
  §6.1 (Ollama direct), §8 (facturation par backend), §10 (bind et canal de commande).
- Mettre à jour PLAN.md (B10) et le commentaire du compose (B4).
- Récupérer `src/sante.js` depuis `cc3f770`.
- Trancher les questions 1 à 17.

**Phase 1, runner et event store**
- Choisir la version du CLI des runs (question 9) et vérifier `apiKeySource` dans `init`.
- Enrichir `agent-runner.js` : événements par message, `session_id`, stop par `abortController`,
  reprise par `resume`, journal brut JSONL et `stderr`.
- Détecter `rate_limit` et `is_error` avant tout retry (A12), en capturant de vraies sorties.
- Brancher le `Reporter` sur SQLite, écrit au fil de l'eau.
- Vitest en enveloppe autour des scripts existants, sans perdre de vérification.

**Phase 2, moteur**
- Schéma graphe compilé en étapes, tests d'équivalence sur `marketing.json` et `web-app.json`.
- Arrêt typé sur approbation (B5), budget qui ouvre une approbation (A13, B14).
- Parseur YAML, migration des agents en `v1`, résolution `agent@version` sans repli (A5, A6).
- Nouveau module VCS pour les projets gérés, checkpoint par étape (A18, A19).

**Avant de déplacer marketing sur le PC**
- Migrer les approbations vers l'event store et reprendre les trois arbitrages en attente (B7).

**Phase 3, maître et workers**
- Listener WebSocket distinct, jeton, whois et ACL (B3), émetteur WoL séparé (B2), tests réseau sur
  le NAS.

**Phases 4 et 5, cockpit**
- Canal de commande cockpit vers maître, cockpit sans clé (B15). Service worker vérifié avec un flux
  SSE long.

## 8. Décisions de Raphaël, 2026-09-16

**Question ouverte §15 : option A.** Les fiches `project.json` sont centralisées dans
`business-pipelines/projects/<project-id>/project.json`.

| # | Décision | Conséquence pour le plan |
|---|---|---|
| 1 | **Agent SDK**, pas la CLI | C1 fermé. Phase 1 enrichit `agent-runner.js` |
| 2 | **Abonnement** pour les runs | C2 fermé. La §8 de la spec redevient le cas central : `waiting_quota`, coût affiché comme équivalent API. Les runs s'authentifient avec la session Claude Code du PC, le NAS n'a plus besoin de `ANTHROPIC_API_KEY` une fois les runs déplacés. Risque ouvert ci-dessous |
| 3 | Question à reformuler | voir §9 |
| 4 | **Aucune décision prise par un agent.** Un projet ne se code qu'après un plan approuvé. Toute décision non prévue par le plan remonte à Raphaël avec un rapport complet : ce qui change, ce que ça implique, fichiers et coûts touchés | C4 fermé, et plus strict que ma recommandation. Le nœud d'approbation porte un **rapport d'impact au schéma imposé**, que le validateur exige. Un outcome d'agent peut renvoyer au travail, jamais valider ni trancher |
| 5 | **Le NAS stocke et sert l'API. Tous les runs tournent sur le PC.** OmniRoute reste sur le PC | C8 fermé. Plus de `runsOn: nas` pour les étapes de travail : le NAS porte le maître, l'event store, le cockpit, les dépôts bare et les poids. Le service `marketing` du compose NAS part sur le PC. Le WoL devient le chemin normal de tout run |
| 6 | **ACL Tailscale** : seul le PC (et le NAS en local) joint le port WebSocket du maître. **Jeton par worker** hors git (`.env`), le maître ne stocke que le hash. Le maître vérifie le jeton **et** que le nom de machine Tailscale correspond au worker annoncé. Révocation worker par worker | C5 fermé. Le nom de machine se lit par `tailscale whois` sur l'IP du pair, ce qui suppose que le maître voie la vraie IP tailnet et pas `127.0.0.1` derrière `serve` **[À VÉRIFIER sur DSM]** |
| 7 | **Veille, pas d'arrêt.** Le maître ne demande la veille que si : aucune étape en file pour le PC, aucune activité utilisateur Windows depuis X minutes (configurable), aucun verrou « ne pas endormir » actif dans le cockpit. Un flag de config réduira les conditions à la première quand le ROG sera un serveur dédié | C13 fermé. À ajouter : toggle « ne pas endormir » dans le cockpit, lecture de l'inactivité Windows depuis WSL **[À VÉRIFIER : méthode]** |
| 8 | **Deux régimes git** : projets gérés = bare NAS principal + miroir GitHub (branches `run/*` incluses) ; outillage = GitHub principal, NAS en sauvegarde ; cockpit commite `agent-registry` en local sur le NAS puis pousse vers GitHub en asynchrone avec retry | C9 fermé. Reporté dans la §7.3 de `docs/SPEC-cockpit-agentique.md` |
| 9 | **Retirer tout ce qui concerne eBay** | plan de retrait proposé à part, avant de toucher au code |

**Risque ouvert sur la décision 2.** La page Agent SDK de la documentation Claude Code dit :
« Unless previously approved, Anthropic does not allow third party developers to offer claude.ai
login or rate limits for their products, including agents built on the Claude Agent SDK. » Elle
précise que l'usage du SDK relève des Commercial Terms. Le texte vise les produits proposés à
des tiers. L'usage personnel d'un abonnement pour des runs automatisés sur ses propres machines
n'y est pas traité explicitement. Avant la phase 3, relire les conditions de l'abonnement ou
poser la question au support. Le runner garde la possibilité de basculer sur une clé API par
backend, sans changer les pipelines.

## 9. Question 3 reformulée : format des pipelines

Trois sous-questions, chacune avec un exemple.

**3a. Quel format est écrit dans les fichiers ?**

Aujourd'hui un pipeline est une **liste d'étapes jouées dans l'ordre**. Une boucle n'est pas une
flèche, c'est une règle attachée à une étape : dans `marketing.json`, l'étape `couverture` dit
« si `couverture.json` vaut `INCOMPLETE`, envoie les manques à `plan-synthesist`, puis reprends
à `couverture` ».

La spec propose un **graphe** : des nœuds, et des flèches entre eux (`review → code` si
`changes_requested`).

- **Option A** : on garde la liste d'étapes dans les fichiers, et l'éditeur visuel dessine un
  graphe à partir d'elle.
- **Option B** : on écrit le graphe dans les fichiers (format de la spec), et le moteur le
  traduit en étapes au moment de l'exécuter.

Recommandation : **B**. L'éditeur visuel et le JSON restent identiques, ce qui est la
promesse de la §11.3. Condition : le graphe doit savoir dire tout ce que la liste dit déjà
(étapes en parallèle, tranche de spec par agent, schéma des sorties, routage d'un manque vers
l'agent responsable). Test d'acceptation : `marketing.json` réécrit en graphe donne exactement le
même run.

**3b. Quel nom pour la décision humaine ?**

Dans le code, `gate` veut dire « contrôle automatique fait par du code » (tests qui passent,
couverture complète). Dans la spec, `gate` veut dire « Raphaël décide ». Le même mot pour deux
choses opposées finira par une erreur de lecture.

Recommandation : `gate` garde son sens actuel (contrôle par du code), le nœud humain s'appelle
`approval`, comme dans le code actuel.

**3c. Comment on compte les tours de boucle ?**

Exemple : `code` produit, puis `tests` et `securite` vérifient. Chacun peut renvoyer à `code`.

- **Par flèche** (spec) : `tests → code` a `maxLoops: 3` et `securite → code` a `maxLoops: 3`.
  En alternant les deux échecs, `code` peut être relancé **6 fois**.
- **Par cycle** (moteur actuel) : la boucle `code ↔ vérifications` a une seule limite de 3.
  `code` est relancé **3 fois au plus**, quel que soit le vérificateur qui échoue.

Le moteur comptait par étape au début, et un run a dépassé son plafond réel de cette façon. Il
a été corrigé pour compter par cycle.

Recommandation : **par cycle**. `maxLoops` se pose sur la boucle, pas sur chaque flèche.

**Réponse de Raphaël, 2026-09-16** : 3a **B**, le graphe est écrit dans les fichiers et
compilé en étapes. 3b **`approval`** pour la décision humaine, `gate` garde son sens. 3c
**`maxLoops` par cycle**.

## 10. Plan de retrait d'eBay (décision 9)

Validé le 2026-09-16, appliqué sur la branche `chore/retirer-ebay`. Les deux points à trancher
sont retenus tels que recommandés : `charger`, `execute` et le cycle sont retirés. Les fichiers
`specs/veille.env` et `specs/ajustement-prix.env` du checkout principal sont supprimés aussi, à
la demande de Raphaël.

### Ce qui part sans discussion

| Catégorie | Fichiers |
|---|---|
| Pipelines | `pipelines/veille-ebay.json`, `pipelines/ajustement-prix.json`, `pipelines/ajustement-prix-appliquer.json` |
| Specs | `specs/veille.json`, `specs/veille.env.example`, `specs/ajustement-prix.json`, `specs/ajustement-prix.env.example` |
| Agents | `.claude/agents/veille-analyst.md`, `.claude/agents/price-planner.md` |
| Code eBay | `src/ebay.js`, `src/executeur-prix.js`, `src/stats.js`, `bin/ebay-consentement.js` |
| Types d'étape eBay | `fetch`, `stats`, `verify`, `verify-actions` dans `src/stage-handlers.js` |
| Tests | `test/ebay.test.js`, `test/veille.test.js`, `test/stats.test.js`, `test/executeur-prix.test.js` |
| Divers | scripts `veille`, `plan:prix`, `appliquer:prix` de `package.json`, l'exécuteur `changement_prix` d'`orchestrator.js`, les sections eBay du README, les commentaires eBay de `.gitignore` et `.dockerignore` |

### Ce qui reste, parce que `marketing` s'en sert

`consigne`, `approval`, `verify-couverture`, `src/approval.js`, `src/cockpit.js`, `src/durable.js`,
`src/alerte.js`, `bin/alerter.js`, `bin/en-attente.js`, le cockpit entier.

### Ce qui doit être réécrit

Les tests `approval`, `cockpit`, `acces`, `alerte` et `cycle` prennent `ajustement-prix` et des
actions `changement_prix` comme exemple. Ils testent des mécanismes génériques (empreinte, gel,
signature, péremption), donc ils restent, avec un dossier d'exemple neutre à la place. Le nombre
de vérifications doit rester le même, hors tests des fichiers supprimés.

### Deux points à trancher

1. **`charger`, `execute` et `src/execute.js`.** C'est la partie « agir » de la chaîne proposer,
   geler, décider, agir. Sans eBay, plus aucun exécuteur n'est branché : c'est du code mort. Mais
   la phase 06 (déploiement derrière approbation) en aura besoin.
   Recommandation : **les retirer**, et les reprendre depuis l'historique quand un vrai
   exécuteur existera.
2. **`bin/cycle.js` et `src/cycle.js`.** Boucle générique, mais ses règles (planifier,
   replanifier, appliquer) ont été écrites pour le pipeline de prix, et le maître de la phase 3
   la remplace. Recommandation : **les retirer**.

### Hors dépôt, à faire par toi

- Révoquer l'application eBay (App ID et Cert ID) dans le portail développeur eBay. Le refresh
  token est déjà supprimé, mais les identifiants permanents restent valides.
- Supprimer `specs/veille.env` et `specs/ajustement-prix.env` du checkout principal. Ils ne sont
  pas suivis et portent les secrets eBay. Je ne les supprime pas moi-même.
- Les worktrees `alerte-cron`, `cockpit-reponse-libre` et `fix-deploiement-nas` pointent vers
  des branches déjà fusionnées et contiennent encore eBay. Ils peuvent être supprimés.
