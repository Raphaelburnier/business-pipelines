# Fixtures de mission Finance — F08

Ces fichiers servent uniquement à préparer et vérifier le contrat de transfert vers
`finance-research@1`. Ils ne décrivent ni les comptes de Raphaël ni des cours de marché
observés. Ils sont destinés à un workspace de recette isolé, sans accès au courtier.

## Contenu

- `finance-snapshot.json` : instantané synthétique préparé le 2026-10-14 à partir des
  exemples CSV F01 déjà présents dans `../exemples/`.
- `manifest.json` : empreintes SHA-256 des entrées et des définitions agent, pipeline et
  procédure utilisées pour la préparation.
- Les opérations sont comptabilisées par devise. Les transferts internes sont exclus des
  revenus et dépenses. Les factures impayées restent hors trésorerie.
- Aucun cours, indicateur macroéconomique ou taux de change n’est inclus. Leur absence
  est explicite : le rapport de recette ne doit pas les combler par des estimations.

## Valeurs attendues

| Devise | Solde initial | Encaissements nets | Dépenses | Excédent opérationnel | Trésorerie finale | Impayés |
|---|---:|---:|---:|---:|---:|---:|
| CHF | 1 000.00 | 1 000.00 | 400.00 | 600.00 | 2 100.00 | 300.00 |
| EUR | 100.00 | 0.00 | 50.00 | -50.00 | 50.00 | 0.00 |

Le compte CHF est consolidé sur les comptes courant et épargne du business fictif. Les
50 CHF d’apport augmentent la trésorerie mais ne sont pas des revenus. Le virement de
400 CHF entre les deux comptes ne change pas le solde consolidé. Aucun total CHF/EUR
n’est calculé. L’excédent opérationnel n’est pas un bénéfice comptable.

## Réutilisation

Copier `finance-snapshot.json` dans le répertoire d’entrée du workspace éphémère, puis
calculer son SHA-256 dans le manifeste de recette avant tout lancement. Garder ce fichier
inchangé pendant une reprise. Les éventuels rapports de sortie sont des artefacts de
recette, à stocker hors de ce dossier source.
