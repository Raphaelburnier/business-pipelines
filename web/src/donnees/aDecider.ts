// Ce qui attend une décision de Raphaël, en une seule liste : le badge « Décisions » et la
// vue d'ensemble en lisent la même longueur, le même nombre partout.
//
// Les approbations de runs arrivent par deux chemins : la boîte (dossiers `source: "run"`,
// déjà comptés dans `decidables` par l'API) et la liste des runs (`waiting_approval`). Un run
// n'est compté qu'une fois : par son dossier s'il en a un, sinon par son statut.
import { useMemo } from "react";
import type { ReponseLivraison, Run } from "../types";
import { useCharge } from "./contexte";
import { attente, type ReponseApprobations } from "./decisions";
import { nomCourt, type EtatPullRequests } from "./pullRequests";

export type GenreDecision = "run" | "pr" | "livraison" | "plan";

export interface ElementDecision {
  cle: string;
  genre: GenreDecision;
  titre: string;
  detail: string;
  /** Depuis quand la décision attend : l'ordre dans un même genre, du plus ancien au plus récent. */
  depuis: string | null;
  href: string;
  /** Le verbe du bouton : « Décider », « Examiner », « Trancher ». */
  action: string;
}

// Un run bloqué passe avant tout : du travail en cours attend. Puis ce qui change le code
// (PR sensibles, livraison), puis les plans métier.
const RANG: Record<GenreDecision, number> = { run: 0, pr: 1, livraison: 2, plan: 3 };

const MOT_CI: Record<string, string> = { verte: "CI verte", en_cours: "CI en cours", rouge: "CI rouge", absente: "sans CI" };

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function elementsADecider({
  livraison,
  prs,
  approbations,
  runs,
  maintenant = Date.now(),
}: {
  livraison: ReponseLivraison | null;
  prs: EtatPullRequests | null;
  approbations: ReponseApprobations | null;
  runs: ReadonlyArray<Run>;
  maintenant?: number;
}): ElementDecision[] {
  const elements: ElementDecision[] = [];
  const dossiers = approbations?.etat.dossiers ?? [];
  const runsAvecDossier = new Set(dossiers.filter((d) => d.source === "run" && d.runId).map((d) => d.runId));

  for (const d of dossiers) {
    if (d.tranche) continue;
    if (d.source === "run") {
      elements.push({
        cle: `run:${d.approbationId ?? d.dossier}`,
        genre: "run",
        titre: d.projet ?? d.runId ?? d.dossier,
        detail: `${d.reason ?? "Approbation demandée"} · depuis ${attente(d.depuis, maintenant)}`,
        depuis: d.depuis,
        href: "/decisions",
        action: "Décider",
      });
    } else if (!d.plan_absent) {
      const restantes = d.actions.filter((a) => a.decision === null).length;
      elements.push({
        cle: `plan:${d.dossier}`,
        genre: "plan",
        titre: d.dossier,
        detail: `${pluriel(restantes, "action")} à trancher · depuis ${attente(d.depuis, maintenant)}`,
        depuis: d.depuis,
        href: "/decisions",
        action: "Trancher",
      });
    }
  }

  for (const run of runs) {
    if (run.statut !== "waiting_approval" || runsAvecDossier.has(run.id)) continue;
    elements.push({
      cle: `run:${run.id}`,
      genre: "run",
      titre: run.projet ?? run.pipeline,
      detail: `${run.pipeline} · attend ta décision`,
      depuis: run.debut,
      href: "/decisions",
      action: "Décider",
    });
  }

  if (prs?.peutFusionner && !prs.erreur) {
    for (const depot of prs.depots) {
      for (const pr of depot.ouvertes) {
        // Une PR sans fichier sensible fusionne seule après sa CI et sa revue : elle n'attend personne.
        if (!pr.sensibles.length || pr.raison || pr.fusionEnCours) continue;
        elements.push({
          cle: `pr:${depot.depot}#${pr.numero}`,
          genre: "pr",
          titre: nomCourt(depot.depot, pr.numero),
          detail: `${pr.titre} · ${MOT_CI[pr.ci.etat] ?? pr.ci.etat} · ${pluriel(pr.sensibles.length, "fichier")} sensible${pr.sensibles.length > 1 ? "s" : ""}`,
          depuis: pr.creeeLe,
          href: "/decisions",
          action: "Examiner",
        });
      }
    }
  }

  const proposition = livraison?.proposition;
  if (proposition?.disponible && !livraison?.enCours) {
    const commits = proposition.commits.cockpit.length + proposition.commits.moteur.length + proposition.commits.registre.length;
    elements.push({
      cle: "livraison",
      genre: "livraison",
      titre: "Livraison du cockpit",
      detail: commits ? `${pluriel(commits, "commit")} prêt${commits > 1 ? "s" : ""} à livrer` : "Une version est prête à livrer",
      depuis: proposition.calculeeLe,
      href: "/decisions",
      action: "Examiner",
    });
  }

  const date = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
  return elements.sort((a, b) => RANG[a.genre] - RANG[b.genre] || (date(a.depuis) || Infinity) - (date(b.depuis) || Infinity));
}

export interface ADecider {
  elements: ElementDecision[];
  /** Une source n'a pas encore répondu : la liste peut s'allonger. */
  chargement: boolean;
  /** Les sources illisibles, nommées : la liste est alors incomplète. */
  erreurs: string[];
  recharger: () => void;
}

/** Les quatre sources de décisions ; `runs` vient de l'activité, déjà lue par la coquille. */
export function useADecider(runs: ReadonlyArray<Run>): ADecider {
  const livraison = useCharge((s) => s.livraison(), []);
  const prs = useCharge((s) => s.pullRequests(), []);
  const approbations = useCharge((s) => s.approbations(), []);
  const elements = useMemo(
    () => elementsADecider({ livraison: livraison.donnees, prs: prs.donnees, approbations: approbations.donnees, runs }),
    [livraison.donnees, prs.donnees, approbations.donnees, runs]
  );
  const erreurs = [livraison.erreur && "livraison", prs.erreur && "pull requests", approbations.erreur && "approbations"].filter((e): e is string => Boolean(e));
  return {
    elements,
    chargement: livraison.chargement || prs.chargement || approbations.chargement,
    erreurs,
    recharger: () => {
      livraison.recharger();
      prs.recharger();
      approbations.recharger();
    },
  };
}
