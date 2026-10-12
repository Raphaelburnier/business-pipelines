# Planificateur de missions

On confie une spec au cockpit : projet, objectif, critères d'acceptation, spec détaillée,
contraintes et exigences. Le planificateur choisit le workflow et les agents, présente le
plan, puis le serveur le fige dans le contrat de mission que le moteur exécute.

Le code est dans `src/planificateur.js` (décision) et `src/api-plans-missions.js` (routes et
état consulté). Le schéma du plan est dans `agent-orchestrator/packages/schemas/plan.js`.

## Ce que le planificateur décide, et sur quoi

Il ne génère pas de pipeline et n'appelle aucun modèle. Il choisit parmi les pipelines
versionnés attachés à la fiche du projet. Le registre valide ces pipelines au chargement :
revues en lecture seule, cycles bornés, budgets, versions épinglées.

1. **Projet.** Sans fiche `projects/<id>/project.json`, la mission est bloquée.
2. **Nature.** `developpement` pour un pipeline tagué `code` ou qui exécute `verify-project`,
   `marketing` pour un pipeline tagué `marketing`. Les gabarits de discussion
   (`workspace: documents`) ne sont jamais lancés. La spec peut préciser sa nature ; sinon
   elle est déduite si le projet n'en propose qu'une.
3. **Rôles.** Ils viennent de la structure du pipeline, jamais de la description libre d'un
   agent : `review` donne une revue, `verify-project` les tests du projet, un autre script un
   contrôle, `approval` une décision humaine, un agent avec `mustChange` le développement, un
   agent qui mène au développement la planification. En marketing, un agent qui reçoit au
   moins deux agents fait la synthèse, les autres analysent.
4. **Agents.** Pour chaque nœud agent ou revue, les candidats sont les membres du roster
   (`equipe/agents.json`) qui incarnent l'agent du registre, avec leur modèle, puis l'agent du
   workflow avec le modèle du pipeline. Un candidat est écarté, avec sa raison, si :
   - son runtime est exclu par la spec ;
   - un run vivant attend le quota ou la connexion de ce runtime ;
   - le backend n'est pas joignable, le worker n'est pas en ligne, n'annonce pas ce runtime ou
     n'est pas à jour pour les missions (même contrôle que le lancement manuel) ;
   - le membre est affecté à un autre projet ou a épuisé son budget mensuel ;
   - le membre est déjà auteur du travail que la revue doit relire.

   Parmi les candidats restants, le score retient d'abord un membre affecté au projet (100),
   puis un membre de l'équipe (30), puis pour une revue un runtime différent de celui du
   développement (20), puis le modèle recommandé par le pipeline (5).
5. **Indépendance.** Le moteur relit toujours dans une session neuve en lecture seule. Le
   plan dit en plus si le relecteur est un autre membre et s'il tourne sur un autre runtime.
6. **Limites.** Tours, budget par run et par mois, corrections bornées : ce sont celles de la
   résolution du pipeline et du projet, recopiées dans le plan. Le budget mensuel du projet
   est contrôlé avant lancement sur le coût équivalent API des runs du mois (le moteur ne le
   contrôle pas lui-même).
7. **Critères.** Chaque critère est relié aux étapes qui le réalisent (développement, ou
   synthèse en marketing) et à celles qui le jugent (revues, approbation, scripts qui rendent
   un verdict). Un reviewer juge tous les critères d'un seul verdict : le résultat n'est pas
   ventilé critère par critère.
8. **Résultat attendu.** Une approbation humaine si le pipeline en a une ; une PR `agent/` si
   le projet publie (fusion par le publieur seulement avec tests et revues attestés, CI verte
   sur le merge exact et aucun fichier sensible) ; sinon des livrables sans PR. Le plan ne
   prévoit jamais de déploiement.

## Statuts

- `lancable` : le plan peut être lancé tel quel.
- `degrade` : un rôle tourne sans membre de l'équipe, ou aucun juge ne couvre les critères.
  Le lancement exige `accepterDegrade: true`, c'est-à-dire une confirmation explicite.
- `bloque` : aucun plan. Chaque blocage donne sa raison et, s'il existe, le seul arbitrage
  qui débloque (attacher un pipeline à la fiche, activer une revue optionnelle, compléter la
  spec, attendre un quota, réveiller un worker, relever un budget).

Activer une revue optionnelle comme `review-security` change la politique du projet : le
planificateur la demande, il ne l'active jamais lui-même.

## Routes

- `POST /api/missions/plan`, corps `{ spec }` : rend `{ statut, plan, blocages, empreinte, projet }`.
  Rien n'est mis en file.
- `POST /api/missions/lancer`, corps `{ spec, empreinte, requestId, accepterDegrade }` : le
  plan est recalculé. S'il a changé depuis sa présentation (équipe, registre, machines,
  quotas), la réponse est 409 et il faut relire le plan. Un `requestId` déjà utilisé rend la
  même commande, pour le même auteur et la même spec.

Les deux routes passent par le contrôle d'identité et d'origine des autres écritures du
cockpit. Le cockpit ne reçoit aucun secret et le planificateur ne contourne ni les tests,
ni les revues, ni les règles de fusion : il produit une commande `run.start` comme le
lancement manuel.

## Contrat et reprise

Le plan est figé dans le contrat de mission, sous l'empreinte SHA-256. Le moteur refuse un
plan qui ne décrit pas exactement la résolution exécutée : même pipeline, mêmes nœuds actifs,
mêmes agents et modèles, mêmes participants, mêmes critères, mêmes limites et pas de PR
annoncée pour un projet qui ne publie pas. Une reprise relit ce contrat : une spec, un
registre, une équipe ou une fiche modifiés ensuite ne changent ni le plan ni le travail.

Le détail d'un run (`GET /api/runs/<id>`) expose `mission.plan` et `criteres`, l'état de
chaque critère d'après la dernière tentative des étapes qui le réalisent et le jugent. La
livraison (PR, CI, fusion) reste affichée par son propre bloc.

## Mise en service

Le runner doit avoir le moteur qui connaît le champ `plan` du contrat avant que le cockpit
l'envoie : livrer moteur et cockpit ensemble. Le worker PC ne lit pas le contrat (il reçoit
`spec._mission`) et n'a pas besoin de mise à jour pour ce changement.
