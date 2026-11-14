// Une carte : un bloc délimité, son titre et ses actions à droite. Bordure seule, sans
// ombre : l'ombre est réservée à ce qui flotte (tiroir, menu, toast).
import { useId, type ReactNode } from "react";

export function Carte({ titre, sousTitre, actions, children, className = "" }: { titre?: ReactNode; sousTitre?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={titre ? id : undefined} className={`flex min-w-0 flex-col gap-3 rounded-xl border border-trait bg-surface p-4 ${className}`}>
      {(titre || actions) && (
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {titre && (
              <h2 id={id} className="text-[15px] font-semibold leading-6 text-encre">
                {titre}
              </h2>
            )}
            {sousTitre && <p className="text-[13px] text-douce">{sousTitre}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
