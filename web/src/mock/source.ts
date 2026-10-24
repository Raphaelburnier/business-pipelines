// La source de la maquette : le scénario, animé par une horloge.
//
// Elle respecte exactement l'interface de la source API. Remplacer l'une par l'autre ne
// touche aucune vue (annexe A).
import type { Evenement } from "../types";
import type { AttributionAvenir, Commande, FiltreRuns, Source } from "../donnees/source";
import { chatMaquette } from "./chat";
import { discussionsMaquette } from "./discussions";
import { approbationsMaquette } from "./decisions";
import { equipeMaquette } from "./equipe";
import { livraisonMaquette } from "./livraison";
import { pullRequestsMaquette } from "./pullRequests";
import { catalogueMaquette } from "./modeles";
import { etatA } from "./scenario";
import { idPipeline, type PipelineConnu, type Rattachement } from "../donnees/pipelines";

const REGISTRE: Record<string, { titre: string | null; versions: number[] }> = {
  marketing: { titre: "Plan marketing à deux voix", versions: [1] },
  "saas-build": { titre: "Construire un SaaS", versions: [2, 3] },
  sauvegarde: { titre: "Sauvegarde du NAS", versions: [1] },
};

export function sourceMaquette({ t0 = Date.now(), maintenant = () => Date.now(), pasMs = 500 } = {}): Source {
  const etat = () => etatA(t0, maintenant() - t0);
  const chat = chatMaquette(maintenant);
  const approbations = approbationsMaquette();
  const livraison = livraisonMaquette(maintenant);
  const equipe = equipeMaquette(maintenant);
  const prs = pullRequestsMaquette(maintenant);
  const commandes = new Map<string, Commande>();
  const attributions: AttributionAvenir[] = [];
  const nomsPipelines = new Map<string, string>();
  const rattachements: Rattachement[] = [];

  return {
    ...discussionsMaquette(),
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
    attributionsAvenir: async () => [...attributions],
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
    async natures() {
      const projets = etat().topologie.projets.filter((p) => p.pipelines.length);
      const de = (motif: RegExp) => projets.filter((p) => p.pipelines.some((r) => motif.test(r))).map((p) => ({ id: p.id, nom: p.nom }));
      return { natures: [
        { id: "finance", libelle: "Finance", description: "Recherche financière privée, rapport validé, sans publication.", tags: ["finance"], handlers: [], priorite: 10,
          regles: "dediees" as const, pipelines: ["finance-research@2"], projets: de(/finance/), discussion: null },
        { id: "developpement", libelle: "Développement", description: "Changement de code jusqu'à la PR, tests et revue indépendante.", tags: ["code"], handlers: ["verify-project"], priorite: 20,
          regles: "dediees" as const, pipelines: ["improve-app@7"], projets: de(/^(?!.*(marketing|finance))/), discussion: null },
        { id: "marketing", libelle: "Marketing", description: "Analyses de marque et de marché, synthèse puis décision.", tags: ["marketing"], handlers: [], priorite: 30,
          regles: "dediees" as const, pipelines: ["marketing@1"], projets: de(/marketing/),
          discussion: { gabarit: "marketing-dialogue@1", competences: ["brand-analyst", "economy-analyst", "plan-synthesist"], versNature: "developpement" } },
      ] };
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
    // La maquette reprend la préparation d'équipe : premier membre de chaque rôle, aucune raison réelle.
    async proposerPlan(spec) {
      const o = await this.preparerMission(spec.projectId, 0);
      const realise = o.roles.filter((r) => r.type === "agent").map((r) => r.noeud);
      const juge = o.roles.filter((r) => r.type === "review").map((r) => r.noeud);
      return { statut: "lancable", blocages: [], empreinte: "0".repeat(64), projet: { id: o.projectId, nom: o.nom },
        plan: { version: 1, nature: o.nature === "marketing" ? "marketing" : "developpement",
          pipeline: { ref: o.pipeline.includes("@") ? o.pipeline : `${o.pipeline}@1`, index: 0, titre: o.titre, raison: "Maquette : premier pipeline du projet." },
          etapes: o.roles.map((r) => { const m = r.membres[0]; return { noeud: r.noeud, type: r.type, role: r.type === "review" ? "revue" as const : "production" as const,
            agent: r.agent, membre: m?.id ?? null, nom: m?.nom ?? r.agent, llm: m?.llm ?? r.llm, machine: "pc", maxTurns: null, raisons: ["Maquette."] }; }),
          criteres: spec.criteres.map((texte) => ({ texte, realisePar: realise, jugePar: juge })),
          independance: [], limites: { maxTurnsPerAgent: null, maxTotalTurns: null, usdPerRun: 4, usdPerMonth: null, corrections: [] },
          resultat: { type: "livrables", depot: null, description: "Maquette : aucun run réel." }, degrade: false, avertissements: [] } };
    },
    async lancerPlan(demande) {
      const commande = await this.lancerRun(demande.spec.projectId, 0);
      const ref = demande.spec.contexte?._roadmapObjective;
      if (ref && typeof ref === "object" && "id" in ref && "revision" in ref) {
        const projet = etat().topologie.projets.find((p) => p.id === demande.spec.projectId);
        const runtime = demande.spec.runtimesExclus?.includes("claude") ? "codex" : "claude";
        attributions.unshift({ objectif: { id: String(ref.id), revision: Number(ref.revision) }, commandeId: commande.id,
          runId: commandes.get(commande.id)?.run ?? null, projetId: demande.spec.projectId,
          agent: { id: null, nom: runtime === "codex" ? "Codex (maquette)" : "Claude (maquette)", llm: { via: runtime, model: runtime === "codex" ? "gpt-5.6-terra" : "sonnet" } },
          statut: "queued", priorite: demande.scheduling?.priority ?? "normale", positionFile: null, reclassable: true,
          attente: null, creeLe: new Date(maintenant()).toISOString(), raison: null, livraison: null });
      }
      return commande;
    },
    async reclasserObjectif(objectifId, priorite) {
      const attribution = attributions.find((a) => a.objectif.id === objectifId);
      if (!attribution?.reclassable) throw new Error("Cette tâche n'est plus reclassable.");
      attribution.priorite = priorite;
    },
    async reprendreRun() { throw new Error("La reprise des runtimes nécessite les données réelles du cockpit."); },
    commande: async (id) => {
      const commande = commandes.get(id);
      if (!commande) throw new Error("Commande inconnue");
      return commande;
    },
    livraison: livraison.livraison,
    livrer: livraison.livrer,
    pullRequests: prs.pullRequests,
    fusionnerPR: prs.fusionnerPR,
    relancerCIPR: prs.relancerCIPR,
    approbations: approbations.lecture,
    decider: approbations.decider,
    deciderRun: approbations.deciderRun,
    filConseil: approbations.filConseil,
    poserConseil: approbations.poserConseil,
    equipe: equipe.lecture,
    affecter: equipe.affecter,
    profil: equipe.profil,
    async pipelines() {
      const parId = new Map<string, PipelineConnu>();
      for (const [id, registre] of Object.entries(REGISTRE)) {
        parId.set(id, { id, nom: null, perso: false, titreRegistre: registre.titre, versions: [...registre.versions], projets: [], runs: 0, dernierRun: null });
      }
      for (const r of etat().runs) {
        const id = idPipeline(r.pipeline);
        const p = parId.get(id) ?? { id, nom: null, perso: false, titreRegistre: null, versions: [], projets: [], runs: 0, dernierRun: null };
        if (r.projet && !p.projets.includes(r.projet)) p.projets.push(r.projet);
        p.runs += 1;
        if (r.debut && (!p.dernierRun || r.debut > p.dernierRun)) p.dernierRun = r.debut;
        parId.set(id, p);
      }
      return {
        projets: etat().topologie.projets.filter((p) => p.aFiche).map((p) => ({ id: p.id, nom: p.nom })),
        peutRattacher: true,
        rattachements: [...rattachements].reverse(),
        pipelines: [...parId.values()].map((p) => ({ ...p, nom: nomsPipelines.get(p.id) ?? p.titreRegistre, perso: nomsPipelines.has(p.id), versions: p.versions.sort((a, b) => a - b) })),
      };
    },
    async rattacherPipeline(pipeline, projet) {
      const id = `rattachement-${rattachements.length + 1}`;
      const ref = pipeline.includes("@") ? pipeline : `${pipeline}@1`;
      // La maquette joue le publieur : la PR « s'ouvre » une seconde plus tard.
      rattachements.push({ id, projet, pipeline: ref, statut: "pending", ok: null, raison: null, pr: null, par: "maquette", le: new Date(maintenant()).toISOString() });
      setTimeout(() => {
        const r = rattachements.find((x) => x.id === id);
        if (r) Object.assign(r, { statut: "done", ok: true, pr: { numero: 107 + rattachements.indexOf(r), url: "https://github.com/" } });
      }, 1000);
      return { id, statut: "pending" };
    },
    async renommerPipeline(pipeline, nom) {
      const id = idPipeline(pipeline);
      if (nom === null) nomsPipelines.delete(id);
      else nomsPipelines.set(id, nom.trim());
    },
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
