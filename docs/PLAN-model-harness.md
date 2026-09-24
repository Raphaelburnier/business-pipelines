# Plan : harness de modèles multi-fournisseurs dans le cockpit

Version du 2026-09-24. Remplace le brief générique « Multi-Provider Model Harness for
Cockpit », qui supposait un sélecteur et un chemin d'exécution à créer. Ce plan part de ce
que le code contient réellement. Lire aussi `docs/SPEC-cockpit-agentique.md` §11.7 et
`docs/AUDIT.md` C12 et décisions 5 et 9.

## Objectif

Depuis le cockpit, savoir quels modèles un run peut utiliser maintenant, qui les sert,
avec quelles capacités, s'il reste du quota, et sinon pourquoi et jusqu'à quand. Puis
choisir l'un d'eux au lancement d'un run, et plus tard dans le chat.

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

Reste à faire (Codex) : installer un minuteur systemd utilisateur sur le PC qui lance
`NAS_SSH=<compte@hôte> bin/publier-modeles.sh` toutes les 2 minutes, sur le modèle de
`claude-jobs-repli.timer`. Vérifier que le compte SSH peut écrire dans
`/volume1/docker/business-pipelines/etat/`.

### Étape 2 : cockpit (faite)

`business-pipelines` branche `feat/model-harness` :

- `src/modeles.js` et `GET /api/modeles` : sert le dernier relevé, son âge, `perime`, et
  `viaRunner` (variable `COCKPIT_VIA_RUNNER`, défaut `claude`).
- `POST /api/runs` refuse (400) un `llmOverrides` dont le backend n'est pas dans
  `viaRunner`, avant la mise en file.
- Front : `donnees/modeles.ts` (`classer`, `raisonIndisponible`, `correspond`),
  `vues/SelecteurModele.tsx` (recherche sur nom, identifiant et fournisseur ; groupes,
  combos en tête ; indisponibles repliés avec raison et reprise ; bouton relire),
  intégré au lanceur de `Panneau.tsx`. Le choix part en `llmOverrides: {"*": llm}`.
- Maquette : `mock/modeles.ts` montre chaque cas (`/app/?source=maquette`).
- `bin/publier-modeles.sh` : relevé puis poussée SSH, écriture atomique côté NAS.

Conflit attendu : `Panneau.tsx` est aussi modifié par la refonte de navigation non
committée du worktree `steam-tierlist-run`. Trois ajouts localisés, à reporter à la main.

### Décision du 2026-09-24 : voie A, les runs OmniRoute tournent sur le PC

Tranché par Raphaël. Implémentation confiée à Codex. Les autres voies, pour mémoire :
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
5. Réveil : si `pc` dort, le maître le réveille par WoL (`src/wol.js`) et le run attend en
   `waiting_machine`, comme le prévoit la spec. Jamais de repli silencieux sur `claude`.
6. Cockpit : remplacer `COCKPIT_VIA_RUNNER` par une table par machine, par exemple
   `COCKPIT_VIA_MACHINES=nas:claude;pc:claude,omniroute`, dans `src/modeles.js`. `/api/modeles`
   rend `viaParMachine` et l'état des machines (déjà dans `/api/machines`). `classer()` rend
   un modèle OmniRoute utilisable si `pc` est `online` ou réveillable, et l'annote « réveillera
   le PC » s'il dort. `POST /api/runs` applique la même règle. Étendre
   `modeles.reponse` dans `packages/schemas/modeles.js`.
7. Relevé : garder `bin/publier-modeles.sh` sur un minuteur du PC pour l'instant. Plus tard,
   le worker pourra pousser le relevé par le protocole WebSocket (nouveau type de message),
   ce qui supprime la dépendance SSH.
8. Tests : un nœud `omniroute` part sur `pc` ; `pc` absent refuse le run avant la mise en
   file ; `pc` endormi passe le run en `waiting_machine` puis le reprend ; un nœud `claude`
   reste sur le NAS ; le sélecteur rend OmniRoute utilisable quand `pc` est en ligne.

Critère de fin : depuis le téléphone, choisir `agentic-code` dans le lanceur, lancer
Steam TierList, voir les nœuds agents tourner sur `pc` avec `via: omniroute` dans le détail
du run, et le coût affiché comme équivalent.

### Étape 3 : erreurs à l'exécution et fournisseur réel (Codex, après la voie A)

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

### Étape 4 : chat (§11.7, Codex, après l'étape 3)

Réutiliser `SelecteurModele` et `classer()` tels quels, avec deux différences : le chat ne
demande pas l'appel d'outils du même ordre (MCP en lecture seule), et son défaut est un
modèle économique via OmniRoute. Dépense suivie à part avec plafond mensuel (spec §11.7).
Le modèle choisi se mémorise par fil (`chat_threads`), pas globalement. Au rechargement,
si le modèle mémorisé n'est plus utilisable, le fil l'affiche comme indisponible avec sa
raison et ne lui substitue rien.

## Ce qu'il ne faut pas faire

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
