// Les PR de la maquette : deux PR fusionnées que la livraison de la maquette apporte (mêmes
// SHA que ses commits), une PR ouverte à CI verte qui touche le compose, une autre dont la
// CI tourne encore. Une fusion la retire de la liste au relevé suivant.
import type { DemandeFusion, EtatPullRequests, PullRequestOuverte } from "../donnees/pullRequests";

const sha = (c: string) => c.repeat(40);

export function pullRequestsMaquette(maintenant: () => number) {
  const fusionnees = new Set<number>();
  const etat = (): EtatPullRequests => ({
    releveLe: new Date(maintenant() - 40_000).toISOString(),
    perime: false,
    erreur: null,
    peutFusionner: true,
    recentes: [],
    depots: [
      {
        depot: "Raphaelburnier/business-pipelines",
        parDefaut: "main",
        ouvertes: ([
          {
            numero: 66,
            titre: "feat: mount the marketing repo in the runner",
            url: "https://github.com/Raphaelburnier/business-pipelines/pull/66",
            auteur: "Raphaelburnier",
            branche: "claude/marketing-runner",
            base: "main",
            versDefaut: true,
            sha: sha("e"),
            baseSha: sha("a"),
            brouillon: false,
            fusionnable: true,
            etatFusion: "clean",
            ci: { etat: "verte", details: [{ nom: "test", statut: "completed", conclusion: "success" }] },
            sensibles: ["docker-compose.yaml", "Dockerfile"],
            fichiers: 6,
            pourquoi: "Le marketing n'était pas lançable depuis le cockpit.",
            creeeLe: "2026-10-05T12:00:00Z",
            raison: null,
            fusionEnCours: false,
          },
          {
            numero: 67,
            titre: "feat: nommer chaque livraison",
            url: "https://github.com/Raphaelburnier/business-pipelines/pull/67",
            auteur: "Raphaelburnier",
            branche: "claude/pull-requests",
            base: "main",
            versDefaut: true,
            sha: sha("f"),
            baseSha: sha("a"),
            brouillon: false,
            fusionnable: true,
            etatFusion: "unstable",
            ci: { etat: "en_cours", details: [{ nom: "test", statut: "in_progress", conclusion: null }] },
            sensibles: [],
            fichiers: 4,
            pourquoi: "La carte Livraison ne disait pas ce qu'une livraison apporte.",
            creeeLe: "2026-10-06T08:00:00Z",
            raison: "CI en cours",
            fusionEnCours: false,
          },
        ] satisfies PullRequestOuverte[]).filter((pr) => !fusionnees.has(pr.numero)),
        fusionnees: [
          {
            numero: 39,
            titre: "feat: Livraison card in the cockpit Decisions page",
            url: "https://github.com/Raphaelburnier/business-pipelines/pull/39",
            shas: [sha("8"), sha("7")],
            pourquoi: "Livrer le cockpit sans ouvrir de terminal : un clic dans Décisions, que le livreur exécute sur le NAS.",
            fusionneeLe: "2026-09-29T13:10:00Z",
          },
          {
            numero: 38,
            titre: "fix: the runner only requeues its own commands",
            url: "https://github.com/Raphaelburnier/business-pipelines/pull/38",
            shas: [sha("6")],
            pourquoi: null,
            fusionneeLe: "2026-09-29T11:20:00Z",
          },
        ],
      },
    ],
  });

  return {
    pullRequests: async () => etat(),
    async fusionnerPR(demande: DemandeFusion) {
      const pr = etat().depots[0]?.ouvertes.find((p) => p.numero === demande.numero);
      if (!pr) throw new Error(`PR #${demande.numero} absente du relevé`);
      if (demande.sha !== pr.sha || demande.baseSha !== pr.baseSha) throw new Error("la PR ou sa base a bougé");
      if (pr.raison) throw new Error(`PR non fusionnable : ${pr.raison}`);
      fusionnees.add(pr.numero);
      return { id: "fusion-maquette", statut: "pending" };
    },
  };
}
