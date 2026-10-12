# Finance — trésorerie CSV et contexte macro

La page `/finance` fonctionne sans chiffres initiaux. Les montants sont inconnus tant
que les entrées nécessaires ne sont pas importées. « Voir un exemple fictif » charge
des cas synthétiques en lecture seule ; aucune ligne n’est ajoutée au stockage. Le
mode global `?source=maquette` ne propose aucune écriture Finance.

Trésorerie et le premier connecteur macro de Marchés sont implémentés. Analyses et
Portefeuille indiquent « À développer ». Dans Marchés, collecter les statistiques
publiques puis choisir une zone et un indicateur pour lire dix années d'historique.
Le [contrat macro](macro.md) détaille les dates, absences, sources et limites.
Le futur agent prépare des analyses sourcées ; les investissements seront exécutés par
l’utilisateur chez son courtier. Aucun cours boursier ni agent d'analyse n'est encore intégré.

## Premier usage

1. Télécharger `mouvements.csv` et `soldes.csv` depuis la page. Les [modèles](templates/)
   contiennent seulement les en-têtes ; les [exemples](exemples/) sont fictifs.
2. Identifier chaque business et chaque compte avec des identifiants stables. Utiliser
   les identifiants du relevé pour `source_record_id`, jamais un numéro de ligne recalculé.
3. Renseigner les dates ISO et les montants en centimes entiers : 1200 CHF = 120000.
   Les remboursements et dépenses sont négatifs, les paiements clients positifs.
4. Choisir le type, sélectionner le CSV puis prévisualiser. Le mapping permet d’associer
   des noms de colonnes différents au contrat. Recalculer l’aperçu après une modification.
5. Corriger les erreurs et confirmer. Un conflit bloque l’intégralité de cet import.
6. Choisir période, compte/business et devise. Un clic sur un indicateur ouvre ses
   mouvements sources. Les soldes de départ et les factures sont consultables en dessous.
7. Pour un solde par business, ouvrir « Attribuer les comptes aux business ». Déclarer
   explicitement les comptes dédiés ; un compte partagé ne reçoit aucune allocation estimée.

## Contrat et calculs

| Entrée | Identité stable | Règle |
| --- | --- | --- |
| Mouvement | `(source, source_record_id)` | Le signe et la catégorie déterminent les flux ; `business_id` décrit le mouvement. |
| Solde | `(account_id, currency, source_record_id)` | Observation au **début** de `as_of`, avant les mouvements du jour. Deux soldes contradictoires à une même date sont refusés. |
| Facture | `(business_id, document_id)` | Document distinct du mouvement bancaire ; `tax_minor` vide reste inconnu. |
| Attribution | `accountId` | Confirmation humaine `unknown`, `shared` ou `dedicated` avec `businessId`. S’applique à tout l’historique importé. |

Période : `[from, to)` — début inclus, fin exclue. Sans filtre, du premier jour connu au
jour suivant la dernière observation/mouvement. Les dates des factures ne déterminent
pas une période bancaire à elles seules.

Chaque devise garde son total. CHF, EUR et USD sont couverts avec deux décimales ; les
autres devises sont refusées. Aucun taux de change ni total multidevise n’est inventé.

- Encaissements nets = `customer_payment` − valeur absolue de `customer_refund`.
- Dépenses = valeur absolue de `operating_expense`.
- Excédent d’exploitation = encaissements nets − dépenses. Il ne représente pas un
  bénéfice comptable et n’utilise pas les coûts estimés des modèles d’IA.
- `owner_funding` distingue les apports/retraits des revenus.
- `internal_transfer` affecte les soldes de comptes, sans être un revenu. Les deux
  contreparties partagent `transfer_group_id` ; un groupe incomplet est signalé.
- Une facture `unpaid` reste hors trésorerie disponible. Les impayés indiquent l’état
  des documents importés, pas une reconstitution historique de leur statut. Le filtre
  compte affiche cet indicateur inconnu car les factures ne déclarent pas de compte.
- Solde calculé = dernier solde observé avant/au début + mouvements du journal jusqu’à
  la borne. Un compte sans solde empêche une somme consolidée trompeuse. Un nouveau
  solde contradictoire signale un écart ; il ne corrige jamais les mouvements en silence.
- Une trésorerie business est calculable seulement si tous les comptes concernés sont
  déclarés dédiés et si leurs mouvements ne déclarent pas un autre business. La propriété
  partagée, inconnue ou contradictoire laisse ce montant inconnu.

Les calculs utilisent des centimes entiers, une accumulation `BigInt` et un contrôle de
précision avant l’affichage. La présence d’un import ne prouve pas l’exhaustivité du journal.

## Stockage et API

Le service utilise un fichier JSON atomiquement remplacé, dans `etat/finance/finance.json`
par défaut. `etat/` est déjà un volume persistant dans le Compose actuel et reste ignoré
par Git. `FINANCE_STORAGE_ROOT` permet un dossier dédié. Aucun dossier n’est créé par
une lecture ou un aperçu. Première confirmation : dossier 0700 et fichier 0600.

Les CSV originaux, SHA-256, mapping, date de confirmation et numéro de ligne sont conservés.
Ne pas éditer le JSON à la main. Un JSON tronqué désactive Finance sans vider les données.
Sauvegarder le dossier avec les états du cockpit. Le stockage V1 suppose **un processus
écrivain** ; ce service n’est pas destiné à plusieurs instances partageant le fichier.

Les routes passent par les contrôles d’identité/hôte du cockpit ; les POST réutilisent
son contrôle d’origine et son lecteur JSON. Réponses API et CSV : `Cache-Control: no-store`.

| Route | Usage |
| --- | --- |
| `GET /api/finance/summary?from=&to=&account=&business=` | Indicateurs, historique, mouvements et provenance |
| `GET /api/finance/example` | Même lecture sur les fixtures, `synthetic: true` |
| `GET /api/finance/templates/{mouvements,soldes,factures}` | Modèle vide |
| `POST /api/finance/imports/preview` | `{kind,fileName,csv,mapping?}` → token, erreurs, doublons et aperçu |
| `POST /api/finance/imports/confirm` | `{token}` → confirmation idempotente |
| `POST /api/finance/accounts/scope` | `{accountId,ownership,businessId?}` → attribution confirmée |
| `GET /api/finance/imports/{id}` | Original de l’import confirmé |

Limites V1 : fichier CSV 1 Mo, corps JSON d’aperçu 2,1 Mo, 10 000 lignes/import,
100 aperçus en mémoire pendant 15 minutes, 1000 imports, 100 000 lignes conservées et
30 Mo de stockage. Un aperçu ne survit pas au redémarrage ; il faut le recalculer. Une
nouvelle écriture invalide les aperçus antérieurs. Le réimport identique ne crée ni ligne
ni nouvelle entrée d’import ; une modification du même identifiant demande une correction
explicite, dont le parcours n’est pas encore implémenté.

## Résultats attendus des exemples

Période `2026-10-01` → `2026-11-01` ; agrégation des comptes, sans filtre business.

| Indicateur, en centimes | CHF | EUR |
| --- | ---: | ---: |
| Solde initial | 100000 | 10000 |
| Encaissements bruts | 120000 | 0 |
| Remboursements | 20000 | 0 |
| Encaissements nets | 100000 | 0 |
| Dépenses | 40000 | 5000 |
| Excédent d’exploitation | 60000 | -5000 |
| Apports nets | 50000 | 0 |
| Virements internes consolidés | 0 | 0 |
| Solde final calculé | 210000 | 5000 |
| Impayés hors trésorerie | 30000 | 0 |

Les comptes `demo-courant`, `demo-epargne`, `demo-eur` n’ont aucune propriété implicite.
L’essai d’attribution les déclare dédiés au business fictif ; seul cet essai permet sa
trésorerie business. Le compte courant seul termine à 170000 CHF et l’épargne à 40000 CHF.

## Validation et suite

Commandes : `node test/finance-import.test.js`, `node test/finance-metrics.test.js`,
`node test/finance-sources.test.js`,
`npm test`, `npm run web:test`, `npm run web:build`. Les trois suites Finance sont incluses
dans `npm test`, donc dans la CI existante. La recette navigateur utilise un stockage
temporaire et uniquement ces fixtures : vide → exemple → import → réimport → filtres →
attribution → rechargement, navigation/retour, consultation clavier et largeur mobile.

Prochain jalon : couverture des cours, puis mission
réelle d’analyse. La livraison sur le NAS et la validation avec des relevés réels restent
distinctes des essais locaux.
