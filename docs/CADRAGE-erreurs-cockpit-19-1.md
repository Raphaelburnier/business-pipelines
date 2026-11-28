# 19.1 : trois erreurs du cockpit à empêcher

Résumé : retenir la perte de critères d'une mission, les liens directs Planning
refusés et les changements que la revue ne peut pas lire complètement. Les
protections actuelles sont conservées. 19.2 devra démontrer leurs refus sur des
contre-exemples isolés et compléter les seules lacunes constatées. Aucun changement
de code ni lancement de mission n'est réalisé par ce cadrage.

Préparation autorisée explicitement par Raphaël le 28 novembre 2026, en exception
à l'attente de 18.11 et au plafond de travail en cours. Cet accord couvre 19.1,
document et suivi ; il ne lance pas 19.2. La dépendance 18.11 reste dans la feuille.
Les sources ci-dessous ont été examinées sur le cockpit `30c240e`.

## 1. Critères de mission incomplets selon le point d'entrée

Incident : O7, corrigé par [#290](https://github.com/Raphaelburnier/business-pipelines/pull/290)
et clos par [#325](https://github.com/Raphaelburnier/business-pipelines/pull/325).
[La spécification](SPEC-cadrage-lots.md#objectif-et-constats) décrit le problème :
Attribuer perdait le but et les prérequis ; le Planning remplaçait les critères par
une phrase issue de `detail.slice(0, 950)`.

**Cause.** Deux constructions de mission avaient leur propre interprétation de la
fiche. Une limite de présentation devenait une suppression silencieuse d'exigences.

**Exemple fautif.** Une tâche possède deux critères distincts, un détail de 1 100
caractères dont la fin est nécessaire et un but de lot. Le Planning envoie
`criteres: [detail.slice(0, 950)]` ; Attribuer envoie une autre liste. L'un ou l'autre
trajet produit une mission amputée.

**Exemple correct.** Les deux trajets conservent les mêmes critères canoniques,
séparés et dans le même ordre, le détail complet et le but. Les critères ajoutés par
l'utilisateur complètent cette liste. Le serveur reconstruit aussi le socle de
confiance : le navigateur n'a pas le pouvoir de retirer les exigences.

**Contrôle existant.** `web/src/avenir/AVenir.test.ts`, test « Attribuer et le
constructeur du calendrier conservent les mêmes critères sans limite à 950
caractères », compare `construireSpecAttribution` et `cadrerEtape`. Les tests de
`src/cadrage-lots.mjs` vérifient la construction complète et le rétablissement du
socle retiré par un client.

```sh
npm --prefix web test -- src/avenir/AVenir.test.ts
node --test test/cadrage-lots.test.js
```

**Travail délimité pour 19.2.** Réutiliser ces tests. Dans une copie temporaire,
réintroduire la troncature dans un trajet, puis une omission de critère dans
l'autre. La commande front doit échouer pour chacun de ces changements ; après
restauration, elle doit réussir. Vérifier explicitement le but et la fin du détail
pour les deux résultats si une assertion manque. Une égalité entre deux listes
également amputées ne suffit pas : comparer aussi au cadrage attendu.

La comparaison des constructeurs ne démontre pas les gestes de glisser-déposer ou
de formulaire dans un navigateur : cette partie reste au lot 20.

## 2. Liens directs Planning refusés par le serveur

Incident : O8, observé dans [la recette du 27 novembre](RECETTE-cadrage-2026-11-27.md#o8--liens-directs-et-rechargement),
corrigé par [#311](https://github.com/Raphaelburnier/business-pipelines/pull/311).
`/taskboard/taches` et `/taskboard/activite` étaient des adresses du client mais
renvoyaient HTTP 404 à l'ouverture directe.

**Cause.** Le routeur client et la liste des adresses servies avec l'entrée HTML
avaient divergé. Une navigation déjà chargée ne vérifiait pas le GET initial.

**Exemple fautif.** Le serveur ne sert que `/taskboard`. Le client sait afficher
l'onglet Tâches, mais une nouvelle requête GET vers `/taskboard/taches` renvoie 404.

**Exemple correct.** Les quatre adresses connues, `/taskboard` et ses sous-onglets
`calendrier`, `taches`, `activite`, servent l'entrée HTML quand le front est
construit ; un sous-onglet inconnu reste en 404. Le refus des hôtes inconnus et les
contrôles d'identité existants restent applicables.

**Contrôle existant.** `test/cockpit-routes.test.js` démarre le vrai serveur avec
une base temporaire et teste les GET connus et inconnus. Sans `web/dist`, il attend
503 pour une page admise : ce succès de test ne prouve pas la présence d'un front
servi en 200. Le scénario construit doit donc être exercé aussi.

```sh
npm --prefix web run build
node test/cockpit-routes.test.js
```

**Travail délimité pour 19.2.** Dans une copie temporaire avec le front construit,
retirer `taches` de la règle des sous-onglets dans `bin/cockpit.js`. Le test des
routes doit échouer ; la restauration doit rétablir le succès. Réutiliser la suite
existante et compléter les assertions HTML pour les sous-onglets si nécessaire.
Conserver le contrôle 404 d'une adresse inconnue : un repli HTML sur toutes les
adresses masquerait la régression.

La CI actuelle lance les tests serveur avant le build web et ne garantit donc pas
ce scénario construit. Pour 19.2, prévoir l'exécution de cette suite après le build
dans le groupe qui construit déjà le front, avec la même commande locale. Ne pas
dupliquer le build dans les trois groupes. Toute modification de workflow suivra
les règles ordinaires de revue et de fusion sensible.

Cette vérification reste HTTP ; les gestes bureau/mobile sont réservés au lot 20.

## 3. Sources ou patch incomplets pour la revue

Incident : pendant [#303](https://github.com/Raphaelburnier/business-pipelines/pull/303),
une réindentation globale de la feuille JSON a produit un patch omis ou tronqué.
La correction `a75fdf0` limite le compactage aux lignes de structure. Plus tard,
[#318](https://github.com/Raphaelburnier/business-pipelines/pull/318) archive les
lots faits pour que la feuille reste sous la limite de lecture.

**Cause.** Un changement de présentation réécrivait toutes les longues lignes.
La taille du fichier final ne mesurait ni la taille du patch transmis ni le total
des sources avant et après que la revue doit lire.

**Exemple fautif.** Une source finale de 99 000 octets semble admissible, mais
l'API ne fournit pas son patch complet. Autre cas : plusieurs fichiers restent
chacun sous 100 000 octets, mais leurs versions avant et après totalisent plus
de 500 000 octets. Une revue ne peut pas approuver ce contexte incomplet.

**Exemple correct.** Le formatage conserve les données et les longues entrées
inchangées. Le contexte de revue contient chaque patch, dont les lignes ajoutées
et retirées correspondent aux compteurs, ainsi que les sources textuelles aux
révisions exactes. Chaque source reste au plus à 100 000 octets et la somme lue
au plus à 500 000. Si les limites ne passent pas, découper le travail ou archiver
avec le formateur existant ; ne relever aucune limite.

**Contrôles existants.** `bin/valider-feuille.js` contrôle la taille des deux
feuilles ; `bin/formater-feuille.js` vérifie l'identité des données assemblées.
`.github/scripts/review-verdict.cjs` refuse un patch absent/incomplet, un fichier
trop gros ou un total de lecture excessif, avec les limites exportées `LIMITES`.
`test/github-review.test.js` exerce déjà les contextes incomplets et les refus.

```sh
node bin/valider-feuille.js --base origin/main
node --test test/github-review.test.js
```

**Travail délimité pour 19.2.** Étendre les fixtures de cette suite aux frontières
100 000/100 001 octets par source et 500 000/500 001 octets cumulés. Alimenter la
fonction actuelle `preparer` avec des réponses GitHub simulées, patch absent ou
compteurs incompatibles : elle doit produire `ready: false` avec une raison utile.
Un contexte complet dans les limites doit produire `ready: true`.

Dans la copie temporaire, neutraliser séparément les contrôles de complétude et de
taille : les assertions des fixtures fautives doivent faire échouer la commande
de test. Les refus sont ici un résultat attendu de la fonction ; ils ne doivent
pas faire échouer le test lorsque la protection fonctionne. La suite fait déjà
partie de `npm test`, réparti par `bin/tests-groupe.js` dans la CI.

Les réponses simulées ne prouvent pas qu'un patch réel est complet sur GitHub.
À l'ouverture de chaque PR, relire le contexte et le verdict réels. Aucune regex
locale ni limite de fichier ne remplace ce contrôle. La politique de revue et
de fusion reste inchangée ; seul son test est dans le périmètre proposé.

## Exécution et critères de fin proposés pour 19.2

Conserver les commandes des trois familles ci-dessus en local et en CI. Le travail
autorisé par 19.1 est ce document ; les manipulations suivantes sont proposées
pour 19.2 et n'ont pas été exécutées ici :

1. Vérifier le cas correct sur la révision de départ, dépendances installées.
2. Appliquer un seul contre-exemple dans une copie temporaire, hors du checkout
   de travail. La commande correspondante doit sortir en échec pour l'assertion
   métier attendue ; une erreur d'installation ou de syntaxe ne compte pas.
3. Restaurer la copie et vérifier le retour au vert. Conserver le contre-exemple,
   la commande, sa sortie utile et les révisions de code/test dans la PR de 19.2.

Les trois familles d'erreurs doivent disposer de ces deux preuves, rouge puis
verte. Compléter un test ou une exécution CI seulement lorsqu'une lacune est
établie ; ne pas recréer les contrôles du cadrage commun ou du préparateur de revue.
Chaque échec doit indiquer le chemin, le résultat attendu et le résultat obtenu.

Périmètre proposé : `web/src/avenir/AVenir.test.ts`, `test/cockpit-routes.test.js`,
`test/github-review.test.js`, et l'étape CI après build si nécessaire. Les copies
de contre-exemples ne sont jamais poussées dans une branche de production.
Ne modifier ni les seuils de revue, ni les règles de fusion, ni le contrat moteur.

Les critères de fin des skills restent à 16.10, leurs cas d'évaluation à 16.11,
la parité des fichiers du gate à 18.7 et les cartes de parcours à 20.5.
Le cas 3 réutilise le préparateur de revue sans modifier ses copies partagées.
Aucun outil de navigateur supplémentaire,
interdiction générale de `useEffect`, pipeline, protocole ou format d'échange
n'est créé. 19.2 attend toujours ses dépendances et une place selon 18.11.

## Validation de 19.1

Ce document associe trois incidents à leurs causes, contre-exemples, comportements
corrects, protections actuelles et commandes. Les mutations et mesures rouge/vert
restent à produire en 19.2 : aucune efficacité supplémentaire n'est revendiquée.
La clôture documentaire de 19.1 exige sa PR fusionnée ; sa dispense de recette de
production est conservée. Le suivi partagé porte l'accord exceptionnel et les
preuves de validation, sans modifier les cadrages des autres étapes.
