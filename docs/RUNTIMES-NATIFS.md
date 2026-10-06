# Intégration des agents Codex et Claude

Le choix de backend d'un rôle de développement ou marketing est transmis au moteur
avec `llm { via, model }`. Le conseiller Qwen garde sa configuration indépendante.

Le cockpit refuse Codex si aucun worker joignable ne l'annonce dans
`meta.capacites.backends`. La configuration `pc:claude,omniroute,codex` seule ne
prouve pas qu'un ancien worker sait exécuter Codex. Il n'y a pas de réveil ou de
repli implicite vers Claude.

Une connexion expirée conserve le run et sa session dans `waiting_auth`.
L'interface affiche « connexion requise » et permet la reprise après reconnexion
sur la machine d'exécution. Le code de sortie 78 fait partie des attentes normales
du runner. L'attente n'est pas présentée comme une approbation à donner.

## Livraison conjointe

1. Fusionner la PR moteur [#33](https://github.com/Raphaelburnier/agent-orchestrator/pull/33)
   et cette intégration cockpit, après leurs CI respectives.
2. Livrer ensemble le moteur NAS et le cockpit ; mettre à jour le worker PC avec
   le même contrat de protocole. Vérifier ses capacités annoncées.
3. Vérifier la connexion des CLI sous le compte du service worker, y compris
   l'écriture des fichiers de session. Le NAS ne porte pas la connexion Codex.
4. Faire un run puis une reprise depuis le cockpit pour confirmer l'installation.

La CI épingle le commit moteur testé. Les exclusions Docker réintroduisent seulement
`ci.yml` et `agent-gated-merge.yml`, requis par les tests exécutés pendant la
construction de l'image. Les autres workflows et les fichiers `.env` restent
exclus du contexte. La modification de CI/Docker demande une fusion explicite
selon les instructions du dépôt.

La recette locale du 6 octobre a validé les deux CLI sur abonnement, des sorties
marketing et du code, puis la reprise de la même session. Le test distribué du
moteur couvre une connexion expirée et la reprise via les vrais WebSockets.
La recette Docker minimale a validé les inclusions et exclusions sur le NAS,
sans basculer les services. Cela ne constitue pas une livraison en production ni
la recette complète revue indépendante → PR → fusion.

Voir les [garanties et limites du moteur](https://github.com/Raphaelburnier/agent-orchestrator/blob/claude/via-codex/docs/RUNTIMES-NATIFS.md).
