# Modèle de livraison approuvé et restauration vérifiée

## Résumé

Corriger le chemin d'incident de restauration, puis permettre à Raphaël d'approuver une
version précise du modèle de déploiement et des montages Docker. L'approbation persiste
dans la configuration protégée du NAS et se réutilise tant que leur contenu est identique.
Les délais se règlent sans changement de script. La prochaine étape est la validation par
des pannes simulées, puis la première activation manuelle du livreur mis à jour.

## Décisions validées le 23 octobre 2026

- Conserver la protection de `deploy/nas/` et de `docker-compose.yaml`.
- Enregistrer une approbation opérateur par empreinte SHA-256 des entrées Git protégées
  (chemins, modes et blobs), avec le SHA complet du commit source, l'auteur et la date.
- Une approbation autorise les livraisons suivantes contenant exactement ce même ensemble
  protégé. Un autre contenu exige une autre approbation. Un commit non fusionné reste refusé.
- L'approbation se fait par une commande opérateur sur le NAS ; le fichier reste dans
  `specs/`, non monté dans le runner. Aucune permission supplémentaire donnée aux agents.
- Sans approbation explicite, le modèle actuellement en production garde le comportement F3.
  Le premier livreur capable de vérifier ces approbations se met à jour manuellement.
- Les délais proviennent d'un JSON protégé sous `specs/`, relu par livraison, avec valeurs
  positives et plafonds. Aucune configuration provenant d'une mission ou d'un modèle.

## Correction et garanties

La variable `rollback_code` non définie peut interrompre l'écriture de l'incident avec
`set -u`. La restauration doit conserver la cause initiale, retourner un échec et poser
un incident durable avant de commencer. Seul un retour confirmé des services l'efface.
Le livreur distingue restauration confirmée et incident ; il refuse les nouvelles livraisons
en présence d'un incident et continue à publier son état.

Les budgets construction, bascule et restauration portent sur chaque phase entière.
Les commandes ont aussi leurs limites. L'arrêt vise le groupe créé et attend son nettoyage ;
il ne dépend pas d'une course entre le lancement de `setsid` et le premier contrôle du groupe.
Un signal provoque un code non nul et une restauration sous un budget indépendant.

## Validation

- Exécuter le vrai modèle généré dans des dossiers temporaires avec un faux Docker et un
  faux contrôle HTTP : succès, échec/timeout avant bascule, échec après bascule,
  restauration bloquée et interruption opérateur.
- Vérifier le code effectivement restauré, les dossiers d'état conservés, le code de sortie,
  l'incident durable et la terminaison des enfants ; aucun Docker ni NAS réel sollicité.
- Tester l'approbation manquante, corrompue, révoquée, un SHA non fusionné, un changement
  du modèle/compose après approbation et la réutilisation sur un commit métier ultérieur.
- Tester les limites et la relecture des réglages ; exécuter les suites serveur et la CI.

## Utilisation opérateur

Après fusion et première livraison manuelle du code, recréer le livreur avec
`bin/livrer.sh --livreur` : cette commande construit depuis le code déjà installé sur le NAS,
elle ne copie pas les changements du poste. Le livreur ne se reconstruit pas lui-même.

Depuis le NAS, inspecter puis approuver le **SHA Git complet d'un commit fusionné** :

```sh
sudo docker exec business_livreur node bin/modele-livraison.js inspecter --sha <SHA_COMPLET>
sudo docker exec business_livreur node bin/modele-livraison.js approuver --sha <SHA_COMPLET> --par raphael
```

Le miroir utilisé est `/git/systeme/business-pipelines.git`. L'empreinte couvre l'intégralité
de `deploy/nas/` ainsi que `docker-compose.yaml`, avec chemins, modes et identifiants de blobs.
Le registre `/volume1/docker/business-pipelines/specs/livraison-modeles.json` porte le SHA
source, l'opérateur déclaré et la date. Son écriture est atomique, verrouillée et en mode 600.
Ces commandes nécessitent l'accès opérateur Docker au NAS ; elles ne sont pas des outils du
runner. L'autorité est l'accès au fichier protégé, pas une identité déduite du champ `--par`.

Les livraisons ordinaires restent déclenchées depuis le cockpit. Le livreur vérifie la
signature et l'identité comme avant, puis compare l'ensemble protégé avec l'approbation.
Une version métier ultérieure réutilise l'approbation quand cet ensemble ne change pas.
La source du script exécuté reste le SHA approuvé. Une branche non fusionnée reste refusée.

Révoquer une empreinte empêche de la réutiliser, même si elle est déjà en production :

```sh
sudo docker exec business_livreur node bin/modele-livraison.js revoquer --empreinte <SHA256_COMPLET>
```

Il faut alors une nouvelle approbation explicite ou une autre version approuvée pour livrer.
Une révocation ne redéploie ni n'arrête ce qui tourne déjà. Un registre corrompu bloque le
contrôle ; ne pas l'effacer pour ignorer une révocation. Un verrou laissé après une interruption
se retire seulement après vérification qu'aucune commande d'approbation n'est encore active.

Pour les délais, créer `specs/livraison-delais.json` sur le NAS à partir de
`specs/livraison-delais.json.example`. Le livreur le relit avant chaque livraison ; JSON prioritaire
sur l'environnement, puis valeurs par défaut. L'absence du fichier conserve les défauts ;
un fichier invalide ou une clé inconnue refuse la livraison avant préparation.

| Clé JSON | Défaut (secondes) | Maximum |
|---|---:|---:|
| construction | 2700 | 7200 |
| bascule | 600 | 1800 |
| restauration | 300 | 900 |
| commande | 120 | 1800 |
| archive | 300 | 900 |
| grace | 5 | 30 |

Tous les réglages sont des entiers strictement positifs. Le script manuel accepte les variables
`LIVRAISON_BUILD_TIMEOUT_SEC`, `LIVRAISON_SWITCH_TIMEOUT_SEC`, `LIVRAISON_ROLLBACK_TIMEOUT_SEC`,
`LIVRAISON_COMMAND_TIMEOUT_SEC`, `LIVRAISON_ARCHIVE_TIMEOUT_SEC` et `LIVRAISON_STOP_GRACE_SEC`,
avec les mêmes plafonds. Le chemin manuel ne lit pas le JSON : seuls les lancements du livreur
l'appliquent. Les réglages ne changent pas l'empreinte approuvée du modèle.

En cas de restauration non confirmée, `etat/incident-livraison` reste présent. Le livreur publie
la suspension et refuse les nouvelles livraisons ; l'état de la tentative reste « échec » et ne
prétend pas qu'une restauration a réussi. Vérifier et rétablir les quatre services et le code
avant de retirer manuellement cet incident. Ne jamais le supprimer pour relancer à l'aveugle.

## Limites

L'approbation porte sur le code du déploiement, pas sur un droit de fusion GitHub ni sur
un lancement automatique de chaque livraison. La fusion des fichiers protégés et la
première installation du livreur restent explicites. Les tests simulés ne prouvent pas
une activation NAS : relever la release réellement exécutée lors de la livraison.
