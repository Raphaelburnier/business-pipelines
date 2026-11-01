# Alertes d’exploitation hors du cockpit

Résumé : un service dédié sur le NAS lit les événements durables et les remet au SMTP configuré. Il fonctionne sans le PC, conserve les envois à reprendre et n’a aucune autorité sur les runs. Le destinataire choisi est l’adresse du compte SMTP existant ; la configuration reste privée sur le NAS.

## Événements et envois

`alerte`, `run.failed` et le format moteur actuel `run.finished` avec `status: failed` sont pris en compte. Les succès, annulations et simples événements de progression ne produisent pas de courriel. Les messages contiennent le contexte minimal du run ou de la machine et des liens de lecture ; les raisons libres, payloads, identifiants SMTP et jetons ne sont pas reproduits.

Le premier démarrage se positionne à la tête courante pour éviter un déluge historique. Ensuite, le curseur et les notifications sont conservés dans `etat/alertes/notifications.sqlite`. Chaque événement est préparé une seule fois ; les répétitions machine sont regroupées pendant quinze minutes et un groupe déjà en attente n’est pas multiplié. Trois messages au maximum sont essayés par tour de quinze secondes. Les accusés sont conservés trente jours, avec un maximum de 10 000 ; les messages en attente ne sont pas purgés.

Un échec SMTP est réessayé avec un recul d’une minute à une heure. Les autres notifications continuent. Un envoi et son accusé SQLite ne forment pas une transaction distribuée : un arrêt entre les deux peut répéter le courriel, dont le Message-ID reste identique. L’acceptation SMTP n’est pas une preuve de remise en boîte de réception.

## Configuration privée

Créer `specs/alerteur.json`, mode 600, propriétaire du NAS 1026:100. Les champs sont ceux du gabarit `specs/alerteur.json.example`. Le JSON conserve les caractères des mots de passe sans interpolation shell ou Compose. Le fichier réel est exclu de Git et des images Docker, puis monté en lecture seule ; aucune clé de fournisseur ou de GitHub n’est transmise au service.

L’opérateur peut reprendre le SMTP de l’ancien fichier, avec le choix explicite du compte comme destinataire :

```sh
node bin/preparer-alerteur.js specs/alerte.env specs/alerteur.json --compte-smtp
node bin/alerteur.js --verifier-config
```

L’utilitaire refuse de remplacer une configuration cible différente et ne modifie jamais l’ancien `alerte.env`. Il n’affiche aucune adresse ou valeur secrète. Le SMTP utilise TLS implicite au port 465, STARTTLS exigé autrement et la validation normale des certificats. Connexion, dialogue et envoi sont bornés ; le transport est fermé à la fin de chaque tentative.

## Service et état

Le service Docker `alerteur` tourne sous 1026:100, sans capacités Linux, sans port entrant, sans accès Docker, sans agent ni modèle. Sa racine est en lecture seule. Il lit `etat/` via `/app/source` et n’écrit que dans son dossier `/app/alertes`. Il utilise un réseau distinct et un verrou noyau, libéré même après SIGKILL, pour empêcher deux consommateurs simultanés du même journal.

```sh
sudo docker exec business_alerteur node bin/alerteur.js --etat
sudo docker exec business_alerteur node bin/alerteur.js --sante
```

L’état expose le curseur et son retard, les compteurs, les catégories d’erreur, le dernier succès et l’âge du plus ancien message en attente. Les logs JSON portent une corrélation et le point d’entrée, jamais le contenu du courriel ou la configuration. Un SMTP indisponible est distingué d’un consommateur arrêté. Le healthcheck vérifie que le service consulte bien sa source et progresse récemment.

Une notification de recette peut être remise au destinataire configuré avec `--tester`. Elle ne crée ni événement ni run et ne change pas le curseur. Les courriels d’approbation historiques restent compatibles avec `bin/alerter.js` ; le service de ce lot cible les alertes d’exploitation.

## Livraison, restauration et sauvegarde

Le modèle protège l’activation et le retour arrière du nouveau service. Il refuse l’absence de configuration privée ou de mode 600 avant toute construction. Le service doit être actif et son contrôle local réussir avant une livraison considérée saine ; une panne restaure l’ancien ensemble de services et les anciennes images. Le journal d’envoi reste dans `etat/`, hors archives de rollback du code.

La sauvegarde 4.5 inclut la base d’envoi lorsqu’elle existe. Elle la copie avant `events.sqlite`, afin que le curseur sauvegardé ne dépasse pas les événements de la copie source. Restaurer les deux avec les services arrêtés et suivre le guide de reprise. Aucun test ne remplace la base de production.

Le [guide de réaction](runbooks/alertes.md) précise les vérifications à faire en cas d’alerte ou d’absence de courriel. Le lot reste en cours jusqu’à la recette SMTP, à l’approbation du modèle exact et à la vérification du service livré.
