// La source de la maquette : le scénario, animé par une horloge.
//
// Elle respecte exactement l'interface de la source API. Remplacer l'une par l'autre ne
// touche aucune vue (annexe A).
import type { Evenement } from "../types";
import type { Commande, FiltreRuns, Source } from "../donnees/source";
import { chatMaquette } from "./chat";
import { approbationsMaquette } from "./decisions";
import { equipeMaquette } from "./equipe";
import { livraisonMaquette } from "./livraison";
import { pullRequestsMaquette } from "./pullRequests";
import { catalogueMaquette } from "./modeles";
import { etatA } from "./scenario";

export function sourceMaquette({ t0 = Date.now(), maintenant = () => Date.now(), pasMs = 500 } = {}): Source {
  const etat = () => etatA(t0, maintenant() - t0);
  const chat = chatMaquette(maintenant);
  const approbations = approbationsMaquette();
  const livraison = livraisonMaquette(maintenant);
  const equipe = equipeMaquette(maintenant);
  const prs = pullRequestsMaquette(maintenant);
  const commandes = new Map<string, Commande>();

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
    lancerRun: async (projectId) => {
      const id = `commande-maquette-${commandes.size + 1}`;
      const run = etat().runs.find((r) => r.projet === projectId)?.id || null;
      commandes.set(id, { id, type: "run.start", statut: run ? "done" : "refused", projet: projectId, run,
        resultat: run ? { ok: true } : { ok: false, raison: "La maquette ne contient pas de run pour ce projet." } });
      return { id, statut: "pending" };
    },
    async preparerMission(projectId, pipelineIndex) {
      const projet = etat().topologie.projets.find((p) => p.id === projectId);
      if (!projet) throw new Error("Projet inconnu");
      const membres = (await equipe.lecture()).agents;
      const marketing = /marketing/.test(projet.pipelines[pipelineIndex] ?? "");
      const noms = marketing ? ["economy-analyst", "brand-analyst", "plan-synthesist"] : ["improvement-planner", "improvement-editor", "code-reviewer"];
      return { projectId, pipelineIndex, nom: projet.nom, repo: `maquette/${projectId}`, pipeline: projet.pipelines[pipelineIndex] ?? "dev@1",
        titre: marketing ? "Plan marketing" : "Développement et revue", nature: marketing ? "marketing" : "developpement",
        configuration: "0".repeat(64), spec: { project_name: projectId }, budget: { usdPerRun: 4 }, publication: !marketing,
        roles: noms.map((nom, i) => ({ noeud: `etape-${i}`, agent: `${nom}@1`, type: nom === "code-reviewer" ? "review" : "agent",
          llm: { via: "claude", model: "sonnet" }, membre: null,
          membres: membres.filter((m) => m.registre.includes(nom)).map((m) => ({ id: m.id, nom: m.nom, role: m.role, llm: m.llm })) })) };
    },
    async lancerMission(demande) { return this.lancerRun(demande.projectId, demande.pipelineIndex); },
    commande: async (id) => {
      const commande = commandes.get(id);
      if (!commande) throw new Error("Commande inconnue");
      return commande;
    },
    livraison: livraison.livraison,
    livrer: livraison.livrer,
    pullRequests: prs.pullRequests,
    fusionnerPR: prs.fusionnerPR,
    approbations: approbations.lecture,
    decider: approbations.decider,
    deciderRun: approbations.deciderRun,
    filConseil: approbations.filConseil,
    poserConseil: approbations.poserConseil,
    equipe: equipe.lecture,
    affecter: equipe.affecter,
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
