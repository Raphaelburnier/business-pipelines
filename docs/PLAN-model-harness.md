# Plan : harness de modèles multi-fournisseurs dans le cockpit

Version du 2026-09-24. Remplace le brief générique « Multi-Provider Model Harness for
Cockpit », qui supposait un sélecteur et un chemin d'exécution à créer. Ce plan part de ce
que le code contient réellement. Lire aussi `docs/SPEC-cockpit-agentique.md` §11.7 et
`docs/AUDIT.md` C12 et décisions 5 et 9.

## Objectif

Depuis le cockpit, savoir quels modèles un run peut utiliser maintenant, qui les sert,
avec quelles capacités, s'il reste du quota, et sinon pourquoi et jusqu'à quand. Puis
choisir l'un d'eux au lancement d'un run. Le même chantier ajoute maintenant un mode
« Demander au cockpit » en lecture seule, distinct des tâches de développement.

## Ce que le code contient (vérifié le 2026-09-24)

- Aucun chat ni sélecteur de modèle dans le cockpit. Le seul point d'accroche est le
  lanceur de runs (`web/src/vues/Panneau.tsx`, `PanneauProjet`). Le schéma de commande
  prévoyait déjà `llmOverrides` (`agent-orchestrator/packages/schemas/commandes.js`).
- Le chemin d'exécution unique existe déjà. Les agents passent par
  `@anthropic-ai/claude-agent-sdk` ; un « backend » est un jeu de variables d'environnement
  (`agent-orchestrator/src/backends.js`). OmniRoute accepte `/v1/messages` : le choix
  `{via: "omniroute", model: "codex/gpt-5.6-terra"}` suffit à router n'importe quel modèle.
  Il ne faut pas écrire de couche `execute()` par fournisseur.
- Le cockpit et le runner tournent sur le NAS. OmniRoute tourne sur le PC (WSL, NAT,
  `:20128`). Le NAS ne joint pas OmniRoute et n'a pas de `backends.json` : depuis le runner
  du NAS, seul `via: claude` fonctionne.
- OmniRoute 3.8.50 expose, avec une clé d'inférence ordinaire :
  - `GET /v1/models` : environ 1000 entrées, avec `owned_by`, `capabilities`
    (`tool_calling`, `vision`, `reasoning`, `thinking`) et `context_length`. Le catalogue
    liste aussi des fournisseurs sans connexion (aihorde, devin-cli-agentic, etc.) et des
    modèles retirés : exister au catalogue ne veut pas dire être utilisable.
  - `GET /v1/me/status` : usage de la clé ; avec le scope `self:account-quota`, ajoute
    `accountQuotas[]` pour chaque connexion active : `{provider, connectionId, quotas:
    {fenêtre: {usedPercentage, remainingPercentage, resetAt}}}` ou `{available: false,
    reason}`. Quotas réels pour agy, antigravity, codex, claude, github, kiro, etc. ;
    `not_supported` pour gemini, groq, cline, ollama.
  - Les routes de gestion (`/api/providers`, `/api/resilience/connections`, `/api/combos`)
    exigent le scope `manage`, qui permet aussi de réécrire combos et fournisseurs. On ne
    s'en sert pas.
- Erreurs d'OmniRoute (`open-sse/utils/error.ts` du paquet) : 429 `model_cooldown` avec
  `reset_seconds` et `retry_after` ; 503 `provider_circuit_open` ; 503
  `ALL_ACCOUNTS_INACTIVE` quand un combo n'a plus de maillon ; 401 `invalid_api_key` pour la
  clé de la passerelle. En-têtes `X-OmniRoute-Provider`, `X-OmniRoute-Model`,
  `X-OmniRoute-Response-Cost`.

## Principes

1. Le quota appartient à la connexion, pas au modèle. agy et antigravity partagent un
   compte Google ; une erreur de nom chez codex met toute la connexion en cooldown environ
   100 s. Un modèle hérite de l'état de la meilleure connexion de son fournisseur.
2. `inconnu` est un état normal, pas un échec. Aucun quota n'est inventé ni déduit du nom.
3. Les combos sont la politique de repli explicite. Un combo se choisit en connaissance de
   cause ; un modèle direct n'a pas de repli. Aucune bascule silencieuse ailleurs.
4. Le cockpit exposé au tailnet ne reçoit aucune clé, ni Anthropic ni OmniRoute.
5. On groupe par fournisseur de routage (`owned_by`), pas par éditeur : c'est lui qui
   décide de la disponibilité. `cline/google/gemma-4` est chez cline.
6. Étendre les schémas zod de `agent-orchestrator/packages/schemas`, réutiliser
   `llm {via, model}`. Pas de second modèle de domaine.
7. Questions et tâches sont deux chemins différents : le chat utilise Claude depuis le
   runner du NAS et reste disponible sans le PC ; les tâches OmniRoute exigent le worker PC
   en ligne. Aucun Wake-on-LAN et aucun repli silencieux entre les deux.

## Architecture

```text
PC (WSL)                                     NAS
OmniRoute :20128                             cockpit (sans clé)
   ^  /v1/models, /v1/me/status                 GET /api/modeles  <- etat/modeles.json
   |                                            POST /api/runs refuse un via injoignable
orch modeles  -> relevé JSON                  runner (clé Anthropic)
   |                                            --llm *=via:modèle
bin/publier-modeles.sh --ssh-->  etat/modeles.json
(minuteur toutes les 2 min)
```

États visibles dans le cockpit, du plus global au plus fin :

| Niveau | États | Source |
|---|---|---|
| Relevé | frais, périmé (plus de 10 min : PC en veille ou minuteur arrêté), absent | `releveLe` |
| Passerelle | ok, injoignable, refus (clé) | le collecteur |
| Quotas | relevés, scope absent (catalogue non filtré) | `accountQuotas` présent ou non |
| Connexion | disponible, limité (moins de 20 %), épuisé (avec reprise), inconnu | `accountQuotas` |
| Modèle pour un run | utilisable ; indisponible : épuisé, sans appel d'outils, backend injoignable depuis le runner | `classer()` côté front |

## Étapes

### Étape 0 : préalables (faite, sauf un point pour Raphaël)

- Jeton du backend `omniroute` de `~/.config/agent-orchestrator/backends.json` : valide
  (200 sur `/v1/models`). La mention contraire de `PLAN.md` est périmée.
- OmniRoute écoute sur `0.0.0.0:20128`, alors que `AUDIT.md` dit « local seulement ». En
  NAT WSL, seul Windows y accède. Remettre `127.0.0.1` reste souhaitable pour coller à la
  décision 5, mais ce n'est pas bloquant.
- À faire par Raphaël, dans le dashboard OmniRoute : ajouter le scope `self:account-quota`
  à la clé de `~/.config/omniroute-client.env`, ou créer une clé dédiée
  (`self:usage` + `self:account-quota`, sans `manage`). Sans ce scope, le relevé dit
  `scope_absent` et ne filtre rien.

### Étape 1 : collecteur sur le PC (faite)

`agent-orchestrator` branche `feat/model-harness` :

- `packages/schemas/modeles.js` : `catalogue`, `modele`, `connexion`, `reponse`.
- `src/catalogue-modeles.js` : `releverCatalogue`, `normaliserCatalogue` (pure),
  `normaliserConnexion`. Ne lève jamais : une passerelle muette donne un catalogue en échec.
- `orch modeles [--sortie <fichier>]`, écriture atomique.
- `--llm *=<via>:<modèle>` : le joker vaut pour tous les nœuds agents ; un choix nommé
  l'emporte (`src/registre.js`, `llmEffectif`).
- Tests : `test/vitest/catalogue-modeles.test.mjs`.

Le minuteur systemd utilisateur `modeles-cockpit.timer` est installé sur le PC et publie
toutes les deux minutes dans `/volume1/docker/business-pipelines/etat/modeles.json`.

### Étape 2 : cockpit (faite)

`business-pipelines` branche `feat/model-harness` :

- `src/modeles.js` et `GET /api/modeles` : sert le dernier relevé, son âge, `perime`,
  `viaParMachine` et l'état des machines (`COCKPIT_VIA_MACHINES`).
- `POST /api/runs` refuse (400), avant la mise en file, un `llmOverrides` dont aucune
  machine configurée n'est actuellement `online` ou `busy`.
- Front : `donnees/modeles.ts` (`classer`, `raisonIndisponible`, `correspond`),
  `vues/SelecteurModele.tsx` (recherche sur nom, identifiant et fournisseur ; groupes,
  combos en tête ; indisponibles repliés avec raison et reprise ; bouton relire),
  intégré au lanceur de `Panneau.tsx`. Le choix part en `llmOverrides: {"*": llm}`.
- Maquette : `mock/modeles.ts` montre chaque cas (`/app/?source=maquette`).
- `bin/publier-modeles.sh` : relevé puis poussée SSH, écriture atomique côté NAS.

Conflit attendu : `Panneau.tsx` est aussi modifié par la refonte de navigation non
committée du worktree `steam-tierlist-run`. Trois ajouts localisés, à reporter à la main.

### Décisions du 2026-09-24 : voie A, PC sans réveil automatique, chat permanent

Tranché par Raphaël. Les nœuds OmniRoute tournent sur l'unique worker PC. Le téléphone et
les autres appareils sont des interfaces du cockpit, pas des workers. Une tâche de
développement n'est lançable que si le PC est déjà en ligne ; s'il dort ou est hors ligne,
elle est refusée avant la file. Aucun Wake-on-LAN.

En parallèle, « Demander au cockpit » reste disponible quand le PC dort : conversation
Claude exécutée par le runner du NAS, strictement en lecture seule et séparée d'un run de
développement. Le service web du cockpit ne reçoit toujours aucune clé.

Les autres voies, pour mémoire :
B (OmniRoute servi au NAS par `tailscale serve`, revient sur la décision 5) et C (statu quo)
sont écartées.

Aujourd'hui le runner du NAS ne joint pas OmniRoute : tous les modèles OmniRoute sont grisés
« non joignable depuis le runner ». La voie A confie les nœuds OmniRoute au worker du PC, qui
a la passerelle en local. Le code du maître et des workers existe (phase 3 :
`src/maitre.js`, `src/worker.js`, `bin/orch-worker.js`, `src/dispatch.js`, `src/wol.js`) ;
il n'est pas branché sur le chemin des runs du cockpit.

Travail pour Codex, dans l'ordre :

1. Trancher avec Raphaël l'écart noté dans `etat-business-pipelines.md` : fusionner runner et
   maître, ou garder le runner comme seul détenteur de la clé et lui faire lancer
   `orch projet ... --distribue`. Recommandation : garder le runner (il porte déjà la file
   de commandes et la clé), et lui faire ouvrir le maître avec `--distribue`.
2. Maître : l'ouvrir sur le NAS au port 4650 (le 4700 est pris), derrière l'ACL Tailscale et
   le jeton haché déjà prévus. Le runner est le seul à l'ouvrir ; pas de second processus
   concurrent sur l'event store.
3. Worker du PC : service systemd utilisateur `orch-worker` (`ORCH_MAITRE_URL`,
   `ORCH_MACHINE=pc`, `ORCH_JETON` dans un fichier en 600, jamais sur la ligne de commande).
   Il lit `~/.config/agent-orchestrator/backends.json`, où le backend `omniroute` est valide.
4. Placement : un nœud dont le LLM effectif a `via: omniroute` doit partir sur `pc`, quel que
   soit son `runsOn` du template, ou être refusé avant le run si `pc` n'est pas enregistré.
   L'écrire dans `src/dispatch.js` ou `src/graphe.js` (`role = noeud.runsOn || "pc"`), pas
   dans le cockpit.
5. Disponibilité : si `pc` dort ou est hors ligne, refuser le run avant la file avec une
   raison lisible. Ne pas envoyer de WoL et ne jamais replier silencieusement sur `claude`.
6. Cockpit : remplacer `COCKPIT_VIA_RUNNER` par une table par machine, par exemple
   `COCKPIT_VIA_MACHINES=nas:claude;pc:claude,omniroute`, dans `src/modeles.js`. `/api/modeles`
   rend `viaParMachine` et l'état des machines (déjà dans `/api/machines`). `classer()` rend
   un modèle OmniRoute utilisable seulement si `pc` est `online` ou `busy`.
   `POST /api/runs` applique la même règle. Étendre
   `modeles.reponse` dans `packages/schemas/modeles.js`.
7. Relevé : garder `bin/publier-modeles.sh` sur un minuteur du PC pour l'instant. Plus tard,
   le worker pourra pousser le relevé par le protocole WebSocket (nouveau type de message),
   ce qui supprime la dépendance SSH.
8. Tests : un nœud `omniroute` part sur `pc` ; `pc` absent ou endormi refuse le run avant
   la mise en file ; un nœud `claude` reste sur le NAS ; le sélecteur rend OmniRoute
   utilisable uniquement quand `pc` est en ligne.

Critère de fin : depuis le téléphone, choisir `agentic-code` dans le lanceur, lancer
Steam TierList, voir les nœuds agents tourner sur `pc` avec `via: omniroute` dans le détail
du run, et le coût affiché comme équivalent. PC endormi, le même lancement est refusé sans
le réveiller, tandis que « Demander au cockpit » continue de répondre via Claude sur le NAS.

### Étape 3 : erreurs à l'exécution et fournisseur réel (faite, Codex `d212cd0`)

Vérifié le 2026-09-25 : erreurs normalisées dans `agent-runner`, événement `step:llm` par appel
(`via`, `model`, `statut`, `latenceMs`, `erreur`), relevé des modèles redemandé par le worker PC
après `rate_limited` ou `quota_exhausted` (`ctx.actualiserModeles`, `bin/orch-worker.js`).

Commencer par une vérification, avant tout code : ce que `query()` du SDK agent rend
quand OmniRoute répond 429 ou 503 (message d'erreur texte ? code ? en-têtes ?). Le SDK
lance la CLI en sous-processus ; les en-têtes `X-OmniRoute-*` ne remontent probablement
pas. Si c'est le cas, relire `/api/usage/call-logs` n'est pas possible sans `manage` :
se contenter du texte d'erreur.

Puis, dans `agent-orchestrator` :

- `normaliserErreurFournisseur(statut, corps)` dans `src/catalogue-modeles.js` :

  | Entrée | Type normalisé |
  |---|---|
  | 429 `model_cooldown` | `rate_limited`, `resetAt = now + reset_seconds` |
  | 429 avec quota épuisé, ou 503 `ALL_ACCOUNTS_INACTIVE` | `quota_exhausted` |
  | 503 `provider_circuit_open` | `provider_down` |
  | 401 `invalid_api_key` | `gateway_unauthorized` (la clé du cockpit, pas le fournisseur) |
  | modèle inconnu ou retiré | `model_unavailable` |
  | autre | `unknown` |

- L'étape en échec porte ce type dans l'event store ; le run passe en `waiting_quota`
  comme aujourd'hui pour Claude. Pas de bascule vers un autre modèle.
- Déclencher un nouveau relevé après une erreur `quota_exhausted` ou `rate_limited`, pour
  que le sélecteur se mette à jour sans attendre le minuteur.
- Journal structuré par étape : `{via, model, statut, latenceMs, erreur}`. Jamais de clé,
  d'en-tête d'autorisation ni de corps de réponse complet.
- Coût : quand OmniRoute sert, `total_cost_usd` du SDK est une estimation au tarif public
  (AUDIT C12). L'afficher comme « équivalent », comme le reste de `/api/usage`.

### Étape 4 : chat (§11.7), première tranche faite le 2026-09-25

Livré (moteur `a35dd3d`, `fe6d3a2`, `6b81bc1` ; cockpit, commit de ce jour) :

- Stockage : `chat_threads`, `chat_messages`, commande `chat.respond`, usage du mois à part.
- `agent-orchestrator/src/chat.js` : réponse de Claude en flux (`includePartialMessages`),
  sans aucun outil, sans réglage de projet, dans un dossier vide. Le contexte du cockpit
  (15 derniers runs, machines, usage) arrive en instantané lecture seule dans le prompt.
- Runner : deux boucles, `run.start` et `chat.respond` (`prendreCommande({ kinds })`) ; une
  question n'attend plus la fin d'un run.
- Cockpit : `GET/POST /api/chat`, `GET /api/chat/<id>`, `POST /api/chat/<id>/messages`,
  mêmes contrôles d'écriture que `POST /api/runs`, une réponse à la fois par fil, plafond
  `COCKPIT_CHAT_PLAFOND_USD` (10 $ par défaut), modèle `COCKPIT_CHAT_MODELE` (`sonnet`).
- Front : vue `/demander` et `/demander/<id>`, liste des fils et conversation côte à côte
  sur grand écran, empilées sur téléphone ; relecture du fil chaque seconde pendant une
  réponse ; maquette dans `mock/chat.ts`.
- Vérifié de bout en bout en local avec le vrai Claude : question posée par l'API, prise par
  le runner, réponse fondée sur la base, refus explicite de lancer un run.

Constat en passant, corrigé pour tous les agents (`6b81bc1`) : sur une machine connectée à
claude.ai, le CLI ajoutait les connecteurs du compte (Gmail, Drive, Notion…) à chaque agent,
`tools: []` compris. 140 k tokens par appel (0,28 $ pour une phrase) et des outils
d'écriture hors périmètre. `strictMcpConfig` avec `mcpServers: {}` les retire (0,0016 $).
Ça concernait aussi les agents de pipeline sur le worker PC.

Deuxième tranche, faite le 2026-09-25 (moteur `1c477be`, `9f81dcd`) :

- Serveur MCP `cockpit-read` dans le processus du runner : `list_runs`, `get_run`,
  `get_step_log` (journal lisible, 200 lignes et 20 000 caractères au plus, filtre par mot) et
  `get_state`. Aucun outil n'écrit. Un journal resté sur le PC est signalé comme tel.
- Bouton « Expliquer cette étape » dans le détail d'une étape : ouvre `/demander` avec la
  question pré-remplie, jamais envoyée sans clic.
- Vérifié en réel : pour citer le test en échec, le chat a lu le journal par `get_step_log`
  (0,014 $ la réponse, haiku).

Troisième tranche, faite le 2026-09-26 :

- `GET /api/chat/<id>/flux` (`src/flux-chat.js`) : flux SSE propre au fil, sondé toutes les
  250 ms côté serveur, envoyé seulement quand le fil change, refermé par le serveur une fois
  la réponse finie. Le front l'écoute pendant une réponse et revient à la relecture chaque
  seconde si le flux tombe. Vérifié dans un navigateur réel : une connexion par réponse.
- Correctif : `/demander` n'était pas dans la liste des routes du front servies par le
  cockpit. L'URL directe et le rechargement rendaient 404 ; la maquette sous Vite le masquait.

Reste pour les tranches suivantes :

- `vault-search` et le contexte `_context/` du projet sélectionné. Préalables : le miroir du
  vault sur le NAS (§7.6, pas construit) et la décision de Raphaël sur les dossiers envoyés à
  Claude (question ouverte 2 de la spec).
- Lire les journaux des étapes exécutées sur le PC (aujourd'hui : signalés absents du NAS).
- Un seul réglage du modèle du chat : le cockpit affiche `COCKPIT_CHAT_MODELE` et le runner
  l'applique, chacun depuis son environnement. Les deux valent `sonnet` par défaut.
- Le sélecteur multi-modèles du chat reste différé : tant qu'OmniRoute dépend du PC, Claude
  est le seul backend du mode permanent. Aucun modèle OmniRoute n'est substitué quand le PC dort.

## Ce qu'il ne faut pas faire

- Retirer `strictMcpConfig` d'`agent-runner` : les connecteurs claude.ai reviendraient dans chaque agent.
- Utiliser ou stocker une clé OmniRoute `manage`.
- Donner une clé quelconque au service `cockpit`.
- Écrire une branche de code par fournisseur (`if provider === ...`).
- Déduire un quota ou une capacité du nom d'un modèle.
- Basculer vers un autre modèle après une erreur, hors combos.
- Afficher les 1000 entrées du catalogue brut comme utilisables.
- Réécrire la navigation, le lanceur ou le runner au-delà de ce qui est décrit.

## Tests attendus

Déjà couverts : filtrage par connexion active ; héritage épuisé, limité, inconnu ; scope
absent ; passerelle muette et refus ; joker de lancement ; route `/api/modeles` derrière le
contrôle d'identité ; refus d'un backend injoignable ; classement du sélecteur (épuisé,
sans outils, runner sans OmniRoute, recherche multi-mots).

À ajouter avec l'étape 3 : chaque ligne du tableau de normalisation ; une étape en
`rate_limited` passe le run en `waiting_quota` sans changer de modèle ; un relevé est
redemandé après une erreur de quota ; un fournisseur en panne n'empêche pas les autres
d'apparaître utilisables dans le relevé suivant.

## Critères d'acceptation

- Le cockpit montre les modèles réellement utilisables par le runner, groupés par
  fournisseur, avec recherche, capacités, et raison et reprise pour les indisponibles.
- L'âge du relevé est visible ; un relevé périmé ou une passerelle muette se voit.
- Aucun quota n'est inventé ; `inconnu` s'affiche comme tel.
- Un run lancé avec un modèle choisi l'utilise sur tous ses nœuds agents.
- Un backend injoignable est refusé avant la mise en file.
- Une erreur de quota à l'exécution met le run en attente et met à jour le relevé.
- Aucune clé dans le service cockpit, aucune clé `manage` nulle part.
