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
| `statistiques` | `stats` | calcule médianes, comptes et groupes, écrit `stats.json`. Zéro token. |
| `analyse` | agents | `veille-analyst` interprète et rédige, en citant les valeurs calculées |
| `verification` | `verify` | contrôle couverture, traçabilité et arithmétique, porte le gate |

Sur gate rouge, les manques repartent vers l'analyste avec leur raison exacte, puis la
vérification est rejouée. La collecte, elle, n'est jamais relancée : `rerun_from` pointe
sur `verification`.

## Le stage `stats`, et pourquoi il existe

Le premier run réel contre eBay a produit un rapport intégralement sourcé, cohérent, et
faux. L'agent annonçait 46,99 comme médiane de 35 prix là où c'était 45,99 : il avait
pris la 19e valeur triée pour la 18e. Le gate a dit COMPLETE, parce qu'il contrôlait la
couverture et l'existence des sources, jamais les nombres.

Ce n'est pas un problème de formulation de prompt. Un nombre calculable ne se demande pas
à un modèle. `stats.json` est donc produit avant l'agent, de façon déterministe et
gratuite, et porte médiane, moyenne, quartiles, min et max, globalement puis par état, par
vendeur et par mode de livraison, plus `champs_absents`, le nombre d'annonces où chaque
champ manque.

L'agent ne trie plus, ne compte plus, n'arrondit plus. Il choisit la bonne valeur, la
relie à la bonne question, et la rédige. C'est là qu'est son travail.

### Le contrôle qui rend la correction réelle

Retirer le calcul à l'agent ne suffit pas : rien ne l'empêche de recalculer dans son coin
et de citer son propre résultat. Chaque réponse porte donc `valeurs`, la liste des clés de
`stats.json` dont ses nombres viennent :

```json
{
  "question": "Quelle est la médiane des prix affichés ?",
  "reponse": "La médiane est de 45.99 USD sur les 35 annonces collectées.",
  "valeurs": [
    { "cle": "prix.mediane", "valeur": 45.99 },
    { "cle": "devise_unique", "valeur": "USD" }
  ],
  "sources": ["v1|110590106561|0"]
}
```

La vérification résout chaque `cle` dans `stats.json` et recompare. Une clé inconnue, une
valeur qui diverge, ou un chiffre écrit sans rien citer : gate rouge, avec les deux
nombres nommés dans la raison. Le run qui avait produit 46,99 serait rejeté aujourd'hui.

`champs_absents` sert la même honnêteté du côté des questions sans réponse : « le champ
vendeur est absent sur 34 des 35 annonces » est une raison chiffrée et vérifiable, là où
« données insuffisantes » n'en est pas une.

Le stage `stats` ne porte jamais de gate, et le chargeur le refuse. Router son résultat à
un agent lui rendrait la main sur les nombres qu'on vient précisément de lui retirer.

Le pipeline `ajustement-prix` reçoit le même traitement, et l'enjeu y est plus direct :
une médiane fausse d'un dollar y produit un prix faux, qu'on approuverait en lisant une
ligne parfaitement plausible.

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

### Le cycle, en deux pipelines

```
npm run plan:prix        collecte → plan → contrôle → approbation
                         arrêt : les actions en attente, l'empreinte à recopier,
                         et le plan GELÉ dans approvals/

                         tu écris approvals/ajustement-prix.decisions.json

npm run appliquer:prix   chargement du plan gelé → approbation → exécution
                         aucun agent, budget déclaré à zéro
```

**Pourquoi deux pipelines et pas un.** Le moteur repart toujours du premier stage, donc un
run unique replanifierait après ta décision. Or un planificateur est un modèle : il ne
redonne pas deux fois le même plan. Nouvelle empreinte, approbation caduque, nouvel arrêt,
sans fin. Le cycle ne pouvait jamais aboutir, et chaque tour repayait le planificateur.

Planifier et appliquer sont séparés par une décision humaine qui peut prendre des heures.
Les forcer dans un même run est ce qui créait le problème.

**Le gel** rend l'approbation honnête : tu approuves un texte figé, et c'est exactement
celui qui s'exécute. La liaison TOCTOU passe de vérifiée à garantie par construction.

### Savoir qu'une décision attend

Un arrêt qui s'écrit dans un terminal est invisible quand le run vient d'un cron sur un
NAS : le pipeline s'arrêterait et l'attente durerait indéfiniment sans que rien ne le
signale.

L'approbation dépose donc sa demande dans `approvals/EN-ATTENTE.json`, avec le dossier,
l'empreinte, le nombre d'actions, depuis quand, le registre à remplir et le pipeline à
lancer ensuite.

```bash
npm run en-attente
```

Sortie 0 si rien n'attend, **1 s'il y a des décisions à prendre**, donc utilisable tel
quel dans un cron sans parser la sortie.

**Cette boîte n'est couplée à aucun transport, délibérément.** Prévenir par Telegram, par
mail ou via un cockpit sont trois lecteurs du même fichier, et choisir l'un n'interdit pas
les autres. Coupler l'arrêt à un transport figerait ce choix dans le code qui garde
l'argent.

La clé est le **dossier**, pas le pipeline : la demande est créée par la planification et
consommée par l'application, deux pipelines différents. Replanifier remplace la demande au
lieu de l'empiler, sinon la boîte se remplirait de demandes portant sur des plans qui
n'existent plus, et une boîte pleine de faux se fait ignorer.

### La péremption

Un plan bâti sur le marché de lundi n'a plus de sens jeudi : les montants approuvés
portent sur des données mortes. Le plan gelé emporte donc l'heure de **collecte**, et le
chargement refuse au-delà de `max_age_heures` (12 h dans le pipeline livré) en disant de
combien il est en retard.

C'est l'heure de collecte qui fait foi, pas celle du gel ni celle de l'exécution : c'est
la donnée de marché qui vieillit, pas la décision. Un plan sans aucune date est refusé
plutôt qu'appliqué à l'aveugle.

Ce risque existait déjà, toute boucle avec un humain dedans l'a. Il était simplement
masqué par un défaut plus grave.

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

### La place de marché, parce qu'eBay en choisit une à ta place

`EBAY_MARKETPLACE_ID` par défaut `EBAY_US`. Sans en-tête `X-EBAY-C-MARKETPLACE-ID`,
eBay ne refuse pas la requête : il retient EBAY_US et renvoie des prix en dollars sans
rien signaler. Un spec qui demandait des euros recevait donc des dollars, et la réponse
ne portait aucune trace de l'écart.

Le défaut est donc déclaré, pas hérité. Dans le sandbox, EBAY_US est le seul marché
peuplé : EBAY_FR répond 200 avec zéro annonce. Viser EBAY_FR n'a de sens qu'en prod.

La collecte porte maintenant `marketplace` et `devises`, les devises réellement
observées. Une analyse ne peut plus additionner des dollars et des euros en croyant
faire une médiane sans que le fichier le montre.

## Écrire sur eBay demande un autre jeton

Lire et écrire ne se paient pas de la même monnaie, et ça se vérifie contre le vrai eBay
plutôt que ça ne se suppose :

| Ce qu'on demande | Ce qu'eBay répond |
|---|---|
| `client_credentials` + scope de base | 200, jeton applicatif |
| `client_credentials` + `sell.inventory` | 400 `invalid_scope` |
| `GET /sell/inventory/v1/inventory_item` avec un jeton applicatif | 403 `Insufficient permissions` |

Un jeton applicatif s'obtient sans humain et ne peut que lire. Écrire exige un jeton
**utilisateur**, donné une fois par consentement dans un navigateur, sur le compte vendeur
concerné. Le consentement rend un refresh token qui vaut environ 18 mois, à partir duquel
tous les jetons d'écriture suivants se fabriquent sans interaction.

C'est l'unique geste manuel de toute la chaîne, et il n'est pas contournable : c'est eBay
qui exige qu'un humain autorise une application à toucher à ses annonces.

### Le faire

D'abord, dans la console développeur eBay, section **User Tokens**, « Get a Token from
eBay via Your Application » : créer un **RuName** et le poser dans `EBAY_RUNAME`. C'est un
identifiant eBay, pas une URL.

Ensuite, une seule fois :

```
node bin/ebay-consentement.js specs/ajustement-prix.env
```

Le script imprime l'URL à ouvrir. Se connecter avec le compte **vendeur** (dans le
sandbox, un utilisateur de test, pas le compte développeur), accepter, puis coller l'URL
de retour ou le code seul. `EBAY_REFRESH_TOKEN` est écrit dans le `.env`, qui est
gitignoré.

Le code de consentement expire en quelques minutes et ne sert qu'une fois : un
`invalid_grant` veut dire « refais l'étape 1 », pas « mauvaise clé ».

### Ce que le code refuse de faire

`jetonUtilisateur()` ne retombe jamais sur le jeton de lecture quand le refresh token
manque. Ce repli silencieux produirait un 403 au moment d'exécuter une action qu'un humain
vient d'approuver, c'est à dire au pire moment possible, et le message parlerait de
permissions plutôt que de configuration.

Les deux jetons ont aussi des espaces de cache distincts. Partager la clé servirait un
jeton de lecture à un appel d'écriture, et le refus n'arriverait que chez eBay.

## Ajouter une source

`SOURCES` dans `src/stage-handlers.js` est un registre. Ajouter Amazon ou TikTok s'y fait
en une entrée, sans toucher au handler ni au moteur. Un pipeline qui nomme une source
inconnue échoue au chargement, pas après la collecte.

## Ce qui reste à faire

**Fait le 2026-08-18** : premier run réel contre l'API eBay sandbox. Le pipeline passe de
bout en bout, 35 annonces collectées pour 0,28 $ et 4 tours. Ce run a révélé trois choses
qu'aucun test sur fixture ne pouvait montrer : la place de marché non déclarée qui faisait
renvoyer des dollars pour un spec en euros, une requête insatisfiable qui renvoyait zéro
annonce, et la médiane fausse qui a donné le stage `stats`.

**Fait le 2026-08-19** : consentement obtenu, et l'exécuteur `changement_prix` écrit
contre l'API vivante. Le prix d'une vraie offre du sandbox est passé de 134,50 à
129,99 $ par le chemin complet. Voir la section suivante.

**Fait le 2026-08-19** : la boucle complète, contre le vrai eBay. Relevé de marché,
statistiques, plan, contrôle, gel, approbation, exécution, registre. Le prix d'une vraie
annonce publiée est passé de 499,99 à 240,99 $, eBay le confirme, et un second passage du
pipeline d'application n'a rien réexécuté (`a_faire: 0, deja: 1`).

**Reste ouvert** : choisir le transport de notification pour la boîte de réception, qui
reste agnostique en attendant.

## Ce que la boucle réelle a appris

Quatre runs, quatre refus du planificateur avant la première action. Aucun n'était un bug
de sa part, et chacun a désigné un défaut réel.

**La requête mélangeait des formats incomparables.** `pokemon booster` agrège des packs
simples, des lots et des boîtes de 36. La médiane à 45,99 $ n'existait sur aucun marché
réel, et s'y aligner aurait fait chuter une annonce de 124,99 à 45,99 $.

**Une valeur aberrante faussait le repère.** Une caisse complète à 18 999 $ tirait la
médiane à 336,99 $. Le planificateur a écrit noir sur blanc : « je ne peux pas recalculer
de médiane filtrée ». En lui retirant l'arithmétique, ce qui était juste, on lui avait
aussi retiré le moyen d'écarter un point. Lui rendre le calcul aurait rouvert le défaut
d'origine, alors `stats.json` porte désormais un second repère, `prix_hors_aberrants`,
calculé par la règle de l'écart interquartile. Les deux mesures sont publiées côte à
côte : écarter des points est un choix, pas une correction.

**Les comparables portaient sur d'autres extensions.** Refus encore, et encore justifié.

**Et le quatrième refus a trouvé un bug dans mon code.** Le planificateur a écrit que sa
cible figurait dans `mes_annonces` mais était rejetée comme absente de la collecte. Il
avait raison : l'élargissement du contrôle avait atterri sur le contrôle du rapport de
veille au lieu de celui des actions. Corrigé, avec le test qui l'aurait attrapé, et la
mutation qui remet l'ancien comportement fait bien tomber ce test.

### Les annonces du vendeur ne se cherchent pas, elles se demandent

Une recherche rend les annonces les plus pertinentes pour une requête, pas les siennes.
Le sandbox l'a montré sans ambiguïté : une annonce fraîchement publiée que le lookup
direct rend en 200 est absente de la recherche. En production le problème est le même en
plus discret, l'annonce se trouvant simplement au-delà de la page lue.

La collecte récupère donc les annonces du vendeur une par une, par `mine_from`, et les
range hors de `collecte`. Les mêler au marché ferait calculer une médiane qui contient
déjà son propre prix, donc un alignement sur soi-même. Une annonce vendue ou retirée
ressort dans `mes_annonces_introuvables` : c'est une information, pas une panne.

## L'exécuteur de prix, et ce que la vraie API a appris

`src/executeur-prix.js` applique une action `changement_prix` approuvée. Trois choses
qu'aucune documentation accessible ne disait et que seul l'appel réel a montrées.

**eBay rend 400 sur tout appel Sell sans `Accept-Language`**, avec un message qui parle
d'en-tête. Reçu après un 403 de permissions, il envoie chercher au mauvais endroit.

**Un jeton applicatif rend 403 là où un jeton utilisateur rend 200.** Le type de jeton se
lit donc au code retour, ce qui est la seule vérification qui vaille.

**`PUT /offer/{id}` remplace l'offre au lieu de la modifier.** Construire le corps de zéro
effacerait la quantité, la catégorie et l'entrepôt en changeant le prix. L'exécuteur relit
l'offre et ne touche qu'au prix.

### Les trois refus

**Le prix de départ doit encore correspondre.** Une approbation humaine porte sur un écart
précis, « de 82 à 79 ». Si le marché a bougé depuis, appliquer 79 exécute une décision que
personne n'a prise sur le marché d'aujourd'hui. La cible est refusée, le lot continue.

**La devise doit correspondre.** Un plan en euros appliqué à une offre en dollars passerait
pour un succès en changeant le prix de vingt pour cent. C'est systémique : le plan a été
calculé sur un autre marché que celui visé, et le lot s'arrête.

**Le prix est relu après écriture.** eBay peut accepter un PUT sans appliquer la valeur
attendue. Sans relecture, le registre consignerait un changement qui n'a pas eu lieu, et
c'est précisément la trace sur laquelle un humain s'appuie ensuite.

### Ce que le relevé et l'écriture ne partagent pas

Le relevé vient de la Browse API et nomme ses annonces `v1|123|0`. L'écriture passe par la
Sell API, qui ne connaît que des `offerId` et des SKU. L'exécuteur accepte les trois
formes plutôt que d'imposer au planificateur une contrainte qu'il n'a pas les moyens de
tenir. Une cible au format du relevé se résout en balayant le catalogue du vendeur, borné
par son propre nombre d'articles.
