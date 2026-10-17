# Correction automatique des échecs CI

`.github/workflows/ci-autofix.yml` déclenche une correction cloud quand la CI d'une PR
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
| `signaler` | `pull-requests: write` | aucun | non | poste le marqueur de correction ou l'arrêt |
| `corriger` | `contents: read` | `CLAUDE_CODE_OAUTH_TOKEN`, à la seule étape Claude | l'agent le lit, ne l'exécute pas | produit un patch |
| `publier` | `contents: read`, `pull-requests: write`, `id-token: write` | jeton de l'app Claude, obtenu par OIDC dans ce job, puis révoqué | non | valide, commite, pousse, rend compte |

Le push passe par le jeton de l'app Claude parce qu'un push fait avec `GITHUB_TOKEN` ne
déclenche pas de nouvelle CI. Ce jeton est demandé avec `contents: write` seul. Si le service
d'échange refuse la portée réduite, le job reprend la portée par défaut de l'app (contents,
pull requests, issues en écriture) et l'écrit dans le résumé du run. Dans les deux cas, le
jeton ne sert qu'à un `git push HEAD:refs/heads/<branche validée>` sans `--force`, dans un job
qui n'exécute aucun code de la PR, et il est révoqué à la sortie du script.

## Contrôles

Conservés depuis la version précédente :

- branche du dépôt lui-même, préfixe `codex/`, `claude/`, `agent/` ou `automation/` ;
- PR ouverte dont la tête est le SHA exact du run en échec ;
- une transmission par tentative de CI (`<!-- ci-autofix:<sha>:<tentative> -->`) ;
- pas de seconde correction sur un échec d'un commit `[ci-autofix]` en première tentative ;
  une relance depuis le cockpit (tentative suivante) est transmise ;
- refus des chemins sensibles.

Ajoutés :

- le run relu par l'API doit être le workflow `CI` (`.github/workflows/ci.yml`), en échec,
  sur ce SHA et cette branche, et sa tentative courante doit être celle de l'événement ;
- la PR doit viser la branche par défaut et venir du même dépôt ; si l'événement associe des
  PR au run, celle-ci doit en faire partie ;
- le nom de branche suit un jeu de caractères fermé avant d'apparaître dans un prompt ou une
  commande ;
- seuls les marqueurs postés par `github-actions[bot]` comptent pour la déduplication ;
- au plus 3 commits `[ci-autofix]` par PR, relances comprises ;
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
- `claude.yml` (mentions `@claude`) et `claude-code-review.yml` ne sont pas modifiés ici.
  Les copies de `ci-autofix.yml` dans agent-orchestrator, agent-registry, steam_tierList,
  tcg-generator et Saas-generator doivent suivre ce même routage, par une PR dédiée chacun.

## Recette après fusion

Un workflow `workflow_run` s'exécute toujours dans sa version de la branche par défaut, et
l'échange OIDC vérifie aussi ce fichier sur `main` : rien ne peut être essayé sur GitHub avant
la fusion.

1. PR `claude/` de test avec un test volontairement cassé : les quatre jobs tournent, un commit
   `… [ci-autofix]` arrive sur la branche et la CI repart dessus.
2. Résumé du job `publier` : noter si la portée réduite `contents: write` a été acceptée.
3. Même PR, CI encore rouge sur le commit `[ci-autofix]` : commentaire d'arrêt, rien d'autre.
   Le cockpit affiche « escaladée ».
4. Relance depuis le cockpit : la tentative 2 est transmise une fois, pas deux.
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
