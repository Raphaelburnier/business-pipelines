# Lot 2.9 — Réserver du quota Claude pour l’usage interactif

**Résumé — proposition à valider.** Réserver une partie de la fenêtre Claude de cinq heures en empêchant de nouveaux appels des runs au-delà d’un seuil. Proposition initiale : seuil de **75 % consommés**, réserve **désactivée par défaut**. Une étape déjà lancée termine son travail ; le même run reprend dès que la politique et une mesure récente l’autorisent. La réserve ne modifie pas les autres runtimes. Ce document propose les échanges entre cockpit et moteur ; aucune activation ni implémentation n’est incluse dans cette proposition.

## Objectif et périmètre

Le réglage vise à conserver du quota pour les sessions interactives. Le seuil porte sur le pourcentage **déjà consommé**, pas sur le pourcentage restant. À 75 %, le lancement d’une nouvelle étape Claude est suspendu dès que la consommation observée atteint 75 %.

Le contrôle se fait entre les étapes. Il ne garantit donc pas qu’il restera exactement 25 % : une étape déjà en cours peut dépasser le seuil avant de finir. Elle n’est pas interrompue pour cette réserve.

Périmètre : planification, départs immédiats ou différés, reprises, étapes Claude locales et distantes, réglage opérateur et indication dans la barre de quota. Les sessions interactives restent libres d’utiliser l’abonnement. Les runs Codex et les autres runtimes continuent selon leurs règles existantes.

Hypothèses proposées, à approuver :

- Un seul compte Claude partagé, comme dans l’agrégation actuelle des mesures PC/moteur.
- Seuil entier de 1 à 100, valeur initiale 75 ; activation initiale désactivée.
- Réserve active + mesure de cinq heures absente, invalide ou vieille de plus de quinze minutes : aucun nouvel appel Claude, avec état « mesure inconnue » explicite.
- Une réserve n’est pas une panne fournisseur : elle ne consomme pas les trois tentatives de reprise prévues pour les véritables quotas.
- Désactiver la réserve ou relever son seuil permet une reprise au prochain contrôle si les autres conditions sont satisfaites.

## Constats dans les sources

Inspection du cockpit `ff2b50f`, puis actualisation sur `2b72cff` : seul le statut du lot 1.4 change entre ces deux versions. Moteur inspecté : `52724fe`.

- `BP src/quota.js` conserve les mesures fraîches pendant quinze minutes et sait isoler `five_hour`. Le seuil fixe de 25 % restants sert à ordonner la file.
- `BP src/api-plans-missions.js` écarte déjà les abonnements sous 10 % restants lors de la proposition de plan. Ce comportement est distinct de la réserve.
- `BP src/atelier.js` exclut des commandes bloquées par quota/connexion ; une reprise est actuellement exemptée de son propre blocage de quota. La réserve doit rester contrôlée sur les reprises.
- `AO src/run-waits.js` conserve les attentes et déduplique les reprises. Les véritables quotas ont leurs limites existantes ; les objectifs calendrier ont leur politique propre.
- `AO src/graphe.js` peut basculer sur un secours après une vraie erreur de quota. Une réserve doit donc avoir une cause distincte.
- `AO src/maitre.js` attend la disponibilité et la capacité du worker avant l’envoi : un second contrôle est nécessaire après cette attente.

## Comportement attendu

### Mesure et décision

Le contrôle lit uniquement la fenêtre Claude `five_hour`, issue des événements existants `runtime.quota_snapshot`. Il n’attend pas une mesure Codex pour décider et ne prend pas la fenêtre hebdomadaire à sa place.

Conserver la validation de fraîcheur existante, notamment l’invalidation d’une mesure récente incorrecte plutôt qu’un repli sur un ancien relevé. Pour plusieurs sources encore valides du même compte et de la même fenêtre, prendre la consommation maximale. Une fenêtre dont le reset est passé ne prouve pas le quota disponible dans la nouvelle fenêtre.

| Réserve | Mesure de cinq heures | Décision pour un nouvel appel Claude |
|---|---|---|
| Désactivée | Quelconque | La réserve ne bloque pas ; contrôles existants maintenus |
| Active | Fraîche, consommation strictement sous le seuil | Autorisé sous les contrôles existants |
| Active | Fraîche, consommation égale ou supérieure au seuil | Attente pour réserve |
| Active | Absente, périmée, invalide ou fenêtre déjà terminée | Attente d’une mesure récente |

Une vraie limite fournisseur, une reconnexion nécessaire, une pause opérateur, une annulation, une maintenance de livraison ou un worker indisponible restent bloquants selon leurs règles. Désactiver la réserve ne les lève pas.

### Départs et étapes en cours

- Un nouveau plan ne présente pas Claude comme disponible si la réserve le bloque. Un choix automatique peut proposer un autre runtime déjà autorisé, dans un plan visible à valider.
- Un run dont le contrat est figé ne change ni d’agent ni de modèle à cause de la réserve. Ses nouveaux départs et reprises restent en file tant que Claude est bloqué.
- Contrôler la réserve avant un nouvel appel local et juste avant un envoi au worker, après l’attente de capacité. L’envoi accepté délimite une étape en cours.
- Les étapes déjà lancées, y compris les branches parallèles en vol, terminent. Leurs résultats et checkpoints sont conservés. Le run attend avant sa prochaine étape Claude.
- Un run mixte peut attendre Claude après avoir conservé ses étapes réussies ; les runs d’autres runtimes restent indépendants.
- La réserve ne déclenche ni secours automatique, ni arête d’échec métier, ni annulation des étapes sœurs.

### Attente et reprise

Réutiliser le statut `waiting_quota`, le run, son contrat, son workspace et les étapes réussies. Ajouter un motif explicite pour distinguer la réserve d’une vraie panne de quota.

Le reset connu est une échéance de réévaluation, pas une autorisation aveugle de démarrer. Reprendre avec une mesure fraîche sous le seuil. Sans nouvelle mesure, l’attente reste visible ; le contrôle ne crée pas de commandes de reprise en boucle et n’invente pas de reset à cinq heures.

Une nouvelle mesure de la même fenêtre sous le seuil ne lève pas un dépassement déjà observé pour cette fenêtre : conserver le maximum valide jusqu’au reset, sauf modification du réglage opérateur. Après reset, une mesure fraîche de la nouvelle fenêtre est requise.

Les reprises pour réserve sont dédupliquées et acquittées atomiquement comme les reprises existantes. Elles n’incrémentent pas les tentatives de panne de quota par run/compte et ne réinitialisent jamais ces compteurs. Aucun run terminé ou annulé n’est réactivé. Désactivation ou relèvement du seuil réévaluent aussi les attentes de réserve sans attendre le reset.

## Contrats proposés entre composants

### Réglage opérateur

Nouvelle route du cockpit : `GET /api/quota/reserve-claude`. Réponse proposée :

```json
{
  "configuration": { "active": false, "seuilUtilise": 75 },
  "etat": "desactive",
  "mesure": null,
  "attenteJusqua": null,
  "autorise": true,
  "modificationEnCours": null
}
```

`etat` vaut `desactive`, `autorise`, `seuil-atteint` ou `mesure-inconnue`. Une mesure présente contient `utilisation`, `observeLe`, `reinitialisation`, avec les dates ISO du relevé validé. `attenteJusqua` est le reset connu ou `null`, sans promesse de reprise immédiate. `autorise` décrit le droit de modifier le réglage. Une modification en file expose son identifiant, son statut et la configuration demandée ; la configuration principale reste celle effectivement appliquée.

`POST /api/quota/reserve-claude` n’accepte que :

```json
{ "active": true, "seuilUtilise": 75 }
```

Validation stricte : booléen réel, entier de 1 à 100, aucun champ supplémentaire. Même identité opérateur, contrôle d’origine et mécanisme de signature que les commandes de pause. Le droit d’envoyer des mesures depuis le PC ne donne pas celui de modifier la réserve. Identité et canal viennent du serveur, jamais du corps.

Le POST dépose la commande durable signée `quota.reserve.set`, de charge identique, et retourne `202` avec les champs existants `id` et `statut`. L’acceptation n’est pas une application : l’interface attend l’acquittement et relit le réglage effectif. La commande passe par une voie de contrôle qui reste disponible pendant les runs longs, les pauses et les réserves.

L’application émet `quota.reserve_changed` avec `active`, `seuilUtilise`, `par`, `canal`, `commandeId`, puis acquitte dans la même transaction. Le dernier événement est la source de vérité après redémarrage ; sans événement, utiliser les valeurs initiales proposées. Rejouer une même commande ne crée pas de second changement. Aucune nouvelle table ni fichier de configuration de production n’est nécessaire.

### Blocage transmis entre maître et processus du run

Erreur distincte proposée : `ReserveQuotaBloquee`. Dans l’enveloppe existante `detail.rejet` du maître distant, conserver `nom`, `message`, `definitive` et ajouter seulement pour cette erreur un objet optionnel `reserve` :

```json
{
  "motif": "seuil",
  "seuilUtilise": 75,
  "utilisation": 78.2,
  "observeLe": null,
  "reinitialisation": null,
  "reglageCommandeId": null
}
```

`motif` vaut `seuil` ou `mesure-inconnue`. `utilisation` est un pourcentage validé ou `null` ; les dates et l’identifiant de réglage sont validés ou `null`. Les valeurs nulles de l’exemple indiquent l’absence de preuve, pas une date à fabriquer.

Dans `run_waits.cause_json`, conserver le statut/runtime existant et ajouter `motif: "reserve-interactive"` avec ce même objet `reserve`. L’événement existant d’attente rend ces informations inspectables. Le run reste `waiting_quota`, mais l’interface affiche la réserve, pas un quota fournisseur épuisé. La cause distingue les compteurs et permet la réévaluation lors d’un changement de réglage.

Pas de nouveau type WebSocket worker : le contrôle est central, avant l’appel local ou l’envoi. La transmission maître/processus conserve l’enveloppe existante et doit préserver le motif, sans le convertir en perte d’étape.

## Interface

Dans la barre actuelle de quota : commande « Réserve Claude » accessible au clavier, ouvrant un réglage compact avec activation, seuil « Consommation maximale des runs » en pourcentage et bouton Enregistrer. Afficher la configuration effective et l’état en attente pendant une modification.

Indications attendues : « Réserve désactivée », « Réserve active · seuil 75 % », « Runs Claude en attente jusqu’au reset » ou « En attente d’une mesure récente ». L’heure affichée reste une échéance de réévaluation. Un lecteur sans droit opérateur voit le même état sans commande d’écriture.

Réutiliser les styles et rafraîchissements existants. Aucun choix de modèle, de provider ou détail interne de stockage n’est ajouté à ce parcours.

## Structure et conventions

CommonJS côté serveur/moteur, TypeScript React côté front, schémas partagés dans `AO packages/schemas/`. Garder une règle de décision commune côté moteur, consommée par le cockpit, pour éviter des décisions divergentes entre planificateur, file et exécution.

Zones concernées : `BP src/quota.js`, `src/api-plans-missions.js`, `src/atelier.js`, `bin/cockpit.js`, `bin/commande-runner.js`, `web/src/vues/Kpis.tsx` et l’adaptateur de données ; `AO packages/schemas/commandes.js`, `packages/schemas/cockpit.js`, `src/graphe.js`, `src/maitre.js`, `src/maitre-distant.js`, `src/run-waits.js` et le point d’entrée du run. Tests dans `BP test/`, `BP web/src/` et `AO test/vitest/`.

Style attendu : fonctions de décision sans effet de bord, horloge injectable et noms explicites, par exemple `decisionReserve(store, maintenant)`. L’égalité au seuil doit être visible dans la condition : `utilisation >= seuilUtilise`. Les erreurs de mesure restent distinctes d’une mesure de zéro.

## Commandes de validation

Dans chaque dépôt, installer avec `npm ci`. Dans `BP web`, installer également avec `npm ci`. La dépendance locale exige deux dossiers frères `business-pipelines` et `agent-orchestrator`.

Commandes existantes à utiliser, sans appel à un modèle réel :

```sh
# Depuis agent-orchestrator : suite et typecheck
npm test

# Depuis business-pipelines : invariants et intégration existants
node --test test/quota.test.js test/reprises-runs.test.js test/planificateur.test.js test/atelier.test.js
npm run web:test
npm --prefix web run build
npm test
```

Ajouter des recettes ciblées de réserve aux suites normales du dépôt concerné. La CI croisée moteur/cockpit doit rester verte sur les versions réellement proposées à la livraison. Aucune suite n’a été exécutée pour cette proposition documentaire seule.

## Critères de réussite et scénarios

1. Désactivée, la réserve laisse les comportements existants inchangés ; le réglage et les commandes survivent au redémarrage sans double événement.
2. Seuil 75 : 74,9 % autorise, 75 % et 75,1 % bloquent. Le seuil 100 est valide ; 0, 101, fractions, chaînes, champs supplémentaires sont refusés.
3. Claude frais mais Codex inconnu : la réserve décide d’après Claude. La fenêtre de sept jours ne remplace pas celle de cinq heures.
4. Mesure absente, invalide, future non tolérée ou périmée : blocage explicite si active ; aucune utilisation d’un ancien relevé invalidé.
5. Plusieurs sources d’un même compte : le maximum de consommation dans la fenêtre empêche une fausse libération. Reset passé sans nouveau relevé : attente conservée.
6. Départ immédiat, calendrier, reprise manuelle/automatique, commande déjà réservée et dispatch attendant un worker : aucune nouvelle étape Claude ne franchit un contrôle actif bloquant.
7. Franchissement du seuil pendant une étape : elle finit et son checkpoint reste ; l’étape Claude suivante attend, sans secours automatique ni échec métier. Les autres runs continuent.
8. Nouvelle fenêtre fraîche sous le seuil : même run/session/workspace et étapes réussies conservés après redémarrage ; aucun doublon de reprise.
9. Après plusieurs fenêtres de réserve, aucune tentative de panne réelle n’est consommée. Les limites existantes continuent de s’appliquer aux véritables quotas.
10. Désactivation ou hausse du seuil : libération des seules attentes de réserve devenues admissibles ; une attente de connexion ou de quota réel reste protégée.
11. Pause opérateur, annulation et maintenance gardent la priorité ; les commandes de contrôle fonctionnent pendant une réserve. Un run terminé n’est jamais repris.
12. Le maître distant conserve l’erreur de réserve et ses métadonnées. Une attente de capacité ne laisse pas démarrer une étape après activation du blocage.
13. Autorisations et origine : non-opérateur et identité PC limitée à la mesure refusés ; charge stricte ; aucune identité injectée dans le corps ; commande et événement dédupliqués.
14. Formulaire accessible, réglage enregistré sans redéploiement, erreur visible sans faux succès ; état effectif partagé par la barre, le planificateur, la file et le moteur.

Les scénarios utilisent une horloge fixée, des mesures fictives et des bases temporaires, y compris les courses entre contrôle, réservation et envoi. Pas d’attente réelle de cinq heures ni d’écriture dans les données métier de production.

## Bornes et validation attendue

Toujours : préserver le contrat du run, les contrôles d’autorité et les travaux existants ; refuser un état illisible plutôt que prétendre connaître le quota ; vérifier les chemins de course et la compatibilité des schémas.

À valider maintenant : valeurs initiales 75 %/désactivée, comportement prudent sans mesure, et les échanges définis ci-dessus. Source : `AGENTS.md` commun, « Ne jamais inventer en silence un format ou un protocole entre composants : proposer un schéma et attendre la validation. »

Toute nécessité nouvelle de migration, de dépendance ou de modification du modèle de déploiement doit être motivée avant élargissement. Les PR sensibles suivent leur circuit explicite et aucun refus d’un workflow n’est contourné. Aucun secret n’est consulté en clair. La livraison reste demandée par l’opérateur depuis le cockpit.
