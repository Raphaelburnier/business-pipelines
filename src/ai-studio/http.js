const fs = require("fs");
const path = require("path");
const { RequeteInvalide, Introuvable } = require("./store");
const { MODEL_CATEGORIES } = require("./model-library");

function creerRouteurAIStudio({ service, json, corpsJson, durcissement, origineAutorisee = () => true }) {
  return async function traiterAIStudio(req, res) {
    const url = new URL(req.url, "http://cockpit");
    if (!url.pathname.startsWith("/api/ai-studio")) return false;

    try {
      const morceaux = url.pathname.slice("/api/ai-studio".length).split("/").filter(Boolean).map(decodeURIComponent);
      if (req.method === "GET" && morceaux.length === 1 && morceaux[0] === "status") {
        return fini(json(res, 200, await service.status()));
      }
      if (morceaux[0] === "models") {
        if (req.method === "GET" && morceaux.length === 1) {
          const models = service.models.liste();
          const checkpoints = await service.comfyui.checkpoints().catch(() => null);
          const noms = new Map([["checkpoints", checkpoints]]);
          if (checkpoints !== null) {
            await Promise.all([...new Set(models.map((model) => model.category))]
              .filter((categorie) => categorie !== "checkpoints")
              .map(async (categorie) => noms.set(categorie, await service.comfyui.modelNames(categorie).catch(() => null))));
          }
          return fini(json(res, 200, {
            categories: MODEL_CATEGORIES,
            models: models.map((model) => ({ ...model, installed: noms.get(model.category)?.includes(model.name) ?? null })),
            comfy_available: checkpoints !== null,
          }));
        }
        if (req.method === "POST" && morceaux.length === 1) {
          if (!origineAutorisee(req.headers)) return fini(json(res, 403, { erreur: "origine refusée" }));
          if (String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase() !== "application/octet-stream") {
            return fini(json(res, 415, { erreur: "type de contenu refusé : application/octet-stream attendu" }));
          }
          const nom = url.searchParams.get("name");
          const categorie = url.searchParams.get("category") || "checkpoints";
          return fini(json(res, 201, await service.models.ajouter(categorie, nom, req)));
        }
      }
      if (req.method === "GET" && morceaux.length === 1 && morceaux[0] === "checkpoints") {
        return fini(json(res, 200, { checkpoints: await service.comfyui.checkpoints() }));
      }
      if (req.method === "GET" && morceaux.length === 1 && morceaux[0] === "workflows") {
        return fini(json(res, 200, { workflows: service.workflows.liste() }));
      }
      if (morceaux[0] === "profiles") {
        if (req.method === "GET" && morceaux.length === 1) return fini(json(res, 200, { profiles: service.store.profils() }));
        if (req.method === "POST" && morceaux.length === 1) {
          const corps = await corpsJson(req, res);
          if (!corps) return true;
          return fini(json(res, 201, service.creerProfil(corps)));
        }
        const profileId = morceaux[1];
        if (req.method === "GET" && morceaux.length === 2) return fini(json(res, 200, service.store.profil(profileId)));
        if (req.method === "PATCH" && morceaux.length === 2) {
          const corps = await corpsJson(req, res);
          if (!corps) return true;
          return fini(json(res, 200, service.store.modifierProfil(profileId, corps)));
        }
        if (morceaux[2] === "references") {
          if (req.method === "POST" && morceaux.length === 3) {
            const corps = await corpsJson(req, res, 17 * 1024 * 1024);
            if (!corps) return true;
            if (typeof corps.data !== "string") throw new RequeteInvalide("données image absentes");
            const reference = service.store.ajouterReference(profileId, {
              name: corps.name,
              mime: corps.mime,
              buffer: Buffer.from(corps.data, "base64"),
            });
            return fini(json(res, 201, reference));
          }
          if (req.method === "GET" && morceaux.length === 4) {
            const fichier = service.store.cheminReference(profileId, morceaux[3]);
            return fini(servirFichier(res, fichier, durcissement));
          }
        }
      }
      if (req.method === "POST" && morceaux.length === 1 && morceaux[0] === "generate") {
        const corps = await corpsJson(req, res);
        if (!corps) return true;
        const generations = await service.generer(corps);
        return fini(json(res, 202, { generations }));
      }
      if (morceaux[0] === "generations") {
        if (req.method === "GET" && morceaux.length === 1) {
          return fini(json(res, 200, {
            generations: service.store.generations({
              profileId: url.searchParams.get("profile"),
              status: url.searchParams.get("status"),
              limit: url.searchParams.get("limit"),
            }),
          }));
        }
        const id = morceaux[1];
        if (req.method === "GET" && morceaux.length === 2) return fini(json(res, 200, service.store.generation(id)));
        if (req.method === "GET" && morceaux[2] === "image") return fini(servirFichier(res, service.store.cheminImage(id), durcissement));
        if (req.method === "GET" && morceaux[2] === "workflow") {
          return fini(servirFichier(res, service.store.cheminWorkflow(id), durcissement, "application/json; charset=utf-8", `attachment; filename="${id}-workflow.json"`));
        }
        if (req.method === "POST" && morceaux[2] === "regenerate") {
          const corps = await corpsJson(req, res);
          if (!corps) return true;
          return fini(json(res, 202, { generations: await service.regenerer(id, corps) }));
        }
        if (req.method === "POST" && morceaux.length === 3 && morceaux[2] === "approve") {
          const corps = await corpsJson(req, res);
          if (!corps) return true;
          return fini(json(res, 202, service.approuver(id)));
        }
        if (req.method === "POST" && morceaux[2] === "cancel") {
          const corps = await corpsJson(req, res);
          if (!corps) return true;
          return fini(json(res, 200, await service.queue.annuler(id)));
        }
      }
      return fini(json(res, 404, { erreur: "route AI Studio inconnue" }));
    } catch (err) {
      if (err instanceof RequeteInvalide) return fini(json(res, 400, { erreur: err.message }));
      if (err instanceof Introuvable) return fini(json(res, 404, { erreur: err.message }));
      console.error("AI Studio :", err);
      return fini(json(res, 500, { erreur: `panne AI Studio : ${err.message}` }));
    }
  };
}

function fini() {
  return true;
}

function servirFichier(res, fichier, durcissement, type = null, disposition = null) {
  const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".json": "application/json; charset=utf-8" };
  const corps = fs.readFileSync(fichier);
  res.writeHead(200, {
    "Content-Type": type || TYPES[path.extname(fichier).toLowerCase()] || "application/octet-stream",
    "Content-Length": corps.length,
    ...(disposition ? { "Content-Disposition": disposition } : {}),
    ...durcissement,
  });
  res.end(corps);
}

module.exports = { creerRouteurAIStudio, servirFichier };
