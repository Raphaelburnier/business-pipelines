# Marchés — premier connecteur macro (F05)

Catalogue initial fixe : Suisse, États-Unis, Union européenne, Chine, Japon et
monde ; croissance du PIB réel et inflation des prix à la consommation, en % par
an. Dix années civiles closes, sans prévision ni remplissage des trous. Les
agrégats suivent la méthode WDI ; aucune moyenne entre pays n'est calculée ici.

Source : Banque mondiale, World Development Indicators (source API 2). Les fiches
[PIB](https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG) et
[inflation](https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG) donnent les
définitions, fournisseurs et licence CC BY 4.0. Attribution aux fournisseurs
statistiques nationaux/OCDE/Banque mondiale pour le PIB et au FMI pour l'inflation.
[Conditions de réutilisation](https://data.worldbank.org/summary-terms-of-use).

## Contrat de collecte

- GET `/api/finance/macro` lit le cache sans collecte ni écriture.
- POST `/api/finance/macro/refresh`, corps `{}`, collecte le catalogue fixe. Une
  requête publique, sans clé, abonnement, données business ni URL fournie par le
  navigateur. Les contrôles d'identité et d'origine existants s'appliquent.
- GET `/api/finance/macro/original` expose la dernière réponse publique conservée,
  son URL exacte, SHA-256 et date de collecte. Elle explique les points affichés.
- GET `/api/finance/macro/example` expose un exemple explicitement fictif, sans
  appel externe ni persistance. La maquette globale utilise exclusivement cet exemple.

Collectes concurrentes regroupées ; minimum 60 secondes entre deux tentatives ;
timeout 20 secondes, réponse bornée à 512 ko. Une réponse non conforme, incomplète,
paginée de façon inattendue ou contradictoire n'efface pas le dernier instantané.
Les tests CI injectent les réponses et n'utilisent pas Internet.

Identité d'un point : `(pays, indicateur, année)`, y compris une valeur manquante.
Réimport identique : zéro ajout et zéro révision. Une révision officielle remplace
le point de même identité et incrémente la version ; le cache conserve le dernier
instantané, pas toutes les versions historiques. Les futures missions figeront
leurs propres entrées. Les valeurs statistiques sont des nombres, distincts des
centimes exacts de la trésorerie ; arrondi uniquement à l'affichage.

## Dates et disponibilité

L'année observée, la collecte et `lastupdated` sont distinctes. `lastupdated`
désigne la mise à jour de la base WDI, pas la publication individuelle du chiffre.
La date de publication individuelle reste inconnue. Une valeur nulle reste absente ;
la carte indique explicitement si la dernière année du catalogue manque et cite
l'année de la dernière valeur. Une série sans valeur reste indisponible.

Le cache est à actualiser après 7 jours ; un dernier point antérieur de plus d'un
an à la dernière année civile close est signalé comme ancien. Ces seuils sont des
règles du cockpit et non un engagement de fréquence de la Banque mondiale.
Une panne indique la dernière tentative et préserve les dates du dernier succès.
Collecte manuelle uniquement dans F05 ; programmation prévue en F12.

Stockage atomique séparé : `etat/finance/macro.json`, sous `FINANCE_STORAGE_ROOT`
s'il est défini, fichier 0600 et dossier 0700. Un processus écrivain. Un cache
corrompu désactive les routes macro sans désactiver les imports de trésorerie.
Lecture du cache bornée à 2 Mo. Aucun fichier financier privé n'est transmis.

Cette vue constitue un contexte économique annuel. Les cours d'actions/ETF,
connecteurs BNS/BCE/Fed et rapports de l'agent restent des étapes ultérieures.
