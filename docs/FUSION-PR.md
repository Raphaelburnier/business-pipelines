# Fusion des PR : preuves CI et décision du cockpit

La commande signée `github.merge` porte `depot`, `numero`, `sha` (tête) et
`baseSha` (branche par défaut au moment du clic). Le cockpit ne reçoit aucun jeton.
Le publieur relit GitHub et conserve le triplet testé dans le résultat de la commande.
Les anciennes demandes sans base sont refusées ; il faut recharger le relevé et recliquer.

## Preuve du code testé

Pour un événement `pull_request`, `github.sha` désigne le commit de merge ; le SHA de
la branche source vient de `github.event.pull_request.head.sha`.
[Contexte des événements GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).

Le workflow nommé exactement `CI`, dans `.github/workflows/ci.yml`, expose une étape :

```text
Verify tested merge (merge=<40 caractères>, head=<40 caractères>, base=<40 caractères>)
```

Son script vérifie que le checkout est ce merge, qu'il a exactement deux parents (base,
tête), et que la base est encore la branche par défaut distante. Les tests suivent.
Le publieur lit les jobs de la tentative exacte et exige que cette étape ait réussi ;
il relit aussi le commit et ses parents par l'API Git.
[Jobs d'une tentative](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt),
[parents du commit](https://docs.github.com/en/rest/git/commits#get-a-commit).
Les dates de création du run et du commit ne constituent aucune preuve.

Une autre CI, un succès ancien suivi d'une nouvelle tentative, `neutral`, `skipped`,
un job sans cette preuve ou une base différente bloquent la fusion. La preuve dépend du
workflow CI approuvé dans le dépôt : modifier ce workflow exige une fusion explicite.

## Métadonnées et décision

Le relevé utilise le détail actuel de chaque PR. Il lit toutes les pages de fichiers et
les anciens noms des renommages. Une liste incomplète est bloquante (limite GitHub :
3 000 fichiers). Les conversations sont lues via GraphQL ; toute conversation non résolue
ou toute réponse illisible bloque. Les fichiers sensibles et le code de cette politique
sont signalés au cockpit. Le clic d'une identité tailnet autorisée vaut décision explicite.

Avant le PUT en squash, le publieur relit la CI, les conversations, la PR, la branche par
défaut et sa tête. Il refuse tout changement de tête/base depuis le clic. Le workflow
d'auto-fusion vérifie les mêmes preuves, refuse les fichiers sensibles et se limite aux
branches internes `codex/`, `claude/`, `agent/` et `automation/`.
Il refuse plus de 100 conversations plutôt que de valider un relevé partiel.
Aucun de ces deux composants ne checkout ni n'exécute le code de la PR.

Le PUT REST garantit la précondition sur la tête avec `sha`. Il ne propose aucune
précondition atomique sur la base : une modification concurrente de la base après la
dernière lecture reste une limite de GitHub. Cette validation ne remplace pas une
protection de branche sur GitHub Free privé.
[Contrat REST de fusion](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request).

## Mise en service

1. Fusionner explicitement les PR du moteur et du registre, puis celle du cockpit :
   elles modifient les workflows de CI et de fusion.
2. Livrer ensemble le nouveau moteur et le cockpit. Le moteur exige désormais `baseSha`
   dans toute nouvelle commande `github.merge`. La CI du cockpit épingle le moteur
   `26532672ed9a5631989b5c1fe83d8ef027c6ef61` pour vérifier exactement ce contrat.
3. Attendre un nouveau relevé du publieur et une CI comportant la preuve sur chaque PR
   ouverte. Une ancienne CI verte ne suffit pas après migration ou changement de base.
4. Pour les autres dépôts surveillés et les générateurs de nouveaux dépôts, adopter ce
   format de preuve et les nouveaux contrôles avant d'autoriser leur fusion ici.

Le jeton du publieur demande Contents et Pull requests en écriture, Actions en lecture ;
le droit Checks n'est pas utilisé. Les autorisations de fusion restent dans
`specs/livraison.json`. Les résultats de tests locaux et les preuves GitHub sont consignés
dans la page du vault `plan-runs-dev-autonomes`.
