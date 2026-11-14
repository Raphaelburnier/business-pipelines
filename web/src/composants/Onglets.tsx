// Des onglets accessibles : un seul arrêt de tabulation, les flèches passent d'un onglet à
// l'autre, Début et Fin vont aux extrémités. Le parent garde l'onglet choisi (souvent dans
// l'adresse) et affiche le panneau correspondant.
import { useRef, type KeyboardEvent } from "react";

export interface Onglet<C extends string> {
  cle: C;
  libelle: string;
  /** Un compteur discret à côté du libellé, masqué à zéro. */
  compte?: number;
}

export function Onglets<C extends string>({ onglets, actif, onChoisir, libelle }: { onglets: ReadonlyArray<Onglet<C>>; actif: C; onChoisir: (cle: C) => void; libelle: string }) {
  const boutons = useRef(new Map<C, HTMLButtonElement>());

  function clavier(event: KeyboardEvent<HTMLDivElement>) {
    const n = onglets.length;
    const i = onglets.findIndex((o) => o.cle === actif);
    const j = event.key === "ArrowRight" ? (i + 1) % n : event.key === "ArrowLeft" ? (i - 1 + n) % n : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : -1;
    const cible = onglets[j];
    if (!cible) return;
    event.preventDefault();
    onChoisir(cible.cle);
    boutons.current.get(cible.cle)?.focus();
  }

  return (
    <div role="tablist" aria-label={libelle} onKeyDown={clavier} className="flex gap-1 overflow-x-auto border-b border-trait">
      {onglets.map((o) => {
        const choisi = o.cle === actif;
        return (
          <button
            key={o.cle}
            ref={(element) => {
              if (element) boutons.current.set(o.cle, element);
              else boutons.current.delete(o.cle);
            }}
            type="button"
            role="tab"
            aria-selected={choisi}
            tabIndex={choisi ? 0 : -1}
            onClick={() => onChoisir(o.cle)}
            className={`-mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors duration-150 ${choisi ? "border-accent text-encre" : "border-transparent text-douce hover:text-encre"}`}
          >
            {o.libelle}
            {o.compte !== undefined && o.compte > 0 && <span className="rounded-full bg-carte px-1.5 text-xs tabular-nums text-douce">{o.compte}</span>}
          </button>
        );
      })}
    </div>
  );
}
