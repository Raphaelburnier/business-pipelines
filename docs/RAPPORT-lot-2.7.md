# Lot 2.7 — reprise au retour du worker

## Résumé

Un run suspendu pour une indisponibilité temporaire reprend quand le maître confirme
que son worker est connecté et libre. La reprise conserve le run, la mission figée,
le workspace et les étapes réussies. Elle est dédupliquée et bornée à trois tentatives
pendant 24 h ; les décisions d'approbation restent dans leur file courte. Les tests
automatisés passent. La dernière étape est de contrôler cette version après livraison.

## Changement

- Le moteur enregistre une attente machine durable à la sortie de la CLI, puis crée
  une commande `run.resume` lorsque le worker est disponible. Une attente interne de
  réveil ne crée pas de seconde CLI.
- Le maître exige une vraie connexion, le message `hello` et l'absence d'étape en cours.
  Une ancienne ligne « online » en base ne suffit pas.
- La reprise a priorité sur les nouveaux départs et reste exclusive avec les autres CLI.
  Une commande dont le worker disparaît attend de nouveau, sans relancer une CLI.
- Les attentes historiques conservent leur date limite. Les erreurs définitives et les
  étapes perdues ne sont pas rejouées automatiquement. Les limites de compte quota
  restent distinctes du compteur de reprise machine.
- Le runner attend que son maître permanent soit prêt. Ses enfants ne prennent plus
  eux-mêmes le port 4650 : ce chemin de conflit `EADDRINUSE` est supprimé.
- Le cockpit explique l'attente du worker sans la présenter comme une attente quota.
  Le lot 2.6 reste terminé ; le lot 2.7 quitte le catalogue des travaux attribuables.

## Vérifications

- Moteur : `npm test`, **346 tests et typecheck réussis**.
- Intégration ciblée : **18 tests réussis**, dont la reprise machine après redémarrage,
  la conservation du contrat malgré une fiche projet devenue invalide, un seul run,
  un script préparatoire exécuté une seule fois et aucun second maître dans la CLI.
- Disponibilité du worker testée avec un vrai WebSocket sur la boucle locale.
- Cockpit : `npm test` complet réussi ; catalogue et Atelier : **54 tests réussis**.
- Web : **74 tests**, typecheck et construction réussis.

Un premier passage local du moteur a dépassé les 5 s d'un test existant de vérification
de projet. Le scénario isolé puis la suite complète repassent avec les limites d'origine ;
aucun test n'a été retiré et aucun délai de vérification n'a été augmenté dans le dépôt.

Les recettes utilisent des bases et workspaces temporaires. Le transport du worker est
déterministe dans la recette du runner ; le vrai transport est couvert séparément par
les tests WebSocket. Aucun fournisseur de modèle ni run de production n'est appelé.

## Portée et suite

Spécification : [SPEC-reprise-machine.md](SPEC-reprise-machine.md).
Le lot ne promet pas la reprise des runs `failed` ni d'une étape distante dont le résultat
est perdu. La reprise de quota sans échéance relève du lot 2.8. La version du moteur
et celle du cockpit doivent être livrées ensemble ; le statut GitHub seul ne prouve pas
que cette version est exécutée sur le NAS.
