# Lot 2.7 — reprise après retour du worker

## Résumé

Un run suspendu parce que sa machine est injoignable reprend automatiquement quand
le maître permanent confirme son retour. La reprise conserve le run, le contrat figé,
le workspace et les étapes déjà terminées. Elle reste exclusive avec les autres CLI.
Les décisions d'approbation restent traitées dans leur file courte. Le lot 2.6 reste
terminé ; le 2.7 sera clôturé après vérification et livraison.

## Périmètre demandé

Cette spécification précise le lot 2.7 de la feuille de route et le contrat validé
dans `SPEC-file-prioritaire.md` : reprises admissibles avant les nouveaux départs,
contrat conservé et aucun contrôle humain automatiquement validé. L'utilisateur a
demandé de passer à sa mise en œuvre après clôture du 2.6.

Hypothèses : l'indisponibilité temporaire est distincte d'une erreur définitive
(réveil interdit ou capacités incompatibles). Une étape perdue après déconnexion
reste un incident distinct : elle n'est pas rejouée aveuglément par ce lot.

## Comportement attendu

- Enregistrer durablement l'attente à la sortie de la CLI, avec la machine structurée.
  Reconstruire les anciennes attentes depuis leurs événements, sans analyser la prose.
  Leur délai part de l'attente historique : un redémarrage n'accorde pas 24 h neuves.
- Ne pas programmer de reprise pendant l'attente interne d'une CLI encore vivante.
  Un simple statut temporaire `waiting_machine` pendant un réveil ne suffit pas.
- Ne réserver une reprise automatique que lorsque le maître a une connexion réelle,
  la machine est en ligne et n'exécute aucune étape. Un état historique en base ne suffit pas.
- Créer au plus une commande `run.resume` par attente, y compris après redémarrage,
  double clic ou deux pollers. Revérifier sa validité avant lancement.
- Conserver les bornes existantes : trois reprises automatiques, attente de 24 h,
  puis reprise manuelle visible. Le temps hors ligne ne consomme aucune tentative.
  Les limites de compte quota ne s'appliquent pas à une attente machine.
- Une erreur définitive, une attente d'approbation, un quota ou un run terminé ne
  déclenchent aucune reprise machine. Aucun réveil ou modèle supplémentaire n'est appelé.
- Le runner attend son maître permanent avant une CLI ; ses enfants utilisent toujours
  ce maître. Ils n'essaient pas d'ouvrir eux-mêmes le port 4650.
- Conserver le traitement immédiat des décisions, avec reprise exclusive déjà existante.
- Afficher dans le cockpit l'attente du worker et la borne automatique, sans texte de quota.

## Sources et style

Moteur : `src/run-waits.js`, `src/maitre-distant.js`, `bin/orch.js` et schéma du cockpit.
Intégration : `bin/commande-runner.js`, `src/reprises-runs.js`, vue `AttenteRun.tsx`.
CommonJS côté serveur, fonctions françaises et schémas partagés avec le front.
Exemple : `store.attentes.programmer({ machineDisponible });`.

## Vérification

Dans le moteur : `npx vitest run test/vitest/run-waits-machine.test.mjs test/vitest/maitre-distant.test.mjs`,
puis `npm test`. Dans le cockpit : `node --test test/reprises-runs.test.js`,
`node --test test/approbations-runs.test.js`, `npm run web:test`, `npm --prefix web run build`,
puis `npm test`.

Les recettes utilisent une base temporaire, le vrai runner et une CLI déterministe ou
un worker local de test. Elles couvrent retour de machine, redémarrage, doublons,
contrat/workspace conservés, absence de retour, expiration, résultat définitif et
approbation pendant un run long. Aucun appel modèle ni run de production nécessaire.

## Limites

Toujours conserver signatures, contrôle des missions et limites du runtime.
Aucune nouvelle dépendance, migration, modification de CI ou politique de livraison.
Le quota sans échéance relève du lot 2.8 ; le lot 12.2 et ses worktrees restent séparés.
Le lot 2.7 est retiré des objectifs attribuables dès son passage en cours pour empêcher
un second agent de recevoir le même travail.
