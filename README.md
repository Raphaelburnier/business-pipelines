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

## Le stage `execute`, moitié gardienne

La garde est écrite et testée. Le geste qui touche une plateforme marchande, non : il
sera écrit contre la vraie API, après le premier run réel, jamais contre une forme
devinée. Le registre d'exécuteurs est donc **vide**, et un type sans exécuteur arrête le
run en le nommant plutôt que de se sauter en silence.

Quatre propriétés, toutes vérifiées avant qu'une seule action ne parte :

1. **Le plan n'a pas bougé depuis l'approbation.** Second tour de clé sur le TOCTOU,
   au moment où le geste part et plus seulement au moment où il est autorisé.
2. **Rien ne s'exécute qui ne figure pas dans `executables`.** La liste de travail se lit
   dans l'approbation, jamais dans le plan complet : c'est la liste courte, celle qu'un
   humain a validée. Partir du plan et filtrer laisserait une erreur de filtre possible.
3. **Une action déjà faite n'est jamais refaite.** Ledger hors du workspace, sinon
   l'idempotence ne survivrait pas au run suivant. La clé porte l'empreinte du plan ET
   l'id : un id comme `prix-001` revient d'un plan à l'autre en désignant autre chose, et
   sans l'empreinte un ajustement légitime serait sauté au motif qu'un homonyme a eu lieu.
4. **Chaque succès est consigné immédiatement**, pas à la fin du lot. Un processus tué au
   milieu doit laisser la trace exacte de ce qui a eu lieu.

Comme `approval`, ce stage ne porte pas de gate, et le chargeur en refuse un : un échec
d'API n'est pas un défaut qu'un agent peut corriger, et l'y router ferait replanifier,
ce qui invaliderait l'approbation et réclamerait une nouvelle décision humaine. Boucle
sans fin garantie.

### Deux natures d'échec

| Nature | Exemple | Comportement |
|---|---|---|
| **Cible perdue** | annonce supprimée, 404 ou 403 sur un objet précis | consigner, continuer le lot |
| **Panne** | 401 identifiants expirés, 429 quota, 5xx, réseau | arrêt immédiat |

C'est la même distinction que `isTransientSdkCrash` côté moteur, et pour la même raison :
confondre « ce cas-là est perdu » et « le système est en panne » fait prendre la mauvaise
décision dans les deux sens.

**Fail-closed.** Seul un exécuteur peut déclarer une perte de cible, en posant
`err.cible = true`. Tout le reste vaut panne. Ne jamais deviner dans le sens permissif :
un 500 pris pour une cible morte enchaînerait quarante appels sur une API déjà en
difficulté.

**Bornage des séries.** Trois échecs de cible consécutifs arrêtent le lot malgré tout. Une
API qui renvoie 404 sur tout parce qu'un identifiant a changé de périmètre ressemble à
quarante mauvaises cibles, et ce motif doit couper. Une réussite remet le compteur à zéro.

Pourquoi ne pas simplement tout arrêter à la première casse : parce qu'une annonce
supprimée bloquerait alors les trente-neuf autres actions déjà approuvées, sans issue.
Relancer échouerait à l'identique, et retirer l'action fautive du plan changerait son
empreinte, donc invaliderait l'approbation et obligerait à réapprouver tout le reste à la
main. Le remède était pire que le mal.

### Trois verdicts

`EXECUTE` tout est passé. `PARTIEL` des cibles étaient perdues, le reste est fait, et le
run **aboutit** : un système sain qui rencontre la réalité ne doit pas produire un « run
raté », ça apprend à ignorer les échecs. `INTERROMPU` le lot a été coupé, des actions
approuvées n'ont pas été tentées, et celles-là sont nommées dans le rapport.

## Utilisation

```bash
npm install
npm test                 # 20 vérifications, sans réseau ni credentials
```

Pour un vrai run, il faut des identifiants sandbox eBay :

```bash
cp specs/veille.env.example specs/veille.env   # puis remplir
npm run veille
```

Le fichier rempli est gitignoré, le gabarit ne l'est pas. Convention du moteur :
`specs/veille.json` attend `specs/veille.env`.

### Ce qu'il faut y mettre, et pourquoi pas un token

`EBAY_CLIENT_ID` et `EBAY_CLIENT_SECRET`, l'App ID et le Cert ID de la console
développeur eBay, section Sandbox. Ce sont des identifiants **permanents**.

Un token applicatif eBay expire en environ 2 heures. En ranger un dans un `.env`
condamne tout run planifié à échouer sur un token périmé sans que rien ne l'explique.
Le code fabrique donc le token à la demande, à partir des identifiants, et le garde en
cache jusqu'à son expiration moins une minute de marge. Deux collectes dans le même
processus ne déclenchent qu'un seul appel OAuth.

`EBAY_OAUTH_TOKEN` reste accepté et court-circuite la fabrication : pratique pour un
essai à la main, inutilisable pour de l'automatisé.

## Ajouter une source

`SOURCES` dans `src/stage-handlers.js` est un registre. Ajouter Amazon ou TikTok s'y fait
en une entrée, sans toucher au handler ni au moteur. Un pipeline qui nomme une source
inconnue échoue au chargement, pas après la collecte.

## Ce qui reste à faire

**En attente, bloqué hors du code (depuis le 2026-08-17)** : premier run réel contre
l'API. Le compte du programme développeur eBay demande au moins un jour d'acceptation.
Tout est testé sauf le contact avec la vraie API, donc rien d'autre n'attend après ça.
Reprendre par `cp specs/veille.env.example specs/veille.env` puis `npm run veille`.

**Ensuite** : la moitié eBay du stage `execute`, un exécuteur pour `changement_prix`
contre la Sell Inventory API. La moitié gardienne est faite et testée, il ne manque que
le geste. Une ligne à ajouter au registre d'exécuteurs, écrite contre l'API réelle une
fois le premier run passé.
