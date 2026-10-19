# Spec : fraîcheur du dépôt et suivi des PR pendant un run

## Objectif

Pendant un run de développement, chaque session doit savoir si la branche par défaut du
projet a avancé et connaître les livraisons/PR ouvertes qui concernent ce dépôt. Le run ne
doit pas continuer à développer sur une base périmée sans le savoir.

## Hypothèses et choix

- Le périmètre est le dépôt GitHub du projet choisi pour le run.
- La branche par défaut fusionnée est la seule source de code à intégrer automatiquement.
- Les PR suivies dans l'event store sont présentées comme des métadonnées (numéro, URL,
  statut, raison, état CI, branche et SHAs tête/base) ; leur code n'est jamais importé.
- Le suivi des livraisons reste centralisé dans le cockpit/publieur. Les sessions reçoivent
  un résumé ciblé aux frontières d'étapes, pas une boucle de polling GitHub chacune.
- Si la branche par défaut a avancé, la run branch est synchronisée à une frontière sûre,
  avant la prochaine étape qui modifie ou révise du code. Si la synchronisation crée des
  conflits, le run s'arrête sur un état d'attente explicite avec les SHAs et les fichiers
  concernés ; il ne poursuit pas silencieusement sur l'ancienne base.

## Commandes et stack

- Cockpit : Node.js, event store SQLite et publieur déjà chargé du suivi GitHub.
- Moteur : agent-orchestrator et worker qui préparent les branches de run et exécutent les
  étapes d'agent.
- Commandes de validation existantes : `npm test`, `npm run web:test`, `npm run web:build`.
- Validation du moteur : commandes CI définies par le dépôt `agent-orchestrator`.

## Comportement attendu

1. Au démarrage, enregistrer le dépôt, la branche par défaut et son SHA de base pour le run.
2. Avant toute étape de développement ou de revue, rafraîchir l'état de la branche par
   défaut et les métadonnées des PR/livraisons suivies pour le projet.
3. Si la base n'a pas changé, fournir à la session le snapshot courant et continuer.
4. Si la base a avancé, intégrer le nouveau commit fusionné à la branche du run avant de
   lancer la prochaine étape, puis transmettre à la session les anciens/nouveaux SHAs, le
   résumé des changements et les PR/livraisons pertinentes.
5. Si l'intégration échoue, bloquer l'étape suivante dans un état durable visible dans le
   cockpit. La reprise doit retenter le contrôle et ne pas perdre le checkpoint précédent.
6. Une PR non fusionnée reste un signal de coordination. Son code n'est intégré qu'après
   fusion dans la branche par défaut ou si l'objectif référence explicitement cette PR comme
   dépendance.
7. Le contrôle se répète après une reprise de quota ou de worker, avant le prochain lot
   d'étapes. À la publication, l'attestation teste/revue doit encore couvrir l'arbre livré ;
   le gate GitHub vérifie la CI sur le merge ref courant. Si la base change après le dernier
   stage, la fusion est bloquée et l'agent n'est pas relancé automatiquement.

## Structure concernée

- `src/suivi-livraisons.js` et l'API GitHub : source centralisée des états PR et livraisons.
- Les contrats d'événements et de run dans `agent-orchestrator/packages/schemas/` et son
  event store : snapshot de fraîcheur, événements de changement et état d'attente.
- Le cycle d'étapes/checkpoints et la préparation des dépôts dans `agent-orchestrator/src/` :
  contrôle/synchronisation aux frontières sûres et injection du résumé dans le message agent.
- Cockpit : projection du snapshot, des changements intégrés et des conflits sur la page du
  run, avec l'état bloquant et une action de reprise appropriée.

## Contrat de données minimal

- Projet, dépôt GitHub, branche par défaut, SHA de base observé et heure de lecture.
- RunId et SHA effectivement intégré à la branche de travail.
- PR ouvertes pertinentes : numéro, URL, titre, branche source, SHA de tête, état CI et
  dernière mise à jour.
- Historique append-only des contrôles : base avancée, synchronisation réussie/échouée,
  fichiers conflictuels et message destiné à la session.
- Aucune donnée d'authentification ni contenu de patch de PR non fusionnée.

## Stratégie de validation

- Dépôt distant simulé : run neuf démarre sur la tête par défaut observée.
- Run en cours : un commit arrive sur la branche par défaut ; le prochain stage reçoit la
  nouvelle base et la branche de run l'intègre avant l'exécution.
- Conflit : l'étape ne démarre pas, l'attente survit au redémarrage et le checkpoint reste
  reprenable.
- PR ouverte non fusionnée : ses métadonnées sont visibles dans le contexte, aucun commit
  n'est importé.
- Reprise quota/worker : le contrôle de fraîcheur est relancé avant l'étape reprise.
- Pré-publication : la branche est contrôlée contre la dernière base et ne peut être livrée
  avec une base obsolète non signalée.
- Vérifier les permissions GitHub minimales et que le code non fusionné n'est jamais exécuté
  par le service de suivi.

## Limites et règles

- Toujours séparer l'état d'exécution du run de l'état de livraison de sa PR.
- Toujours signaler aux agents les commits fusionnés depuis leur dernier snapshot.
- Ne jamais importer le code d'une PR ouverte sans dépendance explicitement choisie.
- Ne jamais continuer silencieusement sur une base dont l'intégration a échoué.
- Garder les lectures GitHub centralisées et limiter les métadonnées au projet du run.

## Critères de réussite

1. Chaque session reçoit avant chaque lot d'étapes l'état des PR/livraisons suivies du
   dépôt du projet et le SHA de la base courante.
2. Après une fusion sur la branche par défaut, le run intègre cette version avant son prochain
   stage de code ou de revue, ou passe à un état d'attente visible en cas de conflit.
3. Les PR encore ouvertes sont visibles comme contexte, sans que leur code soit récupéré.
4. Une reprise après quota ou redémarrage vérifie de nouveau la fraîcheur avant de continuer.
5. À la publication, l'attestation et le gate de CI empêchent la fusion d'un arbre différent
   ou testé sur une base dépassée. Une relance automatique de la revue en cas d'avance de la
   base après le dernier stage est explicitement hors de ce premier lot.

## Décision de reprise

En cas de conflit ou d'impossibilité de lire la branche par défaut, le cockpit met le run en
`waiting_freshness` et propose une reprise manuelle du même run. La correction du conflit ou
le rétablissement du dépôt précède la reprise ; aucune étape ne démarre sur la base bloquée.
