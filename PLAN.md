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

Cinq étapes. Une étape déterministe relit d'abord la consigne que l'opérateur a pu écrire
sur le plan précédent. Deux voix analysent ensuite la même demande en parallèle,
`economy-analyst` et `brand-analyst`, chacune produisant son artefact avec un schéma
strict. `plan-synthesist` les confronte en un plan unique. Un contrôle déterministe rend
le verdict du gate. Une approbation humaine tranche, question par question, dans le
cockpit.

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

Budget du premier tour : deux dollars, quarante tours, quinze par agent.

Aucun agent ne nomme de backend depuis le 2026-09-13. Le pipeline visait `opus-direct`,
qui n'existe que dans la configuration d'un poste, et refusait donc de se charger sur le
NAS. Il prend désormais le backend par défaut, comme le pipeline de prix, et tourne
partout où une clé Anthropic est fournie.

La consigne libre boucle depuis la même date. L'étape `consigne` la relit dans le registre
des décisions, hors du workspace, en rejouant le juge d'approbation sur le plan gelé. Elle
expire d'elle-même dès qu'un tour gèle un nouveau plan, et survit à un tour qui échoue
avant. La même étape refuse de relancer tant que le plan gelé attend une décision ou a été
entièrement tranché, parce qu'un tour de plus produirait une empreinte neuve et effacerait
ces décisions en silence.

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

Le jeton des backends OmniRoute n'a jamais été valide. `backends.json` porte
`omniroute-local`, que la passerelle refuse : la vérification de la phase 01 avait utilisé
la vraie clé de la passerelle, pas le backend. Constaté le 2026-09-13. La correction écrit
dans un fichier de secrets et reste à faire par l'opérateur. Elle ne bloque plus le
pipeline marketing, qui ne nomme plus de backend.

Le drapeau `--resume` de la phase 03 est inutilisable ici pour la même raison. Ce dépôt a
son propre lanceur, qui vide le workspace à chaque fois et n'ouvre aucun journal de
reprise. Deux ou trois lignes à changer, mais c'est un changement de sémantique
d'exécution, à décider plutôt qu'à glisser.

La clé Anthropic hors passerelle, décrite en phase 01.

Le ménage des anciennes pipelines, en partie fait. Le cycle de prix a été retiré le
2026-09-13 : il ne tournait nulle part, ni sur le NAS où son conteneur n'avait jamais été
créé, ni sur le poste où son minuteur était désactivé. Son service Docker, son script npm
et son minuteur local sont partis, la boucle générique `bin/cycle.js` reste. Les pipelines
de veille et de prix, avec leurs tests, sont toujours en place : décision non prise.

Conséquence du retrait : plus aucun service du NAS ne détient la clé Anthropic, puisque le
cockpit n'en reçoit délibérément aucune. Faire tourner le pipeline marketing sur le NAS
demandera son propre service.

Le compose sans cycle a été redéposé sur le NAS le 2026-09-13. Il ne déclare plus que le
cockpit, qui n'a pas été redémarré. La sauvegarde `docker-compose.yaml.avant-retrait-cycle`
contient par erreur la version sans cycle, et l'ancienne version reste celle de `main` au
2026-09-11. Restent sur le NAS l'image `business-pipelines-cycle` et deux vieilles images
`buisness-piplines-*`, inutilisées, dont la suppression a été refusée par les permissions
de la session. Elles ne coûtent que de la place.

L'ancien dossier NAS `buisness-piplines`, doublon du 26 août resté avec des secrets
périmés dans un dossier ouvert à tous, a été supprimé le même jour. Une archive en droits
restreints est gardée dans le répertoire personnel de `admindunas`.

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
