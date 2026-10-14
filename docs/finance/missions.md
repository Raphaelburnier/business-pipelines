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

Les trois handlers ne sont pas encore installés. Le cockpit refuse donc par
défaut toute mise en file Finance, par le planificateur comme par le formulaire
manuel. Une capacité ne peut venir que du serveur, via
`params.financeDisponible(handler, machine) === true`, jamais d'un champ de la
requête HTTP. Elle doit couvrir chaque script actif et est relue au lancement.
F08/F09 devront raccorder cette preuve à des handlers réellement enregistrés.
Le formulaire manuel reçoit également `options.blocages` depuis le serveur et
désactive sa mise en file lorsqu'une capacité manque. Le contrôle serveur reste
obligatoire même si un client contourne le formulaire.

La recette F07 injecte cette capacité dans une fixture isolée : elle prouve la
proposition, le gel, la mise en file idempotente et la relecture du contrat,
sans exécuter d'agent ni produire une analyse financière réelle. L'API normale
reste bloquée. Les sources de cours déjà disponibles restent en accès public
limité ; aucune clé EODHD personnelle n'est requise pour F07.

F08 épingle la procédure `finance-snapshot-analysis` par empreinte dans le manifeste du workspace et
transmet les empreintes des entrées/sorties dans les événements du run. La recette F08
reste bloquée tant que les handlers Finance ne sont pas enregistrés ; aucune mission
native ni analyse réelle n'a été lancée. F09 installera les contrôles du rapport, son
archivage et sa consultation depuis Finance. Les décisions d'investissement restent effectuées manuellement chez le
courtier ; aucun ordre ni accès courtier ne fait partie de ce pipeline.

## Versions compagnons

Le cockpit utilise le moteur `257a1ad6c4f3ba14ef4457dbd7bc82190793fe15`
(`codex/finance-mission-contract`) et les déclarations du registre
`796abe97abb024de5e694aab42f0feb84a74383e`
(`codex/finance-research-pipeline`). Le moteur est épinglé à ce SHA dans la CI ;
les fixtures de tests copient les deux déclarations versionnées du registre.
Ces branches sont proposées en PR brouillon : leur existence ne signifie pas
qu'elles sont fusionnées ou installées sur le NAS.
