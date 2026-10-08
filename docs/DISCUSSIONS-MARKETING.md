# Discuter avec l'équipe marketing d'un projet

La page `/marketing` choisit le projet métier. `/marketing/<projet>` retrouve ses fils,
et `/marketing/<projet>/<fil>` ouvre une discussion. Le panneau projet et la navigation
permettent d'y accéder. Le projet n'a pas besoin d'une fiche séparée nommée `marketing`.

## Parcours

1. Choisir le projet, les membres compatibles, Codex/Claude et le modèle de chacun.
2. Donner l'objectif et le premier message. Cocher « directive » si cette consigne doit
   rester présente dans les tours suivants.
3. Lire les réponses attribuées, questions et propositions. Adresser la suite à toute
   l'équipe ou à un membre. Chaque destinataire répond une fois, depuis son rôle.
4. « Préparer cette spec pour le dev » conserve une proposition comme brouillon du même
   projet et ouvre le formulaire Missions. Relire l'équipe dev, les critères et la spec,
   puis lancer par le chemin habituel.

La préparation du brouillon ne lance aucun code. Le formulaire accepte les modifications
de spec ; le serveur conserve sa source, la proposition originale et les directives du
tour pour retracer ce passage. Aucun rôle de test ou de revue n'est supprimé.

## État durable

Les tables `team_threads`, `team_turns`, `team_drafts` et `team_requests` sont créées dans
le même SQLite que les commandes. L'ouverture ou l'envoi, son identifiant de requête,
le contrat et la commande `run.start` sont inscrits dans une transaction. Un envoi HTTP
rejoué avec le même auteur/canal/contenu retrouve son tour ; un contenu différent avec
le même identifiant est refusé. Une proposition déjà préparée retrouve son brouillon.

Les réponses restent des événements `team.reply` du moteur. La lecture vérifie l'étape
exacte réussie, le fil, le tour, le membre et le schéma de réponse. Les réponses partielles
restent visibles si un autre destinataire échoue ; la réussite du run reste distincte.

Le fil conserve les participants, modèles, projet et prompts résolus. Chaque tour fige
l'objectif, toutes les directives accumulées, les douze derniers tours (résumés des réponses,
questions et propositions limités à 4 000 caractères chacun et 64 000 au total, avec priorité
aux tours récents) et le nouveau message. L'historique affiché conserve
les réponses complètes. Maximum six destinataires, quarante tours par fil, six turns de
modèle par agent et trente-six par run ; aucune relance automatique entre agents.

Un tour en cours, interrompu ou attendant quota/connexion/machine/décision bloque le
suivant. Son lien vers le run permet de retrouver l'état réel. Les commandes de contrôle
et la reprise automatique des quotas restent le sujet 7 du plan autonome.

## API

Toutes ces routes passent par le contrôle d'identité du cockpit. Les POST gardent le
contrôle d'origine et le JSON borné du serveur.

| Route | Fonction |
|---|---|
| GET `/api/equipes/marketing/options?projet=<id>` | Projet, membres compatibles, modèles par défaut et empreinte |
| GET `/api/equipes/marketing?projet=<id>` | Fils du projet |
| POST `/api/equipes/marketing` | Objectif, participants, premier message, `requestId` et configuration |
| GET `/api/equipes/marketing/<fil>` | Messages, réponses, états des tours et brouillons |
| POST `/api/equipes/marketing/<fil>/messages` | Message/directive, destinataires facultatifs et `requestId` |
| POST `/api/equipes/marketing/<fil>/brouillons` | Tour, membre, index de proposition et `requestId` |
| GET `/api/equipes/brouillons/<id>` | Spec conservée et origine |

Le lancement habituel POST `/api/runs` accepte aussi `brouillonId`. Le serveur refuse un
autre projet ou un workflow non dev, et résout l'origine depuis son propre stockage.

## Mise en service et limites

Livrer les trois dépôts compagnons, puis le worker PC qui doit annoncer `discussion: 1`
en plus de `missions: 1`. Le contrôle avant mise en file et au dispatch évite un tour
silencieux avec un ancien worker. Le runner et sa concurrence restent ceux des runs.

Le fil produit des documents ; ni la publication d'une campagne, ni la collecte de sources
externes, ni l'action du conseiller Qwen ne sont ajoutées. Le dépôt applicatif n'est pas
cloné pour une discussion ; sa lecture exige un contexte fourni dans la demande. La
recette réelle conversation → brouillon → mission dev → tests/revues/PR/fusion reste
à exercer après livraison. Aucun test local ajouté ou lancé pour ce lot.
