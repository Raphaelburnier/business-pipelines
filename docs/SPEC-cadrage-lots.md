# TaskBoard : cadrage fiable et clôture vérifiable

Résumé : donner aux tâches système un cadrage commun au navigateur et au serveur,
transmettre tous les critères à la mission et refuser un départ dont les dépendances
ne sont pas terminées. Distinguer développement, fusion et recette sans confondre la
réussite d'un run avec la clôture du lot. Schéma et migration **approuvés par Raphaël le 20 novembre 2026**.
Correctif fusionné par la PR #290 ; consignes persistantes fusionnées par registre #48.
La production contrôlée le 23 novembre ne les contient pas encore. Prochaine étape :
attendre leur livraison demandée par Raphaël, puis vérifier la version servie avant recette.

## Objectif et constats

Le défaut O7 couvre trois pertes de cadrage constatées dans le code :

- `AVenir.tsx:construireSpecAttribution` reprend le détail de l'étape, sans le but ni
  les prérequis du lot ; ses critères initiaux restent génériques.
- `TaskBoard.tsx` fabrique un critère avec `detail.slice(0, 950)` : plusieurs exigences
  deviennent une phrase, et la fin peut disparaître.
- `objectifs-avenirs.js:validerReference` vérifie ID, révision et projet, sans vérifier
  les dépendances ; `prerequis` reste un texte affiché.

Le statut à trois valeurs sert aux filtres, mais ne distingue pas code terminé, fusion
attendue et recette attendue. Les règles communes imposent déjà cette distinction.
Une seule capacité est concernée : le cadrage d'une tâche système jusqu'à sa clôture.

## Source de vérité et schéma approuvé

Déplacer les données `LOTS` et `DEFAUTS` dans `web/src/avenir/feuille.json`, lisible par
le serveur et le front. `feuille.ts` conserve types et fonctions de présentation en
important ces données. Le classement éditorial reste inchangé. Pourquoi : éviter deux
descriptions concurrentes et permettre au serveur de vérifier l'état des prérequis.

Conserver les champs actuels et ajouter, pour une étape cadrée :

```json
{
  "id": "20.2",
  "titre": "Exercer une commande du navigateur à la base temporaire",
  "detail": "Description lisible du travail demandé.",
  "fichiers": ["BP web/e2e/", "BP test/"],
  "statut": "a-faire",
  "cadrage": {
    "revision": 1,
    "criteres": [
      "Un double clic ne persiste qu'une commande dans la base temporaire.",
      "Le navigateur affiche le résultat du serveur après rechargement."
    ],
    "directives": ["Utiliser un serveur et une base temporaires."],
    "exclusions": ["Aucune commande de production ni appel de modèle."],
    "dependances": ["20.1"],
    "cloture": {
      "fusionRequise": true,
      "recetteRequise": false,
      "motifDispenseRecette": "Outillage de test local sans modification de production."
    }
  },
  "suivi": { "phase": "a-faire", "attente": null, "preuves": [] }
}
```

Cet exemple illustre le format ; il ne remplace pas le contenu déjà préparé de 20.2.

- `criteres` : 1 à 30 textes non vides, au plus 1 000 caractères chacun, comme le
  contrat actuel. Aucun raccourcissement silencieux ; un dépassement bloque le cadrage.
- `directives` et `exclusions` : listes jointes dans les champs de mission existants,
  au plus 4 000 caractères par champ. Les dépassements sont signalés avant planification.
- `dependances` : IDs explicites d'étapes ou de défauts. Référence inconnue, doublon,
  autoréférence ou cycle refusés. Ne pas déduire des dépendances de la prose : une
  phrase peut contenir une exception ou décrire autre chose qu'un ordre de départ.
- `revision` : identique à celle du catalogue admissible. Modifier critères,
  dépendances, périmètre ou conditions de clôture incrémente cette révision pour
  invalider les anciens plans, au lieu d'en changer le sens en silence.
- `cloture` : fusion et recette requises par défaut. Une dispense de recette impose
  `motifDispenseRecette` non vide : elle peut couvrir un document ou un outil de test,
  mais n'autorise aucune livraison.
- `phase` : `a-faire`, `developpement`, `fusion-attendue`, `recette-attendue`, `bloque`
  ou `clos`. Les quatre phases intermédiaires correspondent à `statut: en-cours` ;
  `clos` à `fait`, `a-faire` à `a-faire`. Refuser les combinaisons incohérentes.
- `attente` : raison non vide si la phase est `bloque`, pour rendre visible l'action
  humaine ou la dépendance restante.
- `preuves` : entrées `{type, reference, revision, commit}`, avec `type` dans
  `verification`, `fusion`, `recette` et le commit exact vérifié. Références vers les
  résultats existants : ID de run, chemin de rapport versionné ou URL de PR ; aucun
  journal brut ni donnée privée dans ce dépôt. Une preuve porte la révision du cadrage
  et le code réellement vérifié, pour ne pas confondre ces deux identités.

`objectifs.json` reste la liste d'admission (ID, révision, dépôt, fichiers), contrôlée
contre la feuille commune. Être dans cette liste ne suffit plus : le serveur exige
un cadrage complet et des dépendances terminées. Un défaut exécutable suit les mêmes
exigences. Les données historiques sans cadrage restent représentables et consultables.

## Transmission et contrôle serveur

Attribuer et Calendrier utilisent un constructeur commun. Le document de mission
contient but du lot, détail, dépendances, périmètre et conditions de clôture. Chaque
critère reste une entrée distincte. L'utilisateur peut ajouter un critère ou renforcer
la revue ; il ne peut pas retirer un critère canonique.

Le serveur reconstruit le socle depuis les données de confiance. Il ne fait pas
confiance au texte ou aux dépendances fournis par le navigateur. Les données canoniques
sont couvertes par l'empreinte du plan avec les autres champs existants.

Contrôler le cadrage et les dépendances à la proposition, à la validation des plans et
au départ effectif d'une commande encore en attente. Une référence périmée ou une
dépendance non faite bloque le départ avec un motif visible, sans changer l'historique.
La validation initiale d'un groupe multi-dépôts reste transactionnelle ; au départ
différé, chaque commande est recontrôlée sans annuler les missions déjà actives.

Les champs de mission, références `_roadmapObjective` et `_taskBoardObjective`, commandes
et transport moteur restent inchangés. Si le départ différé exige une extension du
contrat moteur, la proposer séparément avant implémentation.

## Suivi et clôture

Afficher phase et attente à côté du statut, sans remplacer les badges d'activité.
Un run réussi reste distinct d'une PR fusionnée et d'une recette réussie.

Pour un nouveau cadrage, `clos` exige une preuve de vérification, puis de fusion et
de recette lorsqu'elles sont requises, rattachées à la révision concernée. Le contrôle
valide présence, type et rattachement : une URL seule ne prouve pas un succès. La
session responsable confronte ces références aux résultats réels et clôture par PR,
selon les règles de suivi existantes. Aucun nouveau format de rapport d'agent.

Le suivi reste versionné, sans écriture dans l'event store. Les agents natifs ne
modifient pas la feuille ; la session pilote la maintient. Ni l'accord du schéma ni
un run réussi n'autorise une livraison, qui reste demandée par Raphaël depuis le cockpit.

## Migration et cas limites

- Conserver les statuts historiques ; ne pas rouvrir les lots faits ni inventer des
  preuves rétroactives. Migrer les tâches encore utiles par petits groupes relus.
- Une tâche sans cadrage complet reste visible mais non lançable, même si son ID est
  au catalogue. Afficher les éléments manquants plutôt que produire des critères vagues.
- Recalculer les plans non démarrés rendus incomplets par ce contrôle. Les runs actifs
  gardent leur mission figée ; aucune annulation ni réécriture de leur contrat.
- Une dépendance multi-dépôts exige sa clôture complète, pas un seul run réussi.
- Respecter 18.11. Cette évolution n'autorise pas le lancement des lots 19 et 20 et ne
  crée pas de superviseur. Les contrôles existants de sensibilité restent applicables.

## Structure et conventions

`web/src/avenir/feuille.json` porte les données ; `feuille.ts` et le constructeur partagé
les exposent. Côté serveur : `src/objectifs-avenirs.js`, `src/planificateur.js`,
`src/taskboard.js`, `src/missions.js` et le point de départ différé. Côté interface :
`web/src/avenir/AVenir.tsx` et `web/src/TaskBoard.tsx`. Conserver le style des fichiers
et les schémas de mission existants ; le schéma d'exemple donne les noms proposés.

## Stratégie de test et critères de fin

1. Critère après le caractère 950 : transmis intégralement. Deux critères restent
   deux entrées dans Attribuer et Calendrier ; le but et les dépendances arrivent aussi.
2. Client modifié : ni suppression des critères canoniques ni suppression d'une revue.
3. Dépendance inconnue, cyclique ou non faite : refus ; toutes faites : accord.
4. Modification après calcul ou avant départ différé : refus explicite. Échec d'un
   plan de groupe à la validation : aucune réservation partielle.
5. Cadrage manquant : tâche visible, non lançable. Runs actifs et anciens lots faits
   conservés. Le catalogue ne permet pas de reprendre un objectif en cours ou fait.
6. Fusion attendue, recette attendue et blocage visibles ; clôture sans les preuves
   requises refusée. Ne pas confondre validité de référence et vérification du résultat.
7. Types, tests et build verts ; recette navigateur locale sur données synthétiques,
   sans fournisseur payant ni commande de production.

Commandes depuis la racine, avec le moteur courant disponible :

```sh
node bin/valider-feuille.js --base origin/main
node test/planificateur.test.js
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm test
```

Ajouter des cas ciblés aux suites existantes, dont une régression qui échoue avant
chaque correctif. Documenter la commande navigateur avec l'outil réellement disponible
lors de l'implémentation ; ne pas prétendre qu'une commande non installée existe déjà.

## Limites et validation

Préserver accès, sensibilité, révisions et idempotence. Ne modifier ni workflow de
fusion ni politique des fichiers sensibles pour réaliser ce correctif. Toute extension
du contrat moteur, des formats de preuve ou des droits exige un cadrage distinct.

L'accord reçu porte sur le schéma, les phases de suivi et la migration qui bloque
les anciennes tâches incomplètes. Les correctifs seront ensuite préparés, testés et
relus ; leur livraison reste une action humaine distincte.

## Procédure pour les prochaines sessions

Les données se modifient dans `web/src/avenir/feuille.json` ; `feuille.ts` reste
la façade du front. Ne pas y réintroduire une seconde copie des lots : l'affichage
et le contrôle serveur doivent conserver la même source de vérité.

1. Relire l'étape et ses dépendances avant de travailler. Mettre `statut` à
   `en-cours`, `suivi.phase` à `developpement`, et retirer l'ID du catalogue.
2. Préparer critères observables, directives, exclusions et dépendances explicites.
   Ne pas convertir automatiquement un ancien détail vague en critères. Modifier le
   sens du cadrage impose une nouvelle `cadrage.revision`, identique à celle du
   catalogue si l'étape y figure, pour invalider les anciens plans.
3. Après développement, consigner les preuves et utiliser `fusion-attendue`, puis
   `recette-attendue` si elle est requise. Une attente bloquante prend `bloque`
   avec une raison compréhensible.
4. Passer à `clos` et `fait` après confrontation des preuves aux résultats réels.
   Valider le format d'une référence ne prouve pas sa réussite. Garder toute donnée
   sensible hors du dépôt public.
5. Exécuter `npm run feuille:formater`, puis
   `node bin/valider-feuille.js --base origin/main` et les tests adaptés.
   `npm test` valide aussi la feuille ; en CI de PR, elle est comparée au premier
   parent du merge testé. Une évolution sans nouvelle révision est refusée.

Le formatage conserve une étape par ligne et vérifie que les données sont identiques.
La feuille doit tenir dans les 100 000 octets admis par le workflow de revue ; le
validateur le vérifie avant la CI. Pourquoi : au-delà, GitHub peut omettre le patch et
la revue refuse un diff tronqué avant même d'appeler un modèle. Le formateur ne retire
jamais de contenu et aucune limite du workflow n'est augmentée.

Les anciens lots faits ne demandent pas de preuve rétroactive. Les anciennes tâches
à faire sans cadrage restent affichées avec « cadrage manquant » et sans départ.
Les lots 19 et 20 possèdent un cadrage mais restent hors catalogue et soumis à 18.11.
Leur présence n'autorise aucun lancement.


## Vérification locale

Le correctif a passé les 12 tests du cadrage, les 41 tests du planificateur,
les 100 tests front, le contrôle TypeScript, le build et les 12 recettes de reprise
avec le vrai runner et un fournisseur simulé. Les cas historiques de ces recettes
reçoivent un cadrage synthétique en mémoire ; aucun ancien objectif réel n'est rouvert.
La suite serveur complète a réussi. La CI finale de PR `45019559811` est verte
(trois groupes et Docker) ; la revue `45019558190` approuve la tête
`0adc4777279f0e7b47cefd51e7e11215f0fb8a23`, sans constat. La fusion #290 est
`7c6c7445e9439ebccfc067535b716d5038733c1a` ; son arbre est identique à celui
de la tête testée. Registre #48 est fusionnée en
`bbc19fed7eb6d1743f18e4e45c5c1648c42c472e`, après CI et revue vertes.

Recette Chromium sur la maquette locale : les lots 19 et 20 sont visibles ; une tâche
historique sans cadrage reste visible et non déplaçable ; O7 affiche sa phase ; les
critères et dépendances de 20.2 sont consultables et 18.11 explique le blocage. À
390 pixels de largeur, le contenu ne déborde pas horizontalement. Aucun modèle ni
service de production n'a été appelé par cette recette.

Commande utilisée avec une session dédiée, après démarrage de Vite sur le port local
4187 : `agent-browser --session cadrage-lots-20261120 open
http://localhost:4187/taskboard/taches?source=maquette`. Les assertions métier sont dans
les suites versionnées ; cette recette vérifie l'affichage et les gestes réels.

## Recette après livraison humaine

Résumé : les fusions sont terminées, mais O7 reste `en-cours`, phase
`recette-attendue`. Le contrôle du 23 novembre constate une production saine qui
ne contient pas encore #290 ni registre #48. La livraison déjà en construction
cible des versions antérieures ; elle ne constitue pas une recette de ce correctif.

Avant une nouvelle demande de livraison, attendre la fin de celle en cours puis
contrôler la proposition dans le cockpit : les versions proposées doivent contenir
les deux commits de fusion ci-dessus et la mise à jour du suivi O7 décrite ici,
pour que sa phase affichée soit cohérente avec les fusions. Une date de calcul récente ne garantit pas
que les miroirs ont suivi GitHub. Si ces commits manquent, attendre l'actualisation
des miroirs et relever le motif réel de l'écart ; ne pas remplacer la cible à la
main. Pourquoi : une livraison réussie peut installer une version antérieure au
correctif attendu. Seul Raphaël demande la livraison depuis le cockpit.

Après cette livraison, effectuer les contrôles suivants, sans lancer de mission ni
appeler de fournisseur de modèle :

| Contrôle | Résultat nécessaire |
| --- | --- |
| Santé et versions réellement servies | Santé saine ; cockpit et registre contiennent les commits de fusion attendus. Vérifier leur ascendance, pas seulement le nom de release. |
| O7 dans les tâches, bureau et mobile | Statut en cours et phase recette attendue ; fusion et vérification référencées, aucune clôture annoncée. |
| Critères et dépendances de 20.2 | Critères distincts et complets ; 18.11 et 20.1 visibles. L'étape reste non attribuable tant que ses prérequis et son admission ne sont pas satisfaits. |
| Ancienne tâche sans cadrage, par exemple 3.6 | Toujours consultable ; motif de préparation manquante et aucun départ possible. |
| Runs déjà actifs et historique | Missions conservées ; aucune réécriture, annulation ou relance pour les besoins de la recette. |

Les mutations de planification, les critères longs, les références périmées et les
reprises se vérifient sur cette même révision dans les tests isolés existants
(`test/cadrage-lots.test.js`, `test/planificateur.test.js`,
`test/reprises-runs.test.js`) ; ne pas tenter un départ de production pour démontrer
un refus. Pourquoi : la recette de l'interface ne doit pas créer un travail réel.

Ne clôturer O7 qu'après ces résultats réels : consigner la version effectivement
vérifiée et recettée, les références de CI et de fusion, puis proposer `clos`/`fait`
dans une PR de suivi. Les preuves de vérification et de recette doivent porter sur
le même commit. Les lots 19/20 restent soumis à 18.11 et hors catalogue.
