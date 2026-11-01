# Sauvegarder et restaurer l’état du cockpit

Résumé : le PC tire chaque jour une copie cohérente de SQLite et de la configuration par SSH, puis conserve 14 archives chiffrées hors NAS. Une restauration vérifiée se fait toujours dans un dossier neuf ; la remise en service après sinistre reste une opération séparée, services arrêtés.

## Installation sur le PC

Prérequis : Linux avec systemd utilisateur, Node 22.16+ (API `node:sqlite.backup`), Python 3.8+, `tar`, `flock` et OpenSSH. La session du PC doit déjà joindre le NAS avec sa clé et une empreinte d’hôte connue ; le compte existant doit pouvoir appeler `sudo -n /usr/local/bin/docker exec`. Aucun nouveau droit NAS n’est ajouté. Le cockpit doit fonctionner, faute de quoi l’export échoue.

```sh
bash bin/installer-sauvegarde.sh utilisateur@nas
systemctl --user list-timers sauvegarde-cockpit.timer
node "$HOME/.local/lib/cockpit-backup/bin/sauvegarder-etat.js" --statut
```

Le programme est copié dans `~/.local/lib/cockpit-backup` et ne dépend plus d’un worktree. Configuration privée : `~/.config/cockpit-backup/config.json`. Clé AES-256 : `~/.config/cockpit-backup/cle`, créée une seule fois et jamais affichée. Archives et `statut.json` : `~/.local/state/cockpit-backup/archives`. Une réinstallation conserve la configuration et la clé.

**Conserver une copie privée de la clé sur un autre support sûr. Sans elle, une perte du PC rend les archives irrécupérables.** Ne jamais ajouter clé, configuration ou archives dans Git ou un journal. La clé locale est séparée des archives mais reste sur le PC : ce n’est pas une protection contre une compromission du compte utilisateur.

Le timer tourne à 05:45, décalage aléatoire jusqu’à 15 min, et rattrape un déclenchement manqué au démarrage de systemd. Il ne réveille pas le PC et ne démarre pas WSL depuis Windows. La sauvegarde devient périmée après 36 heures ; `--statut` affiche cet âge et conserve le dernier succès même après un échec. Diagnostic : `journalctl --user -u sauvegarde-cockpit.service`, sans contenu des fichiers. L’alerte externe relève du lot 4.2.

L’export passe par stdin SSH, s’exécute dans le cockpit et crée un répertoire temporaire 0700 dans le conteneur. La base est copiée par SQLite, y compris les transactions validées dans le WAL, puis vérifiée. `specs/` (dont `workers.json` et les secrets), `approvals/` et `projects/` sont copiés sans suivre de lien. Les workspaces, images, modèles et connexions CLI en dehors de ces dossiers ne sont pas sauvegardés. Les fichiers de configuration sont vérifiés pendant leur copie ; ce n’est pas une transaction globale entre SQLite et les fichiers.

L’archive ne transite en clair que par le canal SSH et le temporaire privé du conteneur. Elle est chiffrée en AES-256-GCM sur le PC. Seul un export terminé publie une archive ; un échec ou un dépassement de 5 min conserve les précédentes. Le verrou noyau empêche deux copies simultanées et se libère même après l’arrêt du processus. Une interruption brutale peut laisser un fichier `.partiel` chiffré sans validité et, côté NAS, un temporaire privé ; ils ne comptent pas dans la rétention. Ne pas supprimer un temporaire pendant une exportation active.

## Recette et restauration isolée

```sh
node "$HOME/.local/lib/cockpit-backup/bin/sauvegarder-etat.js" \
  --restaurer "$HOME/.local/state/cockpit-backup/archives/cockpit-etat-…cbackup" \
  --vers "$HOME/restauration-cockpit-NEUF"
```

Le déchiffrement complet et l’authentification précèdent l’extraction. Le programme refuse les liens, chemins sortants, doublons, fichiers inconnus du manifeste, altérations et bases invalides. Il compare les SHA-256 et le nombre de lignes de chaque table. Le dossier de destination ne doit pas exister. Les fichiers restaurés restent privés (0700/0600). Supprimer ensuite ce dossier de recette : il contient les secrets déchiffrés.

## Reprise après sinistre

1. Récupérer le code livré et les outils de restauration sur un PC sain ; récupérer l’archive et sa clé privée. Dans une configuration locale 0600, définir `cle`, `archives` et la cible `ssh` (la restauration ne se connecte pas au NAS).
2. Restaurer vers un dossier neuf, vérifier le manifeste et `PRAGMA integrity_check`. Les compteurs sont ceux de l’instantané, pas ceux d’une plateforme qui a continué à tourner.
3. Avant toute copie dans une installation NAS, arrêter **tous** les services écrivains : cockpit, runner, maître, publieur et livreur. Vérifier leur arrêt ; ne jamais remplacer une base active ni conserver un ancien `events.sqlite-wal`/`-shm` avec la base restaurée.
4. Garder l’installation sinistrée à part, remettre l’instantané dans une installation neuve, rétablir propriétaires et permissions privées attendues puis démarrer les services avec la release compatible. Ne pas utiliser le rollback de livraison pour restaurer ces données.
5. Relire les commandes et runs non terminés avant reprise : une restauration revient à un état ancien ; des effets externes déjà produits depuis cet instant peuvent exister. Vérifier notamment les PR et livraisons pour éviter de rejouer une action.

La procédure automatique ne bascule jamais les données de production. Cette recette couvre la récupération des fichiers et de SQLite ; elle ne simule pas la destruction du NAS ou la reprise des effets externes.

Depuis le lot 4.2, la base `etat/alertes/notifications.sqlite` est également copiée lorsqu’elle existe. Elle est sauvegardée avant l’event store pour que son curseur ne dépasse pas les événements de l’archive. Restaurer ensemble ces deux bases ; une remise en place d’un ancien état peut répéter des courriels déjà acceptés par le SMTP.
