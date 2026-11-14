# TaskBoard : rendre exécutables le registre et agent-secrets

Résumé : ajouter deux projets au catalogue pour préparer des plans qui couvrent tous
les dépôts annoncés. Les fiches réutilisent les contrats et le pipeline existants.
Le raccordement a été validé le 12 novembre ; les fiches et les montages sont
fusionnés par #238. Les copies Git NAS, l’alias SSH du PC et sa liste d’admission
sont préparés. La confiance Git de l’image doit encore être complétée et les accès
du publieur vérifiés avant l’approbation du modèle et la livraison opérateur.

## Fonctionnement proposé

| Projet | Dépôt du runner | Dépôt du worker PC | Vérifications |
| --- | --- | --- | --- |
| agent-registry | `/git/agent-registry.git` | `agenticos-git:/volume1/docker/git/agent-registry.git` | `npm ci`, `npm run valider` |
| agent-secrets | `/git/agent-secrets.git` | `agenticos-git:/volume1/docker/git/agent-secrets.git` | environnement Python verrouillé, pytest, mypy, recettes du gate, syntaxe des scripts, paquet |

Les deux fiches utilisent `improve-app@9` avec revue de sécurité obligatoire.
Cette version, déjà utilisée par le cockpit, apporte les procédures partagées
versionnées ; les tests et les revues restent ceux du pipeline publié.
Le travail est réalisé sur le PC et produit une PR ; un run ne livre aucun service.
Le catalogue des tâches admissibles et les autorisations de fusion restent ceux
déjà validés. Les tâches qui modifient la machine locale ne deviennent pas
exécutables simplement parce que ces deux projets existent.

Un groupe TaskBoard reste enregistré en une transaction, après validation de chaque
plan. Un dépôt inaccessible ou non préparé bloque son lancement ; aucun identifiant
de connexion n’est inventé et aucun dépôt annoncé n’est retiré silencieusement.

## Préparation et isolation

Le registre se vérifie sur ses définitions, avec son validateur officiel. La règle
des versions publiées immuables reste imposée par la CI du registre ; son contrôle
Git ne s’exécute pas dans le snapshot de vérification, qui exclut volontairement
`.git`. Pourquoi : monter l’historique dans le vérificateur élargirait son accès
alors que la CI possède déjà la base Git nécessaire à ce contrôle.

agent-secrets se vérifie avec Python 3.12 et uv 0.12.3, comme sa CI. Le bootstrap de uv
est placé dans le `/tmp` isolé du vérificateur ; aucune installation globale et aucun
outil de préparation ajouté au paquet produit. Seule la
préparation des dépendances a le réseau ; les contrôles utilisent ensuite `.venv`
sans réseau. Les tests emploient leurs données factices. Aucun coffre, jeton,
identifiant de production ni accès Infisical supplémentaire n’est nécessaire.

## Raccordement NAS à approuver

Le runner doit pouvoir cloner puis pousser ses branches `run/…` et `agent/…` vers
deux dépôts de travail dédiés. Ils devront être montés individuellement en écriture,
comme les dépôts de travail actuels, avec les entrées `safe.directory` correspondantes.
Ces deux chemins doivent aussi figurer dans la configuration système Git de
l’image, comme les quatre dépôts existants. Pourquoi : la réception locale d’une
poussée vérifie elle-même le propriétaire du dépôt ; les exceptions transmises
dans l’environnement du client ne suffisent pas à ce contrôle. Les deux ajouts
du Dockerfile complètent les mêmes chemins de confiance que le montage autorisé.
Le dossier Git entier ne doit pas être monté dans le runner. Pourquoi : ses agents
ne doivent pas gagner l’accès aux dépôts des autres projets.

Ces dépôts de travail sont distincts des miroirs de confiance de `/git/systeme`,
utilisés par le livreur. Le registre installé sous `/app/agent-registry` reste en
lecture seule ; travailler sur sa copie ne change pas les agents déjà installés.
Le publieur conserve seul les accès GitHub de publication. Si ses permissions ne
couvrent pas ces dépôts privés, l’opérateur doit les accorder via les outils dédiés ;
aucune valeur de jeton n’est lue ou inscrite dans cette proposition.

`agenticos-git` est un alias SSH local du PC vers le même NAS et le même utilisateur
que les projets existants. Sa configuration contient l’adresse privée et reste hors
du dépôt public. Elle n’accorde aucun droit supplémentaire ; les clés et la vérification
d’hôte restent celles de la connexion existante. Pourquoi : le PC doit pousser ses
checkpoints dans le dépôt nu que le NAS lit, sans publier une adresse personnelle.
Pointer `repoWorkers` sur GitHub casserait cet échange et exigerait un accès de
publication sur le PC. L’alias doit donc être configuré et testé avant activation.

Le changement des montages Docker modifiera l’empreinte du modèle de livraison.
Il faut donc préparer et tester ce modèle, puis faire approuver son empreinte
fusionnée par Raphaël avant le clic Livrer. Cette PR prépare les deux montages
et leurs deux exceptions Git ; elle ne doit pas être activée avant la préparation
des dépôts et l’approbation du nouveau modèle.
Sources : `docs/SPEC-modele-livraison-approuve.md` et AGENTS.md commun, invariants
sur les livraisons et les fusions sensibles. Pourquoi : un ajout de volume change
les dépôts auxquels le runner peut accéder, indépendamment de l’interface.

## Vérification attendue

- Résolution des deux fiches avec le registre réellement publié ; étapes de revue
  conservées et publication liée au dépôt correct.
- Exécution de chaque profil par le vrai vérificateur Bubblewrap, sur les commits
  actuels, sans modèle, secret ou fichier de production.
- Préparation NAS : dépôts de travail distincts, lecture du registre installé
  conservée et aucun accès en écriture aux miroirs de confiance.
- Recette TaskBoard : proposition groupée complète et aucun départ partiel.
- Après activation opérateur seulement : préparation réelle d’un plan depuis le
  cockpit, puis run de recette explicitement lancé par Raphaël.

## Recette avant livraison

Les profils des deux projets passent dans le vrai vérificateur Bubblewrap.
Le trajet PC vers dépôt NAS puis retour NAS vers PC a aussi été exercé avec
le transport SSH et les fonctions de checkpoints de l’image installée : les
deux projets passent après ajout temporaire des deux chemins à la configuration
système Git du processus de test. Les branches principales restent inchangées,
les branches de recette sont supprimées et aucun modèle n’est appelé.

Le fichier système temporaire reproduit les deux ajouts du Dockerfile ; il ne
modifie ni l’image installée ni les services permanents. Les nouveaux montages
du runner doivent encore être vérifiés après la livraison opérateur. Le lot
11.6 et le défaut O6 restent donc en cours dans le TaskBoard.

## Recette après livraison du 13 novembre 2026

La livraison opérateur `645320b6` a installé le cockpit `81757910`, le moteur
`ca1aaec2` et le registre `a9b1627` (release `cockpit-20261113-122306`). La santé
de la plateforme est verte. Le contrôle depuis le publieur confirme les deux
dépôts accessibles avec les droits de publication.

Les deux projets apparaissent dans la topologie. Dans le runner installé, leurs
montages individuels sont en écriture, le registre installé reste en lecture seule
et la configuration Git système admet les deux chemins sans joker. Les checkpoints
PC → runner → PC passent pour les deux projets, sans configuration temporaire de
remplacement ; les branches principales sont conservées et les branches de test
supprimées.

La recette navigateur du cockpit réel prépare les deux plans du groupe 9.3
(cockpit et registre) et une proposition pour agent-secrets, tous lançables sur
`improve-app@9`. Aucun départ n’est envoyé ; aucune erreur JavaScript n’est relevée
sur les vues desktop et mobile.

Le worker connecté annonce encore `523e81e7` ; seul un test diffère de `ca1aaec2`.
Sa copie `ca1aaec2` est préparée. La bascule a été refusée avant la pause car un
run opérateur avait commencé : ne pas interrompre ce travail pour aligner le SHA.
Le contrôle final du worker et le run de recette lancé explicitement par Raphaël
sur un des projets nouvellement raccordés restent attendus. 11.6/O6 restent en
cours ; aucun objectif 11.6 n’est proposé dans le catalogue attribuable.

## Reprise de la recette les 13 et 14 novembre 2026

La recette opérateur du registre a passé le plan, l'implémentation, les tests et la
revue de code. Le quota Claude de la revue de sécurité a déclenché un relais Codex,
qui a attribué à tort le journal du superviseur au reviewer (R10). Le correctif
moteur #122 a été livré en `58bd7d41`, sur le NAS puis le worker PC. La recette du
runtime installé accepte ce journal et refuse toujours une écriture dans la revue.

Le run conserve son contrat et ses étapes validées. Sa reprise exige un instantané
de revue qui n'existe plus ; son rejeu avec `--depuis review-security` devrait
ouvrir une session neuve, mais le dispatcher transmet encore la session de l'ancienne
attente au worker (R11). Le correctif doit respecter le choix de reprise existant.
Les tests avec maître et worker réels couvrent la reprise quota avec session conservée,
le rejeu avec session neuve et le refus inchangé d'une vraie reprise sans instantané.
11.6/O6/R10/R11 restent en cours jusqu'à la recette complète, sans nouvel objectif
attribuable ajouté ni nouvelle forme de message entre composants.

## Ordre d’activation opérateur

0. Configurer l’alias SSH `agenticos-git` sur le PC du worker à partir de la connexion
   NAS existante : mêmes hôte, utilisateur et mécanisme de clé, sans désactiver la
   vérification d’hôte. Le tester par un `git ls-remote` sur un dépôt de travail déjà
   accessible, puis sur chacun des deux nouveaux dépôts après leur préparation.
   Si `ORCH_WORKER_DEPOTS` restreint les dépôts du worker, ajouter explicitement ces
   deux URL avec l’alias : le contrôle compare leur texte avant la résolution SSH.
   Ne pas remplacer cette liste par une autorisation globale.
1. Préparer sur le NAS les deux dépôts nus de travail, distincts de `/git/systeme`.
   Depuis un poste où les clones privés sont déjà disponibles, un `git bundle create`
   de leur branche `main` permet un transfert hors ligne. Sur le NAS, `git clone --bare`
   de chaque bundle initialise le dépôt correspondant avant tout changement de montage.
   Un dépôt existant doit être inspecté et conservé ; ne pas le remplacer.
2. Contrôler leur branche `main`, leur `HEAD` symbolique et les droits de lecture et
   de poussée du runner, selon les dépôts de travail déjà installés. Un clone suivi
   d’une poussée de branche temporaire, puis de sa suppression, vérifie ces droits.
   Ne jamais créer ces copies dans `/git/systeme` ni leur donner l’option miroir.
3. Vérifier que le publieur peut lire les deux dépôts GitHub et publier leurs PR avec
   son accès existant. Si les permissions manquent, les régler par les outils dédiés.
   Le jeton de lecture des miroirs de déploiement n’est pas un accès de publication.
4. Faire valider et fusionner la PR. Inspecter et approuver le modèle sur le SHA
   fusionné, avec `bin/modele-livraison.js`, selon la procédure existante.
5. Demander la livraison depuis le cockpit. Après livraison, contrôler les deux
   projets dans `/api/projects`, la santé et le worker PC, puis le formulaire groupé.

La préparation des dépôts précède la livraison : un montage de répertoire vide ne
constitue pas un dépôt Git utilisable. Aucune commande de cette liste n’est exécutée
automatiquement par cette PR.

## Limites

Les deux fiches ne donnent pas accès aux secrets ; elles permettent de travailler
sur le code du registre et d’agent-secrets. Les mises à jour de leurs services,
les changements d’approbation et les tâches de configuration du poste conservent
leurs règles propres. Aucun nouveau message entre cockpit, moteur et worker.
