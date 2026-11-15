// Un tiroir latéral pour le détail secondaire (activité, inspection) : il s'ouvre par-dessus
// la page sans la quitter. Le focus y entre, y reste (Tab boucle), et revient au déclencheur
// à la fermeture ; Échap ou un clic sur le voile le referment.
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icone } from "../icones";

const FOCALISABLES = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function Tiroir({ ouvert, onFermer, titre, children }: { ouvert: boolean; onFermer: () => void; titre: ReactNode; children: ReactNode }) {
  const id = useId();
  const panneau = useRef<HTMLDivElement>(null);
  // Le parent passe souvent une fonction recréée à chaque rendu : la garder en référence
  // évite de rejouer l'ouverture (et de voler le focus) à chaque mise à jour.
  const fermer = useRef(onFermer);
  useEffect(() => {
    fermer.current = onFermer;
  });

  useEffect(() => {
    if (!ouvert) return;
    const precedent = document.activeElement;
    panneau.current?.focus();
    const echapper = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        fermer.current();
      }
    };
    window.addEventListener("keydown", echapper);
    return () => {
      window.removeEventListener("keydown", echapper);
      if (precedent instanceof HTMLElement && precedent.isConnected) precedent.focus({ preventScroll: true });
    };
  }, [ouvert]);

  function garderLeFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || !panneau.current) return;
    const elements = [...panneau.current.querySelectorAll<HTMLElement>(FOCALISABLES)];
    const premier = elements[0];
    const dernier = elements[elements.length - 1];
    if (!premier || !dernier) return;
    if (event.shiftKey && document.activeElement === premier) {
      event.preventDefault();
      dernier.focus();
    } else if (!event.shiftKey && document.activeElement === dernier) {
      event.preventDefault();
      premier.focus();
    }
  }

  if (!ouvert) return null;
  return createPortal(
    <div className="fixed inset-0 z-30">
      <div aria-hidden="true" onClick={() => fermer.current()} className="absolute inset-0 bg-black/40" />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onKeyDown={garderLeFocus}
        className="ao-tiroir absolute inset-y-0 right-0 flex w-[min(420px,100vw)] flex-col border-l border-trait bg-surface shadow-[var(--ombre-pop)] outline-none"
      >
        <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-trait px-4">
          <h2 id={id} className="truncate text-[15px] font-semibold text-encre">
            {titre}
          </h2>
          <button type="button" onClick={() => fermer.current()} aria-label="Fermer" className="ao-bouton-icone">
            <Icone nom="fermer" taille={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
