# Réagir à une alerte du cockpit

Résumé : un courriel signale un run échoué ou une machine devenue indisponible. Ouvrir le lien du cockpit pour consulter le diagnostic puis agir depuis une session opérateur. Le courriel ne permet pas d’approuver, d’arrêter ou de relancer un run.

## Run en échec

Consulter le run lié, son étape en échec et ses journaux. Vérifier les conditions qui ont changé (connexion du worker, authentification, dépendance, conflit ou verdict de tests) avant une reprise manuelle. Si la cause reste inconnue, conserver l’ID du run et son diagnostic pour investigation ; une relance répétée ne constitue pas une résolution.

## Machine indisponible ou étape perdue

Vérifier dans le cockpit l’état du worker, sa dernière connexion et l’étape concernée. Réveiller ou reconnecter la machine si nécessaire, puis vérifier la reprise proposée. Les alertes répétées pour une même machine et un même sujet sont regroupées pendant quinze minutes, avec un seul message en attente pour ce groupe ; les échecs de runs distincts ne sont pas regroupés.

## Aucun courriel reçu

Sur le NAS, lire l’état sans exposer la configuration :

```sh
sudo docker compose ps alerteur
sudo docker exec business_alerteur node bin/alerteur.js --etat
sudo docker logs --tail 30 business_alerteur
```

- `sourceCode` doit être `ok` et le dernier tour récent. Un retard positif se rattrape par pages.
- `pending` indique des messages persistés qui restent à envoyer. `EAUTH` demande de vérifier le SMTP privé ; `ETIMEDOUT`, `ECONNECTION` ou `ESOCKET` demandent de vérifier la connectivité et le fournisseur. Le recul entre réessais varie d’une minute à une heure. Aucun échec ne marque le message envoyé.
- Un message peut avoir été accepté par le SMTP puis classé comme indésirable ou refusé plus loin. Vérifier la boîte cible et les retours du fournisseur. Le service ne prouve pas l’arrivée dans la boîte de réception sur la seule acceptation SMTP.
- `SOURCE_CHANGE_OU_RECULE` signale un journal moteur remplacé ou restauré dont le curseur n’est plus cohérent. Arrêter l’alerteur, conserver sa base pour analyse, puis reconstituer un point de départ depuis une restauration compatible ou archiver explicitement l’ancien dossier d’envoi avant une nouvelle initialisation. Ne jamais effacer ce dossier à l’aveugle : il porte les messages en attente.

Le premier démarrage part de la tête courante du journal : il n’envoie pas l’historique. Un arrêt brutal entre acceptation SMTP et accusé local peut provoquer une répétition avec le même Message-ID. Une restauration d’une sauvegarde ancienne peut aussi rejouer un envoi ; vérifier les messages déjà reçus avant de réactiver un ancien journal.

Un NAS arrêté ne peut pas annoncer sa propre panne par ce service. À son retour, les événements qui avaient été enregistrés sont repris ; les événements jamais écrits ne peuvent pas être reconstruits. Le monitoring indépendant de l’hôte et la santé générale relèvent du lot 4.3.
