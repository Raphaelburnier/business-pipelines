# Lot 2.6 — Délais des opérations qui occupent les files

Statut : proposition à valider avant implémentation.
Date : 23 octobre 2026.
Bases examinées : cockpit `b74e0f7`, moteur `92c60a9`.

## Résumé

Le lot doit libérer les files lorsqu'une opération est réellement bloquée, sans
interrompre un run long qui progresse normalement. Le seuil de 6 h devient un contrôle
diagnostique, pas un ordre d'arrêt. L'orchestrateur surveille la progression et décide
des arrêts sur des signaux vérifiables ; un agent de supervision peut aider au
diagnostic, sans pouvoir arrêter seul un run. Le choix d'un plafond absolu distinct
reste à valider.

## Objectif et périmètre

Une opération réellement bloquée ne doit pas monopoliser indéfiniment une file. Les
durées maximales des appels et sous-processus bornent les opérations individuelles ;
la surveillance d'un run distingue le temps écoulé de l'absence de progression. Un run
long qui progresse normalement continue. Un arrêt n'est demandé que sur des signaux de
blocage ou de boucle documentés ; sa cause reste visible et la suite reprend lorsque
l'arrêt est confirmé. Un arrêt non confirmé devient un incident explicite, jamais un
succès ni une relance automatique susceptible de doubler le travail.

Le lot couvre les points nommés par la feuille : CLI `orch.js`, scripts externes du
graphe, Git du moteur/publieur/livreur/conseiller, HTTP du publieur et du conseiller,
et chaîne `deploy.sh`. Il réalise une capacité commune de limitation des opérations ;
les files de runs, d'approbations, de chat, du publieur et du livreur restent distinctes.

Ne font pas partie de ce lot : reprise automatique `waiting_machine` (2.7), reprise
quota (2.8), préemption d'un run prioritaire, interface Pause/Stop, nouveaux budgets
métier, refonte de l'isolation des agents. La garantie vise Linux/WSL, plateformes du
NAS et du worker actuel ; l'arrêt d'un arbre de processus Windows natif n'est pas promis.

## Constats vérifiés

- `bin/commande-runner.js` attend `close` de `orch.js`, sans échéance et sans arrêt forcé.
- `src/graphe.js::lancerCommande` attend un script sans durée maximale.
- Plusieurs appels Git de `src/checkpoints.js`, `src/publieur.js`, `src/livreur.js`
  et `bin/conseiller-pc.js` n'ont pas de borne.
- `src/publieur.js::apiAvec` ne fournit pas de signal de délai à `fetch`, puis lit le JSON.
- Le conseiller possède déjà 30 s vers le cockpit et 120 s par appel Ollama : ces
  protections sont à vérifier/conserver, pas à remplacer arbitrairement.
- Le script de livraison possède un contrôle de santé partiellement borné, mais pas
  la construction, les commandes Docker ou la restauration.
- Sonde réelle locale : à 1 521 ms, `runtime-process` rend `LimiteExecution` alors
  qu'un enfant ignorant SIGTERM survit à la sortie du parent. Les processus temporaires
  ont ensuite été nettoyés explicitement. Aucune opération de production ni modèle.

Les graphes AST ont été interrogés avec `--context call --budget 1200`, puis les
conclusions ont été confirmées dans les sources des deux worktrees. L'outil local
`graphify-code` applique déjà `--no-label` dans son wrapper.

Référence technique : la documentation [Node 22, child_process](https://r2.nodejs.org/dist/v22.19.0/docs/api/child_process.html#child_processexecfilesyncfile-args-options)
précise qu'un timeout synchrone utilisant SIGTERM peut encore attendre si le processus
intercepte ce signal. Ajouter seulement `timeout` ne suffit donc pas à garantir l'arrêt.

## Bornes proposées

Ces valeurs sont des défauts configurables côté opérateur, pas des durées imposées par
un contenu de mission. Les essais injectent des délais courts. Valeurs nulles, négatives,
non finies ou supérieures au maximum : erreur de configuration explicite avant lancement.
Aucun réglage `0` ne désactive silencieusement une protection.

| Opération | Défaut | Maximum configurable | Comportement à l'échéance |
|---|---:|---:|---|
| HTTP GitHub du publieur | 30 s | 120 s | Annuler la requête et la lecture du corps ; erreur typée |
| HTTP conseiller vers cockpit | 30 s existantes | 120 s | Conserver l'annulation effective et la cause |
| Un appel Ollama | 120 s existantes | 10 min | Annuler le corps compris ; conserver le seul repli déjà prévu |
| Git, clone/fetch/push compris | 2 min | 30 min | Arrêter l'arbre du processus, erreur contextualisée |
| Extraction/compression d'archive | 5 min | 15 min | Arrêt effectif, aucun succès ni bascule si préparation incomplète |
| Script externe d'un nœud | 15 min | 6 h | Annulation, terminaison du groupe, étape en échec explicite |
| Run dans la file du cockpit | contrôle diagnostique à 6 h | plafond absolu séparé, valeur à valider | Ne pas arrêter sur le seul temps écoulé ; orchestrateur tranche sur l'état et la progression |
| Construction d'une livraison | 45 min | 2 h | Interrompre la construction propre au lot, conserver l'installation active |
| Bascule et contrôle de santé | 10 min | 30 min | Entrer dans la restauration bornée |
| Restauration | 5 min | 15 min | Si non rétablie, incident persistant et suspension des nouvelles livraisons |

Le contrôle diagnostique à 6 h collecte l'étape courante, les transitions récentes,
les heartbeats, les dernières sorties et l'état des processus. Il vérifie si le run a
avancé ou répète les mêmes actions sans progrès. Un heartbeat seul ne prouve pas le
progrès ; les appels longs doivent exposer un état et des signaux d'activité adaptés.
Les attentes quota/approbation qui font sortir la CLI gardent leur fonctionnement
actuel et ne sont pas classées comme blocage.

La surveillance déterministe appartient à l'orchestrateur, qui possède l'état du run
et des étapes. Un agent de supervision peut fournir un diagnostic en lecture seule
lorsque les signaux sont ambigus, mais ne commande jamais seul l'arrêt ni la reprise.
L'orchestrateur arrête uniquement après confirmation d'une stagnation ou d'une boucle
selon des critères testables (absence de transition/progrès sur une fenêtre propre à
l'étape, ou cycle d'actions répétées au-delà d'un seuil configuré). Les seuils et les
signaux précis doivent être fixés avant l'implémentation et testés sur un run long qui
progresse, un processus bloqué et un cycle répétitif.

Un plafond absolu de durée totale, s'il est conservé, est une barrière opérateur
distincte du détecteur de blocage. Sa valeur et son comportement restent à valider ;
il ne peut pas être présenté comme une preuve qu'un run tourne en rond.

Les commandes utilitaires Docker et Git d'une phase ont aussi leur propre borne ;
une phase globale ne dispense pas de borner la commande sur laquelle elle attend.
Les futures variables et leurs unités seront documentées avec les valeurs ci-dessus.
Les réglages existants de runtime ne sont pas renommés.

## Contrat d'arrêt et résultat observable

1. À échéance, la cause est `LimiteExecution`, distincte d'une annulation opérateur,
   d'un quota, d'un besoin d'authentification et d'un arrêt machine.
2. Pour un processus local, SIGTERM vise le groupe ; SIGKILL suit après la grâce si
   nécessaire. Le nettoyage des enfants n'est pas annulé parce que le parent a fermé
   ses propres flux. La promesse ne vaut pas confirmation d'arrêt tant qu'un enfant
   contrôlé est encore actif.
3. Les chemins de succès, erreur de démarrage, timeout et annulation nettoient timers,
   listeners et verrous une seule fois. Une sortie excessive reste bornée.
4. Aucun `Promise.race` ne suffit à rendre le système fiable : libérer le demandeur en
   laissant son opération continuer n'est pas une réussite du lot.
5. HTTP : la borne couvre réception des en-têtes **et** consommation du corps. Un corps
   bloqué ne devient pas un résultat `null` silencieux après un abort.
6. Git : préserver la forme attendue du résultat, texte ou Buffer. Une migration
   asynchrone ou un exécuteur isolé est à privilégier lorsqu'un simple appel synchrone
   ne permet pas de terminer les descendants. Pas d'arrêt global de processus Git
   appartenant à d'autres travaux.
7. Une écriture distante au résultat incertain n'est pas retentée aveuglément. La
   réconciliation existante par branche/SHA/PR précède une nouvelle mutation.
8. Les sessions, checkpoints et métriques déjà observées sont conservés conformément
   au lot 2.5. Le timeout de la CLI reste visible dans le résultat de commande et ne
   se réduit pas à « code 1 » ou à un faux arrêt demandé par l'utilisateur.
9. Si un arrêt distant n'est pas confirmé dans la grâce, la commande finit en échec
   explicite et l'admission d'un nouveau lancement incompatible est suspendue avec
   sa raison visible. Les autres files continuent. Aucune reprise automatique ajoutée.

## Livraison : précautions propres à la bascule

Un watchdog qui tue brutalement tout le groupe `deploy.sh` peut supprimer aussi sa
restauration. Il ne constitue pas une implémentation acceptable à lui seul.

- Avant bascule : l'installation courante reste servie, les processus/ressources de
  construction du seul lot sont arrêtés et la livraison finit en échec identifiable.
- Après bascule : l'expiration ou un signal de terminaison conduit à la restauration.
  Celle-ci possède son propre budget, indépendant du délai déjà expiré.
- Les commandes de restauration elles-mêmes sont bornées. Un signal ne peut pas être
  converti en code de retour zéro par le trap.
- Si la restauration échoue ou reste non confirmée, le service publie un incident
  persistant et refuse de nouvelles livraisons jusqu'à une levée explicite. Sa boucle
  d'observation continue ; pas de promesse bloquée sans diagnostic.
- Les dossiers d'état, la base vivante, les secrets et les backups existants ne sont
  pas remplacés pour tenter de débloquer un déploiement.
- Aucun arrêt du démon Docker ni de conteneurs sans rapport avec le lot.

Le modèle de déploiement est figé par la protection F3. Sa première mise en service
modifiée devra donc suivre la livraison manuelle autorisée ; le livreur ne chargera
pas le nouveau modèle depuis une PR simplement parce qu'elle est fusionnée.

## Code et structure

Stack conservée : Node 22, CommonJS, SQLite existant, Vitest pour le moteur, tests Node
pour le cockpit. Aucune nouvelle dépendance ni migration de base n'est prévue.

Zones à couvrir (inventaire, pas obligation de modifier chaque fichier) :

| Dépôt | Zone | Responsabilité |
|---|---|---|
| Moteur | `src/runtime-process.js` | Arrêt confirmé, descendants, buffers et cause |
| Moteur | `src/graphe.js` | Script externe borné et statut d'étape |
| Moteur | `src/checkpoints.js` et helpers Git employés par le run | Git borné |
| Cockpit | `bin/commande-runner.js` | Durée CLI, grâce, résultat durable et libération du lancement |
| Cockpit | `src/publieur.js`, `src/livreur.js`, `bin/conseiller-pc.js` | Git/HTTP et préparation bornés |
| Cockpit | `bin/livreur.js`, `deploy/nas/deploy.sh.modele` | Budgets des phases et restauration |

Style : noms de fonctions en français, erreurs structurées, modules CommonJS, injection
des processus/réseaux pour les tests. Exemple de contrat de caller :

```js
try {
  await executerProcessus({ binaire, args, signal, delaiMs });
} catch (err) {
  reporter.event("operation:failed", { operation, raison: err.name });
  throw err;
}
```

Les informations de diagnostic portent opération, identifiant de run/commande,
échéance, phase et cause. Ne pas enregistrer d'environnement complet, de jeton,
d'en-tête d'autorisation ni d'URL contenant des credentials.

## Commandes de validation

Moteur, depuis sa racine :

```sh
npm ci
npm test
```

`npm test` comprend Vitest et le typecheck du moteur. Les nouveaux cas iront dans
`test/vitest/`, à côté des tests de processus et de graphe existants.

Cockpit, dans un layout où `../agent-orchestrator` correspond au moteur testé :

```sh
npm ci
npm --prefix web ci
npm test
npm run web:test
npm --prefix web run build
sh -n deploy/nas/deploy.sh.modele
```

Les tests de livraison emploient un faux Docker instrumenté et des dossiers temporaires.
Les tests HTTP emploient un vrai serveur local pouvant bloquer les en-têtes ou le corps.
Les essais de processus/Git utilisent de vrais enfants temporaires, y compris un petit-fils
ignorant SIGTERM. Aucun appel modèle ni panne volontaire sur la production n'est requis.

## Critères d'acceptation

- [ ] Un run long qui progresse normalement reste actif au contrôle diagnostique de 6 h.
- [ ] Un run sans progression ou dans un cycle est détecté à partir de signaux observables,
      arrêté par l'orchestrateur et libère la file après confirmation.
- [ ] Un script externe bloqué atteint sa borne, est arrêté et laisse passer la commande
      suivante lorsque l'arrêt est confirmé.
- [ ] Même constat pour le descendant qui ignore SIGTERM alors que son parent sort.
- [ ] Git bloqué n'immobilise plus indéfiniment moteur, publieur, conseiller ou livreur.
- [ ] HTTP bloqué avant/après en-têtes est annulé ; le projet/travail suivant est servi.
- [ ] Les délais déjà présents du conseiller restent effectifs.
- [ ] Une interruption opérateur reste distinguée d'un délai ; identité/session/métriques
      déjà reçues ne disparaissent pas.
- [ ] Livraison avant bascule : échec borné, installation précédente conservée.
- [ ] Livraison après bascule : restauration éprouvée sous son propre délai.
- [ ] Restauration bloquée : arrêt borné, incident persistant visible, pas de nouvelle
      livraison acceptée à l'aveugle.
- [ ] Tests, typecheck et build des deux consommateurs passent sur les SHA exacts.
- [ ] Après les fusions explicitement autorisées, les versions réellement exécutées sur
      NAS/PC et la recette de cette copie sont contrôlées avant de marquer 2.6 fait.

## Limites et validation demandée

À valider : les défauts du tableau et le choix d'une suspension explicite quand l'arrêt
ou la restauration ne sont pas confirmés. Une suspension visible protège les données ;
elle est différente d'une opération laissée en attente sans échéance ni explication.

Pas de changement d'autorité, de politiques de fusion, de secrets, de schéma de base
ou de dépendances sans justification distincte. Aucun timeout configuré depuis un texte
non fiable du modèle. Les PR qui touchent les chemins protégés garderont leur fusion
explicite et la livraison manuelle du nouveau modèle ne sera pas contournée.
