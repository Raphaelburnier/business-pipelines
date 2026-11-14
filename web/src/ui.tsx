// Les briques visuelles communes. Rien ici ne décide : tout vient des données. Les vues
// gardent ces noms ; le rendu vient des composants partagés (src/composants/).
import type { ReactNode } from "react";
import { EtatVide } from "./composants/Etats";
import { Statut } from "./composants/Statut";
import { VIDE, mot, ton, vivant } from "./format";
import { Icone } from "./icones";
import type { EtatMachine, EtatProjet, StatutEtape, StatutRun } from "./types";

type Etat = StatutRun | StatutEtape | EtatMachine | EtatProjet;

const majuscule = (texte: string): string => texte.charAt(0).toLocaleUpperCase("fr") + texte.slice(1);

/** Un état : une pastille de couleur ET son mot. La couleur n'est jamais seule. */
export function Etat({ etat, compact = false }: { etat: Etat; compact?: boolean }) {
  return (
    <Statut ton={ton(etat)} vivant={vivant(etat)} compact={compact} titre={compact ? majuscule(mot(etat)) : undefined}>
      {majuscule(mot(etat))}
    </Statut>
  );
}

export function Titre({ children, compteur }: { children: ReactNode; compteur?: number }) {
  return (
    <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-[.04em] text-douce">
      {children}
      {compteur !== undefined && <span className="tabular-nums">{compteur}</span>}
    </h2>
  );
}

export function Vide({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <EtatVide message={children} action={action} />;
}

/** Une erreur courte, près de ce qu'elle concerne ; `onReessayer` ajoute la relance. */
export function Erreur({ children, onReessayer }: { children: ReactNode; onReessayer?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger-fond px-3 py-2 text-sm text-danger">
      <Icone nom="alerte" taille={16} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
      {onReessayer && (
        <button type="button" onClick={onReessayer} className="flex-none cursor-pointer text-[13px] font-medium underline underline-offset-2 hover:no-underline">
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Une jauge horizontale, avec sa valeur écrite : une barre sans chiffre ne se lit pas. */
export function Jauge({ valeur, libelle }: { valeur: number | null; libelle: string }) {
  if (valeur === null) return <span className="text-xs text-douce">{libelle} : {VIDE}</span>;
  const niveau = valeur >= 90 ? "bg-danger" : valeur >= 70 ? "bg-alerte" : "bg-ok";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-douce" title={`${libelle} : ${valeur} %`}>
      {libelle}
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-trait">
        <span className={`block h-full ${niveau}`} style={{ width: `${Math.min(100, valeur)}%` }} />
      </span>
      <span className="tabular-nums text-encre">{valeur} %</span>
    </span>
  );
}
