// Une équipe de maquette qui montre chaque cas de la page : au travail sur un run, affecté
// sans étape en cours, libre, budget presque épuisé, modèle gratuit, combo sans note.
import type { ChangementProfil, Competences, MembreEquipe, ReponseEquipe } from "../donnees/equipe";

type Base = Pick<MembreEquipe, "id" | "nom" | "role" | "famille" | "llm" | "registre" | "budgetMensuelUsd"> & { consomme: number; jetons: number };

// Extrait de `equipe/benchmarks.json` : la maquette ne lit pas le fichier du serveur.
const OPUS: Competences = {
  modele: "Claude Opus 5.5",
  prix: { entreeUsdParM: 4, sortieUsdParM: 20 },
  releve: "2026-10-14",
  benchmarks: [
    { nom: "AA Intelligence Index v4.3.2", score: 58, max: 100, coutUsd: 5.98, unite: "tâche", variante: "Max", mesure: "independant", source: "https://artificialanalysis.ai/models/claude-opus-5-5" },
    { nom: "SWE-bench Pro", score: 89.9, max: 100, coutUsd: null, unite: null, variante: null, mesure: "editeur", source: null },
  ],
};
const SONNET: Competences = {
  modele: "Claude Sonnet 5.5",
  prix: { entreeUsdParM: 2, sortieUsdParM: 10 },
  releve: "2026-10-14",
  benchmarks: [
    { nom: "AA Intelligence Index v4.3.2", score: 56, max: 100, coutUsd: 5.46, unite: "tâche", variante: "Max", mesure: "independant", source: "https://artificialanalysis.ai/models/claude-sonnet-5-5" },
    { nom: "SWE-bench Pro", score: 81.3, max: 100, coutUsd: null, unite: null, variante: null, mesure: "editeur", source: null },
  ],
};
const TERRA: Competences = {
  modele: "GPT-5.6 Terra",
  prix: { entreeUsdParM: 2, sortieUsdParM: 12 },
  releve: "2026-10-14",
  benchmarks: [
    { nom: "AA Intelligence Index v4.3.2", score: 42, max: 100, coutUsd: 1.4, unite: "tâche", variante: "Max", mesure: "independant", source: "https://artificialanalysis.ai/models/gpt-5-6-terra" },
    { nom: "SWE-bench Pro", score: 63.4, max: 100, coutUsd: null, unite: null, variante: null, mesure: "editeur", source: null },
  ],
};

const BASES: Array<Base & { competences: Competences | null }> = [
  { id: "margaux", nom: "Margaux", role: "Cheffe de projet", famille: "claude", llm: { via: "claude", model: "opus" }, registre: ["plan-synthesist"], budgetMensuelUsd: 60, consomme: 12.4, jetons: 410_000, competences: OPUS },
  { id: "victor", nom: "Victor", role: "Architecte", famille: "codex", llm: { via: "codex", model: "gpt-5.6-terra:high" }, registre: ["architect"], budgetMensuelUsd: null, consomme: 0, jetons: 182_000, competences: TERRA },
  { id: "lea", nom: "Léa", role: "Dev frontend", famille: "claude", llm: { via: "claude", model: "sonnet" }, registre: ["frontend-builder"], budgetMensuelUsd: 50, consomme: 44.8, jetons: 1_900_000, competences: SONNET },
  { id: "hugo", nom: "Hugo", role: "Dev backend", famille: "codex", llm: { via: "codex", model: "gpt-5.6-terra:medium" }, registre: ["backend-builder"], budgetMensuelUsd: null, consomme: 0, jetons: 0, competences: TERRA },
  { id: "elise", nom: "Élise", role: "Analyste marché et économie", famille: "codex", llm: { via: "codex", model: "gpt-5.6-terra:high" }, registre: ["economy-analyst"], budgetMensuelUsd: null, consomme: 0, jetons: 1_240_000, competences: TERRA },
  { id: "paul", nom: "Paul", role: "Scribe (résumés, notes vault)", famille: "libre", llm: { via: "omniroute", model: "agentic-bulk" }, registre: ["passage-extractor"], budgetMensuelUsd: null, consomme: 0, jetons: 95_000, competences: null },
];

export function equipeMaquette(maintenant: () => number) {
  const affectations = new Map<string, { projet: string; depuis: string }>([
    ["margaux", { projet: "steam-tierlist", depuis: new Date(maintenant() - 3 * 86_400_000).toISOString() }],
    ["lea", { projet: "steam-tierlist", depuis: new Date(maintenant() - 3 * 86_400_000).toISOString() }],
  ]);
  const profils = new Map<string, { nom?: string; photo?: string; secours?: string }>([["camille", { secours: "elise" }]]);

  return {
    async lecture(): Promise<ReponseEquipe> {
      const agents = BASES.map(({ consomme, jetons, ...b }, i): MembreEquipe => {
        const affectation = affectations.get(b.id) ?? null;
        const enCours = b.id === "elise" ? { run: "run-marketing-1", projet: "marketing", noeud: "economie" } : null;
        const profil = profils.get(b.id) ?? {};
        return {
          ...b,
          nom: profil.nom ?? b.nom,
          nomRoster: b.nom,
          photo: profil.photo ?? null,
          secours: profil.secours ?? null,
          etapesMois: { total: 40 + i * 13, reussies: 36 + i * 11 },
          occupe: Boolean(affectation || enCours),
          projet: affectation?.projet ?? enCours?.projet ?? null,
          depuis: affectation?.depuis ?? null,
          enCours,
          usage: {
            consommeMoisUsd: consomme,
            jetonsMois: jetons,
            budgetMensuelUsd: b.budgetMensuelUsd,
            resteUsd: b.budgetMensuelUsd === null ? null : Math.max(0, b.budgetMensuelUsd - consomme),
          },
        };
      });
      return { agents, projets: ["marketing", "steam-tierlist"], mesure: true };
    },
    async affecter(ids: string[], projet: string | null): Promise<void> {
      for (const id of ids) {
        if (projet === null) affectations.delete(id);
        else affectations.set(id, { projet, depuis: new Date(maintenant()).toISOString() });
      }
    },
    async profil(agent: string, changement: ChangementProfil): Promise<void> {
      const profil = { ...profils.get(agent) };
      if (changement.nom === null) delete profil.nom;
      else if (changement.nom !== undefined) profil.nom = changement.nom.trim();
      if (changement.photo === null) delete profil.photo;
      else if (changement.photo !== undefined) profil.photo = changement.photo;
      if (changement.secours === null) delete profil.secours;
      else if (changement.secours !== undefined) profil.secours = changement.secours;
      profils.set(agent, profil);
    },
  };
}
