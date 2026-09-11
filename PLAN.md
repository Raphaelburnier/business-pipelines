# Plan de construction, du marketing au déploiement

Six phases, deux dépôts. Ce fichier est l'original du découpage : quand une phase change
d'état, c'est ici qu'on l'écrit, dans le commit qui la clôt. Le plan détaillé dont il
dérive est conservé à côté, dans `docs/plan-agentique-2026-09-11.html`.

Le nombre de phases ne change pas. Un résumé de ce plan avait fusionné deux phases et
ramené le compte à cinq, ce qui a décalé toute la numérotation : « phase 3 » désignait
alors le pipeline marketing au lieu de la reprise d'exécution.

## État des phases

| Phase | Objet | État | Où |
|---|---|---|---|
| 01 | Accès direct Anthropic | Partielle | `~/.config/agent-orchestrator/backends.json` |
| 02 | Escalade en réponse libre dans le cockpit | Faite, non fusionnée | business-pipelines, `worktree-cockpit-reponse-libre` |
| 03 | Reprise d'exécution | Faite, non fusionnée | agent-orchestrator, `worktree-reprise-execution` |
| 04 | Pipeline marketing minimal | Construite, jamais exécutée | business-pipelines, `feat/pipeline-marketing` |
| 05 | Pipeline développement | À faire | business-pipelines |
| 06 | Sécurité et déploiement | À faire | business-pipelines |

## Phase 01, accès direct Anthropic

Le backend `opus-direct` existe et répond, vérifié le 11 septembre 2026 : opus-5 en 2,1 s,
sonnet-5 en 1,4 s. Ce fournisseur n'accepte que la notation à tirets dans les noms de
modèles, et refuse en amont le point de version comme le suffixe d'effort.

Ce qui manque pour clore la phase : un second backend qui court-circuite la passerelle,
avec la clé Anthropic en direct. En l'état, OmniRoute est un point unique de panne sur le
chemin payant. Ces backends vivent hors du contrôle de version, donc aucun commit ne les
porte.

## Phase 02, escalade en réponse libre

Commits `f92375f` puis `6fdfdfe`. La porte d'approbation accepte une réponse libre en plus
d'approuver et de refuser, le verdict `ORIENTE` bloque toute exécution d'action y compris
automatique, un plan périmé invalide l'orientation, et une réponse vide retombe en attente
plutôt que de boucler sur une instruction creuse.

Le handler écrit l'orientation comme artefact typé, et le cockpit affiche de quoi arbitrer.
Reste à fusionner la branche dans `main`.

## Phase 03, reprise d'exécution

Commit `8290f4a` dans agent-orchestrator. Le drapeau `--resume` saute les étapes déjà
sauvées au lieu de les repayer. La progression est tenue dans `.orch-resume.json` au sein
du workspace, écrite après le commit de l'étape, et porte l'empreinte du pipeline et du
spec : une reprise refuse de partir si l'un des deux a changé.

Reste à fusionner la branche dans `master`. Les sept scénarios de reprise vérifiés ne sont
pas dans le dépôt, par choix.

## Phase 04, pipeline marketing minimal

Construite sur la branche `feat/pipeline-marketing`, qui part de celle de la phase 02 pour
que le cockpit sache déjà orienter. Jamais exécutée : la première exécution payante reste
à lancer, et c'est elle qui donnera le coût réel.

Quatre étapes. Deux voix analysent la même demande en parallèle, `economy-analyst` et
`brand-analyst`, chacune produisant son artefact avec un schéma strict. `plan-synthesist`
les confronte en un plan unique. Un contrôle déterministe rend le verdict du gate. Une
approbation humaine tranche, question par question, dans le cockpit.

Le gate est du code, pas un juge. Le type de stage `verify-couverture` vérifie trois
propriétés qu'aucune prose ne contourne : chaque question du spec est traitée, chaque
source citée est l'identifiant d'un constat réellement écrit, et chaque constat des deux
voix est soit cité, soit écarté avec sa raison. La troisième est celle qui compte : elle
interdit de lisser un désaccord en laissant tomber le constat gênant, et c'est exactement
ce qu'un juge agentique jugerait mal, puisqu'il s'agit de comparer deux listes
d'identifiants.

Une quatrième règle a été ajoutée pour une raison que le plan d'origine ne voyait pas.
Aucune étape ne collecte de données avant ces analyses, contrairement au pipeline de prix
qui relève le marché et calcule ses statistiques avant de payer un agent. Un chiffre sorti
d'un modèle sans mesure est une invention plausible, la faute qui avait produit une médiane
inexacte d'un dollar. Tout constat qui avance un chiffre doit donc dire d'où il vient.

Le plan approuvé sort de cette phase comme artefact. C'est lui, et rien d'autre, que la
phase 05 consomme.

Budget du premier tour : deux dollars, quarante tours, quinze par agent. Les trois agents
visent le backend `opus-direct`, donc la passerelle OmniRoute doit tourner. Retirer le
champ `backend` du pipeline les ramène sur l'abonnement.

## Phase 05, pipeline développement

Entrée : le plan validé, jamais une demande libre. Boucle code et review bornée à deux
cycles, escalade au troisième. Chaque agent de code confiné à son périmètre de fichiers,
via le cloisonnement déjà présent dans le moteur.

## Phase 06, sécurité et déploiement

Des tests déterministes d'abord, sans agent. Garder en tête que des tests qui passent ne
disent pas que c'est sûr, ils disent que le comportement attendu est là. Le déploiement
reste le script existant, lancé par une étape déterministe, derrière une approbation
humaine. Un vrai scanner plus tard, quand le reste tourne.

## Points ouverts

La consigne en texte libre ne survit pas d'une exécution à l'autre. La phase 02 l'écrit
dans le workspace, et `orchestrator.js` recrée ce workspace à chaque exécution en le
vidant. La consigne est donc effacée avant que l'exécution suivante puisse la lire, ce qui
coupe la boucle d'escalade au point précis où elle devait se refermer. Constaté en
construisant la phase 04. Le remède suit ce que fait déjà le plan gelé : écrire la consigne
dans le dossier des approbations, qui est hors du workspace et durable, puis la ramener
dans le workspace au début de l'exécution suivante.

Le drapeau `--resume` de la phase 03 est inutilisable ici pour la même raison. Ce dépôt a
son propre lanceur, qui vide le workspace à chaque fois et n'ouvre aucun journal de
reprise. Deux ou trois lignes à changer, mais c'est un changement de sémantique
d'exécution, à décider plutôt qu'à glisser.

La clé Anthropic hors passerelle, décrite en phase 01.

Le ménage des anciennes pipelines. Le plan d'origine l'estimait à trois fichiers de
pipeline, quatre scripts npm et une entrée de compose. C'est plus profond que ça : le
service `cycle` du compose relance le plan de prix toutes les quinze minutes, et les tests
de la veille, d'eBay, de l'exécution et de l'exécuteur de prix tombent avec. Décision à
prendre avant la phase 04, parce que les deux touchent le même dépôt.

GPT-6 Astra. Introuvable au catalogue de la passerelle, et aucune trace ailleurs. Dire où
il a été vu, ou l'écarter du plan.

## Décisions verrouillées

L'orchestrateur tourne sur Opus 5 en accès direct, pas via un abonnement relayé par un
outil tiers.

La cybersécurité et le devops restent du code déterministe. Un agent qui déploie est un
risque que rien ne justifie.

Le garde-fou escalade au lieu de tuer l'exécution. Le travail déjà payé est conservé.

Les agents échangent des artefacts validés par schéma, pas des transcriptions. Une
conversation retransportée à chaque tour fait croître le coût au carré du nombre de tours.

Toute boucle bidirectionnelle est bornée.

Le pipeline marketing se construit avant celui de développement.
