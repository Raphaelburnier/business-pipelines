# Audit, phase 0 du cockpit agentique

Audit du 2026-09-16, fait contre `SPEC-cockpit-agentique.md`. Aucun fichier de code n'a été
modifié. Ce document est le seul livrable de la phase.

Dépôts lus :

| Dépôt | Branche lue | Commit |
|---|---|---|
| `business-pipelines` | `main` | `833eb84` |
| `agent-orchestrator` | `master` | `5bdafd4` |
| `Saas-generator` | `feat/agent-skills` | `1a13fdd` |

Lus aussi : `PLAN.md`, les notes du vault (`business-pipelines`, `agent-orchestrator`,
`omniroute`), `~/.config/agent-orchestrator/backends.json` (noms de variables seulement) et
`claude --help` (Claude Code 2.1.273).

Non vérifiable depuis ce poste : tout ce qui se passe sur le NAS. Le cockpit
`https://nas.tail8296f6.ts.net` n'a répondu ni depuis Windows ni depuis WSL pendant l'audit,
et WSL ne résout pas le nom MagicDNS.

## 1. Résumé

La spec a été écrite sans lire le code, et ça se voit sur six points qui changent la forme du
travail. Les voici, du plus structurant au moins structurant.

1. **Le moteur n'appelle pas la CLI, il passe par l'Agent SDK** (`@anthropic-ai/claude-agent-sdk`
   0.1.77). Le SDK fournit déjà ce que la spec demande à `claude -p` : `session_id`, flux de
   messages, `interrupt()`, `resume`, coût, erreur typée `rate_limit`. Le runner actuel jette
   tout ça et ne garde que le message final.
2. **La facturation réelle n'est pas un abonnement.** Le NAS tourne avec `ANTHROPIC_API_KEY`, et
   `PLAN.md` verrouille « Opus 5 en accès direct, pas via un abonnement relayé ». La §8 de la
   spec (quota par fenêtre, `waiting_quota` comme cas central) décrit un autre mode.
3. **Le format de pipeline existant est une liste ordonnée de stages, pas un graphe.** Les
   gates, le routage des findings, `rerun_from`, les épisodes de correction, le slicing et les
   stages typés n'ont pas d'équivalent direct dans `nodes` / `edges`. Et le mot `gate` désigne
   déjà un contrôle déterministe, pas une décision humaine.
4. **Le signal `outcome.json` écrit par l'agent contredit une décision verrouillée** : le juge
   est du code, jamais l'agent lui-même.
5. **L'identité Tailscale passe par un en-tête**, `Tailscale-User-Login`, injecté par
   `tailscale serve`. La spec dit l'inverse. Et cet en-tête nomme un utilisateur, pas une
   machine : il ne peut pas servir tel quel à authentifier un worker.
6. **OmniRoute et Ollama tournent sur le PC**, pas sur le NAS. Une étape NAS routée vers
   OmniRoute ne marche pas quand le PC dort.

Le reste est compatible ou se règle par un ajustement de plan. La base existante est solide
(230 vérifications vertes côté `business-pipelines`, suite verte côté moteur) et la plupart
des principes de la spec sont déjà appliqués dans le code.

## 2. Stack actuelle

### 2.1 business-pipelines

- Node 22, **JavaScript CommonJS**, aucun TypeScript, aucun framework serveur.
- Dépendances : `agent-orchestrator` (`file:../agent-orchestrator`) et `nodemailer`. Rien d'autre.
- Tests : scripts Node avec un harness maison (`test/harness.js`), lancés en chaîne par
  `npm test`. Pas de Vitest.

**Le cockpit** (`bin/cockpit.js`, 740 lignes, plus `src/cockpit.js`, `src/acces.js`,
`src/pwa.js`, `src/apps.js`) :

- serveur `http` natif ;
- HTML rendu côté serveur dans une chaîne de caractères, CSS inline, petit script inline pour
  poster les décisions. Pas de React, pas d'étape de build ;
- PWA installable (manifeste, service worker sans cache, icônes) ;
- routes : `GET /`, `GET /api/etat`, `POST /api/decider`, et les ressources PWA ;
- contenu : bandeau « ce qui attend », tuiles de modules lues dans `specs/cockpit-apps.json`,
  dossiers d'approbation avec décision par action, note et réponse libre ;
- défenses déjà en place : écoute loopback (ou publication loopback de l'hôte en conteneur,
  déclarée par `COCKPIT_CONTENEUR=1`), liste blanche d'hôtes contre le rebinding DNS, contrôle
  d'`Origin` et de `Content-Type` sur les écritures, signature tirée du canal, échappement de
  tout texte, `Cache-Control: no-store`, aucune exception qui tue le processus ;
- **le cockpit ne reçoit aucune clé Anthropic**, par choix documenté dans `docker-compose.yaml`.

**Le cycle** (`bin/cycle.js`, `src/cycle.js`) : une boucle générique « lire l'état, choisir une
action, la faire, prévenir ». Son conteneur a été **retiré du NAS le 2026-09-13**. Le fichier
reste.

**Les pipelines** : `marketing` (en service sur le NAS, à la demande), `veille-ebay`,
`ajustement-prix`, `ajustement-prix-appliquer` (eBay écarté, décision de retrait non prise).

**Stages typés fournis par le dépôt** (`src/stage-handlers.js`, 1 019 lignes) : `fetch`,
`verify`, `verify-actions`, `verify-couverture`, `approval`, `consigne`, `charger`, `execute`.

**État durable** : fichiers JSON dans `approvals/`, hors du workspace : boîte
`EN-ATTENTE.json`, `<dossier>.decisions.json`, `<dossier>.plan.json` (plan gelé),
`<dossier>.ledger.json`. Lus par le cockpit, le cycle et l'alerteur.

**Journal d'exécution** : le `Reporter` du moteur garde les événements en mémoire et les écrit
dans `generation-report.json` **à la fin du run**. Rien n'est observable pendant le run, à part
la sortie console.

**Lanceur** (`orchestrator.js`) : vide le workspace à chaque run (`overwrite: true`), ne branche
ni `vcs` ni `--resume`. C'est un point ouvert de `PLAN.md`.

### 2.2 agent-orchestrator

- Node, **JavaScript CommonJS**, un seul paquet (pas de monorepo), 3 887 lignes dont les tests.
- Dépendance unique : `@anthropic-ai/claude-agent-sdk` `^0.1.0`, installé en **0.1.77**. Ce SDK
  embarque son propre `cli.js` : il n'utilise pas le `claude` 2.1.273 installé sur la machine.
- Pas de zod. La validation des pipelines est écrite à la main dans `src/loader.js`.
- Remote GitHub (`Raphaelburnier/agent-orchestrator`), branche `master`.

Modules utiles pour la spec :

| Module | Ce qu'il fait aujourd'hui |
|---|---|
| `engine.js` | boucle de stages, gates, routage, épisodes de correction, reprise |
| `agent-runner.js` | appelle `query()` du SDK, hook de périmètre `PreToolUse`, retry sur crash transitoire, renvoie `{ costUsd, turns, summary }` |
| `backends.js` | un backend = un jeu de variables d'environnement, `_billed: "false"` |
| `budget-tracker.js` | cumule USD et turns, **lève une erreur** au plafond |
| `reporter.js` | événements en mémoire, écrits en fin de run |
| `resume.js` | `.orch-resume.json`, empreinte pipeline + spec |
| `vcs.js` | commit par stage vert, merge final si tous les gates sont verts |
| `workspace.js` | dossier isolé avec marque de propriété |

Le runner ne remonte ni `session_id`, ni messages intermédiaires, ni tokens. Il accepte un
`abortController` mais aucun appelant ne s'en sert pour un stop.

### 2.3 Format agents du SaaS generator

Même format que le moteur, puisque le SaaS generator en est le premier consommateur :

- agents en `.md` dans `.claude/agents/`, frontmatter plat `name`, `description`, `tools`
  (liste séparée par des virgules), `model` (`opus` | `sonnet`), puis le prompt système ;
- pipelines JSON au format stages du moteur (`web-app.json`, `discord-bot.json`) ;
- spec projet JSON libre (`spec.example.json` : stack, écrans, modèle de données, contraintes).

Le parseur de frontmatter (`loadAgentDefinition`) découpe chaque ligne sur le premier `:`. Il ne
lit pas d'objet imbriqué comme `defaultLlm: { via, model }` : le format de la §5.2 demande un
vrai parseur YAML.

Agents existants, sans version : 12 dans le moteur, 5 dans `business-pipelines`, 6 dans le
SaaS generator.

Le SaaS generator déclare aussi ses déploiements au cockpit (commit `1a13fdd`), ce qui alimente
les tuiles de modules.

### 2.4 OmniRoute et backends

Déclarés dans `~/.config/agent-orchestrator/backends.json` :

| Backend | URL | Facturé | Modèles |
|---|---|---|---|
| `anthropic` (intégré) | auth native | oui | étiquette de l'agent |
| `ollama`, `ollama-coder` | `localhost:11434` | non | qwen3:8b, qwen2.5-coder:7b |
| `omniroute` | `localhost:20128` | non | combos `agentic-code` / `agentic-bulk` |
| `opus-direct` | `localhost:20128` | oui | `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5` |

OmniRoute 3.8.50 tourne en service systemd utilisateur **dans le WSL de ce poste**. Il répond
(307 sur `/`), Ollama aussi (200).

### 2.5 Déploiement NAS

- `docker-compose.yaml` : `cockpit` (toujours debout, publié sur `127.0.0.1:4600` de l'hôte,
  réseau bridge `business`) et `marketing` (profil `manuel`, lancé par
  `docker compose run --rm marketing`, reçoit `specs/deploiement.env` qui ne porte que
  `ANTHROPIC_API_KEY`).
- Image `node:22-alpine`, ripgrep système. Le moteur est copié dans `.moteur/` par
  `bin/preparer-image.sh` avant le build (copie identique au dépôt, dossier `.claude` exclu).
- Tailscale : `tailscale serve --https=443` vers `localhost:4600`, nom
  `nas.tail8296f6.ts.net` (`bin/tailnet-relais.sh`).

### 2.6 Branches et worktrees de business-pipelines

- `feat/tailnet-acces` est **déjà fusionnée dans `main`**, comme toutes les branches locales
  sauf une.
- `worktree-sante-bind-contrat` porte un commit non fusionné, `cc3f770`. Sa correction de bind
  est remplacée par celle de `main` (`COCKPIT_CONTENEUR`). Mais il ajoute `src/sante.js`, un
  contrat de résultat de contrôle de santé qui distingue `INCONNU` d'un échec et porte un champ
  `attendue` (la cible était-elle censée répondre). C'est exactement la distinction
  `sleeping` / `offline` de la §7.1.
- Quatre worktrees actifs sous `.claude/worktrees/`.

## 3. Ce qui est réutilisable

| Existant | Sert à | Remarque |
|---|---|---|
| `acces.js` (hôtes, origine, identité, bind) | §10, auth cockpit | à garder tel quel, et à étendre pour SSE |
| Compose loopback + `tailscale serve` | §10 isolation | déjà conforme à « jamais `0.0.0.0` publié » |
| `agent-runner.js` + hook de périmètre | §6 runner | à enrichir, pas à réécrire |
| `backends.js` | §6.1 routage OmniRoute / Ollama | correspond à `llm.via` |
| `engine.js` gates, routage, épisodes | §5.4 boucles bornées | la borne existe déjà, par épisode |
| `resume.js` | §6.3 reprise | reprise par stage, pas par session |
| `vcs.js` | §7.3 checkpoints | commit par stage déjà là |
| `budget-tracker.js` | §8 budgets | à passer d'une erreur à une gate |
| harness des tests (`runAgent` mocké) | §6.4 tests sans quota | 230 vérifications sans un appel de modèle |
| stages `approval` / `consigne` / `charger` | §5.4 `gate` humaine | gel du plan, empreinte, péremption |
| `src/sante.js` (branche non fusionnée) | §7.1 états machines | à récupérer |
| `cockpit-apps.json` | §11.1 topologie | les modules déployés n'apparaissent pas dans la spec |
| PWA du cockpit | §11.4 mobile | déjà installable sur téléphone |

## 4. Conflits avec la spec

Chaque ligne demande une décision. Ma recommandation est donnée, je n'ai rien tranché.

### C1. Runner : CLI ou Agent SDK (§6)

- **Spec** : `claude -p --output-format stream-json`, parsing de stdout, faux binaire.
- **Code** : Agent SDK. Les types de la version installée exposent `SDKSystemMessage` avec
  `subtype: 'init'` et `session_id`, `SDKResultMessage` avec `total_cost_usd` et `usage`,
  `Query.interrupt()`, l'option `resume`, `systemPrompt` en chaîne ou en preset avec `append`,
  une erreur d'assistant typée `'rate_limit'`, et `pathToClaudeCodeExecutable`.
- **Recommandation** : garder le SDK. Il fait le parsing et le transport à notre place, et le
  moteur en dépend déjà partout. Enrichir `runOnce` pour émettre `step.started` /
  `step.progress` / `step.finished` à partir des messages, et exposer `session_id`.
  Mettre à jour le SDK (0.1.77 est ancien) dans la même phase.
- **Tests sans quota** : deux options. Garder le mock de `runAgent` du harness, qui marche déjà.
  Ou un faux binaire via `pathToClaudeCodeExecutable`, mais le SDK parle au CLI dans un
  protocole de contrôle bidirectionnel en `stream-json`, donc le faux doit l'imiter
  **[À VÉRIFIER]**. Je recommande le mock de `runAgent` pour le moteur, et un faux binaire
  seulement si un test de bout en bout le justifie.

### C2. Abonnement ou clé API (§8)

- **Spec** : abonnement Pro/Max, coût estimé, limite par fenêtre au centre.
- **Code et plan** : `ANTHROPIC_API_KEY` sur le NAS, backend `opus-direct` facturé à l'usage,
  décision verrouillée dans `PLAN.md`. La note du backend précise « pas de quota d'abonnement,
  donc pas d'attente de réinitialisation ».
- **Impact** : `total_cost_usd` est une dépense réelle sur ce chemin, pas une estimation.
  `waiting_quota` reste utile (rate limit API, crédits épuisés) mais n'est plus le cas central.
- **À décider** : quel mode pour les runs automatisés. Si l'abonnement doit servir, vérifier
  d'abord que les conditions d'utilisation l'autorisent pour un usage automatisé via SDK
  **[À VÉRIFIER]**. Le fournisseur `claude` (OAuth) d'OmniRoute consomme le même quota que les
  sessions interactives.

### C3. Graphe `nodes` / `edges` ou stages ordonnés (§5.4)

- **Spec** : graphe, arêtes conditionnelles `on`, `maxLoops` par arête, `layout`.
- **Code** : stages ordonnés avec `parallel`, `slicing`, `inputs` / `outputs` /
  `output_schema`, gates déterministes (`pass_when`, `fail_when`, `items`, `targets`,
  `rerun_from`), `retry.max_fix_cycles` compté **par épisode**, `requires`, stages typés avec
  validateurs.
- **Collision de vocabulaire** : dans le code, `gate` est un contrôle déterministe porté par un
  stage. Dans la spec, `gate` est une décision humaine. Le code appelle celle-ci `approval`.
- **Détail qui compte** : un plafond par arête reproduit le bug déjà corrigé dans le moteur
  (deux gates qui renvoient au même point montaient chacun jusqu'au plafond, donc deux fois le
  plafond réel). Voir la note `agent-orchestrator`, « le plafond par épisode ».
- **Recommandation** : un schéma v2 en graphe qui **compile vers les stages actuels**, ou
  l'inverse, avec deux exigences : le pipeline `marketing` actuel s'exprime sans perte, et
  `maxLoops` borne un cycle (une composante), pas une arête. Renommer le nœud humain en
  `approval` pour garder `gate` dans son sens actuel.

### C4. `outcome.json` écrit par l'agent (§5.4)

- **Spec** : l'agent `code-reviewer` écrit `approved` ou `changes_requested`, et le graphe route
  là-dessus.
- **Décision verrouillée** : « le juge doit être du code, pas un agent ». `must_change` et
  `verify-couverture` existent précisément parce qu'un agent qui déclare son propre résultat
  n'atteste de rien.
- **Recommandation** : l'outcome d'un agent peut **choisir une route** (quoi faire ensuite),
  jamais **valider** (passer une étape qui compte). Toute arête vers une approbation ou une
  fusion passe par un nœud `script` déterministe. Le validateur de pipeline le vérifie.

### C5. Identité Tailscale (§1, §7.4, §10)

- **Spec** : « identité vérifiée via la connexion Tailscale et non via un header ».
- **Code** : l'identité **est** l'en-tête `Tailscale-User-Login`. Il n'est fiable que parce que
  le service n'est joignable qu'en loopback derrière `tailscale serve`. Le raisonnement est
  écrit dans `src/acces.js`.
- **Problème pour les workers** : l'en-tête nomme l'utilisateur. Le téléphone et le PC portent
  le même utilisateur, donc une liste blanche de machines ne peut pas s'appuyer dessus. Un
  appareil `tagged` ne reçoit aucun en-tête.
- **Options** : `tailscale whois` sur l'IP du pair (suppose un bind direct sur l'IP Tailscale,
  pas `serve`), ACL Tailscale sur le port du maître plus un jeton par worker, ou tag du PC plus
  ACL. **[À VÉRIFIER]** avec le paquet Tailscale de DSM.
- **Recommandation** : ACL Tailscale qui n'ouvre le port WebSocket qu'au PC, plus un jeton par
  worker dans un `.env`. L'en-tête reste réservé au cockpit, où il désigne bien une personne.

### C6. Services du NAS (§1, §2)

- **Spec** : `cockpit.js` et `cycle.js` tournent sur le NAS.
- **Réalité** : seul le cockpit tourne en continu. `marketing` se lance à la main. Le conteneur
  du cycle est retiré depuis le 2026-09-13.
- **Impact** : pas de planificateur en service aujourd'hui. Le maître de la §4 est à créer, pas
  à faire évoluer.

### C7. Où vit l'état durable (§3.1, §9)

- **Spec** : SQLite pour les runs, étapes, événements **et** approbations.
- **Code** : approbations dans des fichiers JSON (`approvals/`), avec gel du plan, empreinte,
  péremption et registre hors workspace. Trois lecteurs indépendants.
- **Recommandation** : SQLite pour `runs` / `steps` / `events` dès la phase 1. Les approbations
  restent en fichiers jusqu'à la phase 5, puis migrent en gardant l'empreinte et le gel. **Trois
  arbitrages marketing attendent une décision sur le NAS** : aucune migration ne doit les perdre.

### C8. Emplacement d'OmniRoute et d'Ollama (§6.1, §7)

- **Spec** : n'importe quelle étape peut passer par OmniRoute.
- **Réalité** : OmniRoute et Ollama écoutent sur `localhost` dans le WSL du PC. Le backend
  facturé `opus-direct` passe aussi par OmniRoute, ce qui en fait un point unique de panne
  (`PLAN.md`, phase 01).
- **À décider** : installer OmniRoute sur le NAS, ou poser la règle « `llm.via: omniroute` ou
  `ollama` implique `runsOn: pc` », que le validateur imposera. Dans les deux cas, garder un
  backend Anthropic direct qui ne passe pas par OmniRoute.

### C9. Remote git (§7.3)

- **Spec** : dépôt bare sur le NAS comme remote principal, miroir GitHub.
- **Réalité** : `origin` est GitHub pour les trois dépôts. Les runs de `business-pipelines`
  n'ont pas de dépôt de travail : le workspace est jetable et `vcs` n'est pas branché.
- **À décider** : pour quels dépôts le remote NAS s'applique (dépôts de projets générés
  seulement, ou aussi les trois dépôts d'outillage), et sur quel dépôt travaille un run qui ne
  produit que des artefacts (marketing).

### C10. Le cockpit lance des runs (§10, §11.2)

- **Spec** : `POST /api/runs`, pause, stop, relance depuis le cockpit.
- **Code** : le cockpit ne détient aucune clé, par choix explicite, pour que le processus exposé
  au tailnet ne puisse pas dépenser.
- **Recommandation** : garder ce principe. Le cockpit écrit une **commande** (table ou file),
  le maître la lit et l'exécute avec ses propres secrets. Le cockpit reste sans clé.

### C11. Budget : arrêt ou gate (§8)

- **Spec** : dépassement, gate automatique `waiting_approval`.
- **Code** : `BudgetTracker.add` lève une erreur et tue le run, alors que `PLAN.md` verrouille
  « le garde-fou escalade au lieu de tuer l'exécution ».
- Pas de conflit avec la spec, mais un écart du code avec sa propre décision. À corriger en
  phase 2.

### C12. Langage, schémas, tests (§0)

- **Spec** : TypeScript, zod dans `packages/schemas`, Vitest.
- **Code** : CommonJS sans TS, validation écrite à la main, tests en scripts Node.
- **Impact** : `agent-orchestrator` passe en workspaces npm pour accueillir `packages/schemas`.
  `preparer-image.sh` copie tout le dépôt, donc reste compatible, mais le paquet `schemas` doit
  être compilé avant la copie. zod v4 est déjà utilisé dans le SaaS generator.
- **Recommandation** : Vitest pour le nouveau code, les scripts existants restent dans
  `npm test` jusqu'à leur migration. Les deux suites doivent rester vertes à chaque phase.

### C13. Machines (§1, §7.5, §7.6)

- Ce poste (`destrobimobile`, i7-11700, RTX 3060) correspond au ROG G10CE. **Le PC homelab est
  donc aussi le poste de développement**, avec la session Claude Code interactive, OmniRoute et
  Ollama. Mettre ce poste en veille depuis le maître coupe tout ça.
- Le commit `cc3f770` dit « the PC shuts down every evening ». La spec parle de veille. Le
  Wake-on-LAN depuis un arrêt complet (S5) dépend du BIOS et de la carte réseau, pas seulement
  de la veille (S3) **[À VÉRIFIER]**.
- RAM du NAS (8 Go) : non vérifiable d'ici.

### C14. Topologie et modules (§11.1)

La spec range maître, machines, business, projets. Le cockpit actuel affiche aussi les
**modules déployés** (`cockpit-apps.json`, alimenté par le SaaS generator). Ils ne figurent pas
dans la spec. Proposition : un niveau « app » sous le projet qui l'a produite, avec le même
contrôle d'URL qu'aujourd'hui.

## 5. Réponses aux [À VÉRIFIER]

| Point | Réponse | Source |
|---|---|---|
| Syntaxe de `--allowedTools` | liste séparée par virgules ou espaces, exemple `"Bash(git *) Edit"`. La forme `Bash(npm test:*)` de la spec n'apparaît pas dans l'aide : à tester | `claude --help` 2.1.273 |
| Alias de modèles | `fable`, `opus`, `sonnet`, ou nom complet (`claude-fable-5`). Via `opus-direct` : notation à tirets seulement (`anthropic/claude-opus-5`), point et suffixe d'effort refusés | `claude --help`, `backends.json` |
| Injection du prompt système | CLI : `--system-prompt` (remplace) ou `--append-system-prompt`. SDK : `systemPrompt` chaîne (remplace, utilisé aujourd'hui) ou `{ type: 'preset', preset: 'claude_code', append }` | aide CLI, types SDK |
| Variables pour OmniRoute | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, validé le 2026-09-15 (requête de 25k tokens, 41 outils, `tool_use` servi). Réserves : un bloc texte `(empty response)` accompagne chaque `tool_use`, Groq limité à 8 000 TPM | `backends.json`, note omniroute |
| Ollama via OmniRoute | Ollama est **retiré** du combo OmniRoute (préremplissage plus long que le délai de file). Il reste joignable en direct par les backends `ollama` | note du backend `omniroute` |
| Format du message de limite | partiel : le SDK type une erreur d'assistant `'rate_limit'`. Le `subtype` du résultat et l'heure de réinitialisation ne sont pas vérifiés. Il faut une capture réelle | types SDK 0.1.77 |
| Autres options utiles | `--max-budget-usd`, `--json-schema` (sortie structurée), `--session-id`, `--no-session-persistence`, `--fallback-model` | `claude --help` |
| WoL depuis un conteneur (`network_mode: host`) | non vérifié. Le compose actuel est en bridge pour l'isolation : passer le maître en host réseau défait ce choix. Alternative : un petit script WoL sur l'hôte DSM, appelé par le maître | à tester sur le NAS |
| Paquet Git Server de Synology | non vérifié | à tester sur le NAS |
| Montage SMB/NFS dans WSL | non vérifié | à tester sur le PC |
| `tailscale serve` sur DSM | déjà utilisé pour le cockpit du NAS. Bind direct sur l'IP 100.x dans un conteneur : non vérifié | compose, `tailnet-relais.sh` |
| Sortant WSL vers le tailnet | **non concluant** : WSL ne résout pas `nas.tail8296f6.ts.net`, et Windows n'a pas eu de réponse non plus pendant l'audit | test du 2026-09-16 |

## 6. Plan ajusté

Les phases de la spec restent, avec ces changements.

**Phase 0 bis, décisions et ménage** (sans code métier) :
- trancher C1 à C5, C8 et C9 (questions au §7 ci-dessous) ;
- récupérer `src/sante.js` depuis `cc3f770` et fermer la branche ;
- décider du sort des pipelines `veille-ebay` et `ajustement-prix` avant de migrer leur format.

**Phase 1, runner et event store** :
- enrichir `agent-runner.js` (événements par message, `session_id`, stop par
  `interrupt()` / `AbortController`, reprise par `resume`) au lieu d'écrire un runner CLI ;
- mettre à jour le SDK ;
- remplacer le stockage en mémoire du `Reporter` par un écrivain SQLite, en gardant
  `generation-report.json` ;
- TypeScript avec `allowJs` dans `agent-orchestrator`, Vitest pour le nouveau code.
- Acceptation inchangée, avec « stop » = `interrupt()` et « reprise » = option `resume`.

**Phase 2, moteur** :
- schéma v2 selon la décision C3, avec `marketing` exprimé sans perte comme test ;
- règle C4 dans le validateur ;
- budget qui ouvre une approbation au lieu de lever une erreur (C11) ;
- `agent-registry` : import des agents existants en `v1`, parseur YAML réel.

**Phase 3, maître et workers** : dépend de C5 (auth worker), C8 (OmniRoute), C13 (veille ou
arrêt, poste de dev partagé).

**Phase 4, cockpit en lecture** : ajouter l'étape de build React au Dockerfile. **L'écran
d'approbation actuel reste en service** jusqu'à la parité de la phase 5, puisqu'il porte des
décisions réelles.

**Phase 5, cockpit en action** : commandes écrites pour le maître, cockpit toujours sans clé
(C10). Migration des approbations fichiers vers SQLite (C7).

Phases 6 et 7 : pas de changement, sauf la règle C8 sur `llm.via`.

## 7. Questions pour Raphaël

1. **Runner** : on garde l'Agent SDK plutôt que la CLI ? (recommandé : oui)
2. **Facturation** : les runs automatisés restent sur clé API, ou tu veux passer par
   l'abonnement ? Si abonnement, qui vérifie les conditions d'utilisation ?
3. **Format de pipeline** : graphe v2 qui compile vers les stages, et renommage du nœud humain en
   `approval` ? `maxLoops` par cycle plutôt que par arête ?
4. **Outcome d'agent** : d'accord pour « un outcome route, il ne valide jamais » ?
5. **OmniRoute** : on l'installe aussi sur le NAS, ou on impose `runsOn: pc` à tout nœud qui
   passe par lui ?
6. **Auth worker** : ACL Tailscale plus jeton par worker ?
7. **PC** : il se met en veille ou il s'éteint le soir ? Et le maître a-t-il le droit d'endormir
   le poste sur lequel tu travailles ?
8. **Remote NAS** : pour les dépôts de projets générés seulement, ou aussi pour les trois dépôts
   d'outillage ?
9. **Pipelines eBay** : on les retire avant la migration du format ?

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
