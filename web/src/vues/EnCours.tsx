// L'activité du système, dans le tiroir ouvert depuis la barre du haut : ce qui attend ta
// décision, ce qui tourne, ce qui attend une ressource. La coquille lit les données une fois
// (le compteur du bouton et la liste viennent de la même lecture).
//
// Les actions ne proposent que les chemins qui existent côté serveur : ouvrir le run, aller
// décider pour une validation, et arrêter un run par sa route d'annulation. La pause d'un seul
// run et Relancer arriveront avec leurs routes ; un bouton qui ne fait rien apprendrait à se
// méfier des autres. La pause globale des démarrages est sous la liste, dans le même tiroir.
import { useMemo, type MouseEvent, type ReactNode } from "react";
import { EtatErreur, EtatVide, Squelette } from "../composants/Etats";
import { useCharge, useHorloge } from "../donnees/contexte";
import { depuis, usd } from "../format";
import type { Run } from "../types";
import { Etat } from "../ui";
import { ControleRun } from "./ControleExecution";

export type Genre = "wait" | "run" | "pause";

const GENRES: Partial<Record<Run["statut"], Genre>> = {
  waiting_approval: "wait",
  running: "run",
  queued: "run",
  paused: "pause",
  waiting_quota: "pause",
  waiting_auth: "pause",
  waiting_machine: "pause",
  waiting_freshness: "pause",
};

const AUCUN_RUN: ReadonlyArray<Run> = [];

const RANG: Record<Genre, number> = { wait: 0, run: 1, pause: 2 };
const SECTIONS: ReadonlyArray<{ genre: Genre; titre: string }> = [
  { genre: "wait", titre: "À valider" },
  { genre: "run", titre: "En cours" },
  { genre: "pause", titre: "En attente" },
];

// Ce qui bloque un run en attente, dit en clair : la pastille donne l'état, ceci la cause.
function cause(run: Run): string | null {
  if (run.statut === "waiting_quota") return "attend le quota";
  if (run.statut === "waiting_auth") return "connexion requise";
  if (run.statut === "waiting_machine") return "attend une machine";
  if (run.statut === "waiting_freshness") return "base à synchroniser";
  return null;
}

export interface Activite {
  /** Les derniers runs lus, vivants ou non : les décisions y cherchent les runs à valider. */
  runs: ReadonlyArray<Run>;
  lignes: ReadonlyArray<{ run: Run; genre: Genre }>;
  livraison: { etape: string | null } | null;
  /** Runs vivants et livraison en cours : le nombre du bouton « Activité ». */
  total: number;
  aValider: number;
  erreur: string | null;
  detail: string | null;
  chargement: boolean;
  recharger: () => void;
}

export function useActivite(): Activite {
  const runs = useCharge((s) => s.runs({ limite: 30 }), []);
  // Une livraison du cockpit en cours se suit aussi d'ici ; le détail est sur Décisions.
  const { donnees: livraison } = useCharge((s) => s.livraison(), []);
  const enCours = livraison?.enCours ?? null;
  const lignes = useMemo(
    () =>
      (runs.donnees ?? [])
        .flatMap((run) => {
          const genre = GENRES[run.statut];
          return genre ? [{ run, genre }] : [];
        })
        .sort((a, b) => RANG[a.genre] - RANG[b.genre] || Date.parse(b.run.debut ?? "") - Date.parse(a.run.debut ?? "")),
    [runs.donnees]
  );
  return {
    runs: runs.donnees ?? AUCUN_RUN,
    lignes,
    livraison: enCours ? { etape: enCours.etape ?? null } : null,
    total: lignes.length + (enCours ? 1 : 0),
    aValider: lignes.filter((l) => l.genre === "wait").length,
    erreur: runs.erreur,
    detail: runs.detail,
    chargement: runs.chargement,
    recharger: runs.recharger,
  };
}

/** Un lien interne : le clic simple reste dans l'application, le clic molette ouvre un onglet. */
function LienInterne({ href, aller, className, children }: { href: string; aller: (href: string) => void; className: string; children: ReactNode }) {
  const ouvrir = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    aller(href);
  };
  return (
    <a href={href} onClick={ouvrir} className={className}>
      {children}
    </a>
  );
}

function Progression({ faites, total, genre }: { faites: number; total: number; genre: Genre }) {
  if (total <= 0) return null;
  return (
    <div className="ao-etapes" role="img" aria-label={`${faites} étape${faites > 1 ? "s" : ""} faite${faites > 1 ? "s" : ""} sur ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < faites ? "fait" : i === faites && genre !== "pause" ? `maintenant ${genre}` : ""} />
      ))}
    </div>
  );
}

export function ListeActivite({ activite, aller, autoriseArret = false }: {
  activite: Activite;
  aller: (href: string) => void;
  /** Droit d'arrêter un run, lu une fois avec l'état de la file plutôt qu'une fois par run. */
  autoriseArret?: boolean;
}) {
  const maintenant = useHorloge(5000);
  const { lignes, livraison } = activite;

  if (activite.erreur && !lignes.length) {
    return <EtatErreur titre="Activité illisible" message={activite.erreur} detail={activite.detail} onReessayer={activite.recharger} />;
  }
  if (activite.chargement) return <Squelette lignes={4} libelle="Lecture des runs…" />;
  if (!lignes.length && !livraison) {
    return (
      <EtatVide
        icone="activite"
        message="Rien ne tourne en ce moment."
        detail="Les runs lancés depuis Missions ou le Planning apparaissent ici, avec ce qui attend ta décision."
        action={
          <LienInterne href="/missions" aller={aller} className="ao-btn">
            Préparer une mission
          </LienInterne>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {activite.erreur && (
        <p role="alert" className="text-[13px] text-danger">
          Dernière lecture en échec : {activite.erreur}. La liste affichée peut dater.
        </p>
      )}
      {SECTIONS.map(({ genre, titre }) => {
        const section = lignes.filter((l) => l.genre === genre);
        const avecLivraison = genre === "run" && livraison;
        if (!section.length && !avecLivraison) return null;
        return (
          <section key={genre} aria-label={titre} className="flex flex-col gap-2">
            <h3 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-[.04em] text-douce">
              {titre}
              <span className="tabular-nums">{section.length + (avecLivraison ? 1 : 0)}</span>
            </h3>
            <ul className="flex flex-col gap-2">
              {avecLivraison && (
                <li className="ao-activite run">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium text-encre">Livraison du cockpit</span>
                    <span className="text-xs text-douce">{livraison.etape ?? "en file"}</span>
                  </div>
                  <div className="ao-actions">
                    <LienInterne href="/decisions" aller={aller} className="ao-btn">
                      Suivre sur Décisions
                    </LienInterne>
                  </div>
                </li>
              )}
              {section.map(({ run }) => {
                const faites = run.etapes.parStatut.succeeded ?? 0;
                const raison = cause(run);
                return (
                  <li key={run.id} className={`ao-activite ${genre}`}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-encre" title={`${run.projet ?? "sans projet"} · ${run.pipeline}`}>
                        {run.projet ?? "Sans projet"}
                      </span>
                      <Etat etat={run.statut} />
                    </div>
                    <div className="flex flex-wrap gap-x-2 font-mono text-xs text-douce">
                      <span>{run.pipeline}</span>
                      {raison && <span>· {raison}</span>}
                      <span>· {depuis(run.debut, maintenant)}</span>
                      <span title="Sur abonnement, un équivalent API, pas une dépense">· {usd(run.coutEquivalentUsd)}</span>
                    </div>
                    <Progression faites={faites} total={run.etapes.total} genre={genre} />
                    <div className="ao-actions">
                      {genre === "wait" && (
                        <LienInterne href="/decisions" aller={aller} className="ao-btn primaire">
                          Décider
                        </LienInterne>
                      )}
                      <LienInterne href={`/run/${encodeURIComponent(run.id)}`} aller={aller} className="ao-btn">
                        Ouvrir le run
                      </LienInterne>
                      <ControleRun run={run} autorise={autoriseArret} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
