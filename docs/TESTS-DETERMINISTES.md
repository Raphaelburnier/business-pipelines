# Vérification déterministe des runs de développement

`improve-app@5` remplace le verdict de l'agent de tests par `verify-project`, fourni par le moteur. Les agents produisent le plan et le code sur le PC ; le superviseur prépare un snapshot isolé et exécute les commandes de la fiche projet. Un `PASS` écrit par l'agent ne rend pas une commande rouge admissible.

Pour Steam TierList, les commandes vérifiées sur le dépôt GitHub courant sont :

- `npm run prepare:run` : installation reproductible des dépendances serveur et client, devDependencies incluses ;
- `npm test` : build client, contrôles de syntaxe serveur et tests `node:test`.

La fiche livrée fournit aussi `repoWorkers`, l'adresse SSH du dépôt réellement monté dans `/git/steam-tierlist.git`. Le maître utilise son chemin local, le PC utilise cette adresse. Elle est un exemple adapté au NAS actuel, à vérifier si le montage change.

## Déploiement coordonné

Le moteur doit être mis à jour sur le NAS et dans la copie figée du worker PC. Le registre doit contenir `improve-app@5`. Une fiche sans `verification` est refusée pour ce pipeline avant le premier appel modèle. Les pipelines v1 à v4 gardent leur comportement.

Le worker PC doit disposer de Linux, Bubblewrap et de namespaces utilisateurs autorisés. Un précontrôle échoué arrête le run pour erreur d'infrastructure : aucune exécution des tests sans isolation n'est permise. Seule la préparation déclarée peut accéder au réseau ; les checks ne reçoivent ni réseau, ni credentials, ni dépôt `.git`, ni base du superviseur.

Les fiches NAS sont montées depuis `projects/` et peuvent contenir des adaptations locales. La mise à jour de la fiche Steam doit conserver ses champs locaux (URL, budget, dépôt). Le fichier versionné déclare le profil et la nouvelle version ; ne pas écraser les autres fiches ni les secrets de configuration lors de cette migration.

Le rapport et `verification.finished` exposent les commandes, codes, journaux, SHA du checkpoint et arbre testé. La publication relit la preuve du superviseur et refuse un arbre différent ou une commande rouge. Les rapports restent sur `run/`; seule la branche de livraison est nettoyée.

`valider-test-report.js` reste utilisé par les anciens pipelines. Il n'est pas la preuve d'exécution du nouveau parcours. La revue indépendante et le suivi jusqu'au merge restent à implémenter avant de considérer le parcours autonome complet comme validé.
