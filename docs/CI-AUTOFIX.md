# Correction automatique des échecs CI

Résumé : le correcteur distingue les erreurs des PR de celles de leur base exacte. Une base rouge prouvée ne consomme aucune transmission PR ; une CI rouge de la branche principale prépare une PR sur `automation/ci-main-<sha>`. Les workflows préparés doivent être fusionnés explicitement puis recettés sur GitHub.

`.github/workflows/ci-autofix.yml` déclenche une correction cloud quand la CI de la branche principale ou d'une PR
sur une branche `codex/`, `claude/`, `agent/` ou `automation/` échoue. Claude propose un
patch dans le job `corriger`, puis `publier` le contrôle et le pousse sur la branche.
Il s'agit d'un agent distinct de la session qui a ouvert la PR. Aucune reprise de cette
session et aucun environnement Codex Cloud ne sont nécessaires.

Le précédent chemin `codex/` publiait seulement un commentaire `@codex`. Sur la PR #92,
le connecteur a répondu « create an environment for this repo » : le signalement était
vert sans tâche de correction. Depuis cette correction, tous les préfixes utilisent le
circuit Claude déjà vérifié jusqu'au push et à la CI verte sur la PR #90.
La recette #116 a ensuite montré que le validateur de publication excluait encore
`codex/` : Claude produisait le bon patch, puis `publier` le refusait avec « branche
non admise ». La même liste de quatre préfixes est désormais vérifiée au tri et à
la publication. Les tests exécutent le commit et le push sur un dépôt temporaire
pour chacun des quatre préfixes ; les branches hors périmètre et les fichiers
sensibles restent refusés avant toute demande de jeton.
Le cockpit peut relancer les jobs échoués : un nouvel échec est alors une nouvelle
tentative de CI, transmise à son tour.

Le contenu de la branche n'est pas fiable. Le code, les tests, la documentation, les fichiers
d'instructions et la sortie des tests (donc le log) peuvent contenir des consignes destinées à
l'agent. Le workflow ne compte donc pas sur l'obéissance de l'agent : chaque étape reçoit
uniquement les droits dont elle a besoin, et la publication revérifie tout ce que l'agent
produit.

## Parcours

```
CI (pull_request) en échec
  └─ trier      lecture seule, aucun code de la PR exécuté
       ├─ rien     (hors périmètre, déjà traité, PR fermée ou déplacée…)
       ├─ boucle → signaler : arrêt commenté sur la PR
       └─ claude → signaler : marqueur de transmission
                   └─ corriger : Claude propose un patch (sans droit d'écriture)
                        └─ publier : validation, commit [ci-autofix], push, compte rendu
```

## Permissions par job

Le workflow déclare `permissions: {}` ; chaque job ouvre les siennes.

| Job | Jeton GitHub | Secret | Exécute le code de la PR | Rôle |
|---|---|---|---|---|
| `trier` | `actions: read`, `contents: read`, `pull-requests: read` | aucun | non | relit le run, la PR, les commits et les commentaires ; collecte et nettoie le log |
| `signaler` | `contents: write`, `pull-requests: write` | aucun | non | réserve une branche de correction main ou poste le marqueur PR |
| `corriger` | `contents: read` | `CLAUDE_CODE_OAUTH_TOKEN`, à la seule étape Claude | l'agent le lit, ne l'exécute pas | produit un patch |
| `publier` | `contents: read`, `pull-requests: write`, `id-token: write` | jeton de l'app Claude, obtenu par OIDC dans ce job, puis révoqué | non | valide, commite, pousse, rend compte |

Le push passe par le jeton de l'app Claude parce qu'un push fait avec `GITHUB_TOKEN` ne
déclenche pas de nouvelle CI. Ce jeton est demandé avec `contents: write` seul pour une PR existante, et avec `pull_requests: write` en plus pour ouvrir la PR de correction de main. Si le service
d'échange refuse la portée réduite, le job reprend la portée par défaut de l'app (contents,
pull requests, issues en écriture) et l'écrit dans le résumé du run. Dans les deux cas, le
jeton ne sert qu'à un `git push HEAD:refs/heads/<branche validée>` sans `--force`, dans un job
qui n'exécute aucun code de la PR, et il est révoqué à la sortie du script.

## Contrôles

Conservés depuis la version précédente :

- branche du dépôt lui-même, préfixe `codex/`, `claude/`, `agent/` ou `automation/` ;
- PR ouverte dont la tête est le SHA exact du run en échec ;
- une transmission par tentative de CI (`<!-- ci-autofix:<sha>:<tentative> -->`) ;
- une CI encore rouge sur un commit `[ci-autofix]` déclenche une nouvelle correction
  automatiquement, tant que le budget de la PR n'est pas épuisé ;
- refus des chemins sensibles.

Ajoutés :

- le run relu par l'API doit être le workflow `CI` (`.github/workflows/ci.yml`), en échec,
  sur ce SHA et cette branche, et sa tentative courante doit être celle de l'événement ;
- la PR doit viser la branche par défaut et venir du même dépôt ; si l'événement associe des
  PR au run, celle-ci doit en faire partie ;
- le nom de branche suit un jeu de caractères fermé avant d'apparaître dans un prompt ou une
  commande ;
- seuls les marqueurs postés par `github-actions[bot]` comptent pour la déduplication ;
- au plus 3 démarrages du correcteur ET 3 commits `[ci-autofix]` par PR, relances comprises ;
  les démarrages sont comptés via les marqueurs de transmission du workflow, même si
  l'agent échoue ou produit un patch vide/refusé. Un commit humain ne remet pas ce budget à zéro ;
- un échec limité à l'étape « Verify tested merge » (base périmée) n'appelle aucun agent :
  un commentaire demande de mettre la branche à jour. Relancer les jobs échoués depuis le
  cockpit réutilise l'ancien merge et échoue de la même façon dès que `main` a avancé ;
- un arrêt porte son propre marqueur (`ci-autofix-arret:`) et la phrase que lit le suivi des
  livraisons du publieur.

Dans `corriger` :

- checkout du SHA exact, sans identifiant persistant ;
- `.git` sort de l'espace de travail et passe en lecture seule : l'agent ne peut toucher ni la
  configuration git (hooks, fsmonitor) ni l'historique ;
- les dossiers `.claude/`, les `.mcp.json` et `CLAUDE.local.md` de la branche sont supprimés
  avant le lancement. En `workflow_run`, l'action ne les restaure pas depuis la base ; un hook
  ou un serveur MCP de la branche se serait exécuté avec le secret ;
- action épinglée par SHA, `github_token` en lecture seule (sinon l'action obtient le jeton
  d'écriture de l'app), `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, hooks désactivés ;
- bubblewrap installé avant Claude : sans lui, ce nettoyage d'environnement empêche Claude
  Code de démarrer (trouvé à la recette du 2026-10-12) ;
- outils : `Read`, `Edit`, `Write`, `Glob`, `Grep`. Pas de `Bash`, pas de réseau. Règles de
  refus sur `/proc`, `/etc`, `/tmp`, les fichiers du runner (`_temp`, `_actions`) et les
  fichiers de configuration du compte ;
- les fichiers vides non suivis que le bac à sable laisse à la racine pour masquer `.env*`,
  `.npmrc`, `bunfig.toml`, `yarn.lock`, etc. sont retirés avant de construire le patch ; un
  tel fichier avec du contenu reste dans le patch et la publication le refuse ;
- les étapes suivantes remettent à zéro `BASH_ENV`, `LD_PRELOAD`, `NODE_OPTIONS`, le `PATH` et
  la configuration git globale, au cas où l'agent aurait écrit un fichier lu par le runner.

Dans `publier`, sur un checkout propre du SHA :

- le patch doit partir de ce SHA et s'appliquer avec `git apply --check` ;
- refus des chemins sensibles (la liste de `agent-gated-merge.yml`, plus `.claude/`,
  `.mcp.json`, `package.json`, fichiers de verrouillage, `.npmrc`, `.gitattributes`,
  `.gitmodules`), des liens symboliques, sous-modules, changements de mode, binaires ;
- refus de supprimer un fichier de test ou d'ajouter `skip`, `only`, `todo`, `xit`… dans un
  test ;
- au plus 20 fichiers, 600 lignes, 300 Ko ; refus des ajouts qui ressemblent à un jeton
  (GitHub, Anthropic, AWS, Slack, clé privée) ;
- titre de commit réduit à une ligne imprimable, préfixe conventionnel imposé, marqueur
  `[ci-autofix]` ajouté par le workflow ;
- PR relue juste avant le push (ouverte, même branche, même tête) ; push simple, que GitHub
  refuse si la branche a avancé.

Le compte rendu cite la note de Claude comme non vérifiée, sans HTML ni mention active. Un
correctif refusé reste sept jours dans les artefacts du run.
Si rien n'est poussé, le compte rendu porte `ci-autofix-echec:<sha>:<tentative>` : le cockpit
affiche l'escalade même si aucun commit de correction n'existe. Une nouvelle transmission
sur la même tête remplace cet arrêt ; un arrêt portant sur une ancienne tête ne bloque pas
la tête courante. L'arrêt pour merge périmé reste distinct et demande une mise à jour de branche.

## Base rouge et branche principale (lots 1.3 et 5.3)

Le tri extrait la base du triplet de merge réussi du run, avec la tête exacte de la PR.
La dernière CI hors PR sur cette base doit être terminée en échec. Les couples job/étape
échoués et les logs complets normalisés doivent coïncider : seuls l'en-tête horodaté de
`gh`, les codes ANSI et les durées TAP sont retirés. Les valeurs `actual`/`expected`,
les noms de tests et les diagnostics TypeScript sont conservés. Un simple code de sortie
sans diagnostic reconnaissable ne prouve pas une erreur héritée.

Si la preuve existe, `signaler` pose `ci-autofix-base:<tête>:<tentative>`, distinct des
transmissions et arrêts. Aucune correction de cette PR n'est demandée, même si les trois
transmissions précédentes sont déjà consommées. Ce commentaire n'affirme pas que la
correction de la base a réussi : son workflow et sa branche restent à vérifier. Si la
preuve est incomplète ou si un autre échec s'ajoute, le parcours PR habituel reste actif.
Cette comparaison stricte privilégie l'absence de faux positifs : un log variable hors des
durées TAP peut empêcher la reconnaissance d'un échec pourtant hérité.

Les CI `push`, `schedule` et `workflow_dispatch` sur la tête courante de la branche par
défaut sont admissibles. Le tri relit le run, sa tentative et la dernière CI pour ce SHA.
`signaler` réserve atomiquement `automation/ci-main-<sha>` par l'API GitHub avant Claude,
avec `GITHUB_TOKEN`. Une réservation existante empêche une seconde préparation, y compris
après quota, refus du patch ou CI nocturne. Une relance des seuls jobs échoués ne rappelle
pas Claude pour main (`github.run_attempt == 1`). Une reprise humaine doit donc examiner
la réservation et les artefacts ; elle n'est pas réarmée automatiquement.

`corriger` conserve son jeton en lecture, ses outils limités et son isolement. `publier`
valide le patch avec les mêmes bornes et chemins sensibles, relit la base courante et le
SHA de la réservation, pousse sans force sur cette seule branche, puis ouvre la PR avec
le jeton d'application. La création par l'app déclenche la CI de PR normale. Aucune écriture
sur la branche principale, fusion ni déploiement direct n'est ajouté. La PR créée reste
soumise aux mêmes règles de CI, revue et fusion que les autres branches `automation/`.
Un échec d'ouverture de PR conserve le correctif sur la branche et laisse un diagnostic
dans le résumé du workflow.

Les six copies du correcteur sont alignées. Leurs CI s'exécutent aussi après push sur leur
vraie branche par défaut et chaque nuit. La preuve du merge et le contrôle d'immuabilité du
registre restent réservés aux événements PR ; les commandes de test/build propres à chaque
dépôt sont conservées.

## Tests

`test/ci-autofix.test.js` (dans `npm test`) :

- lit le YAML : permissions exactes par job, secret limité à l'étape Claude, aucune expression
  `${{ }}` dans un script, prompt limité aux valeurs validées, checkout du SHA, outils et
  règles de Claude, absence de code de PR dans les autres jobs, parité des chemins sensibles
  avec la fusion automatique ;
- exécute le vrai Bash du tri, du signalement, de l'isolement, de l'emballage, de la
  validation, du push et du compte rendu contre un `gh` et un `curl` factices et de vrais
  dépôts git, dont un dépôt distant local pour le push ;
- couvre les refus : autre workflow, fork, branche hors préfixe ou injectée, tentative plus
  récente, PR fermée, déplacée ou vers une autre base, déduplication, boucle, limite de
  corrections, API illisible, chaque famille de chemin sensible, lien symbolique, mode,
  binaire, test supprimé ou sauté, bornes, secret, patch qui ne s'applique pas, branche
  avancée pendant la publication, jeton indisponible ;
- vérifie que `src/suivi-livraisons.js` lit toujours ces commentaires (transmise, poussée,
  escaladée).

## Limites résiduelles

- Le jeton OAuth vit dans le processus de Claude, qui lit du contenu non fiable. Sans shell,
  l'exfiltration demanderait un contournement des règles de refus de Claude Code ; un patch
  contenant un jeton Anthropic est de toute façon refusé à la publication. Le risque n'est pas
  nul tant qu'un secret et un contenu non fiable partagent un processus.
- Une injection peut orienter le correctif dans du code non sensible. Les bornes, la CI qui
  repasse et la revue Claude limitent l'effet, mais `agent-gated-merge` fusionne seul une PR
  `claude/` verte : ce risque existait déjà et n'est pas supprimé.
- Sans shell, Claude ne lance plus les tests avant de proposer. Une correction ratée coûte un
  aller-retour de CI, borné par la limite de 3.
- L'échange OIDC vers le jeton de l'app Claude utilise le service d'Anthropic qu'appelle
  `claude-code-action`, sans documentation publique. S'il change, la publication échoue
  proprement : commentaire sur la PR, patch dans les artefacts.
- Un agent qui contournerait les règles et écrirait dans les fichiers du runner pourrait
  agir sur les étapes suivantes du même job. Les étapes sensibles neutralisent les variables
  connues, mais un job GitHub n'offre pas d'isolement complet entre ses étapes. Aucun workflow
  du dépôt n'utilise `actions/cache` ; en ajouter un demande de revoir ce point.
- Toutes les corrections utilisent l'abonnement Claude configuré dans le dépôt, y compris
  pour les PR ouvertes par Codex. Un quota épuisé ou un jeton expiré fait échouer le job
  `corriger` ; le compte rendu sur la PR indique alors que rien n'a été publié.
- Sur GitHub Free privé, rien n'empêche un push direct hors de ce workflow.
- `claude.yml` (mentions `@claude`) conserve son fonctionnement.
  Les copies de `ci-autofix.yml` dans agent-orchestrator, agent-registry, steam_tierList,
  tcg-generator et Saas-generator doivent suivre ce même routage, par une PR dédiée chacun.

## Recette après fusion

Un workflow `workflow_run` s'exécute toujours dans sa version de la branche par défaut, et
l'échange OIDC vérifie aussi ce fichier sur `main` : rien ne peut être essayé sur GitHub avant
la fusion.

1. PR `claude/` de test avec un test volontairement cassé : les quatre jobs tournent, un commit
   `… [ci-autofix]` arrive sur la branche et la CI repart dessus.
2. Résumé du job `publier` : noter si la portée réduite `contents: write` a été acceptée.
3. Même PR, CI encore rouge sur le commit `[ci-autofix]` : deuxième correcteur sans relance
   humaine. Une nouvelle CI teste le nouveau commit. Après trois démarrages au plus, tout
   nouvel échec est arrêté et le cockpit affiche « escaladée ».
4. Relance depuis le cockpit : la tentative 2 est transmise une fois, pas deux, et seulement
   s'il reste du budget. Vérifier aussi l'arrêt sans commit (quota, patch vide ou refusé).
5. Branche `codex/` en échec : les jobs `corriger` et `publier` tournent comme pour `claude/` ;
   un commit `[ci-autofix]` arrive et la CI redevient verte, sans mention `@codex`.
   Un commentaire seul ne prouve pas la correction.
6. Branche `claude/` qui ajoute `.claude/settings.json` avec un hook : le log de `corriger`
   montre la suppression, le hook ne tourne pas.

## Relance d’un commit publié par l’application Claude

L’acteur GitHub d’une CI reste celui du push initial même si une personne relance ses jobs.
`corriger` autorise donc uniquement l’application `claude` dans `allowed_bots`, sans wildcard.
Les contrôles du dépôt, de la branche, du SHA et de tentative précèdent toujours l’agent.
La recette du 17 octobre a reproduit le refus par défaut sur `claude[bot]` après une relance
humaine (run39021317003). Le test de configuration impose cette valeur exacte.

La recette a aussi reproduit une incompatibilité de `ActionsChat` avec le nouveau type
`execution` du moteur. La PR118, fusionnée pendant la recette, fournit le rendu de cette
variante ; ce correctif conserve son implémentation.

## Revue après un correctif publié automatiquement

### Verdict explicite sur un instantané (lot 6.1)

Le plugin de revue pouvait réussir avec un simple commentaire « aucun problème », ou
ne rien publier ; les erreurs `is_error:true` ne donnaient pas de verdict exploitable.
Le workflow conserve son nom `Claude Code Review`, mais sépare désormais lecture et
publication. La revue reste consultative et distincte du workflow `CI` : exiger ce
verdict avant fusion relève du lot 6.2, et déclencher une correction du lot 6.3.

`pull_request_target` et la relance `workflow_dispatch` utilisent seulement le code de
confiance de la branche par défaut. Aucun checkout, hook, test ou script de la PR n'est
exécuté. Le préparateur télécharge le diff et les contenus textuels aux SHA immuables,
avec la vraie base de comparaison Git. Il refuse forks, brouillons, acteurs sans droit
d'écriture et bots autres que `claude[bot]`. Une PR trop volumineuse, un binaire ou un
diff incomplet produit une indisponibilité explicite, sans appel modèle : au plus
60 fichiers, 100 Ko par fichier et 500 Ko de contexte avant/après au total.

Le relecteur utilise la base de l'action Claude épinglée, sans plugin ni jeton GitHub
d'écriture/OIDC. Ses seuls outils sont Read, Glob et Grep en mode restreint ; hooks,
MCP, shell, réseau, écriture et délégation sont désactivés. Les limites restent
40 tours et 30 minutes pour le job (25 minutes pour l'étape modèle).

Le résultat structuré distingue `approved`, `changes_requested` et une revue incomplète.
Une approbation exige tous les fichiers déclarés relus et aucun constat. Une demande de
correction exige au moins un constat ancré sur une ligne réellement changée, avec sa
priorité et sa conséquence. Le validateur rejette les données incohérentes. Un quota,
une erreur fournisseur, l'absence de résultat ou une couverture partielle ne devient
jamais une approbation ; le job est alors en échec et la publication explique la cause.

Le seul artefact conservé, `github-review-verdict-<tentative>/verdict.json`, contient
`schema_version: 1`, dépôt, PR, tête, base, merge-base, run/tentative, statut, verdict,
résumé, couverture et constats assainis. Le contexte source et le journal brut ne sont
pas publiés. Le second job, seul détenteur du droit de commenter, vérifie la provenance
et relit la PR juste avant publication. Un changement de tête ou de base donne
« PÉRIMÉE », sans approbation de la PR courante. Un marqueur lié aux SHA et au run rend
les reprises de publication idempotentes. Une revue terminée est publiée comme revue
GitHub `COMMENT` liée au `commit_id` exact, avec ses constats inline. Ses conversations
non résolues conservent leur rôle dans le gate existant. Les constats pointent le fichier
de la tête ou celui de la merge-base pour une ligne supprimée. Une indisponibilité ou
un résultat périmé produit seulement un commentaire de diagnostic, sans revue approuvée.

La relance manuelle demande le numéro de la PR et doit viser la branche par défaut.
Elle permet notamment de refaire une revue après retour du quota. Une nouvelle tête
annule le travail précédent via la concurrence par PR. Les tests du contrat, des
permissions et de publication sont dans `test/github-review.test.js`, intégrés à `npm test`.

Recette native du 29 octobre : la [PR204](https://github.com/Raphaelburnier/business-pipelines/pull/204),
fermée sans fusion, a ajouté un module témoin isolé. La revue du commit
`5a34ce43f4bae6253d924be3c81b7efe0988a52d` a demandé une correction avec un constat
P1 inline sur le signe erroné ([run40786912635](https://github.com/Raphaelburnier/business-pipelines/actions/runs/40786912635)).
Après correction, le commit `a9cf29a7574f7ab9f42cf7845ecb341852937de1` a reçu
`approved`, sans constat ([run40787127326](https://github.com/Raphaelburnier/business-pipelines/actions/runs/40787127326)).
Les deux artefacts et revues publiées portent leur propre SHA et la base
`ec7ba51494c7cbce1eb465b22c2d7ee207d58a46`. Les cas quota/erreur et références périmées
sont couverts par les tests de contrat ; cette recette ne simule pas un épuisement réel du fournisseur.

Références : [sorties de l'action épinglée](https://github.com/anthropics/claude-code-action/blob/1d6de8cb0c237e7c15e9e1bdf973826ebae490cc/base-action/action.yml),
[outils et mode restreint](https://code.claude.com/docs/en/cli-reference),
[séparation des privilèges GitHub](https://docs.github.com/en/actions/reference/security/secure-use).

La recette PR120 prouvait deux corrections avec une relance humaine entre les deux. Elle
ne prouve pas encore la nouvelle succession automatique : après fusion de ce lot sensible,
recetter deux erreurs successives sans relance et vérifier la revue sur le commit du bot.
Un quota Claude épuisé reste un arrêt explicite : ce lot n'ajoute aucun basculement Codex.


### Correction déclenchée par la revue (lot 6.3)

Dans business-pipelines, `CI autofix` écoute également la fin réussie de `Claude Code
Review`. Il ne corrige que les revues automatiques `pull_request_target` sur une PR
interne ouverte, non brouillon, visant la branche par défaut et issue d’une branche
`codex/`, `claude/`, `agent/` ou `automation/`. Les cinq autres copies du correcteur
conservent leur fonctionnement CI. Le `workflow_dispatch` de revue reste consultatif :
pour relancer aussi le correcteur, relancer le run automatique de la PR. Ses métadonnées
conservent la branche de la PR et donc le verrou commun avec le correcteur CI.

Le tri relit le workflow source (nom, chemin, événement, dépôt, tête, conclusion,
tentative), refuse une revue plus récente puis télécharge l’unique artefact
`github-review-verdict-<tentative>` de ce run. L’archive et son seul fichier
`verdict.json` sont bornés (300 Ko/100 Ko), lus sans extraction ni exécution. Liens,
chemins traversants, fichiers supplémentaires et clés JSON répétées sont refusés.
Le verdict doit être `reviewed` / `changes_requested`, porter dépôt, PR, tête, base,
run et tentative exacts, et contenir des constats valides sur les fichiers relus.
`approved`, indisponibilité, quota, revue incomplète, artefact absent ou références
périmées donnent `rien`, sans appel modèle. Le diagnostic assaini remplace le log CI
comme entrée du même correcteur isolé ; un constat reste une donnée à vérifier.

Les deux déclencheurs utilisent la même concurrence par branche et le même plafond :
**trois appels et trois commits de correction par PR au total**, sans remise à zéro
après un nouveau commit ou une relance humaine. Le marqueur CI existant est conservé ;
la revue utilise `review-autofix:<tête>:<run>:<tentative>` (et `-arret` / `-echec`).
Seuls les marqueurs du bot GitHub Actions comptent. Le commit garde `[ci-autofix]`,
pour que l’historique et le budget existants restent cohérents.

Les quatre jobs et leurs permissions sont conservés. L’agent ne reçoit ni shell,
réseau ni jeton d’écriture. Le job de publication garde les limites de patch, les
refus de fichiers sensibles et de tests désactivés, la vérification du parent, le
push sans force et la révocation du jeton. Pour une revue, il relit aussi la base
exacte, la tentative et l’absence de revue plus récente ; tout déplacement annule
la publication. Le push redéclenche CI et revue sur le nouveau commit. Le correcteur
ne résout aucune conversation de revue et ne rend pas le verdict obligatoire pour
la fusion : ce dernier point reste le lot 6.2.

Les scénarios de `test/ci-autofix.test.js` exécutent le vrai Bash sur API factice,
archives ZIP et dépôts Git temporaires : déclenchement, provenance, refus, partage
de budget, déduplication et annulation avant push.
