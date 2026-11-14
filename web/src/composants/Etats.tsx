// Les trois états d'un bloc asynchrone qui n'a pas encore de données à montrer : il charge,
// il n'y a rien, ou la lecture a échoué. Chacun dit quoi faire ensuite.
import type { ReactNode } from "react";
import { Icone, type NomIcone } from "../icones";
import { Bouton } from "./Bouton";

// Des largeurs variées : des barres toutes égales ressemblent à un tableau vide.
const LARGEURS = ["w-3/5", "w-full", "w-5/6", "w-2/5", "w-4/5"] as const;

/** Un squelette à la forme du contenu attendu ; annoncé une fois aux lecteurs d'écran. */
export function Squelette({ lignes = 3, libelle = "Chargement…", className = "" }: { lignes?: number; libelle?: string; className?: string }) {
  return (
    <div role="status" className={`flex flex-col gap-2.5 ${className}`}>
      <span className="sr-only">{libelle}</span>
      {Array.from({ length: lignes }, (_, i) => (
        <span key={i} aria-hidden="true" className={`ao-squelette h-3 rounded ${LARGEURS[i % LARGEURS.length]}`} />
      ))}
    </div>
  );
}

/** Rien à montrer : le dire, et proposer la suite quand il y en a une. */
export function EtatVide({ message, detail, action, icone = "vide" }: { message: ReactNode; detail?: ReactNode; action?: ReactNode; icone?: NomIcone }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-trait px-4 py-6 text-center">
      <Icone nom={icone} taille={24} className="text-douce" />
      <div className="text-sm font-medium text-encre">{message}</div>
      {detail && <div className="max-w-prose text-[13px] text-douce">{detail}</div>}
      {action}
    </div>
  );
}

/** Une lecture qui a échoué : ce qui ne va pas, une relance, et le détail technique replié. */
export function EtatErreur({ titre = "Lecture impossible", message, detail, onReessayer }: { titre?: string; message?: ReactNode; detail?: string | null; onReessayer?: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-danger bg-danger-fond p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-danger">
        <Icone nom="alerte" taille={16} />
        {titre}
      </p>
      {message && <div className="text-[13px] text-encre">{message}</div>}
      {onReessayer && (
        <div>
          <Bouton taille="petit" icone="reessayer" onClick={onReessayer}>
            Réessayer
          </Bouton>
        </div>
      )}
      {detail && (
        <details className="text-[12.5px] text-douce">
          <summary className="cursor-pointer">Détail technique</summary>
          <code className="mt-1 block break-all font-mono">{detail}</code>
        </details>
      )}
    </div>
  );
}
