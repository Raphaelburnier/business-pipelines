# Régler la réserve depuis les CLI

Résumé : `agent-reserve` utilise les mêmes API opérateur que les formulaires du cockpit, sans clé locale ni accès direct au moteur. Deux raccourcis visent le fournisseur de la CLI courante : `/reserve` dans Claude Code et `$reserve` dans Codex. Un nombre fixe le seuil consommé **et active** la réserve ; `off` désactive sans effacer le seuil ; sans argument, lecture seule. L’extension Codex doit être livrée sur le cockpit pour que sa route soit disponible.

## Utilisation

| Action | Claude Code | Codex |
| --- | --- | --- |
| Lire l’état | `/reserve` | `$reserve` |
| Seuil choisi de 75 % et activation | `/reserve 75` | `$reserve 75` |
| Désactiver | `/reserve off` | `$reserve off` |

Le nombre 75 est un exemple, pas un défaut. Les réserves restent séparées. Un fournisseur explicite remplace celui de la CLI : `/reserve codex 80` ou `$reserve claude 80`.

Depuis un terminal, sans appel à un modèle :

```sh
agent-reserve claude status
agent-reserve codex 75
agent-reserve codex off
agent-reserve codex status --json
```

Le client attend une commande acquittée puis relit la configuration réelle. Un HTTP 202 seul, un refus ou une attente trop longue ne sont jamais annoncés comme une application. En cas de réponse perdue, relire `status` avant de réessayer : une nouvelle écriture automatique pourrait dupliquer une commande déjà acceptée.

## Installation sur le poste opérateur

```sh
node bin/installer-reserve.js --cockpit-url 'https://<nom-du-cockpit-sur-le-tailnet>'
```

L’URL réelle reste locale, hors du dépôt public. L’installateur copie le client dans `~/.local/share/agent-reserve/`, installe `~/.local/bin/agent-reserve` et les deux skills personnels. Les liens ne pointent pas vers un worktree temporaire. Une installation existante étrangère est refusée avant remplacement, pour conserver les commandes personnelles de l’utilisateur.

La configuration `~/.config/agent-reserve/config.json` contient uniquement `{ "url": "…" }`, jamais de clé. `COCKPIT_RESERVE_URL` peut remplacer cette URL pour une invocation. Le client utilise HTTPS sur le tailnet ; loopback est autorisé pour les tests locaux. Il refuse les identifiants dans l’URL et les redirections, afin de ne pas envoyer une commande opérateur vers un autre service.

Le serveur établit l’identité via la connexion tailnet ; le client ne fabrique pas d’en-tête d’identité et n’utilise ni SSH ni SQLite. Sans droit opérateur, la lecture reste possible mais une modification est refusée. Aucune clé HMAC n’est lue : la signature et l’application restent du côté cockpit/publieur.

Les skills sont des raccourcis opérateur, non des procédures de pipeline ; leurs variantes sont générées depuis le même modèle `cli/reserve-skill.md`. Ils sont limités à l’invocation explicite : le seuil modifie le droit des runs à consommer un abonnement, il ne doit pas être choisi lors d’une tâche sans demande de l’utilisateur.

Après installation, ouvrir une nouvelle session si le menu de la CLI ne montre pas encore le skill. Le programme de terminal est utilisable immédiatement si `~/.local/bin` est dans le PATH.

## Vérification

`npm run test:reserve-cli` vérifie l’isolation des fournisseurs, les bornes, le droit opérateur, l’attente de l’acquittement, les refus, la perte de réponse sans rejeu, le changement de réglage concurrent et l’installation hors dépôt. Les échanges HTTP sont simulés ou sur loopback ; aucun seuil réel n’est modifié par les tests. Cette suite fait partie de `npm test`.

Références de syntaxe : [skills Claude Code](https://code.claude.com/docs/en/skills), [skills Codex](https://learn.chatgpt.com/docs/build-skills). Contrat des routes et événements : `SPEC-reserve-quota-codex.md` et `SPEC-reserve-quota-claude.md`.
