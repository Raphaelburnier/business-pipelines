// La source de la maquette : le scénario, animé par une horloge.
//
// Elle respecte exactement l'interface de la source API. Remplacer l'une par l'autre ne
// touche aucune vue (annexe A).
import type { Evenement } from "../types";
import type { FiltreRuns, Source } from "../donnees/source";
import { etatA } from "./scenario";

export function sourceMaquette({ t0 = Date.now(), maintenant = () => Date.now(), pasMs = 500 } = {}): Source {
  const etat = () => etatA(t0, maintenant() - t0);

  return {
    nom: "maquette",
    topologie: async () => etat().topologie,
    async runs(filtre: FiltreRuns = {}) {
      return etat()
        .runs.filter((r) => (!filtre.project || r.projet === filtre.project) && (!filtre.status || r.statut === filtre.status))
        .slice(0, filtre.limite ?? 20)
        .map(({ etapes, approbations: _a, dernierEvenementId: _d, ...run }) => {
          const parStatut: Record<string, number> = {};
          for (const e of etapes) parStatut[e.statut] = (parStatut[e.statut] ?? 0) + 1;
          return { ...run, etapes: { total: etapes.length, parStatut } };
        });
    },
    run: async (id: string) => etat().runs.find((r) => r.id === id) ?? null,
    usage: async () => etat().usage,
    lancerRun: async () => ({ id: "commande-maquette", statut: "pending" }),
    ecouter(surEvenement, surConnexion, runId) {
      // Le dernier id déjà livré : comme `Last-Event-ID`, il évite de renvoyer deux fois.
      let dernier = etat().evenements.at(-1)?.id ?? 0;
      surConnexion(true);
      const minuterie = setInterval(() => {
        // Le curseur avance sur TOUS les événements, filtrés ou non : sinon ceux des autres
        // runs seraient réexaminés à chaque tour, indéfiniment.
        for (const e of etat().evenements.filter((x: Evenement) => x.id > dernier)) {
          dernier = e.id;
          if (!runId || e.run === runId) surEvenement(e);
        }
      }, pasMs);
      return () => clearInterval(minuterie);
    },
  };
}
