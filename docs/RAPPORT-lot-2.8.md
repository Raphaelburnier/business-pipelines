# Lot 2.8 — reprise après quota

## Résumé

Un run bloqué par quota peut reprendre automatiquement même lorsque le fournisseur
ne donne pas de date. Une tentative est autorisée après cinq heures de prudence, avec
les limites existantes et sans inventer de reset fournisseur. Le planificateur et la
file utilisent la même règle. Les recettes vérifient le même run, sa session, son
workspace et ses étapes réussies, y compris après une ancienne attente de 40 h.
La dernière étape est la vérification de la copie installée après livraison.

## Comportement

- Avec une échéance fiable : attendre cette date et conserver la marge d'une minute
  pour les horaires affichés sans secondes.
- Sans échéance : conserver `resetAt=null` et `resetSource=null`, persister une date
  de tentative distincte cinq heures après le dernier quota.
- Un nouveau quota recommence son délai de prudence ; un redémarrage ne décale aucune
  date et ne remet aucun compteur à zéro.
- Au plus trois reprises automatiques par run et trois par compte/runtime sur 24 h.
  Les limites atteintes demandent une reprise manuelle. Un réglage à zéro reste désactivé.
- Les anciennes attentes sans date adoptent une seule fenêtre de reprise bornée.
  Leur début d'attente et leurs tentatives restent conservés ; une commande en cours
  de rejeu finit d'abord, puis l'attente est réconciliée au prochain passage.
- Le planificateur et Atelier lisent la même date d'admissibilité : aucun des deux
  ne garde un ancien quota sans date bloqué indéfiniment après le délai.
- Authentification, approbations et runs terminés ne sont pas relancés par ce mécanisme.
  Le cas Finance historique `2bf1abcc` est aujourd'hui en échec ; il reste inchangé.

## Vérification et portée

- Moteur : **356 tests et typecheck réussis**.
- Cockpit : suite serveur complète réussie, **63 tests ciblés** de reprise,
  planification et Atelier réussis.
- Web : **74 tests**, typecheck et construction réussis.

La recette utilise le vrai runner et la vraie CLI, avec un fournisseur déterministe
et une base temporaire. Les dates de cette base représentent la fenêtre écoulée :
aucune attente réelle de cinq heures ni appel de modèle payant n'est nécessaire.
Elle vérifie contrat figé malgré une fiche projet devenue invalide, session native,
workspace, fichier partiel, script préparatoire exécuté une seule fois et absence de
double run après plusieurs redémarrages.

Les tests du moteur couvrent aussi les dates connues après minuit, les marges, les
plafonds par compte, l'attente historique, la commande réservée et les bornes désactivées.
Un cas de rejeu a d'abord échoué avant le raccordement de la réconciliation au poller,
puis passe avec ce raccordement.

Le chantier calendrier 12.2 non commité reste séparé. Aucune règle d'arrêt à minuit,
nouvelle dépendance, migration de schéma ni modèle de livraison n'est ajouté.
Les listes des workflows de fusion et de correction CI sont synchronisées avec le
durcissement F13 du moteur : deux chemins d'autorité du chat sont ajoutés. Les contrôles
CI ont détecté la divergence entre dépôts, puis la liste jumelle manquante ; les deux
contrôles restent actifs. La suite serveur complète passe avec le moteur courant
`dbbe8b6`. Cette synchronisation exige une fusion explicite.
La reprise garde les signatures, le contrat de mission et l'acquittement
atomique livrés au lot 2.7.

Spécification : [SPEC-reprise-quota.md](SPEC-reprise-quota.md).
