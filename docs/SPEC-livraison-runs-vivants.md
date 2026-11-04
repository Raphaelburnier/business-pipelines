# Lot 7.3 — Livrer sans interrompre les runs

## Résumé

Objectif : refuser une livraison tant qu'un travail est en cours, puis empêcher un
nouveau départ pendant sa construction et sa bascule. Le contrôle et la réservation
doivent être atomiques ; une simple lecture avant le build laisse une course.
Les dépendances de l'image seront installées par `npm ci`.

**Statut : conception approuvée par Raphaël le 4 novembre 2026 (« je l’accord »).**
Implémentation en cours ; cet accord ne vaut ni fusion sensible ni mise en production.

## Objectif et périmètre

Un clic de Raphaël sur Livraison peut reconstruire puis remplacer les services sans
tuer un run, local ou distant. Un refus doit dire pourquoi et laisser le travail
continuer. Les commandes encore en file restent durables et repartent après une
livraison réussie ou une restauration confirmée.

Hypothèses proposées : le contrôle couvre les exécutions du moteur et les
conversations consommées par le runner. Il ne préempte pas un travail, ne change
pas de provider et n'ajoute pas de délai maximal aux runs. La pause opérateur
du lot 4.1 garde sa valeur et son auteur.

Pourquoi : une livraison ne doit pas devenir une annulation implicite, et le
verrou technique ne doit pas défaire une décision de l'opérateur.

## Constat dans les sources

Sources lues sur le cockpit `f395899` et le moteur `8b5178a` :

- `deploy/nas/deploy.sh.modele` construit les images puis appelle
  `retirer_services`, sans contrôler les runs ni fermer leurs nouveaux départs.
- `bin/commande-runner.js` réserve les commandes et lance les CLI en parallèle.
- `EventStore.prendreCommande` réserve une commande avec une requête atomique,
  mais sans condition liée à une maintenance.
- `ControleExecution.demarragesBloques` traite la pause opérateur existante.
- Le Dockerfile appelle `npm install --omit=dev` pour le moteur et le cockpit ;
  le front utilise déjà `npm ci`.

## Contrat proposé entre livreur et moteur

Le journal SQLite existant porterait un nouvel événement
`execution.maintenance_changed`, avec ce payload strict :

```json
{
  "version": 1,
  "commandeId": "00000000-0000-4000-8000-000000000001",
  "active": true
}
```

`commandeId` désigne exactement la commande `livraison.start` déjà signée et
validée. L'enveloppe d'événement existante fournit la date et l'identifiant ;
aucune identité personnelle, commande shell, chemin ni secret n'entre dans ce
payload. Le même identifiant et `active: false` ferment la maintenance.

Pourquoi : un propriétaire précis empêche une livraison différente de libérer
le verrou d'une autre. La version permet de refuser un contrat inconnu.

### Acquisition et départs

La prise du verrou et la vérification du travail en cours sont réalisées dans une
transaction `BEGIN IMMEDIATE`. Sont bloquants : un run `running`, une étape
`running`, une commande de lancement/reprise/revérification déjà réservée, une
conversation réservée ou un dispatch d'étape non terminé. Une base absente,
illisible ou incompatible refuse la livraison ; elle n'est jamais créée pour
conclure que la plateforme est vide.

Pourquoi : une commande peut avoir été réservée sans avoir encore créé son run.
La lecture des seuls runs manquerait cette fenêtre et les étapes distantes.

La réservation d'un travail vérifie l'absence de maintenance dans sa propre
transaction d'écriture. La création ou la remise en exécution directe d'un run
par la CLI applique la même condition. Les commandes de décision d’approbation peuvent être
enregistrées dans la file, mais leur traitement et leur reprise attendent la libération. Les contrôles d'annulation
et de pause restent disponibles.

Pourquoi : SQLite doit ordonner le départ et la maintenance. Un test de fichier
ou une lecture séparée avant `prendreCommande` laisse une course.

### Durée, échecs et libération

La maintenance commence avant la construction et reste active pendant la
bascule et la recette. Les demandes nouvelles restent en file. Une vérification
supplémentaire précède le premier arrêt de service.

Pourquoi : cette durée rend la garantie compréhensible et couvre aussi une
construction lente. La file reprend ensuite sans nouvelle attribution.

Le propriétaire libère le verrou après succès, échec confirmé avant toute
bascule ou restauration confirmée. Un crash du livreur ou une restauration
incertaine conserve le verrou et l'incident ; ni l'âge du verrou ni le simple
passage d'une commande en échec ne le suppriment. Une procédure opérateur de
récupération devra vérifier la fin de la bascule, les services et le propriétaire
avant la libération, avec une trace dans le journal.

Pourquoi : une expiration automatique pourrait rouvrir les départs pendant une
opération encore active. Une reprise incertaine demande une décision informée.

## Première installation

Le runner et le moteur installés aujourd'hui ignorent ce contrat. Ajouter un
contrôle seulement au nouveau livreur ne protège donc pas la première bascule.

Prévoir une version préparatoire qui sait lire le verrou et bloquer les départs,
puis l'activation du nouveau modèle. La livraison préparatoire est demandée par
Raphaël depuis le cockpit, avec la pause durable activée et l'absence de travail
vérifiée ; la pause reste activée jusqu'à sa recette. Le nouveau modèle refuse
son activation si les composants installés ne supportent pas encore le contrat.
La preuve de compatibilité sera définie et testée dans l'implémentation ; aucune
capacité n'est présumée à partir du seul nom d'un conteneur.

Pourquoi : le changement doit couvrir aussi sa migration, pas seulement les
livraisons suivantes. Le statut « fait » attend les deux étapes et leur recette.

## Installation reproductible

Remplacer les deux installations locales de production du Dockerfile par
`npm ci --omit=dev --no-audit --no-fund`, en conservant l'installation du moteur
dans son propre dossier avant celle du cockpit. Conserver l'installation
versionnée de la CLI et la vérification du front existantes.

Pourquoi : une dépendance `file:` liée n'installe pas à elle seule les dépendances
du moteur ; chaque dépôt possède son propre lockfile. Un manifeste incompatible
doit faire échouer la construction avant la bascule, sans réécrire le lockfile.

## Sources et conventions prévues

- Moteur : `src/event-store.js`, `src/controle-execution.js`, chemins de départ
  CLI et schéma du payload de maintenance ; tests Vitest du moteur.
- Cockpit : `bin/livreur.js`, `deploy/nas/deploy.sh.modele`, Dockerfile,
  `test/deploiement.test.js` et ses fixtures.
- Documentation : ce complément de `SPEC-livraison.md`, procédure de récupération
  et preuve de première installation.
- CommunJS, noms français et petites fonctions ; `try/finally` pour les
  transactions, erreurs explicites sans contenu privé, selon les fichiers existants.

## Recette exigée

1. Run local ou distant actif : refus, aucun `docker rm`, fichiers et processus
   inchangés. Même résultat pour une commande réservée avant la création du run.
2. Deux connexions SQLite concurrentes : soit le départ gagne et la livraison
   refuse, soit la maintenance gagne et le départ reste en file ; jamais les deux.
3. Construction lente : aucun départ ni reprise pendant le verrou ; heartbeat des
   services disponible. Les commandes pendantes gardent leurs identifiants.
4. Succès et restauration confirmée : reprise des commandes ; une pause opérateur
   préexistante reste active. Une panne avant la bascule ne remplace aucun fichier.
5. Crash du livreur et restauration incertaine : verrou durable après redémarrage,
   message opérateur clair, aucune nouvelle exécution ni fausse confirmation.
6. Base absente, corrompue, version de contrat inconnue ou composants anciens :
   refus sans création de base et sans arrêt des services.
7. Build avec les lockfiles valides, puis manifeste volontairement incompatible :
   succès du premier, échec du second avant toute bascule.

Commandes à exécuter après implémentation, dans les worktrees voisins appropriés :

```sh
# Moteur
npm ci
npm test

# Cockpit
npm ci
npm --prefix web ci
npm test
npm run web:test
npm --prefix web run build
MOTEUR=../agent-orchestrator bash bin/preparer-image.sh
docker build --target verification .
```

Les scénarios utilisent de vrais processus et une base temporaire, sans appel de
modèle et sans données de production. Docker n'est pas disponible dans cette
session locale ; son build devra être prouvé par la CI publique avant fusion.

## Validation attendue

Valider le contrat et la sémantique du verrou ci-dessus avant de coder les échanges.
Pourquoi : la règle « Conception » du AGENTS.md commun impose de proposer un schéma
entre composants puis d'attendre sa validation ; cette maintenance en crée un.

L'accord porte sur cette conception. La fusion sensible et l'approbation de
l'empreinte exacte du futur modèle restent des étapes distinctes, avec leurs
effets expliqués. Seul Raphaël demande les livraisons depuis le cockpit.
Pourquoi : une conception approuvée n'est pas une autorisation de remplacer la
production ; c'est l'invariant « Livraisons » du même AGENTS.md.


## Procédure opérateur après une issue incertaine

1. Garder la pause opérateur activée. Vérifier manuellement que le script de
   bascule, ses descendants et une éventuelle construction Docker sont terminés.
   Une commande déclarée refusée ne prouve pas à elle seule cette fin.
   Pourquoi : le livreur peut avoir redémarré alors que son ancien enfant travaille.
2. Vérifier la version réellement installée, les huit services sains et la fin de
   la restauration ou de la livraison. Noter l'identifiant propriétaire du dernier
   événement `execution.maintenance_changed` et le diagnostic de l'incident.
   Pourquoi : libérer autorise les départs ; il faut savoir quelle version les recevra.
3. Si la commande propriétaire est close et qu'aucune livraison n'est ouverte,
   l'opérateur peut exécuter **dans le livreur** :

   ```sh
   node bin/maintenance-livraison.js --liberer <commandeId> --bascule-terminee
   ```

   Le drapeau atteste la vérification manuelle de l'étape 1. L'outil vérifie aussi
   les huit conteneurs, la sonde du cockpit, le propriétaire et le repos sous
   transaction avant d'écrire la libération. Il ne modifie pas la pause opérateur.
   Pourquoi : la confirmation humaine couvre les opérations orphelines ; le code
   refuse les états connus incompatibles au moment de la libération.
4. Conserver le diagnostic puis retirer le fichier d'incident seulement après ces
   vérifications. Reprendre les départs depuis le contrôle de pause du cockpit.
   Pourquoi : garder un incident documenté évite une nouvelle livraison à l'aveugle.

La procédure est manuelle : ni un redémarrage ni un agent ne doit la déclencher
spontanément. L'étape 3 n'est pas une commande de mise en production.
