// Un relevé de maquette qui montre chaque cas du sélecteur : utilisable, limité, épuisé,
// quota inconnu, sans outils, et joignable ou non depuis le runner.
import type { Modele, ReponseModeles } from "../types";

const modele = (m: Partial<Modele> & Pick<Modele, "fournisseur"> & { model: string }): Modele => ({
  id: `omniroute:${m.model}`,
  llm: { via: "omniroute", model: m.model },
  type: m.fournisseur === "combo" ? "combo" : "modele",
  nom: m.nom ?? m.model,
  capacites: m.capacites ?? { outils: true, vision: false, raisonnement: false },
  contexte: m.contexte ?? 200000,
  etat: m.etat ?? "disponible",
  raison: m.raison ?? null,
  resetAt: m.resetAt ?? null,
  fournisseur: m.fournisseur,
});

export function catalogueMaquette(maintenant: number): ReponseModeles {
  const dans = (h: number) => new Date(maintenant + h * 3600_000).toISOString();
  return {
    catalogue: {
      version: 1,
      releveLe: new Date(maintenant - 90_000).toISOString(),
      machine: "pc",
      passerelle: { etat: "ok", detail: null },
      quotas: "releves",
      connexions: [],
      modeles: [
        modele({ fournisseur: "combo", model: "agentic-code", etat: "inconnu", raison: "état de la chaîne non relevé", capacites: { outils: true, vision: false, raisonnement: true } }),
        modele({ fournisseur: "combo", model: "vision", etat: "inconnu", raison: "état de la chaîne non relevé", capacites: { outils: true, vision: true, raisonnement: false } }),
        modele({ fournisseur: "agy", model: "agy/claude-sonnet-4-6", nom: "Claude Sonnet 4.6", etat: "limite", capacites: { outils: true, vision: true, raisonnement: true } }),
        modele({ fournisseur: "codex", model: "codex/gpt-5.6-terra", nom: "GPT 5.6 Terra", etat: "epuise", raison: "quota épuisé", resetAt: dans(3.4), contexte: 872000 }),
        modele({ fournisseur: "gemini", model: "gemini/gemini-flash-lite-latest", nom: "Gemini Flash Lite", etat: "inconnu", raison: "not_supported" }),
        modele({ fournisseur: "ollama-local", model: "ollama-local/qwen3:8b-40k", nom: "Qwen3 8B", etat: "inconnu", raison: "not_supported", capacites: { outils: false, vision: false, raisonnement: false } }),
      ],
    },
    ageSecondes: 90,
    perime: false,
    viaRunner: ["claude", "omniroute"],
    raison: null,
  };
}
