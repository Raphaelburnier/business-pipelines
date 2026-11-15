// Ce qui attend une décision de Raphaël, en une seule liste : le badge « Décisions », la vue
// d'ensemble et la file de la page Décisions en lisent la même longueur, le même nombre partout.
//
// Les approbations de runs arrivent par deux chemins : la boîte (dossiers `source: "run"`,
// déjà comptés dans `decidables` par l'API) et la liste des runs (`waiting_approval`). Un run
// n'est compté qu'une fois : par son dossier s'il en a un, sinon par son statut.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReponseLivraison, Run } from "../types";
import { useCharge, type Chargement } from "./contexte";
import type { DossierApprobation, ReponseApprobations } from "./decisions";
import { intervalleLivraison } from "./livraison";
import { nomCourt, type EtatPullRequests, type PullRequestOuverte } from "./pullRequests";

export type GenreDecision = "run" | "pr" | "livraison" | "plan";

export const NOM_GENRE: Record<GenreDecision, string> = { run: "Run", pr: "PR", livraison: "Livraison", plan: "Plan" };

type SourceDecision = "livraison" | "prs" | "approbations";

/** Ce que la file ouvre pour trancher : le dossier, la PR, la livraison, ou le run lui-même. */
export type ObjetDecision =
  | { type: "dossier"; dossier: DossierApprobation }
  | { type: "run"; run: Run }
  | { type: "pr"; depot: string; pr: PullRequestOuverte }
  | { type: "livraison" };

export interface ElementDecision {
  cle: string;
  genre: GenreDecision;
  titre: string;
  detail: string;
  /** Depuis quand la décision attend : l'ordre dans un même genre, du plus ancien au plus récent. */
  depuis: string | null;
  /** L'élément ouvert dans la file, ou la page du run quand il n'a pas de dossier. */
  href: string;
  /** Le verbe du bouton : « Décider », « Examiner », « Trancher ». */
  action: string;
  objet: ObjetDecision;
}

// Un run bloqué passe avant tout : du travail en cours attend. Puis ce qui change le code
// (PR sensibles, livraison), puis les plans métier.
const RANG: Record<GenreDecision, number> = { run: 0, pr: 1, livraison: 2, plan: 3 };

const MOT_CI: Record<string, string> = { verte: "CI verte", en_cours: "CI en cours", rouge: "CI rouge", absente: "sans CI" };

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? "s" : ""}`;

/** L'adresse qui ouvre un élément de la file. */
export const lienDecision = (cle: string): string => `/decisions?d=${encodeURIComponent(cle)}`;

export function elementsADecider({
  livraison,
  prs,
  approbations,
  runs,
}: {
  livraison: ReponseLivraison | null;
  prs: EtatPullRequests | null;
  approbations: ReponseApprobations | null;
  runs: ReadonlyArray<Run>;
}): ElementDecision[] {
  const elements: ElementDecision[] = [];
  const dossiers = approbations?.etat.dossiers ?? [];
  const runsAvecDossier = new Set(dossiers.filter((d) => d.source === "run" && d.runId).map((d) => d.runId));

  for (const d of dossiers) {
    if (d.tranche) continue;
    if (d.source === "run") {
      const cle = `run:${d.approbationId ?? d.dossier}`;
      elements.push({
        cle,
        genre: "run",
        titre: d.projet ?? d.runId ?? d.dossier,
        detail: `${d.reason === "budget" ? "Rallonge de budget" : d.reason ?? "Approbation demandée"} · étape ${d.nodeId ?? "inconnue"}`,
        depuis: d.depuis,
        href: lienDecision(cle),
        action: "Décider",
        objet: { type: "dossier", dossier: d },
      });
      // Une consigne renvoyée attend le pipeline, pas Raphaël ; un plan introuvable ne se tranche pas.
    } else if (!d.plan_absent && !d.reponse_posee) {
      const restantes = d.actions.filter((a) => a.decision === null).length;
      const cle = `plan:${d.dossier}`;
      elements.push({
        cle,
        genre: "plan",
        titre: d.dossier,
        detail: `${pluriel(restantes, "action")} à trancher${d.fraicheur.verdict === "perime" ? " · données périmées" : ""}`,
        depuis: d.depuis,
        href: lienDecision(cle),
        action: "Trancher",
        objet: { type: "dossier", dossier: d },
      });
    }
  }

  for (const run of runs) {
    if (run.statut !== "waiting_approval" || runsAvecDossier.has(run.id)) continue;
    elements.push({
      cle: `run:${run.id}`,
      genre: "run",
      titre: run.projet ?? run.pipeline,
      detail: `${run.pipeline} · une étape attend ta validation`,
      depuis: run.debut,
      // Sans dossier, la validation se fait sur la page du run, à l'étape qui l'attend.
      href: `/run/${encodeURIComponent(run.id)}`,
      action: "Décider",
      objet: { type: "run", run },
    });
  }

  if (prs?.peutFusionner && !prs.erreur && !prs.perime) {
    for (const depot of prs.depots) {
      for (const pr of depot.ouvertes) {
        // Une PR sans fichier sensible fusionne seule après sa CI et sa revue : elle n'attend personne.
        // Une raison de ne pas fusionner (CI, conflit, conversation) attend l'agent, pas Raphaël.
        if (!pr.sensibles.length || pr.raison || pr.fusionEnCours) continue;
        const cle = `pr:${depot.depot}#${pr.numero}`;
        elements.push({
          cle,
          genre: "pr",
          titre: nomCourt(depot.depot, pr.numero),
          detail: `${pr.pourquoi ?? pr.titre} · ${MOT_CI[pr.ci.etat] ?? pr.ci.etat} · ${pluriel(pr.sensibles.length, "fichier")} sensible${pr.sensibles.length > 1 ? "s" : ""}`,
          depuis: pr.creeeLe,
          href: lienDecision(cle),
          action: "Examiner",
          objet: { type: "pr", depot: depot.depot, pr },
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
      href: lienDecision("livraison"),
      action: "Examiner",
      objet: { type: "livraison" },
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
  livraison: Chargement<ReponseLivraison>;
  prs: Chargement<EtatPullRequests>;
  approbations: Chargement<ReponseApprobations>;
  /** Relire une source après une action, sans effacer ce qui est affiché. */
  relire: (quoi: SourceDecision) => void;
  /** Une décision vient de partir : l'élément quitte la file tout de suite, puis la source est relue. */
  retirer: (cle: string, quoi: SourceDecision) => void;
  /** Une livraison vient d'être demandée : suivre de près jusqu'à son issue, redémarrage compris. */
  attendreLivraison: (commande: string) => void;
  livraisonAttendue: string | null;
}

// Le relevé des PR et la proposition de livraison sont des fichiers, pas des événements SSE :
// sans relecture régulière, le badge ignorerait une PR ou une version prête.
const RELECTURE_PR_MS = 30_000;

/** Les quatre sources de décisions ; `runs` vient de l'activité, déjà lue par la coquille. */
export function useADecider(runs: ReadonlyArray<Run>): ADecider {
  const [tics, setTics] = useState({ livraison: 0, prs: 0, approbations: 0 });
  const [attendue, setAttendue] = useState<string | null>(null);
  const livraison = useCharge((s) => s.livraison(), [tics.livraison]);
  const prs = useCharge((s) => s.pullRequests(), [tics.prs]);
  const approbations = useCharge((s) => s.approbations(), [tics.approbations]);

  const relire = useCallback((quoi: SourceDecision) => setTics((t) => ({ ...t, [quoi]: t[quoi] + 1 })), []);

  // Retiré jusqu'à la prochaine réponse de sa source : si elle le montre encore, il revient.
  const [retires, setRetires] = useState<ReadonlyMap<string, SourceDecision>>(new Map());
  const retirer = useCallback(
    (cle: string, quoi: SourceDecision) => {
      setRetires((r) => new Map(r).set(cle, quoi));
      relire(quoi);
    },
    [relire]
  );
  const oublier = (quoi: SourceDecision) => setRetires((r) => ([...r.values()].includes(quoi) ? new Map([...r].filter(([, q]) => q !== quoi)) : r));
  useEffect(() => oublier("livraison"), [livraison.donnees]);
  useEffect(() => oublier("prs"), [prs.donnees]);
  useEffect(() => oublier("approbations"), [approbations.donnees]);

  // Pendant une livraison, le cockpit redémarre : l'API se tait quelques dizaines de secondes.
  // La relecture accélère jusqu'à ce que l'issue apparaisse dans l'historique.
  const enCours = livraison.donnees?.enCours ?? null;
  const suivre = Boolean(enCours || attendue || livraison.erreur);
  useEffect(() => {
    const t = setInterval(() => relire("livraison"), intervalleLivraison(suivre));
    return () => clearInterval(t);
  }, [suivre, relire]);
  useEffect(() => {
    const t = setInterval(() => relire("prs"), RELECTURE_PR_MS);
    return () => clearInterval(t);
  }, [relire]);
  const derniere = livraison.donnees?.historique[0]?.id ?? null;
  useEffect(() => {
    if (attendue && derniere === attendue && !enCours) setAttendue(null);
  }, [attendue, derniere, enCours]);

  const elements = useMemo(
    () => elementsADecider({ livraison: livraison.donnees, prs: prs.donnees, approbations: approbations.donnees, runs }).filter((e) => !retires.has(e.cle)),
    [livraison.donnees, prs.donnees, approbations.donnees, runs, retires]
  );
  const erreurs = [livraison.erreur && "livraison", prs.erreur && "pull requests", approbations.erreur && "approbations"].filter((e): e is string => Boolean(e));
  const { recharger: rechargerLivraison } = livraison;
  const { recharger: rechargerPrs } = prs;
  const { recharger: rechargerApprobations } = approbations;
  const recharger = useCallback(() => {
    rechargerLivraison();
    rechargerPrs();
    rechargerApprobations();
  }, [rechargerLivraison, rechargerPrs, rechargerApprobations]);

  return {
    elements,
    chargement: livraison.chargement || prs.chargement || approbations.chargement,
    erreurs,
    recharger,
    livraison,
    prs,
    approbations,
    relire,
    retirer,
    attendreLivraison: setAttendue,
    livraisonAttendue: attendue,
  };
}
