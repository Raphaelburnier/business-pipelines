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

### Un registre caduc n'est pas une anomalie, c'est le deuxième tour

Le registre de décisions porte l'empreinte du plan qu'il visait. Dès que le planificateur
en produit un autre, il devient caduc. C'est le cas normal à chaque nouveau cycle, pas un
incident.

Le stage refusait alors d'exécuter, ce qui est juste, mais il refusait aussi de **déposer**,
ce qui ne l'était pas. Le nouveau plan restait invisible : rien dans la boîte, donc rien à
décider dans le cockpit, aucune alerte, et un cron qui repaye le planificateur à chaque
réveil sans que rien n'avance jamais. Le message renvoyait vers un plan gelé qui n'existait
pas. Constaté en relançant la planification après un cycle mené à son terme.

Un plan neuf se dépose et s'attend maintenant comme un premier, et le message dit d'abord
pourquoi la décision précédente ne compte plus. Les décisions périmées restent ignorées :
toutes les actions repartent en attente. On ne s'arrête sec que dans le seul cas où il n'y
a rien à faire attendre, parce qu'il n'y a alors rien à déposer non plus.

## Le stage `execute`

La garde a été écrite et testée d'abord, contre un registre d'exécuteurs **vide** : un
type sans exécuteur arrête le run en le nommant plutôt que de se sauter en silence. Le
geste qui touche une plateforme marchande est venu ensuite, écrit contre l'API vivante et
jamais contre une forme devinée. Le registre ne porte toujours que lui, `changement_prix`,
et la garde n'a pas bougé d'une ligne pour l'accueillir.

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
npm test                 # 184 vérifications, sans réseau ni credentials
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

**Fait le 2026-08-19** : le cockpit d'approbation. `node bin/cockpit.js` sert une page
locale qui lit la boîte, montre chaque plan en attente avec sa fraîcheur, et écrit les
décisions.

**Fait le 2026-08-19** : le cycle et le canal d'alerte. Un cron réveille `bin/cycle.js`,
qui lit l'état, choisit une action et prévient par courriel. Voir la section suivante.

**Fait le 2026-08-20** : décider depuis le téléphone. Le cockpit reste sur la boucle
locale et Tailscale relaie vers lui sous un vrai nom, avec un vrai certificat. La signature
n'est plus un champ de texte : elle vient du canal. Voir « Depuis le téléphone » plus bas.

**Reste ouvert** : l'application sur l'écran d'accueil, puis le push web qui remplacera
le courriel comme canal principal. Le courriel restera le filet, parce qu'il marche encore
quand le téléphone est neuf, réinitialisé ou hors réseau. Reste ouvert aussi l'élargissement
de ce que l'application pilote : historique d'exécution, dernier état du cycle, et
déclenchement de la planification. Le principe retenu pour ce dernier point est que la page
écrit une intention et que le cycle l'exécute, parce qu'un processus web qui lance lui-même
un pipeline devient un moyen de dépenser sans passer par la boucle de décision.

## Le cockpit d'approbation

```
npm run cockpit              # http://127.0.0.1:4600
npm run cockpit:tailnet      # monte le relais, pour y accéder du téléphone
```

La page montre, pour chaque dossier en attente, l'empreinte du plan, l'âge des données et
chaque action avec sa justification, ses sources et l'écart de prix en pourcentage.

### Ce qu'il refuse de faire

Cette page change de vrais prix, elle est donc écrite comme le reste du dépôt.

**Elle n'écoute que sur 127.0.0.1**, y compris depuis qu'on y accède du téléphone. Ce
n'est plus seulement une précaution, c'est une condition : Tailscale n'injecte l'identité
de l'appelant que si le service reste local, sinon n'importe qui sur le réseau peut
fabriquer cette identité. Élargir l'écoute ne rendrait pas le cockpit plus joignable, ça
détruirait la seule chose qui donne du sens aux en-têtes.

Dans un conteneur, cette même adresse ne confine rien : elle rend le service injoignable.
La publication `127.0.0.1:4600:4600` relaie vers l'adresse du conteneur sur son réseau,
jamais vers sa boucle locale à lui, et la connexion est réinitialisée. Le cockpit du NAS a
tourné dix jours dans cet état, `Up` pour Docker et muet pour tout le monde, sans rien dans
ses journaux puisqu'aucune requête ne lui parvenait. Une alerte reçue dehors menait à une
page morte, ce que le service systemd du poste existe précisément pour empêcher.

Le confinement change donc de couche à l'intérieur d'un conteneur : ce n'est plus l'adresse
d'écoute, c'est l'espace de noms réseau plus la publication loopback de l'hôte. Tailscale
continue de parler à `127.0.0.1` sur l'hôte, donc l'exigence qui rend ses en-têtes fiables
tient toujours. Ce déplacement se déclare, il ne se devine pas : `COCKPIT_HOTE` seul est
refusé au démarrage, il faut aussi `COCKPIT_CONTENEUR=1`. Une faute de frappe dans un
`.env` du poste ouvrirait sinon le cockpit sur le LAN, c'est-à-dire exactement là où
n'importe qui peut fabriquer un en-tête d'identité Tailscale.

**Elle vérifie l'en-tête `Host`** contre une liste blanche. Sans ça, un site visité dans le
même navigateur peut faire pointer un nom vers l'adresse locale et parler au serveur à ta
place. Le nom du tailnet n'entre dans cette liste que s'il est configuré.

**Elle vérifie l'origine et le type de contenu sur les écritures.** Tant que la page
n'était joignable qu'en local, aucun site tiers ne pouvait viser une URL stable. Sous un
vrai nom de domaine, un formulaire hébergé ailleurs le peut, et un POST de formulaire
échappe au contrôle préalable CORS. Exiger `application/json` referme cette porte.

**Elle ne laisse pas le corps de la requête choisir où elle écrit.** Ce corps était étalé
tel quel dans l'appel qui enregistre, donc il pouvait redéfinir le répertoire d'écriture,
l'horodatage et le nom du signataire. Rien ne l'exploitait, parce que la liaison locale
rendait le chemin inatteignable. C'est précisément le genre de garde qu'un élargissement
de portée réveille : elle ne tenait que par l'étroitesse de l'accès.

**Elle échappe tout texte affiché.** Les justifications sont écrites par un modèle, et du
texte de modèle rendu tel quel dans une page est une injection en attente.

**Elle refuse un dossier absent de la boîte**, sinon le chemin du registre serait dicté
par la requête et une page locale deviendrait une écriture de fichier arbitraire.

**Elle refuse une empreinte qui ne correspond plus.** Si la planification a tourné entre
l'affichage et le clic, les montants ne sont plus ceux qui ont été lus.

**Elle refuse une décision non signée**, et la signature ne se tape plus. Elle vient du
canal par lequel la requête est arrivée : le login Tailscale pour le téléphone, le compte
système pour la console de la machine. Un registre d'audit anonyme ne dit pas qui a engagé
l'argent, et un champ de texte libre laisse écrire n'importe quel nom.

**Elle refuse une requête arrivée sous le nom du tailnet sans identité Tailscale**, et
elle la refuse avant d'afficher quoi que ce soit. Ça veut dire que le relais n'est pas en
place et que quelque chose d'autre répond sur ce nom : on ne sait pas à qui on parle, donc
on ne lui montre pas non plus les prix et les marges.

**Elle n'affiche aucun feu vert qu'elle ne peut pas justifier.** La fraîcheur se mesure
depuis la collecte, comme le moteur, et sans maximum déclaré elle montre l'âge sans
conclure. Une décision fautive dans un lot n'écrit rien du tout.

**Elle répond à un fichier illisible au lieu de mourir.** Son gestionnaire de requêtes est
`async`, et une exception qui en sortait devenait une promesse rejetée que Node ne rattrape
pas : le processus s'arrêtait. Une boîte de réception tronquée tuait donc le cockpit à
chaque requête, le service systemd le relançait, il remourait au rechargement suivant, et
après cinq démarrages en dix secondes systemd renonçait à le relancer. L'accès depuis le
téléphone finissait par exiger une commande tapée sur la machine, ce qu'il était censé
éviter. La réponse nomme maintenant le fichier à réparer.

**Elle ne redécoupe plus un identifiant d'action.** Le nom du champ était
`d_{dossier}_{action}` et le script le recoupait sur les underscores, en supposant qu'un
nom de dossier tenait en un segment. Dès qu'il en portait deux, l'identifiant reconstruit
désignait une autre action du plan : une décision pouvait partir sur un changement de prix
qui n'avait pas été lu. L'identifiant voyage désormais entier, dans un attribut de données.

### Les fichiers d'approbation s'écrivent en une fois, ou pas du tout

`writeFileSync` vide le fichier de destination avant de le remplir. Un processus tué entre
les deux laisse un JSON incomplet, et ces fichiers-là ne sont pas des brouillons : la boîte
de réception, les plans gelés, les registres de décisions, le ledger d'exécution et le
journal d'alertes survivent au run. Un registre tronqué perd la trace de qui a engagé
l'argent. Un ledger tronqué fait rejouer un changement de prix déjà appliqué, puisque c'est
lui qui porte l'idempotence, et il s'écrit action par action, donc au moment exact où une
interruption est plausible.

`src/durable.js` écrit à côté puis renomme, ce qui est atomique sur un même système de
fichiers : le fichier est le nouveau, ou reste l'ancien. Le test le vérifie par l'inode, qui
est la seule chose qui distingue les deux façons d'écrire. Le même module nomme le fichier
fautif quand une lecture échoue, parce que la boîte, les plans et les registres passent tous
par le même appel et qu'un message parlant d'une position dans une chaîne ne dit pas quoi
réparer.

### Depuis le téléphone

Le montage tient en une phrase : Tailscale termine le TLS sur un vrai nom et relaie vers
`localhost`, le cockpit ne bouge pas.

```
téléphone  --wireguard-->  tailscale (TLS, certificat réel)  --->  127.0.0.1:4600
```

Ce choix a remplacé celui que j'avais annoncé, qui était d'élargir l'écoute et d'inventer
un jeton d'appareil pour porter la signature. Les deux moitiés du plan étaient fausses :
le relais fournit déjà l'identité par en-têtes, donc le jeton n'avait pas lieu d'être, et
élargir l'écoute aurait rendu ces en-têtes falsifiables par n'importe qui sur le réseau.

Sous WSL, le cockpit tourne côté Linux et Tailscale côté Windows. Le pont existe déjà :
Windows relaie son `localhost` vers les sockets en écoute dans WSL. C'est vérifié, pas
supposé.

#### La mettre en place

```
cp specs/cockpit.env.example specs/cockpit.env
npm run cockpit:tailnet      # affiche le nom exact à recopier dans COCKPIT_TAILNET
npm run cockpit
```

Puis, sur le téléphone déjà membre du tailnet, ouvrir `https://<nom>.<tailnet>.ts.net`.

`npm run cockpit:tailnet -- --stop` démonte le relais et le cockpit redevient strictement
local. Sans `COCKPIT_TAILNET`, il l'est aussi : la configuration absente ne dégrade rien.

#### Le garder debout

Le relais ne fait que relayer : si le cockpit n'est pas lancé, le nom `.ts.net` répond une
erreur de passerelle, et une alerte reçue dehors mène à une page morte. Le cockpit est donc
un service utilisateur systemd.

```
bin/installer-service.sh                # installe, active, démarre
bin/installer-service.sh --journal      # suit les logs
bin/installer-service.sh --desinstaller # retire tout
```

Service utilisateur et pas service système, délibérément : le cockpit lit et écrit des
fichiers qui appartiennent à cet utilisateur, et servir une page sur la boucle locale ne
demande aucun droit de root. Il redémarre seul s'il tombe, ce qui est vérifié en le tuant.

Deux limites à connaître. `linger` doit être actif, sinon le service meurt avec la session
et n'est debout que quand on est déjà devant la machine, c'est-à-dire exactement quand on
n'en a pas besoin ; le script le vérifie et donne la commande. Et sous WSL, tout ça ne
tourne que si l'instance WSL tourne : Windows ne démarre pas WSL de lui-même.

#### L'installer comme application

Le cockpit s'installe sur l'écran d'accueil d'un téléphone, d'une tablette ou d'un poste :
il s'ouvre alors en plein écran, sans barre d'adresse, avec sa propre icône. Rien à faire
côté serveur, tout est servi par le cockpit lui-même.

| Appareil | Comment |
|---|---|
| iPhone, iPad | Safari, bouton Partager, « Sur l'écran d'accueil » |
| Android | Chrome, menu, « Installer l'application » |
| Windows, macOS, Linux | Chrome ou Edge, icône d'installation dans la barre d'adresse |

Safari est obligatoire sur iOS : Chrome et Firefox y sont des habillages de WebKit et
n'installent rien.

Un navigateur n'accepte d'installer une page que si trois conditions tiennent : l'origine
est en HTTPS avec un certificat que l'appareil valide, la page déclare un manifeste, et un
service worker enregistré porte un gestionnaire de requêtes. La première venait déjà de
Tailscale, qui termine le TLS sur un vrai nom. Les deux autres sont dans `src/pwa.js`.

**Le service worker ne met rien en cache, et c'est délibéré.** La page montre des décisions
en attente, et chaque plan gelé porte une empreinte qui lie l'approbation à un plan précis.
Servir une copie gardée en cache montrerait des actions déjà tranchées, et ferait cocher
contre une empreinte morte : l'écriture partirait pour se faire refuser en 409, sans que
rien à l'écran l'ait laissé prévoir. Le cockpit envoie déjà `Cache-Control: no-store` sur
la page et sur l'API, et un cache de service worker passerait outre puisqu'il répond avant
que la requête parte. Le worker sert donc à deux choses seulement : rendre l'application
installable, et remplacer la page d'erreur du navigateur par un message qui dit quoi faire
quand la machine est éteinte ou le relais démonté.

Les écritures ne passent pas par le worker : il se retire de toute requête qui n'est pas un
GET. Un worker qui rejouerait un POST écrirait deux fois la même décision sans que personne
l'ait recochée.

Les icônes sont dans `public/`, versionnées plutôt que générées au démarrage. Elles sont
servies depuis une table littérale d'URL, pas par un chemin construit depuis la requête :
c'est la première fois que le cockpit sert des fichiers du disque, et le dépôt tient
`specs/cockpit.env` deux dossiers plus haut.

Le manifeste, le worker et les icônes sont derrière le même contrôle d'identité que la
page. Un appelant que le tailnet n'a pas nommé reçoit 403 sur les quatre.

#### Quand l'application ne répond plus

Elle affiche une page qui nomme les trois causes, dans l'ordre où elles arrivent :
Tailscale déconnecté sur le téléphone, machine hôte éteinte ou en veille, relais démonté.
Aucune décision ne part tant que la connexion n'est pas revenue.

Un cas échappe à cette page, et il faut le savoir : relais monté mais cockpit arrêté. La
requête aboutit alors, avec une erreur de passerelle produite par Tailscale, donc le
service worker la laisse passer telle quelle. Il ne remplace que ce qui n'aboutit pas du
tout. Intercepter aussi les 502 masquerait de vraies pannes serveur derrière un message
générique, ce qui coûte plus cher en diagnostic que ça ne rapporte en confort.

#### Ce que ça authentifie, et ce que ça n'authentifie pas

L'identité vient du tailnet, établie par WireGuard : un appareil qui n'est pas le tien ne
peut pas signer une décision. Un processus déjà présent sur cette machine, lui, peut
fabriquer l'en-tête. Mais il pouvait déjà écrire le registre de décisions directement, donc
la frontière n'a pas bougé. Ce que l'en-tête supprime, c'est l'erreur humaine, pas
l'attaquant local, et le dire autrement serait se raconter une histoire.

Le canal est consigné dans le registre à côté de la signature : `tailnet` veut dire prouvé
par WireGuard, `local` veut dire console de la machine et prouvé par rien.

## Le cycle, et pourquoi un cron ne suffit pas

Une boucle avec un humain dedans n'avance pas d'elle-même : elle alterne entre des moments
où la machine travaille et des moments où elle attend. Un cron qui lancerait simplement la
planification toutes les heures détruirait la moitié attente. Replanifier change
l'empreinte du plan, et une empreinte qui change invalide la décision en cours : l'humain
aurait cliqué sur un montant qui n'existe plus, et le cockpit aurait eu raison de le
refuser. Il faut donc quelque chose qui sache **ne rien faire**.

```bash
npm run cycle            # un réveil : lire l'état, choisir une action, prévenir
npm run cycle -- --dry   # dit ce qu'il ferait, ne lance rien
npm run alerter          # le canal seul
npm run en-attente       # l'affichage seul
```

| État de la boîte | Action |
|---|---|
| rien en attente | planifier |
| plan gelé introuvable | planifier |
| plan frais, décision commencée ou pas | attendre |
| périmé, **aucune** décision prise | attendre, sans rien dépenser |
| périmé, décision commencée | replanifier |
| tout décidé | appliquer, avec le pipeline que la demande désigne |
| la planification précédente n'a rien proposé, il y a moins de 6 h | attendre, sans rien dépenser |

Trois lignes portent tout le reste.

**On ne replanifie jamais pendant qu'une décision fraîche est en cours.** C'est la règle
qui rend le cron compatible avec un humain lent.

**Un plan périmé que personne n'a regardé ne déclenche rien.** Replanifier appellerait le
planificateur pour produire un plan que personne n'attend, et recommencerait toutes les
douze heures, indéfiniment. Si une décision avait commencé, en revanche, quelqu'un s'en
occupe et était simplement en retard : on lui redonne un plan frais à décider. La
péremption du moteur s'applique, elle ne devient pas une exception parce qu'un cron est
passé.

**L'action à appliquer se lit dans la demande, jamais devinée.** Sans `appliquer_avec`, le
cycle attend plutôt que de choisir un pipeline à la place de celui qui a planifié.

**Une planification qui n'a rien proposé retient la suivante.** C'est la règle la plus
récente, et elle vient d'une dépense observée, pas d'une crainte. Un planificateur qui lit
le marché et conclut qu'aucun ajustement n'est justifié a fait son travail : le pipeline se
termine bien, la boîte reste vide, et le réveil suivant repart donc planifier. Il repaie
alors l'agent pour relire le même marché et rendre le même constat. Rien dans les journaux
ne le signale, puisqu'il n'y a pas d'erreur : c'est la dépense la plus discrète de la
boucle, environ dix dollars par jour à un quart d'heure d'intervalle.

Le stage d'approbation date donc ce constat dans `<dossier>.retenue.json`, et le cycle le
lit avant de relancer. Six heures, parce que le stock d'un marché de collection ne se
renouvelle pas à l'heure, et parce que c'est la moitié des douze heures de péremption : une
planification qui reprend après la retenue a encore le temps d'être décidée avant que ses
données ne meurent. Dès qu'un plan propose quelque chose, la marque est levée.

C'est la même règle que le plan périmé que personne n'a regardé, appliquée à un cas qui
n'apparaît qu'une fois le marché devenu pauvre : en cas de doute, ne pas engager d'argent.
Une configuration incomplète dégrade vers le comportement d'origine, jamais vers un cycle
qui cesserait de planifier sans le dire.

### Un arrêt normal ressemble à une panne

Un pipeline de planification se **termine en erreur quand il aboutit** : le stage
d'approbation lève pour arrêter net, c'est sa façon de rendre la main. Lire le seul code
de sortie ferait passer chaque planification réussie pour un incident, tous les jours,
jusqu'à ce qu'on cesse de regarder les alertes, ce qui est la panne la plus grave.

Ce qui distingue les deux est observable ailleurs : un arrêt sur approbation a déposé une
demande dans la boîte. Le cycle compare donc la boîte avant et après. Elle a changé,
l'arrêt est le bon ; elle n'a pas bougé, c'est un vrai échec.

## Le canal d'alerte

Le cockpit règle la décision, pas la notification. Ce module est ce qui va chercher
l'humain, et c'est un lecteur de la boîte de plus, au même titre que `en-attente` et le
cockpit. Il ne touche ni au moteur ni au cockpit.

Le transport vit dans un registre, comme les sources de marché. Un transport reçoit un
message déjà rédigé et le fait sortir : il ne décide jamais s'il faut l'envoyer. C'est ce
qui rendra le push de l'application ajoutable sans toucher une ligne de ce qui décide.

### Ce qu'il refuse de faire

**Il ne consigne que ce qui est parti.** Consigner avant d'envoyer coûterait moins de code
et perdrait l'alerte au premier réseau coupé, en laissant la demande attendre pour
toujours. C'est exactement le défaut que la boîte durable existe pour corriger, et le
réintroduire dans son notifieur serait une belle ironie. Un échec n'arrête pas le lot : les
autres dossiers partent, et le raté repart au réveil suivant.

**Il ne répète pas.** La clé de dédoublonnage porte le dossier, l'empreinte du plan et le
verdict de fraîcheur. Replanifier renotifie, puisque c'est une autre demande. Périmer
renotifie une fois, parce que l'approbation ne s'appliquera plus et qu'il faut le savoir.
Deux messages au maximum par plan, et un cron qui se réveille toutes les quinze minutes
n'en produit aucun de plus. Une boîte qui répète se fait taire aussi sûrement qu'une boîte
pleine de faux se fait ignorer.

**Il ne porte aucune décision.** Pas de bouton, pas de lien qui approuve. Un « approuver »
atteignable depuis un message serait un chemin d'écriture vers l'argent contournant tous
les refus du cockpit, l'empreinte vérifiée et la signature en tête. Le canal prévient, il
n'engage pas.

**Il ne se tait jamais faute de configuration.** Aucun transport, ou un transport inconnu,
échouent bruyamment. Un canal muet ne se remarque que le jour où il comptait.

**Il n'envoie rien en répétition à blanc, et ne consigne rien non plus.** Sinon regarder ce
qui partirait empêcherait que ça parte, et la première alerte perdue serait celle qu'on a
voulu vérifier.

**Il dit quand la liste est tronquée.** Cinq actions affichées sur douze sans le signaler
laissent approuver douze choses après en avoir lu cinq.

### La mettre en place

```bash
cp specs/alerte.env.example specs/alerte.env   # puis remplir
npm run alerter -- --dry                        # voir ce qui partirait
```

Puis une ligne de crontab, un quart d'heure étant largement assez fin pour une boucle dont
l'autre moitié est humaine :

```cron
*/15 * * * * cd /chemin/vers/business-pipelines && /usr/bin/node bin/cycle.js --plan ajustement-prix --spec ./specs/ajustement-prix.json >> /var/log/business-pipelines.log 2>&1
```

### Ce que ça ne résout pas encore

Le courriel prévient, il ne décide pas, et c'est délibéré : un message ne porte aucun
bouton et aucun lien qui approuve. La décision se prend dans le cockpit, joignable depuis
le téléphone depuis le 2026-08-20. Ce qui reste, c'est que le courriel n'arrive pas comme
une notification d'application : il faut ouvrir sa boîte. Le push web réglera ça.

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
