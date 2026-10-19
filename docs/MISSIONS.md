# Lancer une mission depuis le cockpit

La page `/missions` propose d'abord les projets enregistrés. `/missions/<projet>`
préselectionne le projet depuis son panneau. Choisir son workflow, un membre compatible
et un modèle par rôle, puis saisir objectif, critères (un par ligne), spec détaillée,
directives et exclusions. Une relecture précède le lancement et le run s'ouvre dès son
admission. Le changement de projet/workflow réinitialise le formulaire.

Les rôles proviennent du pipeline réellement résolu. Les scripts et revues obligatoires
restent présents ; les revues optionnelles désactivées par la fiche sont exclues de la
sélection. Les affectations existantes préremplissent les choix ; chaque mission peut
choisir d'autres membres/modèles sans réaffecter l'équipe globale. Un choix « agent du
workflow » conserve le rôle du registre. Plusieurs membres affectés au même rôle exigent
un choix explicite dans le formulaire ou le défaut du workflow.

Pour une mission de développement, le contexte structuré initial est vide hormis le
projet, afin de ne pas réutiliser la demande d'un ancien run. Pour le marketing, relire
le contexte structuré (offre, marché, questions, contraintes) prérempli depuis le projet.
La spec détaillée peut être collée en texte libre. L'objectif, les critères et les directives
sont transmis à tous les agents et reviewers en plus de leur tranche métier.

## API

`GET /api/projects/<id>/mission?pipeline=<index>` rend projet, workflow, nature, rôles,
membres compatibles, modèles par défaut, contexte structuré, budget et empreinte de
configuration. La route utilise le même contrôle d'identité que le cockpit.

`POST /api/runs` accepte une demande stricte :

```json
{
  "projectId": "steam-tierlist",
  "pipelineIndex": 0,
  "configuration": "empreinte SHA-256 du GET",
  "requestId": "UUID conservé lors d'une relance HTTP",
  "demande": {
    "objectif": "Résultat attendu",
    "criteres": ["Critère vérifiable"],
    "document": "Spec détaillée",
    "directives": "Instructions pour cette mission",
    "exclusions": "Hors périmètre",
    "spec": {},
    "agents": [{"noeud": "plan", "membre": "margaux", "llm": {"via": "claude", "model": "opus"}}]
  }
}
```

Tous les rôles actifs doivent apparaître exactement une fois. Le serveur vérifie la
compatibilité des membres, les backends et la capacité du worker. Il refuse une
configuration périmée et construit lui-même le contrat résolu ; un client ne peut pas
fournir son propre pipeline, dépôt, profil de tests ou snapshot de prompts.

Une transaction SQLite lie `requestId`, auteur/canal et empreinte de la demande à une
commande unique. Un envoi identique retrouve cette commande, même si la configuration a
changé depuis ; une autre demande avec le même identifiant est refusée. Une orientation
marketing peut produire un autre run de la même mission via la commande existante du moteur.

Le panneau de run restitue objectif, critères, participants et modèles, spec et directives
depuis la commande d'origine. Les anciens lancements `projectId/pipelineIndex/llmOverrides`
restent pris en charge par l'API ; le panneau projet utilise désormais le formulaire.

## Objectifs « À venir »

Une ligne explicitement admissible de la feuille de route peut être lancée depuis le cockpit.
La demande conserve `{id, revision}` dans la spec de mission ; le serveur vérifie cette
référence, puis la signe avec le contrat et réserve l'objectif au plus une fois tant que son
run ou sa livraison est actif. Le client relit l'attribution depuis `GET /api/avenir/objectifs`.

L'attribution pointe toujours vers la commande initiale et le même `runId`, même si une
reprise quota crée une commande `run.resume`. Un quota avec échéance fiable peut être repris
automatiquement dans les bornes de `QUOTAS-REPRISES.md`; une échéance inconnue reste une
action manuelle. L'état du run et celui de la livraison sont distincts : un run réussi qui
attend encore sa PR ou sa fusion est affiché « en revue », pas comme une livraison terminée.

## Livraison

Ce lot dépend du moteur avec `packages/schemas/mission.js` et du worker annonçant
`missions: 1`. Livrer moteur/cockpit ensemble et actualiser le PC avant une mission réelle.
Le registre actuel suffit : aucun pipeline ni permission d'agent n'est changé par ce lot.
Le service cockpit monte aussi le registre livré en lecture seule et le retrouve par
`ORCH_REGISTRE`, pour préparer les rôles et figer leurs profils dans la commande.
La validation de fusion sensible reste celle du cockpit ; le conseiller Qwen n'obtient
pas de nouvel outil dans ce lot. La conversation d'équipe marketing et son passage vers
une mission dev sont décrits dans [DISCUSSIONS-MARKETING.md](DISCUSSIONS-MARKETING.md).
