// La santé du système en une pastille : le pire de ce qui suit (flux d'événements, machines,
// quota, file d'exécution). Le détail s'ouvre au clic, sans quitter la page.
import { useEffect, useId, useRef, useState } from "react";
import { Statut } from "../composants/Statut";
import { mot, ton, type Ton } from "../format";
import { Icone } from "../icones";
import type { Machine, Usage } from "../types";
import { Jauge } from "../ui";
import type { ControleFile } from "../vues/ControleExecution";

export type Niveau = "ok" | "alerte" | "danger" | "inconnu";

export interface LigneSante {
  cle: string;
  libelle: string;
  ton: Ton;
  mot: string;
  detail?: string;
  /** Une jauge à la place du mot, pour un quota. */
  jauge?: number | null;
}

export interface EvaluationSante {
  niveau: Niveau;
  /** Ce qui compte dans le niveau : les lignes en alerte ou en danger. */
  problemes: number;
  lignes: LigneSante[];
}

const majuscule = (texte: string): string => texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);

function age(secondes: number | null): string | undefined {
  if (secondes === null) return undefined;
  if (secondes < 60) return `signal il y a ${secondes} s`;
  if (secondes < 3600) return `signal il y a ${Math.round(secondes / 60)} min`;
  return `signal il y a ${Math.round(secondes / 3600)} h`;
}

const SEUIL_QUOTA = 90;

/** Le niveau global et ses lignes. `machines` null : la topologie n'a pas encore répondu. */
export function evaluerSante({ machines, connecte, usage, file }: { machines: ReadonlyArray<Machine> | null; connecte: boolean; usage: Usage | null; file: Pick<ControleFile, "etat" | "erreur"> | null }): EvaluationSante {
  const lignes: LigneSante[] = [];
  lignes.push(
    connecte
      ? { cle: "flux", libelle: "Flux d'événements", ton: "ok", mot: "En direct" }
      : { cle: "flux", libelle: "Flux d'événements", ton: "danger", mot: "Coupé", detail: "Les données affichées ne se mettent plus à jour." }
  );
  for (const m of machines ?? []) {
    lignes.push({ cle: `machine:${m.machine}`, libelle: m.nom ?? m.machine, ton: ton(m.etat), mot: majuscule(mot(m.etat)), detail: age(m.depuisSecondes) });
  }
  const quota = usage?.quota ?? null;
  if (quota) {
    const bas = quota.statut === "bas";
    for (const [cle, libelle, fenetre] of [["5h", "Quota 5 h", quota.cinqHeures], ["7j", "Quota 7 jours", quota.septJours]] as const) {
      const valeur = fenetre?.utilisation ?? null;
      const tendu = valeur !== null && valeur >= SEUIL_QUOTA;
      lignes.push({ cle: `quota:${cle}`, libelle, ton: tendu || (bas && cle === "5h") ? "alerte" : valeur === null ? "doux" : "ok", mot: valeur === null ? "Inconnu" : `${Math.round(valeur)} %`, jauge: valeur });
    }
  } else if (usage) {
    lignes.push({ cle: "quota", libelle: "Quota", ton: "doux", mot: "Inconnu", detail: "Aucune mesure récente du quota." });
  }
  if (file?.erreur) lignes.push({ cle: "file", libelle: "Démarrages", ton: "alerte", mot: "Illisible", detail: file.erreur });
  else if (file?.etat) lignes.push({ cle: "file", libelle: "Démarrages", ton: file.etat.pause ? "alerte" : "ok", mot: file.etat.pause ? "Suspendus" : "Actifs" });

  const dangers = lignes.filter((l) => l.ton === "danger").length;
  const alertes = lignes.filter((l) => l.ton === "alerte").length;
  const niveau: Niveau = dangers ? "danger" : alertes ? "alerte" : machines === null ? "inconnu" : "ok";
  return { niveau, problemes: dangers + alertes, lignes };
}

const PASTILLE: Record<Niveau, { ton: Ton; mot: string }> = {
  ok: { ton: "ok", mot: "Système OK" },
  alerte: { ton: "alerte", mot: "À surveiller" },
  danger: { ton: "danger", mot: "Incident" },
  inconnu: { ton: "doux", mot: "Lecture…" },
};

export function Sante({ evaluation, aller }: { evaluation: EvaluationSante; aller: (href: string) => void }) {
  const [ouvert, setOuvert] = useState(false);
  const id = useId();
  const racine = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const { ton: tonPastille, mot: motPastille } = PASTILLE[evaluation.niveau];
  const libelle = evaluation.problemes > 1 ? `${motPastille} · ${evaluation.problemes}` : motPastille;

  useEffect(() => {
    if (!ouvert) return;
    const dehors = (event: PointerEvent) => {
      if (event.target instanceof Node && !racine.current?.contains(event.target)) setOuvert(false);
    };
    const echapper = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener("pointerdown", dehors);
    window.addEventListener("keydown", echapper);
    return () => {
      document.removeEventListener("pointerdown", dehors);
      window.removeEventListener("keydown", echapper);
    };
  }, [ouvert]);

  return (
    <div ref={racine} className="ao-sante">
      <button
        ref={bouton}
        type="button"
        className="ao-sante-bouton"
        aria-expanded={ouvert}
        aria-controls={id}
        aria-label={`Santé du système : ${libelle}`}
        onClick={() => setOuvert((o) => !o)}
      >
        <Statut ton={tonPastille}>
          <span className="ao-sante-mot">{libelle}</span>
        </Statut>
      </button>
      {ouvert && (
        <div id={id} role="region" aria-label="Santé du système" className="ao-pop">
          <ul className="flex flex-col">
            {evaluation.lignes.map((l) => (
              <li key={l.cle} className="flex items-center gap-3 border-b border-trait py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-encre">{l.libelle}</div>
                  {l.detail && <div className="text-xs text-douce">{l.detail}</div>}
                </div>
                {typeof l.jauge === "number" ? <Jauge valeur={l.jauge} libelle="" /> : <Statut ton={l.ton}>{l.mot}</Statut>}
              </li>
            ))}
          </ul>
          <a
            href="/systeme"
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              setOuvert(false);
              aller("/systeme");
            }}
            className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
          >
            Ouvrir Système
            <Icone nom="suite" taille={14} />
          </a>
        </div>
      )}
    </div>
  );
}
