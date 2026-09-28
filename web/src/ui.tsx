// Les briques visuelles communes. Rien ici ne décide : tout vient des données.
import type { ReactNode } from "react";
import { CLASSES_TON, VIDE, mot, ton, vivant } from "./format";
import type { EtatMachine, EtatProjet, StatutEtape, StatutRun } from "./types";

type Etat = StatutRun | StatutEtape | EtatMachine | EtatProjet;

/** Un état : une pastille de couleur ET son mot. La couleur n'est jamais seule. */
export function Etat({ etat, compact = false }: { etat: Etat; compact?: boolean }) {
  const c = CLASSES_TON[ton(etat)];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${c.texte} ${c.fond} ${c.bordure}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${c.plein} ${vivant(etat) ? "pulse-douce" : ""}`} />
      {!compact && mot(etat)}
    </span>
  );
}

export function Titre({ children, compteur }: { children: ReactNode; compteur?: number }) {
  return (
    <h2 className="mb-2 flex items-baseline gap-2 text-xs font-bold uppercase tracking-wider text-douce">
      {children}
      {compteur !== undefined && <span className="tabular-nums">{compteur}</span>}
    </h2>
  );
}

export function Vide({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-trait bg-carte p-4 text-center text-sm text-douce">{children}</p>;
}

export function Erreur({ children }: { children: ReactNode }) {
  return <p className="rounded-r-xl border-l-4 border-danger bg-danger-fond px-3 py-2 text-sm text-danger">{children}</p>;
}

/** Une jauge horizontale, avec sa valeur écrite : une barre sans chiffre ne se lit pas. */
export function Jauge({ valeur, libelle }: { valeur: number | null; libelle: string }) {
  if (valeur === null) return <span className="text-[11px] text-douce">{libelle} : {VIDE}</span>;
  const niveau = valeur >= 90 ? "bg-danger" : valeur >= 70 ? "bg-alerte" : "bg-ok";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-douce" title={`${libelle} : ${valeur} %`}>
      {libelle}
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-trait">
        <span className={`block h-full ${niveau}`} style={{ width: `${Math.min(100, valeur)}%` }} />
      </span>
      <span className="tabular-nums text-encre">{valeur} %</span>
    </span>
  );
}
