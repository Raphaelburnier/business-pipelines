const fs = require("fs");
const path = require("path");
const { lireJson } = require("../durable");
const { RequeteInvalide, sous } = require("./store");

class WorkflowRepository {
  constructor({ templatesDir, storageDir }) {
    this.templatesDir = path.resolve(templatesDir);
    this.storageDir = path.resolve(storageDir);
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.installerTemplates();
  }

  installerTemplates() {
    for (const entree of fs.readdirSync(this.templatesDir, { withFileTypes: true })) {
      if (!entree.isFile() || !/\.(json|manifest\.json)$/.test(entree.name)) continue;
      const source = path.join(this.templatesDir, entree.name);
      const cible = sous(this.storageDir, entree.name);
      const contenu = fs.readFileSync(source);
      if (!fs.existsSync(cible) || !fs.readFileSync(cible).equals(contenu)) fs.writeFileSync(cible, contenu);
    }
  }

  liste() {
    return fs.readdirSync(this.storageDir)
      .filter((nom) => nom.endsWith(".manifest.json"))
      .map((nom) => lireJson(path.join(this.storageDir, nom)))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  manifest(id) {
    if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(String(id || ""))) throw new RequeteInvalide("workflow invalide");
    const manifeste = lireJson(sous(this.storageDir, `${id}.manifest.json`));
    if (!manifeste) throw new RequeteInvalide(`workflow « ${id} » introuvable`);
    return manifeste;
  }

  construire(id, valeurs) {
    const manifeste = this.manifest(id);
    const workflow = lireJson(sous(this.storageDir, manifeste.workflow));
    if (!workflow) throw new Error(`template ${manifeste.workflow} absent`);
    for (const [nom, definition] of Object.entries(manifeste.parameters || {})) {
      const valeur = valeurs[nom] === undefined ? definition.default : valeurs[nom];
      if (valeur === undefined) {
        if (definition.required) throw new RequeteInvalide(`paramètre « ${nom} » requis`);
        continue;
      }
      validerParametre(nom, valeur, definition);
      const node = workflow[String(definition.node)];
      if (!node || !node.inputs || !(definition.input in node.inputs)) {
        throw new Error(`mapping invalide pour ${nom} : ${definition.node}.${definition.input}`);
      }
      node.inputs[definition.input] = valeur;
    }
    return { manifest: manifeste, workflow };
  }
}

function validerParametre(nom, valeur, definition) {
  if (definition.type === "integer" && !Number.isInteger(Number(valeur))) throw new RequeteInvalide(`${nom} doit être un entier`);
  if (definition.type === "number" && !Number.isFinite(Number(valeur))) throw new RequeteInvalide(`${nom} doit être un nombre`);
  if (definition.type === "string" && typeof valeur !== "string") throw new RequeteInvalide(`${nom} doit être du texte`);
  if (["integer", "number"].includes(definition.type)) {
    const n = Number(valeur);
    if (definition.min !== undefined && n < definition.min) throw new RequeteInvalide(`${nom} doit être supérieur ou égal à ${definition.min}`);
    if (definition.max !== undefined && n > definition.max) throw new RequeteInvalide(`${nom} doit être inférieur ou égal à ${definition.max}`);
  }
  if (definition.enum && !definition.enum.includes(valeur)) throw new RequeteInvalide(`${nom} doit valoir ${definition.enum.join(", ")}`);
}

function composerPrompts(profile, request) {
  const sections = [
    ["IDENTITY", profile.identity_prompt],
    ["SUBJECT", request.prompt],
    ["SCENE", request.scene],
    ["OUTFIT", request.outfit],
    ["POSE", request.pose],
    ["CAMERA", [request.camera_angle, request.shot_type].filter(Boolean).join(", ")],
    ["LIGHTING", request.lighting],
    ["AESTHETIC", request.style],
  ].filter(([, texte]) => String(texte || "").trim());
  const positive = sections.map(([titre, texte]) => `${titre}: ${String(texte).trim()}`).join("\n");
  const negative = [profile.negative_prompt, request.negative_prompt].map((v) => String(v || "").trim()).filter(Boolean).join(", ");
  return { positive, negative };
}

module.exports = { WorkflowRepository, composerPrompts, validerParametre };
