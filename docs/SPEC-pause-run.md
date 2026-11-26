# Pause d'un seul run

Statut : contrat validé par Raphaël le 26 novembre 2026. L'implémentation attend son étape au TaskBoard et le plafond de 18.11.
Origine : étape 10.4, dont le détail réserve « la pause d'un seul run » à un contrat de commande validé à part.

## Résumé

- Objectif : suspendre un run précis depuis le cockpit, puis le reprendre plus tard au même point, sans perdre le travail déjà payé et sans toucher aux autres runs.
- Décision : une pause « douce ». Le run termine le lot d'étapes en cours, s'arrête au point de contrôle suivant de l'exécuteur, et devient une attente de plus dans `run_waits`. La reprise passe par le chemin existant `run.resume`, comme après un quota.
- Contrat nouveau : une commande `run.pause { runId }`, deux événements, un code de sortie 80, une cause d'attente `paused` et un champ `pause` dans la liste des runs.
- Prochaine étape : contrat validé le 26 novembre ; une étape du TaskBoard porte l'implémentation, et le plafond de 18.11 décide quand elle démarre.

## Besoins

### Fonctionnels

1. Mettre en pause un run vivant depuis le tiroir Activité et depuis la page du run.
2. Voir l'état sans ambiguïté : « Pause demandée » tant que le run finit son lot d'étapes, puis « En pause », avec qui l'a demandée et depuis quand.
3. Reprendre le même run : même mission, même dossier, mêmes étapes acquises.
4. Arrêter un run en pause ou en pause demandée (l'arrêt garde la priorité).
5. Un run en pause ne repart jamais seul, même si son quota se rétablit.

### Non fonctionnels

- Durable : la demande et l'état survivent à un redémarrage du runner, du maître ou du NAS.
- Aucune perte de travail : pas d'interruption d'une CLI en cours d'écriture.
- Même frontière de sécurité que l'arrêt : identité tailnet, droit d'opérateur, origine vérifiée.
- Coût négligeable : quelques runs vivants, un seul opérateur.

### Contraintes

- Le format des commandes est un contrat partagé : `packages/schemas/commandes.js` (moteur) est un fichier sensible ; `bin/cockpit.js` et `bin/commande-runner.js` aussi. Fusions explicites par Raphaël.
- Ne rien changer au protocole entre maître et workers.
- Réutiliser ce qui existe et a déjà une recette : `run_waits`, `run.resume`, `AttenteRun`, `ControleRun`.

## Vue d'ensemble

```
 Cockpit (navigateur)          Cockpit (serveur)             Runner (NAS)                    Processus du run (orch.js)
 --------------------          -----------------             ------------                    --------------------------
 « Mettre en pause »  --POST /api/runs/:id/pause-->  commande run.pause (file SQLite)
                                                    boucle des contrôles
                                                    demanderPause(commande)
                                                      |- run sans processus vivant :
                                                      |    attente convertie en pause,
                                                      |    statut paused, run.paused
                                                      '- run en cours :
                                                           marqueur run.pause_requested  ---->  point de contrôle entre deux lots :
                                                                                                PauseOperateur, sortie 80,
                                                                                                attente paused, statut paused
 « Reprendre le même run » --POST /api/runs/:id/reprise--> attentes.demander -> run.resume --> relance --resume (chemin existant)
```

Le maître et les workers ne voient rien de nouveau : une étape déjà distribuée se termine normalement, et la pause intervient avant la distribution du lot suivant.

## Comportement détaillé

### Point de contrôle dans l'exécuteur

Dans la boucle de `src/graphe.js`, juste après `sauver()` et avant `controlerBudget()` et l'actualisation de la base, l'exécuteur lit `store.controle.pauseDemandee(runId)`. Si la pause est demandée, il lève `PauseOperateur` avec `codeSortie = 80`. L'état du graphe vient d'être sauvé et aucune étape n'est en vol : la reprise recalcule les mêmes nœuds prêts.

Un lot d'étapes parallèles (revue et revue sécurité, par exemple) se termine entièrement avant la pause.

### Sortie du processus

`bin/orch.js` traite `PauseOperateur` comme les autres attentes : événement `run:paused`, `attentes.mettreEnPause(runId, { par, commandeId })`, statut `paused`, `finalize("paused")`, code 80. Le runner du cockpit ajoute 80 à `CODES_ATTENDUS`.

Toute attente enregistrée alors qu'une pause est demandée devient une pause. Si un quota tombe pendant le lot, la sortie 75 enregistre l'attente de quota, puis la convertit en pause et garde la cause d'origine dans `cause.precedente`. Sans cette règle, la reprise automatique au reset du quota relancerait un run que l'opérateur a voulu arrêter.

### Demande sur un run sans processus vivant

Un run est « sans processus vivant » quand aucune commande `run.start`, `run.resume`, `run.reverify` ou `approval.decide` n'est `pending` ou `taken` pour lui. C'est le test déjà utilisé par `reconcilier()`. Dans ce cas, `demanderPause` convertit tout de suite l'attente en pause, dans une transaction `BEGIN IMMEDIATE`. Cela couvre les runs en `waiting_quota`, `waiting_auth`, `waiting_freshness` et en `waiting_machine` sans CLI active.

### États autorisés

| Statut du run | Effet de `run.pause` |
|---|---|
| `running` | marqueur ; pause au prochain point de contrôle |
| `waiting_quota`, `waiting_auth`, `waiting_freshness`, `waiting_machine` sans processus vivant | pause immédiate |
| `waiting_machine` avec processus vivant (worker en réveil) | marqueur ; pause au prochain point de contrôle |
| `waiting_approval` | marqueur ; la décision relance le run, qui se met en pause avant le lot suivant |
| `queued` | refus : la pause globale des démarrages couvre ce cas |
| `paused` ou marqueur déjà posé | acquitté sans effet (idempotent) |
| `succeeded`, `failed`, `cancelled`, ou arrêt demandé | refus : « run terminé ou arrêté » |

### Reprise

« Reprendre le même run » appelle la route existante `POST /api/runs/:id/reprise` avec le `waitId` de la pause. `attentes.demander` accepte désormais le statut `paused`. La commande `run.resume` est créée avec `automatique: false`, puis `run.resume_requested` est émis : il efface le marqueur. Le runner relance `--resume`, et la fraîcheur de la branche est revérifiée avant le lot suivant, comme après toute reprise.

Une pause demandée mais pas encore effective ne se reprend pas en v1. Il faut attendre l'état « En pause », ou arrêter le run.

### Interactions

- `run.cancel` garde la priorité. Un run en pause n'a aucune étape en vol ; `finaliserAnnulation` le passe à `cancelled`. Une commande `run.pause` encore en file pour un run arrêté est refusée.
- La pause globale bloque déjà les départs de `run.resume` : une reprise demandée pendant la pause globale attend sa levée.
- La réserve de quota est inchangée ; la reprise d'une pause passe par `reserveQuota.verifier` comme toute reprise.
- Le nettoyage des dossiers (18.15) ne touche pas un run en pause, qui n'est pas terminé.
- Pour le plafond 18.11, un run en pause reste vivant et visible dans « En attente ».

## Contrat validé

### Commande

`run.pause` avec la charge `{ runId: string }`, non signée comme `run.cancel` et `execution.pause` : le runner qui la consomme ne détient pas la clé HMAC. Ajout au schéma `packages/schemas/commandes.js`.

Acquittement : `done` avec `detail.effet` à `"immediat"` (attente convertie) ou `"fin-du-lot"` (marqueur posé) ; `refused` avec la raison pour les refus du tableau ci-dessus.

### Route du cockpit

`POST /api/runs/:id/pause`, corps `{}`. Mêmes garde-fous que `/annuler` : droit d'opérateur (`peutFusionner`), origine, identité. Réponses : 202 `{ id, statut }`, 403, 404 (run inconnu), 409 (statut refusé, avec le message).

### Événements

- `run.pause_requested { par, canal, commandeId }` : le marqueur durable. `pauseDemandee(runId)` est vrai si un tel événement existe sans `run.resume_requested` plus récent pour ce run.
- `run.paused { waitId, effet, causePrecedente }` : la pause est effective.

### Attente

Ligne `run_waits` avec `cause.statut = "paused"`, `cause.par`, `cause.depuis`, `cause.precedente` (facultatif), `next_retry_at = NULL`, `max_attempts = 0`. La colonne `deadline` étant obligatoire, elle vaut `first_wait_at` plus 365 jours ; aucune reprise automatique ne la lit pour une pause.

Schéma `cockpit.run.attente.statut` : ajout de `"paused"` ; `actions: ["reprendre"]`.

### Liste des runs

Champ optionnel `pause { commandeId, statut, raison, effet }`, sur le modèle de `annulation`. Présent tant que le marqueur est actif ou que la dernière demande est en file ou refusée. Il permet d'afficher « Pause demandée » après une fermeture du tiroir ou un rechargement, sans refaire le défaut corrigé par #312.

### Code de sortie

80 (`SORTIE_PAUSE`) dans `bin/orch.js`, ajouté à `CODES_ATTENDUS` de `bin/commande-runner.js`.

## Interface

- Tiroir Activité et page du run : bouton secondaire « Mettre en pause » sur les runs des statuts autorisés, sans question de confirmation, car l'action se défait. Toast : « Pause demandée : le run s'arrêtera à la fin de l'étape en cours. »
- Pendant le marqueur : bouton désactivé « Pause demandée… » et la mention « effective à la fin de l'étape en cours ».
- En pause : section « En attente », pastille « En pause », texte « Mis en pause par <identité> depuis <heure> » dans `AttenteRun`, bouton « Reprendre le même run » existant.
- « Arrêter ce run » reste disponible dans tous ces états.

## Pannes et reprises

| Situation | Comportement |
|---|---|
| Runner redémarré avec le marqueur posé | le marqueur est un événement ; le run repris s'arrête au prochain point de contrôle |
| Runner redémarré pendant la conversion d'une attente | transaction unique ; ni demi-pause ni reprise automatique |
| Étape distante perdue pendant le lot | chemin existant (`EtapePerdue`, `waiting_machine`) ; la pause s'applique ensuite par la règle de conversion |
| Deux demandes de pause | la seconde est acquittée sans effet |
| Pause et arrêt simultanés | l'arrêt l'emporte ; la pause est refusée ou effacée par l'annulation |
| Run en pause pendant des jours | il reste visible ; aucune expiration en v1 |

## Charge

Un opérateur, moins de dix runs vivants. Coûts ajoutés : une requête indexée par `run_id` à chaque point de contrôle (comme `annulationDemandee`), une requête par run dans la liste (comme `annulation`). Rien à dimensionner.

## Compromis

| Choix | Retenu | Écarté | Raison |
|---|---|---|---|
| Moment de la pause | fin du lot d'étapes | interruption immédiate de la CLI | pas d'écriture coupée ni d'étape payée pour rien ; pas de `step.cancel` ni de confirmation distante. En contrepartie, l'effet peut attendre jusqu'à la durée d'une étape (15 minutes par appel natif). L'arrêt reste l'outil de l'urgence. |
| État de pause | une cause de plus dans `run_waits` | une table ou une commande `run.unpause` dédiées | la reprise, son idempotence, sa revérification et son écran existent et ont une recette |
| Marqueur | événement `run.pause_requested` | colonne sur `runs` | même modèle que l'annulation : durable, daté, lisible dans la chronologie |
| Reprise d'une pause demandée | refusée en v1 | « annuler la demande de pause » | évite une commande de plus ; le cas reste rare |
| Signature | non signée | HMAC | même niveau que `run.cancel` ; le runner n'a pas la clé |

## À revoir avec l'usage

- Mesurer le délai réel entre « pause demandée » et « en pause » sur les pipelines existants. S'il est souvent trop long, envisager l'interruption immédiate en réutilisant l'arrêt des étapes et la reprise de session.
- Alerte ou rappel pour un run en pause depuis plusieurs jours.
- Pause d'un run encore en file (`queued`), si la pause globale ne suffit pas.

## Vérification prévue

- Moteur (vitest) : marqueur et effacement, point de contrôle avec un lot parallèle, sortie 80, conversion d'une attente survenue pendant le lot, absence de reprise automatique, reprise manuelle, arrêt d'un run en pause, redémarrage avec marqueur.
- Cockpit : route (403, 404, 409, 202), code 80 attendu, champ `pause` de la liste, tests du front.
- Recette Playwright sur le vrai serveur et une base temporaire, avec le harnais de la recette 10.4 : pause pendant un lot, pause d'une attente, rechargement, reprise, arrêt d'un run en pause, opérateur sans droit.
- Recette réelle après livraison : mettre en pause un run improve-app entre le plan et l'implémentation, puis le reprendre.

## Livraison

1. PR moteur : `src/graphe.js`, `bin/orch.js`, `src/controle-execution.js`, `src/run-waits.js`, `packages/schemas/commandes.js` (sensible), `packages/schemas/cockpit.js`, `docs/QUOTAS-REPRISES.md`.
2. PR cockpit : `bin/cockpit.js` (sensible), `bin/commande-runner.js` (sensible), `src/api-lecture.js`, front, `docs/SECURITE-COMMANDES.md` si la liste des commandes non signées y est tenue.
3. Fusions explicites par Raphaël, moteur d'abord. Livraison demandée depuis le cockpit, puis mise à jour du worker PC.

## Hors périmètre

Interruption immédiate d'une étape, pause de plusieurs runs à la fois, pause d'un run en file, changement du protocole maître-worker.
