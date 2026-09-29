const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { AIStudioStore, RequeteInvalide } = require("../src/ai-studio/store");
const { AIStudioService } = require("../src/ai-studio/service");

const tests = [];
const test = (nom, fn) => tests.push({ nom, fn });

function temporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ai-studio-"));
}

function fauxComfy() {
  let numero = 0;
  const prompts = new Map();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const appels = [];
  const fetchFn = async (url, options = {}) => {
    const u = new URL(url);
    appels.push({ chemin: u.pathname, method: options.method || "GET" });
    if (u.pathname === "/system_stats") return Response.json({ system: { os: "test" }, devices: [] });
    if (u.pathname === "/object_info/CheckpointLoaderSimple") return Response.json({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [["realistic.safetensors", "portrait.safetensors"]] } } },
    });
    if (u.pathname === "/prompt" && options.method === "POST") {
      const corps = JSON.parse(options.body);
      numero += 1;
      const promptId = corps.prompt_id || `prompt-${numero}`;
      prompts.set(promptId, corps.prompt);
      return Response.json({ prompt_id: promptId, number: numero, node_errors: {} });
    }
    if (u.pathname.startsWith("/history/")) {
      const promptId = decodeURIComponent(u.pathname.slice("/history/".length));
      if (!prompts.has(promptId)) return Response.json({});
      return Response.json({
        [promptId]: {
          outputs: { "9": { images: [{ filename: `${promptId}.png`, subfolder: "", type: "output" }] } },
          status: { status_str: "success", completed: true, messages: [["execution_success", {}]] },
        },
      });
    }
    if (u.pathname === "/view") return new Response(png, { headers: { "content-type": "image/png" } });
    if (u.pathname === "/queue" || u.pathname === "/interrupt") return Response.json({});
    return new Response("inconnu", { status: 404 });
  };
  return { fetchFn, prompts, appels };
}

async function attendre(predicate, maximumMs = 4000) {
  const debut = Date.now();
  while (Date.now() - debut < maximumMs) {
    const valeur = predicate();
    if (valeur) return valeur;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("condition jamais atteinte");
}

test("le store garde les profils, références et générations dans des JSON autonomes", () => {
  const racine = temporaire();
  const store = new AIStudioStore(racine);
  const luna = store.creerProfil({
    name: "Luna",
    description: "Personnage de test",
    identity_prompt: "adult woman, green eyes",
    negative_prompt: "deformed",
    checkpoint: "realistic.safetensors",
  });
  assert.strictEqual(luna.id, "luna");
  assert.throws(() => store.creerProfil({ name: "Luna" }), RequeteInvalide);

  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const reference = store.ajouterReference("luna", { name: "../Face One.png", mime: "image/png", buffer: png });
  assert.match(reference.name, /^face-one-[a-f0-9]{6}\.png$/);
  assert.strictEqual(fs.existsSync(store.cheminReference("luna", reference.name)), true);
  assert.throws(() => store.cheminReference("luna", "../profile.json"), RequeteInvalide);
  const brouillon = store.creerGeneration({ profileId: "luna", workflowId: "portrait_realistic_v1", request: { prompt: "test" }, settings: {}, workflow: {}, seed: 1 });
  assert.throws(() => store.approuverGeneration(brouillon.generation_id), RequeteInvalide);
  store.fermer();

  // La base est un cache : sa suppression ne retire aucune donnée canonique.
  fs.rmSync(path.join(racine, "index.sqlite"));
  const reconstruit = new AIStudioStore(racine);
  assert.strictEqual(reconstruit.profils()[0].name, "Luna");
  assert.strictEqual(reconstruit.profil("luna").references.length, 1);
  reconstruit.fermer();
});

test("une génération batch traverse ComfyUI puis archive seulement l'image validée", async () => {
  const racine = temporaire();
  const archive = temporaire();
  const comfy = fauxComfy();
  const service = new AIStudioService({
    storageRoot: racine,
    archiveRoot: archive,
    templatesDir: path.join(__dirname, "..", "workflows", "ai-studio"),
    comfyuiUrl: "http://comfy.test:8188",
    maxConcurrent: 2,
    fetchFn: comfy.fetchFn,
    pollIntervalMs: 5,
  });
  service.creerProfil({
    name: "Luna",
    identity_prompt: "adult woman, green eyes, black bob haircut",
    negative_prompt: "deformed hands",
    checkpoint: "realistic.safetensors",
  });

  const creees = await service.generer({
    profile_id: "luna",
    project_id: "Tokyo Weekend",
    prompt: "walking in Tokyo at night",
    scene: "neon street",
    camera_angle: "3/4 right",
    shot_type: "full body",
    style: "realistic Instagram lifestyle",
    count: 2,
    settings: { cfg: 4.5, steps: 30, width: 832, height: 1040 },
  });
  assert.strictEqual(creees.length, 2);
  assert.notStrictEqual(creees[0].seed, creees[1].seed);

  await attendre(() => creees.every((g) => service.store.generation(g.generation_id).status === "completed"));
  const premiere = service.store.generation(creees[0].generation_id);
  assert.strictEqual(premiere.settings.cfg, 4.5);
  assert.match(premiere.settings.positive_prompt, /IDENTITY: adult woman/);
  assert.match(premiere.settings.positive_prompt, /SCENE: neon street/);
  assert.strictEqual(fs.existsSync(service.store.cheminImage(premiere.generation_id)), true);
  assert.strictEqual(fs.existsSync(service.store.cheminWorkflow(premiere.generation_id)), true);
  const dossierArchive = path.join(archive, "tokyo-weekend", "luna", premiere.created_at.slice(0, 4), premiere.created_at.slice(5, 7), premiere.generation_id);
  assert.strictEqual(fs.existsSync(dossierArchive), false);
  assert.strictEqual(premiere.approved_at, null);
  service.approuver(premiere.generation_id);
  await attendre(() => service.store.generation(premiere.generation_id).archived_at);
  assert.strictEqual(fs.existsSync(path.join(dossierArchive, "image.png")), true);
  assert.strictEqual(fs.existsSync(path.join(dossierArchive, "workflow.json")), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dossierArchive, "metadata.json"))).status, "completed");
  assert.ok(JSON.parse(fs.readFileSync(path.join(dossierArchive, "metadata.json"))).approved_at);
  const nonValidee = service.store.generation(creees[1].generation_id);
  const archiveNonValidee = path.join(archive, "tokyo-weekend", "luna", nonValidee.created_at.slice(0, 4), nonValidee.created_at.slice(5, 7), nonValidee.generation_id);
  assert.strictEqual(fs.existsSync(archiveNonValidee), false);
  const workflow = JSON.parse(fs.readFileSync(service.store.cheminWorkflow(premiere.generation_id), "utf8"));
  assert.strictEqual(workflow["3"].inputs.seed, premiere.seed);
  assert.strictEqual(workflow["4"].inputs.ckpt_name, "realistic.safetensors");

  const variantes = await service.regenerer(premiere.generation_id, { settings: { cfg: 4.3 }, same_seed: true });
  await attendre(() => service.store.generation(variantes[0].generation_id).status === "completed");
  const variante = service.store.generation(variantes[0].generation_id);
  assert.strictEqual(variante.seed, premiere.seed);
  assert.strictEqual(variante.settings.cfg, 4.3);
  assert.strictEqual(variante.parent_generation_id, premiere.generation_id);
  assert.strictEqual(variante.project_id, "tokyo-weekend");
  assert.strictEqual((await service.status()).available, true);
  assert.deepStrictEqual(await service.comfyui.checkpoints(), ["realistic.safetensors", "portrait.safetensors"]);
  assert.strictEqual(comfy.prompts.size, 3);
  service.fermer();
});

test("l'archive absente conserve la validation et reprend après redémarrage", async () => {
  const racine = temporaire();
  const archive = path.join(temporaire(), "archive-indisponible");
  fs.writeFileSync(archive, "obstacle");
  const comfy = fauxComfy();
  const options = {
    storageRoot: racine,
    archiveRoot: archive,
    templatesDir: path.join(__dirname, "..", "workflows", "ai-studio"),
    comfyuiUrl: "http://comfy.test:8188",
    maxConcurrent: 1,
    fetchFn: comfy.fetchFn,
    pollIntervalMs: 5,
  };
  const service = new AIStudioService(options);
  service.creerProfil({ name: "Luna", checkpoint: "realistic.safetensors" });
  const [cree] = await service.generer({ profile_id: "luna", prompt: "portrait", count: 1 });
  await attendre(() => service.store.generation(cree.generation_id).status === "completed");
  service.approuver(cree.generation_id);
  const attente = await attendre(() => {
    const g = service.store.generation(cree.generation_id);
    return g.status === "completed" && g.approved_at && g.archive_error ? g : null;
  });
  assert.strictEqual(fs.existsSync(service.store.cheminImage(attente.generation_id)), true);
  assert.strictEqual(fs.statSync(archive).isFile(), true);
  service.fermer();

  fs.unlinkSync(archive);
  fs.mkdirSync(archive);
  const reprise = new AIStudioService(options);
  await attendre(() => reprise.store.generation(cree.generation_id).archived_at);
  const sauvegardee = reprise.store.generation(cree.generation_id);
  assert.strictEqual(fs.existsSync(path.join(archive, sauvegardee.archive.directory, "image.png")), true);
  assert.strictEqual(comfy.prompts.size, 1);
  reprise.fermer();
});

test("une livraison conserve le travail et monte le partage d'archive prévu", () => {
  const racine = path.join(__dirname, "..");
  const livraison = fs.readFileSync(path.join(racine, "deploy", "nas", "deploy.sh.modele"), "utf8");
  const compose = fs.readFileSync(path.join(racine, "docker-compose.yaml"), "utf8");
  // Le comportement, pas l'écriture : la fonction qui dit ce qu'une livraison garde est
  // extraite du modèle et exécutée. `ai-studio-data` est de l'état, le code ne l'est pas.
  const estEtat = livraison.match(/^est_etat\(\) \{\n[\s\S]*?\n\}$/m);
  assert.ok(estEtat, "deploy.sh.modele doit définir est_etat()");
  const garde = (nom) => spawnSync("sh", ["-c", `${estEtat[0]}\nest_etat "$1"`, "sh", nom]).status === 0;
  assert.strictEqual(garde("ai-studio-data"), true, "une livraison doit garder ai-studio-data");
  assert.strictEqual(garde("src"), false, "le code, lui, est remplacé");
  // Et la sauvegarde d'avant bascule ne l'emporte pas : c'est de l'état, pas du code.
  assert.match(livraison, /--exclude=business-pipelines\/ai-studio-data/);
  assert.match(livraison, /mkdir -p[^\n]*"\$BUSINESS\/ai-studio-data"/);
  assert.match(compose, /AI_STUDIO_ARCHIVE_PATH:-\/volume1\/IAstudio/);
  assert.match(compose, /AI_STUDIO_WORK_PATH:-\.\/ai-studio-data/);
});

(async () => {
  let echecs = 0;
  for (const { nom, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${nom}`);
    } catch (err) {
      echecs += 1;
      console.error(`✗ ${nom}`);
      console.error(err);
    }
  }
  if (echecs) process.exitCode = 1;
  else console.log(`${tests.length} tests AI Studio verts`);
})();
