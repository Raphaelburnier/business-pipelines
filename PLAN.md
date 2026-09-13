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
| 02 | Escalade en réponse libre dans le cockpit | Faite | business-pipelines, `main` |
| 03 | Reprise d'exécution | Faite | agent-orchestrator, `master` |
| 04 | Pipeline marketing minimal | Faite, premier tour en attente de décision | business-pipelines, `main`, sur le NAS |
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
Fusionnée dans `main` le 2026-09-13, et en service sur le cockpit du NAS.

## Phase 03, reprise d'exécution

Commit `8290f4a` dans agent-orchestrator. Le drapeau `--resume` saute les étapes déjà
sauvées au lieu de les repayer. La progression est tenue dans `.orch-resume.json` au sein
du workspace, écrite après le commit de l'étape, et porte l'empreinte du pipeline et du
spec : une reprise refuse de partir si l'un des deux a changé.

Fusionnée dans `master` le 2026-09-13. Les sept scénarios de reprise vérifiés ne sont
pas dans le dépôt, par choix.

## Phase 04, pipeline marketing minimal

Fusionnée dans `main` le 2026-09-13 et déployée sur le NAS, où elle se lance à la demande :

```bash
sudo docker compose run --rm marketing
```

Le déploiement a révélé que l'image n'avait jamais embarqué une seule définition d'agent :
le `.dockerignore` excluait tout le dossier `.claude`, où le lanceur les lit. Aucun agent
n'avait encore tourné sur le NAS, donc rien ne l'avait montré. Corrigé le même jour.

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

Premier tour le 2026-09-13, sur le NAS : 1,37 dollar et 21 tours, sous le plafond. Les
deux voix ont coûté 0,20 et 0,11 dollar, en deux tours chacune. La première synthèse a
échoué au contrôle de couverture avec neuf manques, le cycle de correction l'a remise au
vert, et le plan gelé porte trois arbitrages qui attendent dans le cockpit : vendre sous un
nom de boutique, vendre au-dessus de la médiane, et le volume mensuel de départ.

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

Le cycle de correction du pipeline marketing paie deux fois. Son gate renvoie à
`synthese` : après la correction ciblée des manques, la synthèse entière est rejouée et
réécrit le plan qui venait d'être corrigé. Au premier tour, la correction a coûté 0,25
dollar, puis la synthèse complète 0,42 dollar pour repasser le contrôle. Le pipeline de
prix renvoie à son étape de contrôle, et c'est ce que devrait faire celui-ci, avec
`rerun_from: "couverture"`. Le correctif demande de reconstruire l'image du NAS, qui
embarque les pipelines.

Le drapeau `--resume` de la phase 03 est inutilisable ici. Ce dépôt a
son propre lanceur, qui vide le workspace à chaque fois et n'ouvre aucun journal de
reprise. Deux ou trois lignes à changer, mais c'est un changement de sémantique
d'exécution, à décider plutôt qu'à glisser.

La clé Anthropic hors passerelle, décrite en phase 01.

Le ménage des anciennes pipelines, en partie fait. Le cycle de prix a été retiré le
2026-09-13 : il ne tournait nulle part, ni sur le NAS où son conteneur n'avait jamais été
créé, ni sur le poste où son minuteur était désactivé. Son service Docker, son script npm
et son minuteur local sont partis, la boucle générique `bin/cycle.js` reste. Les pipelines
de veille et de prix, avec leurs tests, sont toujours en place : décision non prise.

Le retrait du cycle laissait le NAS sans aucun service détenteur de la clé Anthropic. Le
service marketing à la demande la reçoit désormais, et le cockpit n'en reçoit toujours
aucune.

Le NAS porte le code de `main` depuis le 2026-09-13 : le cockpit, redémarré sur sa nouvelle
image, et le service marketing à la demande. Une archive sans secrets de l'état précédent
est gardée dans le répertoire personnel de `admindunas`. Le fichier
`docker-compose.yaml.avant-retrait-cycle` n'est pas une sauvegarde fiable : il a été
réécrit plusieurs fois. Restent sur le NAS l'image `business-pipelines-cycle` et deux
vieilles images `buisness-piplines-*`, inutilisées, dont la suppression a été refusée par
les permissions de la session. Elles ne coûtent que de la place.

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
