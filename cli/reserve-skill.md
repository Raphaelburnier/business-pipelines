---
name: reserve
description: Régler ou lire la réserve de quota {{FOURNISSEUR}} depuis cette CLI.
{{FRONTMATTER}}
---

Commande de réserve {{FOURNISSEUR}}, via le client installé `agent-reserve`. Invocation explicite : ce réglage change l’admission des runs et ne doit pas être choisi par un agent en arrière-plan.

- Sans argument, ou `status` : exécuter `agent-reserve {{RUNTIME}} status` (lecture seule).
- Entier de 1 à 100, éventuellement suivi de `%` : `agent-reserve {{RUNTIME}} 75` fixe ce seuil consommé et **active** la réserve. Employer le nombre réellement fourni, jamais celui de cet exemple par défaut.
- `off` : `agent-reserve {{RUNTIME}} off` désactive la réserve et garde le seuil choisi.
- Un préfixe explicite `claude` ou `codex` remplace le fournisseur de cette CLI pour cette invocation uniquement.

Les arguments doivent correspondre à cette grammaire avant de construire la commande shell : ne pas exécuter de texte libre, afin qu’un argument ne devienne pas du code. Sans seuil explicitement demandé, rester en lecture seule : créer cette commande n’autorise pas à choisir un pourcentage pour l’utilisateur.

Le client attend l’acquittement et relit l’état réel. Rapporter son résultat ; en attente ou en erreur, ne pas annoncer le réglage appliqué et ne pas réessayer automatiquement, afin de ne pas dupliquer une demande dont la réponse a été perdue. Ne pas utiliser SSH, SQLite ni des en-têtes d’identité fabriqués : le cockpit doit attribuer l’écriture à l’opérateur authentifié.

Arguments de l’invocation : {{ARGUMENTS}}
