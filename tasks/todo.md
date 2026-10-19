# Tâches : objectifs À venir durables

Le suivi d’avancement de ces tâches est maintenu dans la liste claude-mem
`objectifs-durables-cockpit` ; ce fichier fixe le découpage approuvé. Chaque tâche est
ordonnée par dépendance et reste sous cinq fichiers de production/tests.

- [x] **T1 — Catalogue admissible et référence de mission**
  - Acceptation : un manifeste partagé déclare les objectifs attribuables et leur révision ;
    le serveur rejette les IDs/révisions inconnus ; le front ne propose pas les lignes
    marquées faites ; chaque entrée du manifeste existe dans la feuille de route.
  - Vérifier : tests du manifeste avec ID valide, inconnu, retiré et révision périmée.
  - Fichiers : `web/src/avenir/objectifs.json`, `src/objectifs-avenirs.js`,
    `web/src/avenir/feuille.ts`, `web/tsconfig.json`, `test/planificateur.test.js`.

- [ ] **T2 — Réservation atomique et projection API** (dépend de T1)
  - Acceptation : la création `run.start` conserve la référence d’objectif dans sa charge
    signée ; répétition idempotente retourne la même commande ; une autre demande active sur
    le même objectif est refusée ; un objectif terminal peut être repris ; l’API retourne
    l’attribution reliée à son run sans écrire directement l’historique.
  - Vérifier : demandes répétées et concurrentes, conflit actif, relance après échec/arrêt,
    lecture après réouverture du store, accès authentifié à la route.
  - Fichiers : `src/missions.js`, `src/api-lecture.js`, `bin/cockpit.js`,
    `test/planificateur.test.js`, `test/cockpit-routes.test.js`.

- [ ] **T3 — Attribution depuis la page « À venir »** (dépend de T1 et T2)
  - Acceptation : une ligne admissible ouvre un formulaire avec titre/détail préremplis ;
    l’utilisateur choisit projet et agent Codex/Claude, ajuste les critères, puis lance par
    le contrat existant ; la page affiche propriétaire, projet, run et état après
    rafraîchissement ; le conflit serveur est expliqué à l’utilisateur.
  - Vérifier : tests du formulaire, choix agent/projet, états d’attente/terminaux et erreur
    de conflit ; typecheck et build web.
  - Fichiers : `web/src/avenir/AVenir.tsx`, `web/src/avenir/avenir.css`,
    `web/src/donnees/source.ts`, `web/src/donnees/api.ts`,
    `web/src/avenir/AVenir.test.tsx`.

- [ ] **T4 — Reprise de quota, redémarrage et documentation** (dépend de T2 et T3)
  - Acceptation : une attribution reste active à quota connu ou inconnu ; le reset connu
    reprend le run avec le même ID ; quota inconnu reste manuel ; après redémarrage, aucune
    seconde commande n’est créée ; état d’exécution et état de livraison restent distincts.
  - Vérifier : test intégré objectif → commande → run → attente → reprise, test quota inconnu,
    test de redémarrage/relecture ; `npm test`, `npm run web:test`, `npm run web:build`.
  - Fichiers : `test/planificateur.test.js`, `test/reprises-runs.test.js`,
    `test/cockpit-routes.test.js`, `docs/MISSIONS.md`, `docs/QUOTAS-REPRISES.md`.

- [ ] **T5 — Livraison et recette sur le cockpit** (dépend de T4)
  - Acceptation : chaque dépôt modifié a sa CI verte sur le SHA courant ; les versions
    moteur/cockpit sont compatibles ; la recette vérifie un objectif actif et une reprise
    réelle ou un scénario équivalent autorisé ; le vault décrit uniquement ce qui a été
    observé.
  - Vérifier : CI GitHub de chaque dépôt, puis parcours cockpit après déploiement et
    redémarrage des services ; noter les preuves et limites dans la fiche projet.
  - Fichiers : aucun changement de code prévu ; mise à jour du vault après la recette.

## Garde-fous

- Ne commencer T2 qu’après validation T1 ; ne raccorder le formulaire qu’après le contrat
  API de T2.
- Aucune tâche ne crée une table, une file ou une politique de quota parallèle.
- Toute découverte imposant un changement au contrat du moteur déclenche d’abord la mise à
  jour de `docs/SPEC-objectifs-durables.md` et du plan, avant le code concerné.
- Les commandes de test ne sont lancées qu’au cours des tâches d’implémentation/recette,
  avec le résultat réel consigné ; une CI verte seule ne remplace pas la recette métier.
