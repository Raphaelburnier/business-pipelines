# business-pipelines

Pipelines business bâtis sur [`agent-orchestrator`](../agent-orchestrator).

Ce dépôt est né comme un **spike** avec une question précise : le moteur a été conçu
autour d'un workspace de fichiers (empreinte, commits git, projet généré). Tient-il quand
le travail est un appel d'API et non la génération de fichiers ?

Réponse : oui, à une condition, et le spike a coûté une modification au moteur.

## Ce que le spike a établi

**L'accès au monde extérieur appartient à un stage typé, jamais à un agent.** Le handler
`fetch` appelle l'API officielle, réduit la réponse aux champs utiles et écrit le résultat
dans le workspace. À partir de là, l'agent lit un fichier et écrit un fichier, exactement
comme dans un pipeline de génération. Tout ce que le moteur sait déjà faire (gates,
routage, budget, schémas, cycles de correction) s'applique sans rien changer.

Cet appel ne coûte aucun token, il est reproductible, et il est le seul point de contact
avec l'extérieur. Un test l'impose explicitement.

**Le juge doit être déterministe.** La première version faisait décider l'analyste de son
propre verdict. C'est la faute que `must_change` a corrigée côté moteur : un gate qui lit
le rapport de l'agent n'atteste de rien. Le stage `verification` est donc du code, qui
contrôle deux choses qu'aucune formulation ne contourne :

- **couverture** : chaque question du spec apparaît dans les réponses ou dans les
  questions déclarées sans réponse
- **traçabilité** : chaque `id` cité en source existe dans la collecte

L'agent ne rend aucun verdict. Il ne peut donc pas masquer une omission.

**Une correction apportée au moteur.** Un `gate` déclaré sur un stage typé était
silencieusement ignoré : la boucle faisait `continue` avant de l'évaluer. Le pipeline
avait l'air protégé sans l'être, ce qui est pire que pas de gate du tout. Corrigé dans
agent-orchestrator (`feat: let a typed stage carry a gate instead of silently ignoring it`).

**`must_change` ne s'applique pas ici.** Il prouve qu'un agent a modifié des fichiers.
Dans une veille en lecture seule, l'agent produit son rapport et rien d'autre : c'est le
vérificateur déterministe qui joue ce rôle.

## Lecture seule, délibérément

Aucun chemin d'écriture n'existe vers eBay dans ce dépôt. Le risque dominant du projet
business n'est pas la sécurité informatique mais la **suspension de compte**, et une API
de lecture ne peut pas la provoquer. Le sandbox est la cible par défaut : viser la
production demande de poser `EBAY_BASE_URL` explicitement.

## Le pipeline veille-ebay

| Stage | Type | Ce qu'il fait |
|---|---|---|
| `collecte` | `fetch` | appelle la Browse API, normalise, écrit `listings.json`. Zéro token. |
| `analyse` | agents | `veille-analyst` répond aux questions du spec en sourçant chaque réponse |
| `verification` | `verify` | contrôle couverture et traçabilité, porte le gate |

Sur gate rouge, les manques repartent vers l'analyste avec leur raison exacte, puis la
vérification est rejouée. La collecte, elle, n'est jamais relancée : `rerun_from` pointe
sur `verification`.

## Le stage `approval`

Écrit **avant** qu'une seule action d'écriture existe dans ce dépôt, délibérément.

Il ne porte pas de gate, et le chargeur refuse qu'on lui en mette un. Un gate route son
échec vers l'agent responsable pour qu'il le corrige ; une approbation humaine absente
n'est pas un défaut réparable par un agent, et lui router l'échec lui donnerait un moyen
de la contourner. Ce stage s'arrête donc net.

**Fail-closed.** Une action demande une approbation sauf si son type figure dans la liste
`auto` du pipeline. Lister l'inverse obligerait à penser à tout d'avance, et la première
omission serait celle qui coûte cher. Même logique que le backend facturé par défaut du
moteur.

**L'approbation porte sur l'empreinte du plan, pas sur le stage.** C'est ce qui ferme le
TOCTOU : si le plan change entre la décision et l'exécution, l'approbation meurt avec lui
et le run s'arrête en nommant les deux empreintes. Approuver une baisse à 79 EUR ne peut
pas couvrir une baisse à 40 EUR.

**Le registre vit hors du workspace.** Le workspace est jetable, réécrit à chaque run, et
surtout les agents y écrivent. Une approbation rangée là serait falsifiable par ce qu'elle
est censée contrôler. Elle vit dans `approvals/`, ou dans `APPROVALS_DIR`.

Un refus est une décision, pas un échec : l'action est écartée et le run aboutit.

### Le cycle

```
run 1   plan → contrôle déterministe → approbation
        arrêt : "2 actions attendent ton approbation" + l'empreinte à recopier

        tu écris approvals/ajustement-prix.decisions.json

run 2   approbation passe, approbation.json porte les actions exécutables
```

Le pipeline `ajustement-prix` s'arrête là : rien n'exécute encore les actions approuvées.
C'était le but, avoir la barrière avant d'avoir la porte.

## Utilisation

```bash
npm install
npm test                 # 20 vérifications, sans réseau ni credentials
```

Pour un vrai run, il faut un token applicatif du sandbox eBay dans le `.env` du spec
(`specs/veille.example.env` à créer, jamais commité) :

```
EBAY_OAUTH_TOKEN=...
```

```bash
npm run veille
```

## Ajouter une source

`SOURCES` dans `src/stage-handlers.js` est un registre. Ajouter Amazon ou TikTok s'y fait
en une entrée, sans toucher au handler ni au moteur. Un pipeline qui nomme une source
inconnue échoue au chargement, pas après la collecte.

## Ce qui reste à faire

- Un token sandbox eBay et un premier run réel : tout est testé sauf le contact avec la
  vraie API.
- Le type de stage `approval`, gate déterministe d'approbation manuelle, à écrire **avant**
  qu'une seule action d'écriture existe dans ce dépôt.
