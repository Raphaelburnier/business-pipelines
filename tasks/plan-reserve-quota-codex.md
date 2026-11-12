# Réserve Codex — plan d’implémentation

Résumé : spécification validée par Raphaël le 11 novembre 2026. Étendre le contrat existant avec une cible fournisseur optionnelle, puis adapter les décisions et l’interface. La réserve Codex reste désactivée sans seuil au départ. Suivi des tâches : liste Claude-Mem `reserve-quota-codex-20261111`.

1. Moteur : schémas compatibles avec les anciens corps signés, état et historique par fournisseur, attente et reprise sur le bon runtime. Vérifier l’indépendance, les seuils et le comptage avant/après redémarrage.
2. Cockpit : routes séparées, validation du corps avant ajout du runtime par le serveur, vérification au lancement et planificateur. Vérifier HTTP, HMAC, isolation des commandes en attente et refus d’usurpation du fournisseur.
3. Interface : même formulaire pour les deux fournisseurs, libellés et mesures cohérents ; vérifier clavier, acquittement et mobile 375 px avec API isolée.
4. Validation : suites moteur/types, serveur, sauvegardes, front/types/build ; relecture du diff contre la spécification, puis PR avec preuves et SHA exacts.
5. Livraison : préparer les changements ; fusion et demande de production suivent les règles existantes. La recette de production utilise des données isolées ; ne pas changer un réglage opérateur pour tester.

Risque principal : confondre une ancienne commande Claude avec Codex ou appliquer le maximum de l’autre fournisseur. Les tests conservent les anciens cas Claude et ajoutent le traitement simultané des deux réserves. La sonde de quota existante reste indépendante des appels retenus afin de permettre leur reprise.
