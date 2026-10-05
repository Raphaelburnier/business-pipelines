// Une équipe de maquette qui montre chaque cas de la liste : au travail sur un run, affecté
// sans étape en cours, libre, budget presque épuisé, modèle gratuit.
import type { MembreEquipe, ReponseEquipe } from "../donnees/equipe";

type Base = Pick<MembreEquipe, "id" | "nom" | "role" | "famille" | "llm" | "registre" | "budgetMensuelUsd"> & { consomme: number };

const BASES: Base[] = [
  { id: "margaux", nom: "Margaux", role: "Cheffe de projet", famille: "claude", llm: { via: "claude", model: "opus" }, registre: ["plan-synthesist"], budgetMensuelUsd: 60, consomme: 12.4 },
  { id: "victor", nom: "Victor", role: "Architecte", famille: "codex", llm: { via: "omniroute", model: "codex/gpt-5.6-terra-high" }, registre: ["architect"], budgetMensuelUsd: 40, consomme: 3.1 },
  { id: "lea", nom: "Léa", role: "Dev frontend", famille: "claude", llm: { via: "claude", model: "sonnet" }, registre: ["frontend-builder"], budgetMensuelUsd: 50, consomme: 44.8 },
  { id: "hugo", nom: "Hugo", role: "Dev backend", famille: "codex", llm: { via: "omniroute", model: "codex/gpt-5.6-terra" }, registre: ["backend-builder"], budgetMensuelUsd: 50, consomme: 0 },
  { id: "elise", nom: "Élise", role: "Analyste marché et économie", famille: "codex", llm: { via: "omniroute", model: "codex/gpt-5.6-terra-high" }, registre: ["economy-analyst"], budgetMensuelUsd: 30, consomme: 8.2 },
  { id: "paul", nom: "Paul", role: "Scribe (résumés, notes vault)", famille: "libre", llm: { via: "omniroute", model: "agentic-bulk" }, registre: ["passage-extractor"], budgetMensuelUsd: null, consomme: 0 },
];

export function equipeMaquette(maintenant: () => number) {
  const affectations = new Map<string, { projet: string; depuis: string }>([
    ["margaux", { projet: "steam-tierlist", depuis: new Date(maintenant() - 3 * 86_400_000).toISOString() }],
    ["lea", { projet: "steam-tierlist", depuis: new Date(maintenant() - 3 * 86_400_000).toISOString() }],
  ]);

  return {
    async lecture(): Promise<ReponseEquipe> {
      const agents = BASES.map(({ consomme, ...b }): MembreEquipe => {
        const affectation = affectations.get(b.id) ?? null;
        const enCours = b.id === "elise" ? { run: "run-marketing-1", projet: "marketing", noeud: "economie" } : null;
        return {
          ...b,
          occupe: Boolean(affectation || enCours),
          projet: affectation?.projet ?? enCours?.projet ?? null,
          depuis: affectation?.depuis ?? null,
          enCours,
          usage: {
            consommeMoisUsd: consomme,
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
  };
}
