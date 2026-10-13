# F06 — cours datés et liste de suivi personnelle

## Contrat avant implémentation

Marchés garde les statistiques annuelles de la Banque mondiale et ajoute un espace
« Cours & suivi ». Cette première version consulte des clôtures quotidiennes EODHD,
indicatives, pour la recherche personnelle. Aucun ordre, abonnement ou flux temps réel.
Les titres du catalogue servent à vérifier le connecteur, sans recommandation d'achat.

Identité : fournisseur + code de place + symbole, jamais le symbole seul. Le catalogue
initial distingue Apple (NASDAQ/USD), VTI (NYSE Arca/USD), Nestlé (SIX/CHF), ASML
(Amsterdam/EUR) et Toyota (Tokyo/JPY). Les identités sont documentées chez l'émetteur
ou la place ; la disponibilité de chaque code chez EODHD demande une réponse effective.
Les places étrangères restent **non vérifiées** tant que l'accès les refuse.

Un historique couvre les 365 derniers jours calendaires, fin incluse. Une ligne est une
observation `(instrument, date)` ; week-ends, jours fériés et suspensions ne créent aucune
ligne ni zéro. Le dernier prix porte la date de la source, séparée de l'heure de collecte.
Au-delà de cinq jours calendaires, l'écran invite à vérifier la date, sans prétendre
connaître le calendrier de la place. Aucun taux de change ni total multidevise.

`close` est la clôture brute, `adjusted_close` la clôture ajustée des divisions et
dividendes selon EODHD. Le sélecteur et le tableau les distinguent. Une collecte recharge
toute la fenêtre : une opération sur titre peut réviser des valeurs anciennes. Les
compteurs distinguent ajouts, révisions et sorties de fenêtre. Le prix n'est pas un
montant comptable en centimes ; le JPY et les décimales des cours gardent leur unité.

## Accès, coût et droits

Sans `EODHD_API_TOKEN` côté serveur, utiliser le jeton public `demo`, uniquement pour
Apple et VTI. Les autres titres restent ajoutables au suivi mais ne déclenchent aucun
appel avec cet accès. Aucun secret ne transite par le navigateur, les erreurs, les URL
de provenance ou le cache. Ne jamais envoyer une clé dans le chat ni l'ajouter à Git.
La configuration suit le chargeur d'environnement du cockpit existant ; un redémarrage
est nécessaire après configuration. Ce développement ne modifie aucun fichier secret.

La [tarification EODHD](https://eodhd.com/pricing), vérifiée le 13 octobre 2026, annonce
un compte personnel gratuit : 20 appels/jour et un an d'historique mondial. La recette
internationale nécessite une clé et reste à faire. Le serveur conserve un plafond de
20 appels/jour UTC, même avec une offre supérieure : pas d'activation de coût supplémentaire.
Ce compteur décrit les appels du cockpit, pas ceux d'autres applications utilisant la clé.
Écritures atomiques avant chaque requête, tentatives échouées incluses ; intervalle de
60 secondes entre collectes, collectes concurrentes regroupées. Les lectures n'appellent
jamais le fournisseur. Au maximum cinq instruments, appels séquentiels.

Les [conditions personnelles](https://eodhd.com/financial-apis/terms-conditions) couvrent
la recherche privée pour ses propres investissements. Un affichage public, une diffusion
à d'autres utilisateurs ou une exploitation commerciale demande une licence adaptée.
Le fournisseur [décrit ses prix comme indicatifs](https://eodhd.com/financial-summary/VTI.US),
pas comme un flux officiel d'exécution : vérifier le prix chez le courtier avant d'investir.

## Pannes et preuve

Un refus 403 signifie accès refusé, **pas** symbole inexistant ; 404 signifie introuvable
chez ce fournisseur. 401 et 429 arrêtent la collecte restante. Une réponse vide, invalide,
tronquée, trop volumineuse ou un délai de 20 secondes dépassé conserve le dernier succès
avec ses dates. Aucun texte d'erreur distant n'est reflété. Format strict : dates valides
et uniques dans la fenêtre, OHLC positifs cohérents, volume entier non négatif, clôture
ajustée positive ou absente. Une absence ajustée interrompt sa courbe.

Cache indépendant `etat/finance/cours.json` (un processus écrivain), dossier 0700/fichier
0600, taille maximale 6 Mo. Rechargement : validation et reconstruction depuis les réponses
sources et leur SHA-256, jamais depuis des points édités. Cache corrompu : cours indisponibles
sans vider le fichier ni désactiver la trésorerie ou la macro. Dernier original par titre,
pas un archivage de toutes les versions ; les futures missions figeront leurs propres preuves.

API authentifiée du cockpit, contrôle d'origine sur les POST :

| Route | Usage |
| --- | --- |
| `GET /api/finance/prices` | Catalogue, suivi, cours/historique, disponibilité, quota local |
| `GET /api/finance/prices/example` | Exemple entièrement fictif, aucune écriture ni requête |
| `POST /api/finance/prices/watchlist` | `{ids:[...]}` depuis le catalogue fixe, sans collecte |
| `POST /api/finance/prices/refresh` | `{}` ; collecte manuelle de la liste actuelle |
| `GET /api/finance/prices/original?id=...` | Réponse source, période, SHA-256 et URL sans jeton |

Validation : fixtures financières indépendantes (homonymes de places, JPY, jours sans
séance, clôture ajustée absente, révision rétroactive, accès refusé, quota, panne, redémarrage,
cache corrompu, fuite de secret) ; routes réelles identité/origine ; navigateur ordinateur
et mobile. Recette publique réelle sur Apple/VTI. Les essais simulés hors États-Unis ne
valident pas la couverture réelle du fournisseur.

Références : [API EOD](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes),
[Nestlé sur SIX](https://www.six-group.com/en/market-data/shares/share-explorer/share-details.CH0038863350CHF4.html),
[ASML sur Euronext](https://live.euronext.com/en/product/equities/nl0010273215-xams),
[VTI chez Vanguard](https://institutional.vanguard.com/assets/corp/fund_communications/pdf_publish/us-products/fact-sheet/F0970.pdf),
[Toyota, informations actionnaires](https://global.toyota/en/ir/stock/).
