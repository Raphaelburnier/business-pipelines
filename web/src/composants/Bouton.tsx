// Le bouton du cockpit. Le verbe dit ce qui va se passer ; pendant l'envoi, le bouton se
// bloque et l'annonce (aria-busy) : un double clic ne dépose jamais deux commandes.
import { useRef, useState, type ComponentPropsWithRef, type MouseEvent, type ReactNode } from "react";
import { Icone, type NomIcone } from "../icones";

export type VarianteBouton = "primaire" | "secondaire" | "fantome" | "danger";
export type TailleBouton = "petit" | "normal";

const VARIANTES: Record<VarianteBouton, string> = {
  primaire: "border-accent bg-accent text-sur-accent hover:brightness-110",
  secondaire: "border-trait-fort bg-transparent text-encre hover:bg-carte",
  fantome: "border-transparent bg-transparent text-accent hover:bg-carte",
  danger: "border-danger-fort bg-danger-fort text-white hover:brightness-110",
};

const TAILLES: Record<TailleBouton, string> = {
  petit: "h-7 px-2.5 text-[12.5px]",
  normal: "h-8 px-3 text-[13px]",
};

type Props = Omit<ComponentPropsWithRef<"button">, "onClick" | "children"> & {
  variante?: VarianteBouton;
  taille?: TailleBouton;
  icone?: NomIcone;
  /** Envoi suivi par le parent (une commande déposée attend sa réponse). */
  enCours?: boolean;
  /** Le libellé pendant l'envoi, « Fusion… » plutôt qu'un bouton muet. */
  libelleEnCours?: string;
  /** Une promesse rendue garde le bouton bloqué jusqu'à sa fin. Le parent affiche ses erreurs. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<unknown>;
  children: ReactNode;
};

export function Bouton({
  variante = "secondaire",
  taille = "normal",
  icone,
  enCours = false,
  libelleEnCours,
  onClick,
  disabled,
  className = "",
  type = "button",
  children,
  ...reste
}: Props) {
  const [occupe, setOccupe] = useState(false);
  // L'état React arrive au rendu suivant ; le verrou bloque un second clic dans le même instant.
  const verrou = useRef(false);
  const bloque = enCours || occupe;

  async function cliquer(event: MouseEvent<HTMLButtonElement>) {
    if (verrou.current || bloque || !onClick) return;
    const resultat = onClick(event);
    if (!(resultat instanceof Promise)) return;
    verrou.current = true;
    setOccupe(true);
    try {
      await resultat;
    } finally {
      verrou.current = false;
      setOccupe(false);
    }
  }

  return (
    <button
      type={type}
      disabled={disabled || bloque}
      aria-busy={bloque || undefined}
      onClick={(event) => void cliquer(event)}
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-[background-color,border-color,filter] duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTES[variante]} ${TAILLES[taille]} ${className}`}
      {...reste}
    >
      {bloque ? <Icone nom="chargement" taille={14} className="animate-spin motion-reduce:animate-none" /> : icone ? <Icone nom={icone} taille={16} /> : null}
      {bloque && libelleEnCours ? libelleEnCours : children}
    </button>
  );
}
