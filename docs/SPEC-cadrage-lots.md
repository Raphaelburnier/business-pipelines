# TaskBoard : cadrage fiable et clôture vérifiable

Résumé : donner aux tâches système un cadrage commun au navigateur et au serveur,
transmettre tous les critères à la mission et refuser un départ dont les dépendances
ne sont pas terminées. Distinguer développement, fusion et recette sans confondre la
réussite d'un run avec la clôture du lot. Proposition du 20 novembre 2026, **à valider
avant implémentation**. Prochaine étape : accord de Raphaël sur le schéma et la migration.

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

## Source de vérité et schéma proposé

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

L'accord demandé porte sur le schéma, les phases de suivi et la migration qui bloque
les anciennes tâches incomplètes. Les correctifs seront ensuite préparés, testés et
relus ; leur livraison reste une action humaine distincte.
