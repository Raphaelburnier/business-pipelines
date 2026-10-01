import type { CharacterProfile, ComfyStatus, Generation, ModelLibraryStatus, WorkflowManifest } from "./types";

export class AIStudioApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requete<T>(url: string, options: RequestInit = {}): Promise<T> {
  const reponse = await fetch(url, { headers: { accept: "application/json", ...(options.headers || {}) }, ...options });
  const type = reponse.headers.get("content-type") || "";
  const corps = type.includes("json") ? await reponse.json() : await reponse.text();
  if (!reponse.ok) {
    const message = corps && typeof corps === "object" && "erreur" in corps ? String(corps.erreur) : String(corps || reponse.status);
    throw new AIStudioApiError(message, reponse.status);
  }
  return corps as T;
}

function json<T>(url: string, method: "POST" | "PATCH" | "DELETE", corps: unknown): Promise<T> {
  return requete<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
}

export const aiStudioApi = {
  status: () => requete<ComfyStatus>("/api/ai-studio/status"),
  models: () => requete<ModelLibraryStatus>("/api/ai-studio/models"),
  addModel: (file: File, category: string, progress: (percent: number) => void = () => {}) => new Promise<{ category: string; name: string; size: number; sha256: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/ai-studio/models?category=${encodeURIComponent(category)}&name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("accept", "application/json");
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error("transfert du modèle vers le NAS interrompu"));
    xhr.onload = () => {
      let data: { erreur?: string; category?: string; name?: string; size?: number; sha256?: string };
      try { data = JSON.parse(xhr.responseText); }
      catch { reject(new Error("réponse du NAS illisible")); return; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new AIStudioApiError(data.erreur || "import refusé", xhr.status));
      } else resolve(data as { category: string; name: string; size: number; sha256: string });
    };
    xhr.send(file);
  }),
  async checkpoints() {
    return (await requete<{ checkpoints: string[] }>("/api/ai-studio/checkpoints")).checkpoints;
  },
  async profiles() {
    return (await requete<{ profiles: CharacterProfile[] }>("/api/ai-studio/profiles")).profiles;
  },
  profile: (id: string) => requete<CharacterProfile>(`/api/ai-studio/profiles/${encodeURIComponent(id)}`),
  createProfile: (corps: Partial<CharacterProfile>) => json<CharacterProfile>("/api/ai-studio/profiles", "POST", corps),
  updateProfile: (id: string, corps: Partial<CharacterProfile>) => json<CharacterProfile>(`/api/ai-studio/profiles/${encodeURIComponent(id)}`, "PATCH", corps),
  async workflows() {
    return (await requete<{ workflows: WorkflowManifest[] }>("/api/ai-studio/workflows")).workflows;
  },
  async generations(profileId?: string, limit = 100) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (profileId) params.set("profile", profileId);
    return (await requete<{ generations: Generation[] }>(`/api/ai-studio/generations?${params}`)).generations;
  },
  generation: (id: string) => requete<Generation>(`/api/ai-studio/generations/${encodeURIComponent(id)}`),
  generate: (corps: unknown) => json<{ generations: Generation[] }>("/api/ai-studio/generate", "POST", corps),
  regenerate: (id: string, corps: unknown) => json<{ generations: Generation[] }>(`/api/ai-studio/generations/${encodeURIComponent(id)}/regenerate`, "POST", corps),
  approve: (id: string) => json<Generation>(`/api/ai-studio/generations/${encodeURIComponent(id)}/approve`, "POST", {}),
  cancel: (id: string) => json<Generation>(`/api/ai-studio/generations/${encodeURIComponent(id)}/cancel`, "POST", {}),
  deleteGeneration: (id: string) => json<{ generation_id: string; profile_id: string; archive_deleted: boolean }>(`/api/ai-studio/generations/${encodeURIComponent(id)}`, "DELETE", {}),
  deleteProfile: (id: string, archive: boolean) => json<{ id: string; archive_folder: string | null; archive_deleted: boolean }>(`/api/ai-studio/profiles/${encodeURIComponent(id)}`, "DELETE", { archive }),
  async addReference(profileId: string, file: File) {
    const data = await fichierBase64(file);
    return json<{ name: string; url: string }>(`/api/ai-studio/profiles/${encodeURIComponent(profileId)}/references`, "POST", {
      name: file.name,
      mime: file.type,
      data,
    });
  },
};

function fichierBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("lecture du fichier impossible"));
    lecteur.onload = () => resolve(String(lecteur.result).split(",")[1] || "");
    lecteur.readAsDataURL(file);
  });
}
