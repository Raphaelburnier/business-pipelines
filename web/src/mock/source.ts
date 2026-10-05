// La source de la maquette : le scénario, animé par une horloge.
//
// Elle respecte exactement l'interface de la source API. Remplacer l'une par l'autre ne
// touche aucune vue (annexe A).
import type { Evenement } from "../types";
import type { FiltreRuns, Source } from "../donnees/source";
import { chatMaquette } from "./chat";
import { approbationsMaquette } from "./decisions";
import { livraisonMaquette } from "./livraison";
import { pullRequestsMaquette } from "./pullRequests";
import { catalogueMaquette } from "./modeles";
import { etatA } from "./scenario";

export function sourceMaquette({ t0 = Date.now(), maintenant = () => Date.now(), pasMs = 500 } = {}): Source {
  const etat = () => etatA(t0, maintenant() - t0);
  const chat = chatMaquette(maintenant);
  const approbations = approbationsMaquette();
  const livraison = livraisonMaquette(maintenant);
  const prs = pullRequestsMaquette(maintenant);

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
    run: async (id: string) => {
      const courant = etat();
      const run = courant.runs.find((r) => r.id === id);
      if (!run) return null;
      return {
        ...run,
        etapes: run.etapes.map((etape) => {
          const outils = courant.evenements
            .filter((evenement) => evenement.run === id && evenement.etape === etape.id && Array.isArray(evenement.payload.outils))
            .flatMap((evenement) => evenement.payload.outils as string[]);
          return { ...etape, outils: [...new Set(outils)].sort() };
        }),
      };
    },
    usage: async () => etat().usage,
    modeles: async () => catalogueMaquette(maintenant()),
    fils: chat.fils,
    fil: chat.fil,
    poser: chat.poser,
    ecouterFil(id, surFil, surFin) {
      const minuterie = setInterval(async () => {
        const fil = await chat.fil(id);
        if (!fil) return;
        surFil(fil);
        if (!fil.messages.some((m) => m.role === "assistant" && (m.statut === "queued" || m.statut === "streaming"))) {
          clearInterval(minuterie);
          surFin();
        }
      }, 250);
      return () => clearInterval(minuterie);
    },
    lancerRun: async () => ({ id: "commande-maquette", statut: "pending" }),
    livraison: livraison.livraison,
    livrer: livraison.livrer,
    pullRequests: prs.pullRequests,
    fusionnerPR: prs.fusionnerPR,
    approbations: approbations.lecture,
    decider: approbations.decider,
    deciderRun: approbations.deciderRun,
    filConseil: approbations.filConseil,
    poserConseil: approbations.poserConseil,
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
