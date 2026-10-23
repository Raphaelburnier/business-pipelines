# Lot 2.6 — activation et contrôle de la copie installée

## Résumé

Les délais d'opérations sont actifs sur le NAS et le worker PC. Le livreur a été reconstruit
manuellement depuis la version fusionnée ; ses 13 scénarios de déploiement simulés passent
dans l'image installée. Le modèle exact est approuvé et les délais sont configurés. Un run
long reçoit un diagnostic à 6 h et continue. La prochaine étape est la livraison de cette
clôture dans la feuille de route, puis le lot 2.7 sur la reprise `waiting_machine`.

## Versions contrôlées le 24 octobre 2026

| Composant | Version vérifiée |
|---|---|
| Cockpit, runner NAS, publieur | `cee2b0529a5a4f83397d4c44d836fe50e5f03fd9` (PR #170) |
| Moteur NAS et worker PC | `16b787c2ad4cb88cce5404db8dd4eb4c0759f72f` (PR moteur #88) |
| Registre | `ff2c8ea53f74e8224879cb1bb90115bb5051de5c` |
| Image du livreur reconstruite | `sha256:cb0e17744433ccd0b71feec153be03ec531fba78db4cbeb1c22864cd563f300c` |

La release déclarée du NAS était correcte, mais l'ancien livreur exécutait encore une image
de septembre. Sa reconstruction a utilisé le Dockerfile et les sources déjà livrés,
contrôlés par SHA-256. Les six fichiers du nouveau contrôle de livraison correspondent à la
PR #170 ; neuf fichiers cockpit/moteur correspondent aussi dans chacun des conteneurs
runner, cockpit et publieur. Le worker PC annonce la release moteur attendue.

## Contrôles et activation

- PR moteur #88 et cockpit #169/#170 fusionnées avec CI verte ; suites serveur, web,
  typecheck et construction Docker déjà validés.
- Reconstruction et remplacement du seul service `livreur`, depuis le code installé.
- Exécution de `node --test test/deploiement.test.js` dans ce livreur : **13/13 passent**.
  Les cas couvrent succès, erreur avant/après bascule, panne et blocage de restauration,
  interruption pendant la commande, la santé et le handshake, et budget global de phase.
- Les pannes sont simulées avec un Docker factice dans des dossiers temporaires.
  La conservation de `codex/`, des configurations et de l'état est contrôlée dans ces recettes.
- Empreinte approuvée :
  `79bee4c2f75059b56e050b7e33c7567372bf9a2c6716397b649772cca31ef432`.
  Elle couvre le modèle et le compose du commit `cee2b052`.
- Le validateur installé accepte cette empreinte depuis l'ancien modèle `43f889e` et
  retrouve le SHA source approuvé. Il s'agit d'un contrôle de préparation sans bascule.
- Les fichiers d'approbation et de délais sont présents dans `specs/`, en mode 600.
  La clé de signature des commandes est configurée ; aucun incident de livraison n'est présent.

| Réglage | Valeur installée |
|---|---:|
| Construction | 2 700 s |
| Bascule et santé | 600 s |
| Restauration | 300 s |
| Commande utilitaire | 120 s |
| Archive | 300 s |
| Grâce d'arrêt | 5 s |

## Portée

Le seuil de 6 h produit un diagnostic durable ; il ne tue pas un run valide. Les arrêts
reposent sur les bornes des opérations, des tours et des cycles. Les tests de longue durée
injectent des délais courts ; la copie exécutée a été contrôlée par ses empreintes.

Le lot 2.7 reste distinct : reprise programmée après retour du worker et gestion de
`waiting_machine`. Les faits de ce rapport ne valent pas recette métier Finance ou Marketing.
