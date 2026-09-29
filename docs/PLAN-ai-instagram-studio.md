# AI Instagram Studio — plan d’intégration

> Plan établi le 2026-09-28 à partir de `origin/main` (`2ae0229`). La Phase 1 décrite
> ci-dessous est la seule phase autorisée dans ce lot. Les méthodes d’identité, les agents
> créatifs et l’édition directe dans ComfyUI restent explicitement hors de ce lot.

## 1. Existing architecture

- Le Cockpit est un monolithe Node.js 22 sans framework HTTP : `bin/cockpit.js` sert les
  routes JSON, le front compilé et l’ancienne page de décisions.
- Le front principal est React 19 + TypeScript strict + Vite 7. Il possède un routeur léger
  basé sur `history.pushState`, une couche `Source` unique pour l’API/maquette, Tailwind 4 et
  un design system AgenticOS/Night City dans `web/src/style.css`.
- L’identité est prouvée par Tailscale. Le serveur refuse les hôtes inconnus, contrôle
  l’origine des écritures et n’écoute hors loopback qu’en conteneur explicitement déclaré.
- Le dépôt n’a ni ORM ni base applicative générale. `agent-orchestrator` possède son event
  store SQLite ; les approbations ont leur propre store `node:sqlite`.
- Les jobs actuels passent par une table de commandes de l’event store et un runner séparé.
  Ils concernent les pipelines d’agents, pas les travaux ComfyUI.
- Le stockage durable du NAS est injecté par volumes Docker (`approvals`, `etat`, `projects`,
  `specs`). Aucun montage AI Studio n’existe encore.
- Le déploiement est une image Node Alpine unique. Le cockpit est publié uniquement sur
  `127.0.0.1:4600` puis relayé par Tailscale.

## 2. Integration points

- Ajouter les routes `/ai-studio...` au routeur React existant et un lien dans la sidebar.
- Ajouter les routes `/api/ai-studio/...` dans le même serveur HTTP afin de réutiliser
  l’identité, la liste blanche d’hôtes, le contrôle d’origine et les limites de corps.
- Instancier un module AI Studio unique au démarrage du cockpit. Il porte le store, la file
  et le client ComfyUI ; aucune vue React ne parle directement à ComfyUI.
- Conserver l’event store de l’orchestrateur intact : un job d’image n’est pas un run
  agentique et possède son propre cycle de vie.
- Ajouter un volume de travail et un volume d'archive configurables, ainsi que des
  variables non secrètes pour l’URL ComfyUI et la concurrence.

## 3. Proposed architecture

```text
React /ai-studio
        │ même origine, Tailscale
        ▼
API AI Studio dans bin/cockpit.js
        │
        ├── AIStudioStore ── JSON canoniques + index SQLite recréable
        ├── WorkflowRepository + WorkflowParameterMapper
        ├── GenerationQueue ── états persistés, reprise au démarrage
        └── ComfyUIService ── HTTP LAN/Docker uniquement
                                  │
                                  ▼
                               ComfyUI
```

Le store de fichiers est la vérité. SQLite n’est qu’un index de galerie : supprimer la base
et lancer une réindexation ne doit perdre ni profil, ni génération, ni workflow.

## 4. Database changes

Créer `AI_STUDIO_STORAGE_ROOT/index.sqlite` avec deux tables recréables :

- `ai_profiles` : id, nom, description, checkpoint, dates, nombre de références et de
  générations ;
- `ai_generations` : id, profile_id, état, prompt_id ComfyUI, workflow, seed, paramètres,
  chemin relatif de l’image, erreur, dates.

Les entités futures (`ai_presets`, `ai_scenes`, `ai_photoshoots`) ne sont pas créées en
Phase 1. Le schéma de l’event store n’est pas modifié.

## 5. NAS/storage strategy

- `AI_STUDIO_STORAGE_ROOT` garde les profils, références, workflows et états de jobs.
  `AI_STUDIO_ARCHIVE_ROOT` reçoit uniquement les générations réussies et validées. Aucun chemin NAS
  ou IP n'est codé en dur dans l'application.
- Arborescence de travail :

```text
profiles/<profile>/profile.json
profiles/<profile>/references/<reference>
profiles/<profile>/generations/YYYY/MM/<generation>/
  image.<ext>
  metadata.json
  workflow.json
workflows/<template>.json
workflows/<template>.manifest.json
temp/jobs/
index.sqlite
```

L'archive contient `<projet>/<profil>/YYYY/MM/<generation>/` avec
`image.<ext>`, `metadata.json` et `workflow.json`. Chaque dossier est publié par
renommage atomique après validation dans l'Inspector. Si le NAS est indisponible,
l'image et la validation restent dans le volume de travail et l'archivage est repris.

- Tous les identifiants deviennent des slugs validés ; toute résolution est vérifiée sous
  la racine attendue pour empêcher le path traversal.
- Les JSON sont écrits via fichier temporaire + renommage. `metadata.json` contient la
  requête, tous les paramètres exposés, l’état, le `prompt_id`, le résultat et les dates.
- Les uploads de référence sont limités à PNG/JPEG/WebP, validés par signature binaire et
  taille, puis renommés par le serveur.

## 6. ComfyUI integration strategy

- `ComfyUIService` utilise les routes locales officielles : `GET /system_stats`,
  `POST /prompt`, `GET /history/{prompt_id}`, `GET /view` et, pour l’annulation,
  `POST /interrupt` lorsque le job est actif.
- La Phase 1 suit la progression par polling côté backend. Le contrat du service laisse la
  place à un transport WebSocket ultérieur sans modifier l’UI ni le store.
- Le serveur envoie un `client_id` stable par processus et associe immédiatement
  `prompt_id` à `generation_id` dans les métadonnées.
- Les images sont téléchargées par le backend dans le volume de travail. Après réussite et
  validation manuelle, l'image, le workflow exact et les métadonnées sont copiés dans l'archive NAS. Le
  navigateur ne reçoit jamais l’URL ComfyUI.
- Une erreur réseau ou ComfyUI est persistée comme `failed`; un job `queued` reprend après
  redémarrage. Un job déjà envoyé est réconcilié avec `/history/{prompt_id}`.

## 7. UI routes/components

Routes Phase 1 :

- `/ai-studio` : état ComfyUI, création de personnage, cartes profils, générations récentes ;
- `/ai-studio/profiles/:id` : galerie et accès à Generate/References/Settings ;
- `/ai-studio/profiles/:id/generate` : prompt et paramètres avancés ;
- `/ai-studio/profiles/:id/references` : ajout et liste des références ;
- `/ai-studio/generations/:id` : inspector, image, métadonnées, regénération et export JSON.

Direction visuelle : conserver les tokens Night City, Rajdhani/Share Tech Mono et les coins
coupés. La vue AI Studio prend la forme d’une planche-contact de studio : numéros de prises,
bandes de métadonnées et cadres au ratio réel. C’est la signature du module ; aucun nouveau
jeu de couleurs ni police n’est introduit.

## 8. Backend services

- `src/ai-studio/store.js` : profils, références, générations, JSON atomiques, index/reindex ;
- `src/ai-studio/comfyui-service.js` : client HTTP ComfyUI avec timeouts et erreurs typées ;
- `src/ai-studio/workflows.js` : lecture des templates/manifests et mapping validé ;
- `src/ai-studio/queue.js` : ordonnanceur persistant et concurrence bornée ;
- `src/ai-studio/service.js` : façade métier utilisée par les routes ;
- `src/ai-studio/http.js` : parsing/validation des demandes et réponses d’assets.

## 9. Job/queue architecture

États : `draft → queued → sent_to_comfyui → generating → saving → completed`, avec sorties
`failed` et `cancelled`.

- Une génération de quatre images crée quatre IDs, quatre seeds, quatre snapshots et quatre
  entrées durables avant de répondre `202`.
- La file en mémoire n’est qu’un accélérateur. Au démarrage, les métadonnées non terminales
  sont relues ; les jobs non envoyés sont repris, les jobs envoyés sont réconciliés.
- `AI_STUDIO_MAX_CONCURRENT_JOBS` limite le nombre de prompts confiés simultanément à
  ComfyUI. La progression retournée au front combine l’état et, si disponible, les données
  de l’historique ComfyUI.

## 10. Implementation phases

### Phase 1 — ce lot

1. Données de travail, archive NAS des images validées, profils et références.
2. Template `portrait_realistic_v1` + manifest + mapper.
3. Client ComfyUI, file persistante, batch et suivi.
4. Sauvegarde image/métadonnées/workflow et index galerie.
5. API protégée, galerie, formulaire simple/advanced, inspector et regénération avec
   overrides.
6. Tests unitaires, intégration avec faux ComfyUI, typecheck/build et vérification navigateur.

### Phases suivantes — non implémentées ici

- Phase 2 : providers LoRA/IPAdapter/FaceID/InstantID, Character Lock, injection des références.
- Phase 3 : agents Director/Scene/Prompt/Workflow, scènes, presets et photoshoots.
- Phase 4 : synchronisation UI ComfyUI, Save as Preset, compare/sweeps et manifests riches.

## 11. Risks / unknowns

- Raphaël a créé le partage `IAstudio` le 2026-09-29. Le chemin retenu pour le montage est
  `/volume1/IAstudio` ; son existence et ses permissions depuis le conteneur devront être
  confirmées au déploiement, puis `AI_STUDIO_ARCHIVE_PATH` renseigné.
- Le NAS et le conteneur Cockpit accèdent au ComfyUI Windows du PC sur le LAN
  (`192.168.1.26:8188`, constat du 2026-09-29). La première exécution réelle dépend du nom
  de checkpoint et des nodes installés sur l’instance cible.
- Les références sont stockées en Phase 1 mais volontairement non injectées : prétendre à
  une cohérence d’identité avant la Phase 2 serait trompeur.
- Le format API de ComfyUI est conservé exactement. L’ouverture automatique dans le canvas
  avec son layout demande un workflow UI ou une synchronisation dédiée, prévue en Phase 4.
- Le polling est robuste mais moins fin que le WebSocket pour le pourcentage par node ; la
  progression Phase 1 est donc principalement une progression d’état.
- Si le partage d'archive est momentanément indisponible, la validation est conservée
  dans le volume de travail et l'archivage est retenté. Ce volume doit donc rester durable
  jusqu'à la fin des transferts.

## 12. Files expected to be created/modified

Créations prévues :

- `src/ai-studio/{store,comfyui-service,workflows,queue,service,http}.js`
- `workflows/ai-studio/portrait_realistic_v1.{json,manifest.json}`
- `web/src/ai-studio/{types,api,AIStudio,ProfileStudio,Generate,References,Inspector}.tsx`
- `test/ai-studio-*.test.js` et tests front ciblés
- ce plan.

Modifications prévues :

- `bin/cockpit.js` pour l’instanciation et le routage ;
- `web/src/App.tsx`, `web/src/icones.tsx`, `web/src/style.css` pour navigation et vues ;
- `package.json` pour inclure les tests AI Studio ;
- `docker-compose.yaml` et `specs/cockpit.env.example` pour la configuration/montage ;
- `README.md` pour le démarrage et les limites de Phase 1.
