# Lot 2.8 — reprise après quota sans échéance

## Résumé

Un quota suspend le même run, puis autorise une reprise après la date fournisseur fiable
ou, si elle manque, après cinq heures de prudence. Le délai de prudence n'est jamais
présenté comme une réinitialisation garantie. Les reprises restent dédupliquées et limitées
par run et par compte. Les anciennes attentes sont reprises en charge une seule fois.
La mise en œuvre suit le lot 2.8 demandé après la livraison du 2.7.

## Contrat

- Réutiliser le run, le contrat figé, le workspace, la session et les étapes réussies.
- Garder `resetAt` et `resetSource` vides sans preuve fournisseur exploitable. La date
  de nouvelle tentative est un champ distinct, durable, calculé depuis le dernier quota.
- Attendre la vraie date connue, avec la marge existante d'une minute pour une heure
  affichée sans secondes ; sans date, retenter après cinq heures, cadence déjà retenue
  pour la libération du runtime dans le planificateur.
- Conserver trois reprises au plus par run sur 24 h et trois reprises automatiques par
  runtime/compte sur 24 h. À la borne, une action manuelle reste nécessaire et expliquée.
  Un réglage existant à zéro continue de désactiver la reprise automatique.
- Chaque nouveau quota repart du dernier échec pour le délai de prudence ; un redémarrage
  ne décale pas la date et ne remet aucun compteur à zéro.
- Pour une ancienne attente sans date, activer une seule fenêtre de 24 h à l'adoption
  de cette politique, en conservant l'ancien début d'attente et les tentatives consommées.
  Si cinq heures se sont déjà écoulées, rendre la tentative admissible. Les attentes
  terminées, l'authentification et les commandes déjà en file ne sont pas réactivées.
- Partager la même décision de blocage entre le planificateur et la file Atelier.
  Un runtime ne reste pas bloqué indéfiniment par une ancienne attente sans date.
- Conserver l'acquittement atomique du 2.7 et les signatures de commandes.

## Constat de production

Le cas Finance historique `2bf1abcc` est désormais `failed`, sans attente active.
Il ne doit pas être relancé automatiquement. Le cas d'une attente de plus de 40 h
sera reproduit dans une base temporaire.

## Structure, commandes et tests

Moteur : `src/run-waits.js`, règle commune `src/quota-reprise.js`, tests Vitest.
Cockpit : `src/api-plans-missions.js`, `src/atelier.js`, `web/src/vues/AttenteRun.tsx`
et recettes `test/reprises-runs.test.js`. CommonJS serveur et TypeScript React existants.
Exemple : `runtimeBloque({ ...attente, cause }, maintenant)`.

Moteur : `npx vitest run test/vitest/run-waits.test.mjs test/vitest/reprise-quota.test.mjs`,
puis `npm test`. Cockpit : `node --test test/reprises-runs.test.js test/planificateur.test.js test/atelier.test.js`,
`npm run web:test`, `npm --prefix web run build`, puis `npm test`.

Cas nécessaires : date connue, reset inconnu, quota renouvelé, limites run/compte,
ancienne attente de 40 h, plusieurs redémarrages, commande déjà réservée, run terminé,
authentification sans timer et absence de doublons. Les horloges sont injectées ou les
dates des fixtures sont fixées ; aucune attente réelle de cinq heures ni appel modèle.

## Limites

Toujours : préserver les contrôles de mission, les quotas, les approbations et les travaux
non commités du calendrier 12.2. Le run actif n'est pas interrompu à minuit.
Pas de nouvelle dépendance, migration de schéma ni changement de modèle de livraison.
Le workflow de fusion doit synchroniser les deux entrées sensibles `bin/chat-outils-mcp.js`
et `src/api-chat.js`, déjà ajoutées au moteur par le lot F13 ; le test partagé vérifie
l'identité de ces listes entre les dépôts. Cette synchronisation nécessite une fusion explicite.
La politique calendrier non livrée (12.2) reste séparée. Les fichiers sensibles gardent
leur règle de fusion explicite ; aucun contrôle humain n'est automatiquement validé.
