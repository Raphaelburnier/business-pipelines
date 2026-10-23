# Pipelines personnalisables, missions ponctuelles et calendrier

Date : 21 octobre 2026. Statut : découpage validé par Raphaël le 21 octobre 2026 ; implémentation autorisée.

## Demande de Raphaël

- Réutiliser des pipelines et les adapter par glisser-déposer dans la section Pipelines du projet.
- Pouvoir employer un agent pour une autre tâche en adaptant sa consigne dans ce pipeline.
- Confier une mission occasionnelle à un agent seul ou composer un petit pipeline avec plusieurs agents.
- Planifier des objectifs quotidiens dans un calendrier et leur donner la priorité.
- Au retour du quota, traiter en premier les runs interrompus dont la reprise est possible.

## Carte des capacités

| Identifiant stable | Responsabilité | Dépendances |
|---|---|---|
| `file-prioritaire` | Étendre la file durable existante : admissibilité, reprise prioritaire, classement des tâches dues, blocages visibles et absence de doublons. | Moteur et commandes existants |
| `pipelines-personnalisables` | Composer, adapter, enregistrer et réutiliser un graphe dans Pipelines du projet ; modifier la consigne d'un agent pour cette utilisation. | Registre, schémas et validation existants |
| `missions-ponctuelles` | Affecter directement un agent ou composer une petite équipe, figer la mission, suivre son run et proposer « Enregistrer comme pipeline ». | `pipelines-personnalisables`, `file-prioritaire` |
| `calendrier-objectifs` | Créer et placer les objectifs dans le temps, associer agent ou pipeline, rendre les objectifs dus exécutables et suivre leur résultat. | `missions-ponctuelles`, `file-prioritaire` |

Ordre proposé : **file-prioritaire → pipelines-personnalisables → missions-ponctuelles → calendrier-objectifs**. Les deux premiers modules sont indépendants ; cet ordre consolide la reprise avant de multiplier les points de lancement.

Le calendrier exprime *quand* le travail devient dû. La file décide *quel travail admissible* peut démarrer. Le compositeur décrit *ce que les agents font*. Une mission conserve la configuration effectivement confiée et son lien avec le run.

## Parcours visibles

### Projet → Pipelines

La bibliothèque propose « Utiliser », « Adapter » et « Nouveau pipeline ». L'éditeur présente les agents à gauche, le graphe au centre et la consigne de l'étape sélectionnée à droite. On dépose les agents, relie leurs étapes et définit les livrables attendus. Deux branches peuvent travailler en parallèle si le workflow et les capacités disponibles le permettent.

Adapter une consigne ou remplacer un agent s'applique à cette version du pipeline. Les autres utilisations de l'agent conservent leur configuration. La sauvegarde crée une version réutilisable ; les missions déjà lancées gardent leur version et leurs affectations figées.

Le glisser-déposer est le parcours principal sur ordinateur, avec des boutons et commandes clavier équivalents. La lecture, les lancements et le calendrier restent accessibles sur mobile. Le premier périmètre conserve l'éditeur complet sur ordinateur, comme le prévoit la spécification existante.

### Mission ponctuelle

« Un agent » : choisir l'agent, écrire la tâche et le résultat attendu, mettre en file. Le système crée une mission à une étape avec les mêmes mécanismes de suivi et de reprise.

« Plusieurs agents » : ouvrir le même compositeur pour cette mission, ordonner les étapes et préciser les échanges. Le petit pipeline reste attaché à la mission ; « Enregistrer comme pipeline » le rend réutilisable.

Un agent choisi explicitement reste l'agent demandé. Si son runtime manque de quota, l'attente apparaît. Un remplacement éventuel relève d'une politique de substitution explicite ; il ne découle pas implicitement du reset de quota.

### Calendrier des objectifs

Vue semaine et liste « Aujourd'hui ». Chaque objectif affiche son projet, sa date, sa priorité, le résultat attendu, l'agent ou le pipeline choisi, et l'état du travail. Une heure de début peut être ajoutée ; sans heure, l'objectif devient dû au début du jour concerné. Fuseau proposé : `Europe/Zurich`.

La programmation peut être ponctuelle ou répétée. Activer une programmation autorise ses futurs départs dans les conditions affichées. Une répétition possède des occurrences identifiables : une occurrence interrompue garde son run ; l'arrivée du lendemain ne la recrée pas. Pour une même programmation répétée, une occurrence précédente inachevée bloque par défaut le départ de la suivante et l'interface l'explique.

Un objectif en retard reste visible jusqu'à son résultat ou une décision explicite de report/annulation. Les dates des prochains travaux sont modifiables ; déplacer une carte dont le run a commencé ne redémarre pas ce travail. Le détail permet de comprendre pourquoi un objectif attend et quel travail passera ensuite.

## Ordre d'exécution proposé

L'ordre s'applique aux travaux admissibles, à chaque libération de capacité :

1. **Reprendre les runs interrompus** dont la cause d'attente est levée et dont la reprise est autorisée, en conservant l'objectif, le run et les étapes acquises.
2. **Exécuter les objectifs planifiés dus** : retard ou jour courant, en respectant l'heure de début éventuelle ; priorité choisie, puis date prévue et ordre stable à priorité égale.
3. **Exécuter les autres missions en file**, selon leur priorité puis leur ancienneté.

Le classement n'interrompt pas une étape active. Une pause volontaire, une approbation attendue, une reconnexion nécessaire ou un conflit de dépôt restent soumis à leur action explicite. Les décisions d'approbation conservent leur traitement réactif hors de la file longue ; les exécutions qui en résultent doivent s'articuler avec la même admission des travaux pour respecter la priorité globale.

Un travail bloqué par son quota ou sa machine ne monopolise pas la file. Au reset connu d'un runtime, la file reconsidère les travaux correspondants : d'abord les reprises, puis les objectifs dus. Les tâches utilisant d'autres runtimes disponibles restent admissibles. Une tâche prévue dans le futur ne part jamais à l'avance parce qu'un quota vient de revenir.

Les quotas concernent un runtime et son compte, potentiellement partagés par plusieurs agents. Les limites actuelles de reprises et les échéances inconnues doivent rester explicites ; ce cadrage n'autorise pas une interrogation des agents en boucle ni une date de reset inventée.

## Appuis existants et travail restant

Références relues dans `business-pipelines` à `a10d60f` (`origin/main`, récupéré le 21/10), et dans `agent-orchestrator` à `1855848`. Ceci décrit le code, sans attester une nouvelle livraison en production.

| Appui | Constat vérifié | Conséquence |
|---|---|---|
| [Spécification cockpit, §11.3–11.6 et phase 6](docs/SPEC-cockpit-agentique.md) | Éditeur, configurations par étape, versions immuables, appel d'un agent seul et sauvegarde en pipeline déjà prévus. | Compléter cette direction et réutiliser les schémas ; éviter un deuxième moteur de graphes. |
| [Écran Pipelines](web/src/vues/Pipelines.tsx) et [graphe de présentation](web/src/donnees/pipelineGraphe.ts) | L'écran actuel visualise les runs ; son graphe est construit pour l'affichage. | Éditer la définition exécutable du pipeline ; ne pas sauvegarder le graphe de présentation comme workflow. |
| [Planificateur](src/planificateur.js) | Choisit parmi les pipelines attachés au projet ; ne compose pas de graphe libre. | Ajouter un chemin explicite pour la composition et l'affectation manuelles. |
| [Objectifs durables](docs/SPEC-objectifs-durables.md) et [références À venir](src/objectifs-avenirs.js) | Les objectifs attribuables proviennent d'une liste de feuille de route versionnée. | Le calendrier demande des objectifs créés par l'utilisateur et des occurrences datées ; une simple vue calendrier de cette liste ne suffit pas. |
| [Runner](bin/commande-runner.js) | Appelle le programmateur de reprises et active `prioriserRuns`; les approbations sont traitées séparément depuis #152. | Étendre le chemin existant et préserver sa réactivité. |
| Moteur : `src/event-store.js`, `src/run-waits.js` | Priorité aux reprises automatiques de quota ; classement haute/normale/basse ; attente et commande de reprise durables. | Ajouter l'admission selon la date et l'origine de la tâche, puis couvrir les autres interruptions admissibles. |
| [Reprises](src/reprises-runs.js) | Relance le même run à partir de son lancement figé. | Conserver ce contrat pour les trois parcours. |

Le rattachement actuel d'un pipeline à un projet passe par une commande durable et une PR. La spécification de `pipelines-personnalisables` devra distinguer clairement le brouillon éditable, la version enregistrée et sa disponibilité effective pour le projet.

## Exemples pour valider le découpage

- Adapter « Vidéo YouTube » en remplaçant le rédacteur et sa consigne ; conserver un modèle réutilisable et les anciennes missions reproductibles.
- Confier une recherche à un seul agent, puis réutiliser son organisation dans une future mission à plusieurs agents.
- Composer « analyser le bug → corriger → vérifier » pour une seule occasion et l'enregistrer comme modèle si utile. Les contrôles requis par le projet continuent de s'appliquer.
- À la libération d'un quota : reprendre le montage interrompu avant le nouveau script prévu aujourd'hui, puis traiter une recherche ponctuelle en attente.
- Redémarrer le runner alors qu'un objectif attend le quota : retrouver la même occurrence et le même run, sans créer un deuxième départ.

## Point de validation

Valider les quatre modules, leur ordre et les choix proposés : calendrier semaine/jour en heure suisse, horaires facultatifs, agent explicitement choisi conservé, répétitions sans chevauchement par défaut, reprises admissibles avant objectifs dus puis missions ponctuelles.

Après validation, préciser les contrats et critères propres à chaque module en s'appuyant sur les spécifications existantes. Le suivi d'avancement reste dans la liste canonique `pipelines-missions-calendrier` de claude-mem.
