// La liste des runs : un tableau trié (les actifs d'abord), filtrable par statut, projet et
// texte. Les filtres vivent dans l'adresse (/run?statut=echecs&projet=…&q=…) : le retour
// depuis un run les retrouve, et l'accueil peut y mener déjà filtré.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bouton } from "../composants/Bouton";
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { Tableau, type Colonne } from "../composants/Tableau";
import { suivreLien } from "../coquille/Navigation";
import { useCharge, useHorloge } from "../donnees/contexte";
import { trierRuns } from "../donnees/pipelineGraphe";
import { idPipeline, nomPipeline, versionPipeline, type PipelineConnu } from "../donnees/pipelines";
import { VIDE, depuis, duree, usd } from "../format";
import type { Run, StatutRun } from "../types";
import { Etat } from "../ui";

/** Le nombre de runs lus : la même borne que l'activité du Planning. */
export const RUNS_LUS = 100;

export type GroupeStatut = "tous" | "en-cours" | "en-attente" | "echecs" | "termines";

export const GROUPES: ReadonlyArray<{ cle: GroupeStatut; libelle: string; statuts: ReadonlyArray<StatutRun> | null }> = [
  { cle: "tous", libelle: "Tous", statuts: null },
  { cle: "en-cours", libelle: "En cours", statuts: ["queued", "running"] },
  { cle: "en-attente", libelle: "En attente", statuts: ["paused", "waiting_approval", "waiting_quota", "waiting_auth", "waiting_machine", "waiting_freshness"] },
  { cle: "echecs", libelle: "Échoués", statuts: ["failed"] },
  { cle: "termines", libelle: "Terminés", statuts: ["succeeded", "cancelled"] },
];

export interface FiltreRuns {
  statut: GroupeStatut;
  projet: string;
  texte: string;
}

const SANS_PROJET = "-";
const FILTRE_VIDE: FiltreRuns = { statut: "tous", projet: "", texte: "" };

export function lireFiltre(recherche: string): FiltreRuns {
  const p = new URLSearchParams(recherche);
  const statut = p.get("statut");
  return {
    statut: GROUPES.some((g) => g.cle === statut) ? (statut as GroupeStatut) : "tous",
    projet: p.get("projet") ?? "",
    texte: p.get("q") ?? "",
  };
}

export function adresseFiltre(filtre: FiltreRuns): string {
  const p = new URLSearchParams();
  if (filtre.statut !== "tous") p.set("statut", filtre.statut);
  if (filtre.projet) p.set("projet", filtre.projet);
  if (filtre.texte.trim()) p.set("q", filtre.texte.trim());
  const suite = p.toString();
  return suite ? `/run?${suite}` : "/run";
}

export function dansGroupe(run: Pick<Run, "statut">, groupe: GroupeStatut): boolean {
  const statuts = GROUPES.find((g) => g.cle === groupe)?.statuts;
  return !statuts || statuts.includes(run.statut);
}

export function filtrerRuns<R extends Pick<Run, "id" | "statut" | "projet" | "pipeline">>(runs: ReadonlyArray<R>, filtre: FiltreRuns, nom: (pipeline: string) => string = (p) => p): R[] {
  const texte = filtre.texte.trim().toLocaleLowerCase("fr");
  return runs.filter(
    (r) =>
      dansGroupe(r, filtre.statut) &&
      (!filtre.projet || (filtre.projet === SANS_PROJET ? !r.projet : r.projet === filtre.projet)) &&
      (!texte || [r.id, r.pipeline, nom(r.pipeline), r.projet ?? ""].some((champ) => champ.toLocaleLowerCase("fr").includes(texte)))
  );
}

const dureeRun = (r: Run, maintenant: number): number | null => (r.debut ? (r.fin ? Date.parse(r.fin) : maintenant) - Date.parse(r.debut) : null);
const lienRun = (id: string) => `/run/${encodeURIComponent(id)}`;
const dateLongue = (iso: string) => new Date(iso).toLocaleString("fr-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" });

export function ListeRuns({ aller }: { aller: (href: string) => void }) {
  const { donnees: runs, erreur, detail, recharger } = useCharge((s) => s.runs({ limite: RUNS_LUS }), []);
  const { donnees: catalogue } = useCharge((s) => s.pipelines(), []);
  const maintenant = useHorloge(30_000);
  const [filtre, setFiltre] = useState<FiltreRuns>(() => lireFiltre(window.location.search));

  // Les filtres suivent l'adresse sans créer d'entrée d'historique à chaque frappe.
  const ecrite = useRef(adresseFiltre(filtre));
  useEffect(() => {
    const cible = adresseFiltre(filtre);
    ecrite.current = cible;
    if (cible !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, "", cible);
  }, [filtre]);

  // Et l'adresse suit les filtres dans l'autre sens : un clic sur « Runs » ou le bouton retour
  // change l'adresse sans remonter la liste. Une adresse que nous n'avons pas écrite est reprise.
  useEffect(() => {
    const lue = window.location.pathname + window.location.search;
    if (lue !== ecrite.current) {
      ecrite.current = lue;
      setFiltre(lireFiltre(window.location.search));
    }
  });

  const connus = useMemo(() => new Map<string, PipelineConnu>((catalogue?.pipelines ?? []).map((p) => [p.id, p])), [catalogue]);
  const nom = (pipeline: string) => nomPipeline(pipeline, connus);
  const tries = useMemo(() => trierRuns(runs ?? []), [runs]);
  const projets = useMemo(() => [...new Set(tries.map((r) => r.projet).filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b, "fr")), [tries]);
  const sansProjet = tries.some((r) => !r.projet);
  // Les compteurs des puces suivent le projet et le texte choisis, pas le statut lui-même.
  const horsStatut = filtrerRuns(tries, { ...filtre, statut: "tous" }, nom);
  const visibles = horsStatut.filter((r) => dansGroupe(r, filtre.statut));
  const filtreActif = filtre.statut !== "tous" || filtre.projet !== "" || filtre.texte.trim() !== "";

  const colonnes: ReadonlyArray<Colonne<Run>> = [
    {
      cle: "statut",
      titre: "Statut",
      rendu: (r) => <Etat etat={r.statut} />,
      tri: (a, b) => GROUPES.findIndex((g) => dansGroupe(a, g.cle) && g.cle !== "tous") - GROUPES.findIndex((g) => dansGroupe(b, g.cle) && g.cle !== "tous"),
    },
    {
      cle: "pipeline",
      titre: "Pipeline",
      rendu: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <a href={lienRun(r.id)} onClick={suivreLien(aller, lienRun(r.id))} className="font-medium text-encre hover:text-accent hover:underline">
            {nom(r.pipeline)}
          </a>
          <span className="font-mono text-[11.5px] text-douce">
            {idPipeline(r.pipeline)} {versionPipeline(r.pipeline)}
          </span>
        </div>
      ),
      tri: (a, b) => nom(a.pipeline).localeCompare(nom(b.pipeline), "fr"),
    },
    {
      cle: "projet",
      titre: "Projet",
      rendu: (r) => (r.projet ? r.projet : <span className="text-douce">sans projet</span>),
      tri: (a, b) => (a.projet ?? "").localeCompare(b.projet ?? "", "fr"),
    },
    {
      cle: "debut",
      titre: "Démarré",
      rendu: (r) =>
        r.debut ? (
          <span title={dateLongue(r.debut)} className="whitespace-nowrap">
            il y a {depuis(r.debut, maintenant)}
          </span>
        ) : (
          <span className="text-douce">pas démarré</span>
        ),
      tri: (a, b) => (a.debut ?? "").localeCompare(b.debut ?? ""),
    },
    {
      cle: "duree",
      titre: "Durée",
      alignement: "droite",
      rendu: (r) => {
        const ms = dureeRun(r, maintenant);
        return ms === null ? VIDE : duree(ms);
      },
      tri: (a, b) => (dureeRun(a, maintenant) ?? -1) - (dureeRun(b, maintenant) ?? -1),
    },
    {
      cle: "etapes",
      titre: "Étapes",
      alignement: "droite",
      rendu: (r) => {
        const faites = r.etapes.parStatut.succeeded ?? 0;
        const echouees = r.etapes.parStatut.failed ?? 0;
        return (
          <span className="whitespace-nowrap">
            {faites}/{r.etapes.total}
            {echouees > 0 && <span className="text-danger"> · {echouees} en échec</span>}
          </span>
        );
      },
    },
    {
      cle: "cout",
      titre: "Coût éq.",
      alignement: "droite",
      rendu: (r) => <span title="Sur abonnement, un équivalent API, pas une dépense">{usd(r.coutEquivalentUsd)}</span>,
      tri: (a, b) => a.coutEquivalentUsd - b.coutEquivalentUsd,
    },
  ];

  if (erreur && !runs) return <EtatErreur titre="Lecture des runs impossible" message={erreur} detail={detail} onReessayer={recharger} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3" role="search" aria-label="Filtrer les runs">
        <div role="group" aria-label="Statut" className="flex flex-wrap gap-1.5">
          {GROUPES.map((g) => {
            const n = horsStatut.filter((r) => dansGroupe(r, g.cle)).length;
            const choisi = filtre.statut === g.cle;
            return (
              <button key={g.cle} type="button" aria-pressed={choisi} onClick={() => setFiltre({ ...filtre, statut: g.cle })} className={`ao-puce ao-puce-filtre ${choisi ? "on" : ""}`}>
                {g.libelle}
                <span className="tabular-nums">{runs ? n : ""}</span>
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-douce">
          Projet
          <select className="ao-champ" value={filtre.projet} onChange={(e) => setFiltre({ ...filtre, projet: e.target.value })}>
            <option value="">Tous les projets</option>
            {projets.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            {sansProjet && <option value={SANS_PROJET}>Sans projet</option>}
          </select>
        </label>
        <label className="flex min-w-[200px] flex-1 items-center gap-2 text-[13px] text-douce sm:max-w-xs">
          <span className="sr-only">Rechercher un run</span>
          <input
            type="search"
            className="ao-champ w-full"
            placeholder="Pipeline, projet ou identifiant…"
            value={filtre.texte}
            onChange={(e) => setFiltre({ ...filtre, texte: e.target.value })}
          />
        </label>
      </div>

      {erreur && <EtatErreur titre="Relecture des runs impossible" message={`${erreur} La liste affichée date de la dernière lecture réussie.`} detail={detail} onReessayer={recharger} />}

      {!runs ? (
        <div className="rounded-xl border border-trait bg-surface p-4">
          <Squelette lignes={6} libelle="Chargement des runs…" />
        </div>
      ) : !tries.length ? (
        <EtatVide
          icone="run"
          message="Aucun run enregistré"
          detail="Un run démarre quand tu lances une mission ou qu'un départ planifié arrive à son heure."
          action={
            <Bouton variante="primaire" onClick={() => aller("/missions")}>
              Lancer une mission
            </Bouton>
          }
        />
      ) : (
        <Tableau
          libelle="Runs"
          colonnes={colonnes}
          lignes={visibles}
          cleLigne={(r) => r.id}
          onLigne={(r) => aller(lienRun(r.id))}
          vide={
            <EtatVide
              message="Aucun run ne correspond à ces filtres"
              action={
                filtreActif ? (
                  <Bouton taille="petit" onClick={() => setFiltre(FILTRE_VIDE)}>
                    Effacer les filtres
                  </Bouton>
                ) : undefined
              }
            />
          }
        />
      )}
      {runs && tries.length > 0 && (
        <p className="text-[12.5px] text-douce">
          {tries.length >= RUNS_LUS ? `Les ${RUNS_LUS} runs les plus récents` : `${tries.length} run${tries.length > 1 ? "s" : ""}`}, les actifs et ceux qui attendent d'abord. Un clic sur une ligne ouvre son graphe et son détail.
        </p>
      )}
    </div>
  );
}
