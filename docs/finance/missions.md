# Missions Finance — contrat F07

Une mission Finance observe des données datées et produit un rapport privé. La
demande utilise `nature: "finance"` ; le plan annonce `resultat.type: "rapport"`,
sans dépôt GitHub. Les missions de développement et de marketing gardent leurs
contrats actuels.

`finance-research@1`, dans agent-registry, déclare un workspace `documents` et
quatre étapes :

| Étape | Exécutant | Rôle du plan | Artefact |
| --- | --- | --- | --- |
| collecte | `finance-snapshot` | collecte | `finance-snapshot.json` |
| analyse | `financial-research-analyst@1` | analyse | `finance-report.json` |
| validation | `finance-report-validate` | validation | `finance-validation.json` |
| publication | `finance-report-publish` | publication | rapport archivé privé |

La validation déterministe rend PASS ou FAIL. Un FAIL retourne à l'analyse, avec
une seule correction autorisée ; seul PASS ouvre la publication. L'agent ne
valide pas son propre rapport. Le snapshot et le rapport séparent faits sourcés,
hypothèses, données manquantes et scénarios. Une trésorerie absente reste inconnue.

La fiche `projects/finance/project.json` rattache ce pipeline au projet Finance,
avec publication GitHub désactivée. Son champ repo reste une adresse de
compatibilité avec le contrat de projet ; le mode `documents` ne clone aucun dépôt.
F08 ajoute au moteur un workspace propre au run et transporte entre machines uniquement
les chemins déclarés dans `inputs` et `outputs`. Les artefacts sont bornés, transférés
avec SHA-256, installés avec droits privés et revérifiés à la reprise.

Les trois handlers sont enregistrés côté runner NAS. La capacité du planificateur
est fournie par le serveur, via `params.financeDisponible(handler, machine) === true`,
jamais par la requête HTTP. Elle couvre chaque script actif et est relue lors de la
proposition, du lancement et de la mise en file manuelle. Le contrôle serveur reste
obligatoire même si un client contourne le formulaire.

La recette F07 injecte cette capacité dans une fixture isolée : elle prouve la
proposition, le gel, la mise en file idempotente et la relecture du contrat,
sans exécuter d'agent ni produire une analyse financière réelle. L'API normale
reste bloquée. Les sources de cours déjà disponibles restent en accès public
limité ; aucune clé EODHD personnelle n'est requise pour F07.

F08 épingle la procédure `finance-snapshot-analysis` par empreinte dans le manifeste du workspace et
transmet les empreintes des entrées/sorties dans les événements du run. F09 enregistre
les handlers : la collecte compose un snapshot depuis la trésorerie importée et les caches
macro/cours, sans requête réseau au moment de la mission ; le validateur contrôle le schéma,
les sources et les questions ; la publication refuse tout verdict autre que PASS et archive
les trois artefacts en privé, avec idempotence par run. `/api/finance/reports` expose les
rapports validés à l'onglet Analyses. Un snapshot absent reste inconnu, les devises ne sont
pas converties et les cotations restent datées. Ces contrôles déterministes ne prouvent pas
la qualité du raisonnement économique. Les décisions d'investissement restent effectuées
manuellement chez le courtier ; aucun ordre ni accès courtier ne fait partie de ce pipeline.

## Versions compagnons

Les PR compagnons sont fusionnées : moteur #49 (`257a1ad6c4f3ba14ef4457dbd7bc82190793fe15`)
et registre #14 (`796abe97abb024de5e694aab42f0feb84a74383e`). Le cockpit les consomme
via `agent-orchestrator` et ses fixtures versionnées. Le code Finance du cockpit a été livré
par la PR #94. Ces fusions ne prouvent pas que les dépôts sont déployés sur le NAS : le run
F08 natif et la vérification du runtime restent à faire après livraison.
