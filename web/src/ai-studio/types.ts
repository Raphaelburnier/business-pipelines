export interface ReferenceImage {
  name: string;
  url: string;
}

export interface CharacterProfile {
  id: string;
  name: string;
  project_id: string;
  description: string;
  identity_prompt: string;
  negative_prompt: string;
  checkpoint: string;
  identity_method: "none" | string;
  identity_strength: number;
  loras: Array<{ name: string; weight: number }>;
  ipadapter: unknown;
  face_identity: unknown;
  preferred_presets: string[];
  preferred_ratio: string;
  default_resolution: { width: number; height: number };
  created_at: string;
  updated_at: string;
  references: ReferenceImage[];
  generation_count?: number;
}

export type GenerationStatus = "draft" | "queued" | "sent_to_comfyui" | "generating" | "saving" | "completed" | "failed" | "cancelled";

export interface GenerationSettings {
  positive_prompt: string;
  negative_prompt: string;
  checkpoint: string;
  seed: number;
  cfg: number;
  steps: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  width: number;
  height: number;
  filename_prefix: string;
  loras: Array<{ name: string; weight: number }>;
  identity: { method: string; strength: number };
  ipadapter: unknown;
  controlnet: unknown;
  face_identity: unknown;
  manifest_version: number;
}

export interface GenerationRequest {
  prompt: string;
  negative_prompt: string;
  scene: string;
  outfit: string;
  pose: string;
  camera_angle: string;
  shot_type: string;
  lighting: string;
  style: string;
  aspect_ratio: string;
  creativity: number;
}

export interface Generation {
  schema_version: number;
  generation_id: string;
  profile_id: string;
  project_id: string;
  parent_generation_id: string | null;
  status: GenerationStatus;
  progress: number;
  prompt_id: string | null;
  workflow_id: string;
  request: GenerationRequest;
  settings: GenerationSettings;
  seed: number;
  outputs: Array<{ node: string; filename: string; subfolder: string; type: string }>;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  approved_at: string | null;
  archived_at: string | null;
  archive_error: string | null;
  archive?: { directory: string; image: string; workflow: string; metadata: string };
  storage: { directory: string; metadata: string; workflow: string; image: string | null };
}

export interface WorkflowParameter {
  type: "string" | "number" | "integer";
  min?: number;
  max?: number;
  step?: number;
  default?: string | number;
  enum?: string[];
  required?: boolean;
  node: string;
  input: string;
}

export interface WorkflowManifest {
  id: string;
  name: string;
  description: string;
  version: number;
  parameters: Record<string, WorkflowParameter>;
}

export interface ComfyStatus {
  available: boolean;
  url: string;
  latency_ms: number;
  system: unknown;
  error: string | null;
}

export interface StudioModel {
  category: string;
  name: string;
  size: number;
  sha256: string | null;
  installed: boolean | null;
}

export interface ModelLibraryStatus {
  categories: string[];
  models: StudioModel[];
  comfy_available: boolean;
}
