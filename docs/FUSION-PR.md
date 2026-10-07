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

## Preuves de tests et de revue des PR d'agent

Une PR ouverte par le publieur pour un run (branche `agent/…`) porte une livraison dans
l'event store. Quand le pipeline a des juges, cette livraison garde une attestation :
l'arbre Git que le superviseur du moteur a testé et fait relire, les reviewers réellement
employés (agent, runtime, modèle, session) et leur verdict. Voir `docs/REVUE-INDEPENDANTE.md`
dans agent-orchestrator.

À chaque passage, le publieur lit l'arbre du commit de tête sur GitHub (`git/commits/<sha>`)
et applique `raisonPreuvesFusion` du moteur :

- tête dont l'arbre n'est pas l'arbre attesté (correction ci-autofix, push manuel) : fusion
  refusée, y compris sur un clic. Le publieur dépose la tête dans le dépôt du NAS
  (`refs/orch/pr-heads/<run>`) et crée une commande `run.reverify`, une seule par tête. Le
  runner rejoue tests et revues obligatoires sur cet arbre ; la correction bornée du
  pipeline s'applique si une revue ou un test échoue ;
- livraison sans tests ni revue attestés (pipelines d'avant `improve-app@6`, runs anciens) :
  fusion explicite depuis le cockpit seulement ;
- preuves valides, CI verte sur le merge exact, aucune conversation ouverte, aucun fichier
  sensible : le publieur fusionne lui-même en squash, avec le SHA de tête vérifié
  (`PUBLIEUR_FUSION_AUTO=0` laisse toutes les fusions au clic) ;
- preuves valides mais fichiers sensibles : décision de Raphaël dans le cockpit.

Le contrôle est refait juste avant le PUT, sur le SHA exact : un clic ne peut pas fusionner
une tête que tests et revues n'ont pas couverte. Après une revérification, le publieur ne
pousse jamais en force : si le moteur livre un nouveau commit, il descend de la correction
et part en avance rapide.

Le workflow `agent-gated-merge.yml` d'un dépôt de projet ne voit pas ces preuves. Il ne doit
donc pas fusionner les branches `agent/` : elles sont laissées au publieur.

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
