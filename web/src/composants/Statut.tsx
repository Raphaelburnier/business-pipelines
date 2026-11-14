// Une pastille de statut : la couleur du ton, une icône ou un point, et le mot. La couleur
// n'est jamais seule ; en mode compact, le mot reste lu par les lecteurs d'écran.
import type { ReactNode } from "react";
import { CLASSES_TON, type Ton } from "../format";
import { Icone, type NomIcone } from "../icones";

// Les tons qui bougent gardent un point (qui respire quand c'est vivant) ; les autres une icône.
const ICONE_TON: Record<Ton, NomIcone | null> = {
  ok: "ok",
  accent: null,
  bleu: null,
  alerte: "alerte",
  danger: "echec",
  doux: "horloge",
};

export function Statut({ ton, children, vivant = false, compact = false, icone, titre }: { ton: Ton; children: ReactNode; vivant?: boolean; compact?: boolean; icone?: NomIcone; titre?: string }) {
  const c = CLASSES_TON[ton];
  const dessin = icone ?? ICONE_TON[ton];
  return (
    <span title={titre} className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-medium ${c.texte} ${c.fond}`}>
      {dessin ? <Icone nom={dessin} taille={13} /> : <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${c.plein} ${vivant ? "pulse-douce" : ""}`} />}
      {compact ? <span className="sr-only">{children}</span> : children}
    </span>
  );
}

/** Le marqueur « sensible » d'une PR : une exigence de fusion explicite, pas un état. */
export function Sensible({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border border-danger px-2 text-xs font-medium text-danger">
      <Icone nom="sensible" taille={13} />
      {children}
    </span>
  );
}
