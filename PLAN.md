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
| 04 | Pipeline marketing minimal | À faire | business-pipelines |
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

Deux agents pour commencer, économie et image de marque, pas quatre. Un schéma de sortie
strict par agent, c'est ce qui empêche la dérive vers la conversation. Budget serré sur la
première exécution, relâché une fois le coût réel mesuré.

Le plan validé sort de cette phase comme artefact. C'est lui, et rien d'autre, que la
phase 05 consomme.

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
