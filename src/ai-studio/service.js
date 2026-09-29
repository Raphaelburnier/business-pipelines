const crypto = require("crypto");
const { AIStudioStore, RequeteInvalide, generationId, idValide, slug } = require("./store");
const { ComfyUIService } = require("./comfyui-service");
const { WorkflowRepository, composerPrompts } = require("./workflows");
const { GenerationQueue } = require("./queue");

class AIStudioService {
  constructor({ storageRoot, archiveRoot, templatesDir, comfyuiUrl, maxConcurrent = 2, fetchFn = fetch, pollIntervalMs = 1500 }) {
    this.store = new AIStudioStore(storageRoot, archiveRoot);
    this.workflows = new WorkflowRepository({ templatesDir, storageDir: this.store.workflowsDir });
    this.comfyui = new ComfyUIService({ url: comfyuiUrl, fetchFn });
    this.queue = new GenerationQueue({ store: this.store, comfyui: this.comfyui, maxConcurrent, pollIntervalMs });
    this.queue.demarrer();
  }

  status() {
    return this.comfyui.healthCheck();
  }

  creerProfil(demande) {
    return this.store.creerProfil(demande);
  }

  async generer(demande, { parentId = null } = {}) {
    const profile = this.store.profil(demande.profile_id);
    const projectId = idValide(slug(demande.project_id || profile.project_id || profile.id), "projet");
    const workflowId = String(demande.workflow_id || "portrait_realistic_v1");
    const nombre = entier(demande.count, 1, 1, 8, "count");
    const memeSeed = Boolean(demande.same_seed);
    const request = nettoyerRequest(demande);
    if (!request.prompt) throw new RequeteInvalide("une description de photo est requise");
    const checkpoint = String(demande.settings?.checkpoint || profile.checkpoint || "").trim();
    if (!checkpoint) throw new RequeteInvalide("un checkpoint doit être défini sur le profil ou dans les paramètres avancés");
    const { positive, negative } = composerPrompts(profile, request);
    const baseSeed = seed(demande.settings?.seed);
    const resolution = demande.settings?.width && demande.settings?.height
      ? { width: demande.settings.width, height: demande.settings.height }
      : resolutionPourRatio(request.aspect_ratio || profile.preferred_ratio, profile.default_resolution);
    const generations = [];

    for (let i = 0; i < nombre; i += 1) {
      const id = generationId();
      const graine = memeSeed || i === 0 ? baseSeed : seed();
      const settings = normaliserSettings({
        ...demande.settings,
        checkpoint,
        seed: graine,
        width: resolution.width,
        height: resolution.height,
        positive_prompt: positive,
        negative_prompt: negative,
        filename_prefix: `AIStudio/${profile.id}/${id}`,
      });
      const construit = this.workflows.construire(workflowId, settings);
      const generation = this.store.creerGeneration({
        id,
        profileId: profile.id,
        projectId,
        workflowId,
        request,
        settings: {
          ...settings,
          loras: [],
          identity: { method: "none", strength: Number(demande.settings?.identity_strength ?? 0) },
          ipadapter: null,
          controlnet: null,
          face_identity: null,
          preset_id: null,
          manifest_version: construit.manifest.version,
        },
        workflow: construit.workflow,
        seed: graine,
        parentId,
      });
      this.queue.ajouter(generation.generation_id);
      generations.push(this.store.generation(generation.generation_id));
    }
    return generations;
  }

  async regenerer(id, demande = {}) {
    const precedente = this.store.generation(id);
    const settings = { ...precedente.settings, ...(demande.settings || {}) };
    if (demande.same_seed === false && demande.settings?.seed === undefined) delete settings.seed;
    return this.generer(
      {
        profile_id: precedente.profile_id,
        project_id: demande.project_id || precedente.project_id,
        workflow_id: precedente.workflow_id,
        count: demande.count ?? 1,
        same_seed: demande.same_seed ?? true,
        ...precedente.request,
        ...(demande.request || {}),
        settings,
      },
      { parentId: precedente.generation_id }
    );
  }

  approuver(id) {
    const generation = this.store.approuverGeneration(id);
    if (!generation.archived_at) this.queue.ajouter(id, { persister: false });
    return generation;
  }

  fermer() {
    this.queue.arreter();
    this.store.fermer();
  }
}

function nettoyerRequest(d) {
  const propre = {};
  for (const cle of ["prompt", "negative_prompt", "scene", "outfit", "pose", "camera_angle", "shot_type", "lighting", "style", "aspect_ratio"]) {
    propre[cle] = String(d[cle] || "").trim().slice(0, cle.includes("prompt") ? 6000 : 500);
  }
  propre.creativity = nombre(d.creativity, 0.65, 0, 1, "creativity");
  return propre;
}

function normaliserSettings(s) {
  return {
    positive_prompt: String(s.positive_prompt),
    negative_prompt: String(s.negative_prompt || ""),
    checkpoint: String(s.checkpoint),
    seed: entier(s.seed, 0, 0, 2147483647, "seed"),
    cfg: nombre(s.cfg, 5, 1, 15, "cfg"),
    steps: entier(s.steps, 28, 1, 150, "steps"),
    sampler: String(s.sampler || "dpmpp_2m"),
    scheduler: String(s.scheduler || "karras"),
    denoise: nombre(s.denoise, 1, 0, 1, "denoise"),
    width: multipleDeHuit(s.width, 832, "width"),
    height: multipleDeHuit(s.height, 1040, "height"),
    filename_prefix: String(s.filename_prefix),
  };
}

function seed(valeur = undefined) {
  if (valeur !== undefined && valeur !== null && valeur !== "" && Number(valeur) >= 0) return entier(valeur, 0, 0, 2147483647, "seed");
  return crypto.randomInt(0, 2147483648);
}

function entier(valeur, defaut, min, max, nom) {
  const n = valeur === undefined || valeur === null || valeur === "" ? defaut : Number(valeur);
  if (!Number.isInteger(n) || n < min || n > max) throw new RequeteInvalide(`${nom} doit être un entier entre ${min} et ${max}`);
  return n;
}

function nombre(valeur, defaut, min, max, nom) {
  const n = valeur === undefined || valeur === null || valeur === "" ? defaut : Number(valeur);
  if (!Number.isFinite(n) || n < min || n > max) throw new RequeteInvalide(`${nom} doit être entre ${min} et ${max}`);
  return n;
}

function multipleDeHuit(valeur, defaut, nom) {
  const n = entier(valeur, defaut, 256, 4096, nom);
  if (n % 8 !== 0) throw new RequeteInvalide(`${nom} doit être un multiple de 8`);
  return n;
}

function resolutionPourRatio(ratio, defaut) {
  const rapports = { "4:5": 4 / 5, "1:1": 1, "9:16": 9 / 16, "1.91:1": 1.91 };
  const r = rapports[ratio] || (defaut.width / defaut.height);
  const pixels = defaut.width * defaut.height;
  const width = Math.max(256, Math.min(4096, Math.round(Math.sqrt(pixels * r) / 8) * 8));
  const height = Math.max(256, Math.min(4096, Math.round((width / r) / 8) * 8));
  return { width, height };
}

module.exports = { AIStudioService, nettoyerRequest, normaliserSettings, seed, resolutionPourRatio };
