# SPEC : livrer le cockpit depuis le cockpit

> Document destiné à Claude Code et à Raphaël. Rédigé le 2026-09-29 après lecture du code
> (business-pipelines `f5dc441`, agent-orchestrator `d88d94e`).
> **Règle de travail : une phase à la fois, chacune dans sa PR, validée par Raphaël avant la
> suivante.** Les phases 1 et 3 touchent Docker et le déploiement : elles sont exclues de
> l'auto-merge (`AGENTS.md`) et se fusionnent à la main.

---

## 1. Objectif et décision

Aujourd'hui, une nouvelle version du cockpit arrive sur le NAS par `bin/livrer.sh`, lancé
depuis le PC, qui finit sur le mot de passe sudo du NAS. Raphaël veut **voir qu'une livraison
est possible et la déclencher depuis le cockpit**, y compris depuis le téléphone, puis suivre
son déroulement en direct.

**Décision du 2026-09-29 :** la validation par l'identité tailnet de Raphaël, dans le cockpit,
remplace le mot de passe sudo pour mettre en production. Conséquence acceptée : quelqu'un qui
tient son téléphone déverrouillé peut livrer, mais seulement des commits déjà fusionnés sur les
branches par défaut (§3). `bin/livrer.sh` reste le chemin de secours et reste compatible.

---

## 2. Existant (vérifié le 2026-09-29)

- **`bin/livrer.sh`** construit la release à partir de `origin/main` (business-pipelines),
  `origin/master` (agent-orchestrator, déposé dans `.moteur/`), `origin/main`
  (agent-registry), build le front **sur le PC**, écrit `.release` (les trois SHA), dépose sur
  le NAS par SSH et lance `deploy.sh`.
- **`deploy/nas/deploy.sh.modele`** porte toute la bascule : empreinte, sauvegarde tar de
  `/volume1/docker/business-pipelines`, `docker compose build`, remplacement des fichiers hors
  état (`approvals specs logs runs workspace workspaces etat`), `compose up` de `cockpit runner
  tailscale-whois publieur`, contrôle de santé, et restauration des images et fichiers
  précédents en cas d'échec. Il exige root.
- **Commandes durables** (moteur, `src/event-store.js`) : `creerCommande({ kind, payload, par,
  canal })` valide le payload par `packages/schemas/commandes.js` ;
  `prendreCommande({ kinds })` réserve atomiquement la plus ancienne commande des types
  demandés ; `terminerCommande`. Le runner ne prend que `run.start` et le chat.
- **Piège :** `reprendreCommandesInterrompues()` remet en file **toutes** les commandes
  `taken`, sans filtre de type. Le runner l'appelle à son démarrage, et une livraison
  redémarre le runner : une livraison en cours serait remise en file et pourrait être rejouée.
- **Identité** (`src/acces.js`) : `canal: "tailnet"` quand `Tailscale-User-Login` est présent,
  sinon `canal: "local"` avec le compte système, **identité non prouvée**. Les écritures
  (`POST /api/runs`) contrôlent l'origine, le type JSON et la taille du corps (20 ko), puis
  déposent une commande signée (`par`, `canal`) et répondent 202.
- **Publieur** : seul détenteur d'un jeton GitHub, sans agent. Il pousse les branches
  `agent/…` des dépôts de projets et ramène leur branche par défaut. Il ne connaît pas les
  dépôts système.
- **Dépôts git du NAS** (`/volume1/docker/git`) : `marketing.git`, `steam-tierlist.git`.
  **Aucun miroir** de business-pipelines, agent-orchestrator ou agent-registry.
- **Front** : construit hors de l'image (`web/dist` copié par `COPY . .`). Le NAS ne peut donc
  rien livrer seul tant que l'image ne le construit pas.
- **CI** : le workflow `CI` ne tourne que sur les PR. Le commit de tête de `main` (le merge)
  n'a pas de statut propre.
- **Page Décisions** : `/decisions` est l'ancienne page HTML servie par `bin/cockpit.js`
  (approbations des pipelines, `POST /api/decider`). Le front React y renvoie par un lien.

---

## 3. Principes non négociables

1. **Le cockpit ne déploie rien.** Il n'a ni socket Docker, ni jeton, ni accès en écriture au
   code. Il dépose une commande, comme pour un run.
2. **Seule une identité tailnet autorisée livre.** `canal` doit valoir `"tailnet"` et `par`
   figurer dans `LIVRAISON_AUTORISES` (liste de logins, dans l'environnement du cockpit). Le
   canal `local` est refusé : son identité n'est pas prouvée.
3. **On ne livre que du code fusionné.** La commande porte trois SHA complets. Le livreur
   refuse tout SHA absent de son miroir ou qui n'est pas un ancêtre de la branche par défaut
   correspondante. Aucun champ libre : ni branche, ni URL, ni commande.
4. **Le livreur est seul à tenir le pouvoir de déployer**, et il n'est joignable par rien :
   aucun port, aucune entrée réseau. Il ne lit que la file de commandes.
5. **Une livraison à la fois, jamais rejouée.** Une commande de livraison interrompue passe en
   échec, elle ne retourne jamais en file.
6. **Le livreur ne se livre pas lui-même.** Sa mise à jour reste manuelle
   (`bin/livrer.sh --livreur`, §6), pour qu'une livraison ratée ne casse pas l'outil de
   réparation.
7. **Un échec restaure l'état précédent**, et le cockpit le dit : étape en échec, dernières
   lignes du journal, version restaurée.
8. **Une seule logique de bascule.** Le livreur exécute le même `deploy.sh` que
   `bin/livrer.sh`. Pas de seconde implémentation qui divergerait.
9. **Les tests passent avant la bascule.** Le build de l'image lance les tests ; un échec
   arrête tout avant de toucher à l'installation en place.

---

## 4. Architecture

```
GitHub ──(publieur, jeton)──▶ miroirs du NAS  /volume1/docker/git/{business-pipelines,
                                               agent-orchestrator,agent-registry}.git
                                    │ lecture seule
                                    ▼
   cockpit ◀── etat/livraison.json ── livreur ── docker.sock ──▶ build, bascule, santé
      │   (proposition + progression)    ▲
      │                                  │ prendreCommande({ kinds: ["livraison.start"] })
      └── POST /api/livraisons ──▶ event store (commande signée par l'identité tailnet)
```

### 4.1 Miroirs (publieur)

Le publieur ajoute les trois dépôts système à ses cycles : `git fetch` de la branche par défaut
de GitHub vers un dépôt bare du NAS. Il reste le seul détenteur du jeton. Le jeton doit lire
les trois dépôts (agent-orchestrator est privé) **[À VÉRIFIER : portée du jeton actuel]**.

### 4.2 Proposition (livreur)

À intervalle régulier (et au démarrage), le livreur compare `.release` en production aux têtes
des miroirs. Il écrit `etat/livraison.json` :

```json
{
  "enProduction": { "cockpit": "<sha>", "moteur": "<sha>", "registre": "<sha>" },
  "disponible":   { "cockpit": "<sha>", "moteur": "<sha>", "registre": "<sha>" },
  "commits": { "cockpit": [{ "sha": "…", "titre": "…", "auteur": "…", "date": "…" }], "moteur": [], "registre": [] },
  "calculeeLe": "<iso>"
}
```

`disponible` vaut `null` quand la production est à jour. Le cockpit lit ce fichier et ne le
calcule jamais : il n'a pas accès aux miroirs.

### 4.3 Commande `livraison.start`

- Nouveau type dans `packages/schemas/commandes.js` (moteur) :
  `{ cockpit, moteur, registre }`, trois SHA de 40 caractères hexadécimaux, rien d'autre.
- `reprendreCommandesInterrompues({ kinds })` gagne un filtre ; le runner ne remet en file que
  ses propres types. Au démarrage, le livreur passe en `refused` (raison « interrompue ») toute
  `livraison.start` restée `taken`.

### 4.4 Livreur

Nouveau service `livreur` dans `docker-compose.yaml`, image dédiée (node, git, docker-cli,
docker-cli-compose), `restart: always`, **hors de la liste** des services que `deploy.sh`
recrée.

Montages :

| Hôte | Conteneur | Mode | Pourquoi |
| --- | --- | --- | --- |
| `/var/run/docker.sock` | idem | rw | construire les images, basculer |
| `/volume1/docker/business-pipelines` | **même chemin** | rw | `deploy.sh` et `docker compose` résolvent les chemins relatifs du compose ; ils doivent être ceux de l'hôte |
| `/volume1/docker/releases` | même chemin | rw | releases préparées |
| `/volume1/docker/business-pipelines-backups` | même chemin | rw | sauvegardes et restauration |
| miroirs `/volume1/docker/git/*.git` (trois) | `/git/…` | ro | source des releases |

`network_mode: host`, parce que `deploy.sh` contrôle `http://127.0.0.1:4600`. Aucun port publié.
Aucun `env_file` : le livreur ne reçoit ni clé de modèle ni jeton.

Déroulé d'une commande :

1. **Vérifier** : identité tailnet autorisée (le cockpit l'a contrôlée, le livreur le revérifie
   sur `par` et `canal`) ; les trois SHA existent dans les miroirs et sont ancêtres des
   branches par défaut ; aucune autre livraison en cours.
2. **Préparer** : `git archive` des trois SHA, comme `bin/livrer.sh`, puis `.release`, archive,
   empreinte, `deploy.sh` tiré du modèle, dans `/volume1/docker/releases/cockpit-<date>`.
3. **Basculer** : `sh deploy.sh` (en root dans le conteneur). Chaque ligne de sortie devient un
   événement.
4. **Conclure** : `terminerCommande` avec la version livrée, ou l'étape en échec et la version
   restaurée ; mise à jour de `livraison.json`.

Événements, écrits dans l'event store et relayés par le flux SSE existant :
`livraison.debut`, `livraison.etape` (`verifier | preparer | construire | sauvegarder | basculer
| sante | restaurer`), `livraison.journal` (lignes de `deploy.sh`, limitées),
`livraison.fin` (`livree | echec | restauree`).

`deploy.sh` fait `chown -R admindunas:users`. Dans le conteneur, ce nom n'existe pas : le
modèle passe aux UID/GID numériques, `1026:100` (vérifié sur le NAS le 2026-09-29 :
`uid=1026(admindunas) gid=100(users)`), ce qui vaut pour les deux chemins.

### 4.5 L'image construit le front et lance les tests

Le `Dockerfile` gagne une étape de build : installation des dépendances de `web/`, `npm run
build` (typecheck compris), puis `npm test` du serveur. Le front n'est plus construit sur le
PC ; `bin/livrer.sh` cesse de le faire. Une image qui ne passe pas ses tests n'existe pas, donc
`deploy.sh` s'arrête avant la bascule, sans rien toucher.

---

## 5. Interface

### 5.1 Décisions

- Le rail affiche sur « Décisions » la somme des approbations en attente et d'une livraison
  disponible.
- `/decisions` devient une page du front React avec deux sections :
  1. **Livraison** (en tête quand une livraison est disponible ou en cours) ;
  2. **Approbations des pipelines** : le contenu actuel, servi tel quel à une nouvelle adresse
     (§8, question 1).

### 5.2 La carte Livraison

- **Au repos, rien à livrer** : « Production à jour », les trois SHA en production, date de la
  dernière livraison.
- **Livraison disponible** : pour chaque dépôt, SHA en production → SHA disponible et la liste
  des commits (titre, auteur, date), repliable. Bouton primaire **Livrer**. Le clic ouvre une
  confirmation dans la carte (pas de boîte de dialogue du navigateur) : « Livrer ces commits sur
  le NAS ? Le cockpit redémarrera. » puis **Confirmer** / Annuler.
- **En cours** : barre d'étapes segmentée (verifier → … → sante), étape courante en accent,
  les dernières lignes du journal en mono. Aucun bouton pour arrêter : interrompre une bascule
  est pire que la laisser finir ou se restaurer.
- **Pendant la bascule, le cockpit redémarre.** Le front perd l'API et le flux pendant
  quelques dizaines de secondes. Il affiche « Cockpit en redémarrage, reconnexion… », réessaie,
  puis relit la commande (`GET /api/commands/:id`) et `livraison.json` pour afficher l'issue.
- **Terminé** : « Livré » avec la nouvelle version, ou « Échec à l'étape X, version précédente
  restaurée » en `status-err`, avec le journal.
- Historique : les cinq dernières livraisons (date, qui, version, issue).
- La tâche apparaît aussi dans le panneau « En cours » pendant qu'elle tourne.

### 5.3 Maquette

`?source=maquette` couvre les quatre états de la carte, dont le redémarrage simulé.

---

## 6. API et outillage

```
GET  /api/livraison          # livraison.json + livraison en cours + 5 dernières commandes livraison.start
POST /api/livraisons         # { cockpit, moteur, registre } → 202 { commande }
```

`POST /api/livraisons` applique les contrôles de `POST /api/runs` (origine, JSON, 20 ko), puis :
`canal === "tailnet"` et `par` dans `LIVRAISON_AUTORISES`, sinon 403 ; les trois SHA égaux à
`disponible` de `livraison.json`, sinon 409 (« la proposition a changé, recharger ») ; aucune
`livraison.start` en `pending` ou `taken`, sinon 409.

`bin/livrer.sh` reste le secours. Il gagne `--livreur` : construit et redémarre le seul service
`livreur` (sa mise à jour manuelle, §3.6).

---

## 7. Phases

### Phase 1 : l'image construit le front et se teste
- `Dockerfile` : build de `web/` et `npm test` pendant le build ; `bin/livrer.sh` ne build plus
  le front.
- **Acceptation :** une release livrée par `bin/livrer.sh` depuis un PC sans `web/node_modules`
  sert le front ; un test cassé fait échouer `docker compose build` et `deploy.sh` s'arrête
  avant la bascule.

### Phase 2 : le moteur
- Type `livraison.start` (schéma zod, types côté front par `z.infer`) ;
  `reprendreCommandesInterrompues({ kinds })` et son usage filtré dans `commande-runner.js`.
- **Acceptation :** tests du moteur ; un redémarrage du runner ne remet pas en file une
  `livraison.start` réservée.

### Phase 3 : miroirs et livreur
- Publieur : trois miroirs. Service `livreur`, proposition, exécution, événements.
  UID/GID numériques dans le modèle de `deploy.sh`.
- **Acceptation :** une commande déposée à la main dans l'event store livre une nouvelle
  version et écrit `.release` ; un SHA hors branche par défaut est refusé sans rien toucher ;
  un test cassé laisse la production intacte ; un échec de santé restaure ; un redémarrage du
  livreur en pleine livraison la passe en échec au lieu de la rejouer.

### Phase 4 : cockpit
- `GET /api/livraison`, `POST /api/livraisons`, la carte et la page `/decisions`, la maquette.
- **Acceptation :** depuis le téléphone, par le tailnet : voir la livraison disponible, livrer,
  suivre les étapes, retrouver l'issue après le redémarrage du cockpit. Depuis la console du
  NAS (`canal: local`) : 403. Deux clics rapides : une seule livraison.

---

## 8. Questions ouvertes

1. **Adresse des approbations des pipelines** une fois `/decisions` repris par React.
   Recommandation : `/decisions/pipelines`, avec `/decisions` qui garde un lien visible vers
   elle, et le `POST /api/decider` inchangé.
2. **Rétention** des releases et sauvegardes sur le NAS : chaque livraison ajoute environ 1 Mo
   de release et une sauvegarde tar complète. Recommandation : le livreur garde les 5 dernières
   de chaque et supprime les plus anciennes.
3. **Statut CI** : faut-il aussi exiger que la PR qui a produit la tête de `main` ait une CI
   verte (API GitHub, donc le publieur) ? Recommandation : non pour l'instant, les tests du
   build (§4.5) jouent ce rôle sans jeton de plus.

## 9. Hors scope

- Livraison automatique sans clic.
- Revenir à une release antérieure choisie dans le cockpit (la restauration automatique sur
  échec suffit pour commencer).
- Livrer autre chose que le cockpit (Steam TierList et les autres projets ont leur chemin).
