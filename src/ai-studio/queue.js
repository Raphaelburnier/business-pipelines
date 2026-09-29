const { ETATS_TERMINAUX, ArchiveIndisponible } = require("./store");

class GenerationQueue {
  constructor({ store, comfyui, maxConcurrent = 2, pollIntervalMs = 1500 }) {
    this.store = store;
    this.comfyui = comfyui;
    this.maxConcurrent = Math.max(1, Math.min(Number(maxConcurrent) || 2, 8));
    this.pollIntervalMs = pollIntervalMs;
    this.attente = [];
    this.actifs = new Set();
    this.reprendreApresActif = new Set();
    this.arretee = false;
  }

  demarrer() {
    for (const generation of this.store.nonTerminales()) {
      if (generation.status === "draft") this.store.majGeneration(generation.generation_id, { status: "queued" });
      this.ajouter(generation.generation_id, { persister: false });
    }
    for (const generation of this.store.archivagesEnAttente()) {
      this.ajouter(generation.generation_id, { persister: false });
    }
  }

  ajouter(id, { persister = true } = {}) {
    if (this.arretee || this.attente.includes(id)) return;
    if (this.actifs.has(id)) {
      if (!persister) this.reprendreApresActif.add(id);
      return;
    }
    if (persister) this.store.majGeneration(id, { status: "queued", progress: 5, error: null });
    this.attente.push(id);
    queueMicrotask(() => this.pomper());
  }

  async annuler(id) {
    const generation = this.store.generation(id);
    if (ETATS_TERMINAUX.has(generation.status)) return generation;
    this.attente = this.attente.filter((x) => x !== id);
    this.store.majGeneration(id, { status: "cancelled", progress: generation.progress, error: null });
    if (generation.prompt_id) await this.comfyui.cancel(generation.prompt_id);
    return this.store.generation(id);
  }

  pomper() {
    if (this.arretee) return;
    while (this.actifs.size < this.maxConcurrent && this.attente.length) {
      const id = this.attente.shift();
      this.actifs.add(id);
      this.executer(id)
        .catch((err) => {
          try {
            const courant = this.store.generation(id);
            if (err instanceof ArchiveIndisponible && courant.approved_at && !courant.archived_at) {
              this.store.majGeneration(id, { archive_error: err.message });
              const rappel = setTimeout(() => this.ajouter(id, { persister: false }), 30_000);
              rappel.unref?.();
            } else if (!ETATS_TERMINAUX.has(courant.status)) {
              this.store.majGeneration(id, { status: "failed", error: err.message, progress: courant.progress || 0 });
            }
          } catch (secondaire) {
            console.error(`AI Studio : impossible de consigner l'échec de ${id} : ${secondaire.message}`);
          }
        })
        .finally(() => {
          this.actifs.delete(id);
          if (this.reprendreApresActif.delete(id)) this.ajouter(id, { persister: false });
          this.pomper();
        });
    }
  }

  async executer(id) {
    let generation = this.store.generation(id);
    if (generation.status === "completed" && generation.approved_at && !generation.archived_at) {
      this.store.archiverGeneration(id);
      return;
    }
    if (ETATS_TERMINAUX.has(generation.status)) return;
    if (generation.status === "saving" && generation.storage.image) {
      this.store.majGeneration(id, { status: "completed", progress: 100, completed_at: generation.completed_at || new Date().toISOString(), error: null });
      return;
    }

    if (!generation.prompt_id) {
      const workflow = require(this.store.cheminWorkflow(id));
      const job = await this.comfyui.queueWorkflow(workflow);
      generation = this.store.majGeneration(id, {
        status: "sent_to_comfyui",
        progress: 15,
        prompt_id: job.prompt_id,
        comfyui: { queue_number: job.number, node_errors: job.node_errors },
      });
    }

    generation = this.store.majGeneration(id, { status: "generating", progress: 30 });
    let history = null;
    while (!this.arretee) {
      const courant = this.store.generation(id);
      if (courant.status === "cancelled") return;
      const suivi = await this.comfyui.getProgress(generation.prompt_id);
      history = suivi.history;
      if (history) break;
      if (suivi.state === "queued" && (courant.status !== "sent_to_comfyui" || courant.progress !== 20)) {
        this.store.majGeneration(id, { status: "sent_to_comfyui", progress: 20 });
      } else if (suivi.state === "generating" && (courant.status !== "generating" || courant.progress !== 50)) {
        this.store.majGeneration(id, { status: "generating", progress: 50 });
      }
      await attendre(this.pollIntervalMs);
    }
    if (!history) return;
    if (this.store.generation(id).status === "cancelled") return;
    const erreur = this.comfyui.erreurHistory(history);
    if (erreur) throw new Error(`génération ComfyUI en échec : ${erreur}`);
    const sorties = this.comfyui.outputs(history);
    if (!sorties.length) throw new Error("ComfyUI a terminé sans image de sortie");

    this.store.majGeneration(id, { status: "saving", progress: 85, outputs: sorties });
    const image = sorties[0];
    const telechargee = await this.comfyui.downloadOutput(image);
    if (this.store.generation(id).status === "cancelled") return;
    const extension = extensionDepuis(image.filename, telechargee.contentType);
    this.store.sauverImage(id, telechargee.buffer, { extension, source: image });
    this.store.majGeneration(id, {
      status: "completed",
      progress: 100,
      completed_at: new Date().toISOString(),
      error: null,
      comfyui: { ...(generation.comfyui || {}), status: history.status || null },
    });
  }

  arreter() {
    this.arretee = true;
  }
}

function extensionDepuis(nom, mime) {
  const ext = String(nom || "").split(".").pop().toLowerCase();
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return ext;
  return mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "png";
}

function attendre(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { GenerationQueue, extensionDepuis };
