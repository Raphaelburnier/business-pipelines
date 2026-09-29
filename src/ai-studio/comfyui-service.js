const crypto = require("crypto");

class ComfyUIErreur extends Error {
  constructor(message, { code = null, cause = null } = {}) {
    super(message, { cause });
    this.code = code;
  }
}

class ComfyUIService {
  constructor({ url, fetchFn = fetch, timeoutMs = 10_000, clientId = crypto.randomUUID() }) {
    if (!url) throw new Error("COMFYUI_URL est requis");
    this.url = String(url).replace(/\/+$/, "");
    this.fetch = fetchFn;
    this.timeoutMs = timeoutMs;
    this.clientId = clientId;
  }

  async requete(chemin, { method = "GET", body = undefined, timeoutMs = this.timeoutMs } = {}) {
    let reponse;
    try {
      reponse = await this.fetch(`${this.url}${chemin}`, {
        method,
        headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ComfyUIErreur(`ComfyUI injoignable : ${err.message}`, { cause: err });
    }
    if (!reponse.ok) {
      const texte = await reponse.text().catch(() => "");
      throw new ComfyUIErreur(`ComfyUI répond ${reponse.status}${texte ? ` : ${texte.slice(0, 500)}` : ""}`, { code: reponse.status });
    }
    const type = reponse.headers.get("content-type") || "";
    if (!type.includes("json")) return reponse;
    return reponse.json();
  }

  async healthCheck() {
    const debut = Date.now();
    try {
      const systeme = await this.requete("/system_stats", { timeoutMs: 3000 });
      return {
        available: true,
        url: this.url,
        latency_ms: Date.now() - debut,
        system: systeme,
        error: null,
      };
    } catch (err) {
      return {
        available: false,
        url: this.url,
        latency_ms: Date.now() - debut,
        system: null,
        error: err.message,
      };
    }
  }

  async checkpoints() {
    const informations = await this.requete("/object_info/CheckpointLoaderSimple");
    const choix = informations?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    if (!Array.isArray(choix)) throw new ComfyUIErreur("liste des checkpoints ComfyUI indisponible");
    return choix.filter((nom) => typeof nom === "string" && nom.length > 0);
  }

  async queueWorkflow(workflow, { promptId = crypto.randomUUID() } = {}) {
    const resultat = await this.requete("/prompt", {
      method: "POST",
      body: { prompt: workflow, client_id: this.clientId, prompt_id: promptId },
      timeoutMs: 30_000,
    });
    if (!resultat || !resultat.prompt_id) {
      throw new ComfyUIErreur(`ComfyUI n'a pas rendu de prompt_id${resultat?.error ? ` : ${resultat.error}` : ""}`);
    }
    return { prompt_id: resultat.prompt_id, number: resultat.number ?? null, node_errors: resultat.node_errors || {} };
  }

  async getHistory(promptId) {
    const resultat = await this.requete(`/history/${encodeURIComponent(promptId)}`);
    return resultat && resultat[promptId] ? resultat[promptId] : null;
  }

  async getQueue() {
    return this.requete("/queue");
  }

  async getProgress(promptId) {
    const history = await this.getHistory(promptId);
    if (history) {
      const error = this.erreurHistory(history);
      return { state: error ? "failed" : "completed", progress: 100, history, error };
    }
    const file = await this.getQueue();
    if (contientPrompt(file?.queue_running, promptId)) return { state: "generating", progress: 50, history: null, error: null };
    if (contientPrompt(file?.queue_pending, promptId)) return { state: "queued", progress: 20, history: null, error: null };
    return { state: "unknown", progress: null, history: null, error: null };
  }

  async cancel(promptId) {
    // `/interrupt` vise le prompt actuellement actif, sans identifiant. Ne jamais l'appeler
    // à l'aveugle : annuler un job en attente interromprait sinon une autre génération.
    const file = await this.getQueue().catch(() => null);
    const actif = contientPrompt(file?.queue_running, promptId);
    await this.requete("/queue", { method: "POST", body: { delete: [promptId] } }).catch(() => null);
    if (actif) await this.requete("/interrupt", { method: "POST", body: {} }).catch(() => null);
  }

  async downloadOutput(sortie) {
    if (!sortie || !sortie.filename) throw new ComfyUIErreur("sortie ComfyUI sans nom de fichier");
    const params = new URLSearchParams({
      filename: sortie.filename,
      subfolder: sortie.subfolder || "",
      type: sortie.type || "output",
    });
    let reponse;
    try {
      reponse = await this.fetch(`${this.url}/view?${params}`, { signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      throw new ComfyUIErreur(`téléchargement de l'image impossible : ${err.message}`, { cause: err });
    }
    if (!reponse.ok) throw new ComfyUIErreur(`téléchargement de l'image refusé (${reponse.status})`, { code: reponse.status });
    return { buffer: Buffer.from(await reponse.arrayBuffer()), contentType: reponse.headers.get("content-type") || "image/png" };
  }

  outputs(history) {
    const images = [];
    for (const [node, sortie] of Object.entries(history?.outputs || {})) {
      for (const image of sortie.images || []) images.push({ node, ...image });
    }
    return images;
  }

  erreurHistory(history) {
    const messages = history?.status?.messages || [];
    const erreur = messages.find((m) => Array.isArray(m) && /error|interrupt/i.test(String(m[0])));
    return erreur ? JSON.stringify(erreur[1] || erreur[0]).slice(0, 2000) : null;
  }
}

function contientPrompt(file, promptId) {
  return Array.isArray(file) && file.some((entree) => Array.isArray(entree) && entree.some((valeur) => valeur === promptId));
}

module.exports = { ComfyUIService, ComfyUIErreur, contientPrompt };
