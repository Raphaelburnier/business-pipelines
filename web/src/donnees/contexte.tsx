// La source de données, choisie une fois et partagée par toutes les vues.
//
// `?source=maquette` dans l'adresse (ou `VITE_SOURCE=maquette` au build) branche la maquette ;
// sinon, l'API. Le choix se voit dans la barre du haut : une maquette qui se ferait passer
// pour le vrai système serait pire que pas de maquette.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { sourceMaquette } from "../mock/source";
import type { Evenement } from "../types";
import { sourceApi } from "./api";
import type { Source } from "./source";

function choisirSource(): Source {
  const demandee = new URLSearchParams(window.location.search).get("source") ?? import.meta.env.VITE_SOURCE;
  return demandee === "maquette" ? sourceMaquette() : sourceApi();
}

interface Contexte {
  source: Source;
  connecte: boolean;
  /** Incrémenté à chaque événement : une vue qui le lit se recharge d'elle-même. */
  version: number;
  dernier: Evenement | null;
}

const ContexteSource = createContext<Contexte | null>(null);

export function FournisseurSource({ children }: { children: ReactNode }) {
  const [source] = useState(choisirSource);
  const [connecte, setConnecte] = useState(false);
  const [version, setVersion] = useState(0);
  const [dernier, setDernier] = useState<Evenement | null>(null);

  useEffect(
    () =>
      source.ecouter(
        (e) => {
          setDernier(e);
          setVersion((v) => v + 1);
        },
        setConnecte
      ),
    [source]
  );

  return <ContexteSource.Provider value={{ source, connecte, version, dernier }}>{children}</ContexteSource.Provider>;
}

export function useSource(): Contexte {
  const contexte = useContext(ContexteSource);
  if (!contexte) throw new Error("useSource hors de FournisseurSource");
  return contexte;
}

/**
 * Charge une donnée et la recharge à chaque événement du flux. Les réponses arrivées dans
 * le désordre sont écartées : seule la dernière demande a le droit d'écrire l'état.
 */
export function useCharge<T>(charger: (source: Source) => Promise<T>, cles: ReadonlyArray<unknown>) {
  const { source, version } = useSource();
  const versionLissee = useLissage(version, 600);
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const numero = useRef(0);
  const lancer = useCallback(() => charger(source), [source, ...cles]);

  useEffect(() => {
    const moi = ++numero.current;
    lancer()
      .then((d) => {
        if (moi !== numero.current) return;
        setDonnees(d);
        setErreur(null);
      })
      .catch((err: unknown) => {
        if (moi === numero.current) setErreur(err instanceof Error ? err.message : String(err));
      });
  }, [lancer, versionLissee]);

  return { donnees, erreur };
}

// Un agent bavard émet un `step.progress` par tour de modèle. Relire l'API à chacun ferait
// autant de requêtes pour un écran qui ne peut pas changer plus vite qu'on ne le lit : la
// valeur ne suit qu'au plus une fois par intervalle, et la dernière est toujours rattrapée.
function useLissage<T>(valeur: T, intervalleMs: number): T {
  const [lissee, setLissee] = useState(valeur);
  const dernierEnvoi = useRef(0);
  useEffect(() => {
    const attente = Math.max(0, dernierEnvoi.current + intervalleMs - Date.now());
    const t = setTimeout(() => {
      dernierEnvoi.current = Date.now();
      setLissee(valeur);
    }, attente);
    return () => clearTimeout(t);
  }, [valeur, intervalleMs]);
  return lissee;
}

/** Une horloge partagée : les durées avancent sans que chaque carte pose son minuteur. */
export function useHorloge(intervalleMs = 1000): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), intervalleMs);
    return () => clearInterval(t);
  }, [intervalleMs]);
  return maintenant;
}
