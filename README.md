# business-pipelines

Pipelines business bâtis sur [`agent-orchestrator`](../agent-orchestrator), et le cockpit
qui tranche leurs approbations.

Ce dépôt est né comme un spike : le moteur, conçu autour d'un workspace de fichiers,
tient-il quand le travail est un appel d'API ? La réponse a été oui, à condition que
l'accès au monde extérieur appartienne à un stage typé, jamais à un agent. Le pipeline eBay
qui l'a prouvé a été retiré le 2026-09-16 (voir « Ce qui a été retiré »). Ce qu'il a
laissé derrière lui ne connaît pas eBay : proposer, geler, décider, consigner.

## Ce qui tient toujours

**Le juge doit être déterministe.** Un gate qui lit le rapport de l'agent n'atteste de
rien. Les contrôles qui décident d'une suite sont du code, qu'aucune formulation ne
contourne, et ils coûtent zéro token.

**Une correction apportée au moteur.** Un `gate` déclaré sur un stage typé était
silencieusement ignoré : la boucle faisait `continue` avant de l'évaluer. Le pipeline
avait l'air protégé sans l'être, ce qui est pire que pas de gate du tout. Corrigé dans
agent-orchestrator (`feat: let a typed stage carry a gate instead of silently ignoring it`).

## Le pipeline marketing

```bash
npm run marketing                            # sur le poste
sudo docker compose run --rm marketing       # sur le NAS
```

| Stage | Type | Ce qu'il fait |
|---|---|---|
| `consigne` | `consigne` | relit la réponse libre laissée sur le plan précédent |
| `analyse` | agents | `economy-analyst` et `brand-analyst` analysent la même demande en parallèle |
| `synthese` | agents | `plan-synthesist` confronte les deux voix en un plan sans lisser leurs désaccords |
| `couverture` | `verify-couverture` | chaque question traitée, chaque source réelle, chaque constat cité ou écarté ; porte le gate |
| `approbation` | `approval` | gèle le plan et attend une décision humaine, question par question |

Le détail des choix est dans `PLAN.md`, phase 04.

## Le stage `approval`

Il ne porte pas de gate, et le chargeur refuse qu'on lui en mette un. Un gate route son
échec vers l'agent responsable pour qu'il le corrige ; une approbation humaine absente
n'est pas un défaut réparable par un agent, et lui router l'échec lui donnerait un moyen
de la contourner. Ce stage s'arrête donc net.

**Fail-closed.** Une action demande une approbation sauf si son type figure dans la liste
`auto` du pipeline. Lister l'inverse obligerait à penser à tout d'avance, et la première
omission serait celle qui coûte cher.

**L'approbation porte sur l'empreinte du plan, pas sur le stage.** C'est ce qui ferme le
TOCTOU : si le plan change entre la décision et son usage, l'approbation meurt avec lui et
le run s'arrête en nommant les deux empreintes.

**Le registre vit hors du workspace.** Le workspace est jetable, réécrit à chaque run, et
surtout les agents y écrivent. Une approbation rangée là serait falsifiable par ce qu'elle
est censée contrôler. Elle vit dans le store des approbations, `approvals/approbations.sqlite`
(ou le même fichier sous `APPROVALS_DIR`).

Un refus est une décision, pas un échec : l'action est écartée et le run aboutit.

**La réponse libre.** Quand ni approuver ni refuser ne convient, l'opérateur écrit une
consigne. Le plan repart au travail avec elle, et rien n'est exécutable, pas même les
actions automatiques. Une réponse blanche ne vaut rien, et une réponse portant sur un autre
plan non plus.

### Le gel

Le moteur repart toujours du premier stage, et un planificateur est un modèle : il ne
redonne pas deux fois le même plan. Sans gel, relancer après une décision produirait une
nouvelle empreinte, rendrait la décision caduque, et redemanderait une décision, sans fin.

L'approbation gèle donc le plan exact dans le store, sous son dossier. On approuve un texte
figé, et c'est ce texte que la suite consomme. La liaison passe de vérifiée à garantie par
construction.

Pour abandonner un plan gelé et repartir de zéro :

```bash
npm run en-attente -- --abandonner <dossier>
```

Le plan, son registre courant et sa demande partent. Les décisions déjà prises restent en
base, rattachées à l'empreinte qu'elles tranchaient.

### Savoir qu'une décision attend

Un arrêt qui s'écrit dans un terminal est invisible quand le run tourne sur une autre
machine. L'approbation dépose donc sa demande dans la boîte du store, avec le dossier,
l'empreinte, le nombre d'actions et depuis quand. La demande ne porte aucun chemin de
fichier : le dossier suffit à retrouver le plan et le registre.

```bash
npm run en-attente
```

Sortie 0 si rien n'attend, **1 s'il y a des décisions à prendre**.

**Cette boîte n'est couplée à aucun transport, délibérément.** Le cockpit, le canal
d'alerte et `en-attente` sont trois lecteurs du même store, et choisir l'un n'interdit
pas les autres.

### Le store des approbations

Plans gelés, registres de décisions, boîte et journal des alertes vivent dans une base
SQLite, `approvals/approbations.sqlite`, par `node:sqlite` livré avec Node 22 : aucune
compilation native dans l'image Alpine. Node signale le module comme expérimental au
démarrage, sans effet sur son fonctionnement.

Ils vivaient avant dans des fichiers JSON dont la boîte portait les chemins absolus, ce qui
ne marchait que si le run et le cockpit montaient le même dossier sur le même hôte. La base
se lit par dossier. Elle garde aussi l'historique : réécrire le registre d'un plan remplace
ses décisions à lui, jamais celles d'un plan précédent.

Le cockpit et le pipeline marketing ouvrent la même base sur le NAS, une connexion par
opération, en mode WAL. Un run sur le PC ne peut pas écrire dans une base posée sur le NAS :
ce transport arrive avec le maître et ses workers. D'ici là, marketing reste sur le NAS.

**Migrer des approbations tenues en fichiers**, une fois, au déploiement :

```bash
sudo docker compose run --rm cockpit node bin/importer-approbations.js
```

L'import lit la boîte, les plans gelés, les registres et le journal d'alertes, écrit le tout
dans la base, puis relit chaque élément et le compare au fichier. Au moindre écart, il le
nomme et sort en erreur. Il est idempotent et ne touche à aucun fichier : les archiver reste
à faire à la main, après avoir vérifié le cockpit.

La clé est le **dossier**, pas le pipeline. Relancer remplace la demande au lieu de
l'empiler, sinon la boîte se remplirait de demandes portant sur des plans qui n'existent
plus, et une boîte pleine de faux se fait ignorer. Une fois toutes les actions tranchées,
la demande sort de la boîte.

### Un registre caduc n'est pas une anomalie

Le registre porte l'empreinte du plan qu'il visait. Dès qu'un nouveau plan est produit, il
devient caduc. Le stage refuse alors d'en tenir compte, mais il dépose quand même le plan
neuf, qui s'attend comme un premier. On ne s'arrête sec que s'il n'y a rien à faire
attendre, parce qu'il n'y a alors rien à déposer non plus.

## Utilisation

```bash
npm install
npm test                 # 128 vérifications, sans réseau ni credentials
```

Les tests du stage `approval` tournent sur un pipeline neutre, `test/fixtures/approbation.json`,
et ne dépendent d'aucun domaine.

## Ce qui a été retiré

Le 2026-09-16, tout ce qui concernait eBay : les pipelines `veille-ebay`, `ajustement-prix`
et `ajustement-prix-appliquer`, leurs specs et agents, les stages `fetch`, `stats`, `verify`,
`verify-actions`, `charger` et `execute`, l'exécuteur de prix, le script de consentement, et
la boucle `bin/cycle.js`, que le maître du cockpit agentique remplacera.

Leur histoire, et ce que l'API réelle a appris (médiane fausse, place de marché implicite,
jeton d'écriture, `PUT` qui remplace l'offre), reste lisible dans l'historique git, à partir
du commit parent du retrait, et dans la note `business-pipelines` du vault. Pour reprendre
l'exécution d'actions approuvées, repartir de `src/execute.js` et du stage `execute` : leurs
gardes (ledger hors workspace, cible perdue contre panne, séries bornées) ne dépendaient pas
d'eBay.

La péremption affichée par le cockpit et le canal d'alerte lit encore son maximum dans un
stage `charger`. Aucun pipeline livré n'en déclare plus, donc elle rend « fraîcheur
inconnue ». Son sort se décide avec la refonte du cockpit.

## Le cockpit d'approbation

```
npm run cockpit              # http://127.0.0.1:4600
npm run cockpit:tailnet      # monte le relais, pour y accéder du téléphone
```

La page montre, pour chaque dossier en attente, l'empreinte du plan et chaque action : un
arbitrage se lit comme une question suivie de son rapport, les autres actions avec leur
justification et leurs sources.

### Ce qu'il refuse de faire

Cette page écrit de vraies décisions, elle est donc écrite comme le reste du dépôt.

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

### Le panneau des applications déployées

Une fois le cockpit sur l'écran d'accueil du téléphone, il est la porte d'entrée de ce qui
tourne sur le NAS. Il liste donc les applications sorties du générateur de SaaS, en liens
vers elles et rien de plus. Le registre se copie depuis
`specs/cockpit-apps.json.example`, et son absence ramène simplement la page à ce qu'elle
était.

**Le registre est relu à chaque rendu de page.** Lu une fois au démarrage, ajouter une app
demandait de redémarrer le conteneur. Une liste de liens qui exige une commande pour se
tenir à jour est une liste qu'on cesse de tenir, et une liste fausse vaut moins que pas de
liste. Éditer le fichier suffit, le rafraîchissement montre le résultat. La relecture ne
coûte rien en pratique, un petit JSON sur une page qu'un humain ouvre pour décider, et le
risque qu'elle aurait pu ajouter est déjà écarté : un registre cassé en cours de route
nomme son défaut et laisse la page intacte.

**La liste vient d'un fichier, jamais du démon Docker.** Interroger Docker donnerait une
liste toujours juste et coûterait le socket monté dans le conteneur, c'est-à-dire root sur
le NAS accordé à la page joignable depuis le tailnet. Une liste qui vieillit se corrige en
éditant un fichier ; un socket qu'on a monté ne se démonte jamais vraiment.

**Une adresse se déclare, elle ne se construit pas.** Le code ne fabrique aucune URL à
partir d'un port. La différence se voit à l'usage : une app publiée sur le LAN est
injoignable depuis un téléphone qui n'est pas à la maison, alors que le cockpit, lui, passe
par Tailscale. Un lien LAN dans une page qu'on ouvre dehors est un lien mort, et aucun
module ne peut deviner lequel des deux chemins tu as monté.

**Une app ne partage pas l'origine du cockpit**, et c'est le refus le moins évident. Le
contrôle d'origine sur les écritures est ce qui empêche une page tierce d'enregistrer une
décision. Servir une app sous le nom du cockpit lui donnerait cette origine, donc ce droit,
et ces applications sortent d'un générateur : elles sont écrites par un modèle, ce qui est
la définition d'une page tierce. Le chargement refuse une entrée qui atterrit sur une
origine acceptée. Un port distinct suffit à l'en séparer.

**Seuls `http` et `https` sont des liens.** Un `javascript:` dans un href s'exécute dans la
page qui approuve des changements de prix, un `data:` sert un document sous notre propre
origine. Le registre n'est écrit que par le propriétaire du NAS, mais une liste blanche ne
dépend pas de ce qu'on croira se rappeler en l'éditant dans six mois.

**Les liens portent `rel="noopener"`.** Sans lui, la page ouverte reçoit une poignée sur
l'onglet du cockpit et peut le faire naviguer ailleurs, vers une copie qui redemande de
confirmer une décision par exemple.

**Un registre fautif nomme le défaut et ne tue pas la page.** Le panneau est un confort,
décider est la raison d'être du cockpit : faire dépendre la seconde du premier échangerait
une fonction qui garde l'argent contre une liste de liens. Se taire serait pire, on croirait
n'avoir rien déployé.

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

## Le canal d'alerte

Le cockpit règle la décision, pas la notification. Ce module est ce qui va chercher
l'humain, et c'est un lecteur de la boîte de plus, au même titre que `en-attente` et le
cockpit. Il ne touche ni au moteur ni au cockpit.

Le transport vit dans un registre. Un transport reçoit un
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
Deux messages au maximum par plan, même lancé toutes les quinze minutes. Une boîte qui répète se fait taire aussi sûrement qu'une boîte
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
*/15 * * * * cd /chemin/vers/business-pipelines && /usr/bin/node bin/alerter.js >> /var/log/business-pipelines.log 2>&1
```

### Ce que ça ne résout pas encore

Le courriel prévient, il ne décide pas, et c'est délibéré : un message ne porte aucun
bouton et aucun lien qui approuve. La décision se prend dans le cockpit, joignable depuis
le téléphone depuis le 2026-08-20. Ce qui reste, c'est que le courriel n'arrive pas comme
une notification d'application : il faut ouvrir sa boîte. Le push web réglera ça.

## Le cockpit en lecture

La page d'approbation garde la racine ; le cockpit des runs vit sous `/app`. Il lit
l'event store du moteur (§9 de la spec) et ne lui écrit jamais : ce qui s'est passé est
écrit par le moteur et par le maître, au moment où ça arrive.

```bash
npm run web:build   # construit le front (Vite + React + Tailwind) dans web/dist
npm run cockpit     # sert la page d'approbation, /app, et l'API
npm run web:dev     # développement du front seul, API relayée vers le cockpit local
```

Routes de lecture, toutes derrière le même contrôle d'identité que le reste :

| Route | Ce qu'elle rend |
|---|---|
| `GET /api/tableau-de-bord` | runs récents, machines, décisions qui attendent, coût du jour |
| `GET /api/runs` | la liste des runs (`?limite=`, `?projet=`) |
| `GET /api/runs/<id>` | un run, ses étapes, leur machine et leur issue |
| `GET /api/machines` | l'état des machines et l'âge de leur dernier signe de vie |
| `GET /api/flux` | le flux d'événements en SSE (`?run=`, reprise par `Last-Event-ID`) |

Le flux ne porte pas l'état, il dit qu'il a changé : la page recharge la vue concernée. Une
page qui reconstruirait l'état à partir des événements finirait par diverger de la base le
jour où un événement manque.

L'event store se monte dans le conteneur (`./etat:/app/etat`, `ORCH_EVENT_STORE`). Une base
absente ou illisible n'empêche pas de décider : la page d'approbation n'en dépend pas, et
les routes de runs répondent alors 503 en le disant.

