// La source de données, choisie une fois et partagée par toutes les vues.
//
// `?source=maquette` dans l'adresse (ou `VITE_SOURCE=maquette` au build) branche la maquette ;
// sinon, l'API. Le choix se voit dans la barre du haut : une maquette qui se ferait passer
// pour le vrai système serait pire que pas de maquette.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { sourceMaquette } from "../mock/source";
import type { Evenement } from "../types";
import { sourceApi } from "./api";
import { lireErreur, type ErreurLisible } from "./erreurs";
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
export interface Chargement<T> {
  donnees: T | null;
  /** Message lisible (voir `lireErreur`), prêt à afficher ; `null` après une lecture réussie. */
  erreur: string | null;
  /** Le message technique d'origine quand il diffère, pour un « Détail technique ». */
  detail: string | null;
  /** Vrai tant que la première lecture n'a rien rendu : le moment d'un squelette. */
  chargement: boolean;
  /** Relit tout de suite, sans attendre le prochain événement : le bouton « Réessayer ». */
  recharger: () => void;
}

export function useCharge<T>(charger: (source: Source) => Promise<T>, cles: ReadonlyArray<unknown>): Chargement<T> {
  const { source, version } = useSource();
  const versionLissee = useLissage(version, 600);
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<ErreurLisible | null>(null);
  const [essai, setEssai] = useState(0);
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
        if (moi === numero.current) setErreur(lireErreur(err));
      });
  }, [lancer, versionLissee, essai]);

  // Effacer l'erreur rend le squelette pendant la relecture : le clic se voit tout de suite.
  const recharger = useCallback(() => {
    setErreur(null);
    setEssai((n) => n + 1);
  }, []);

  return { donnees, erreur: erreur?.message ?? null, detail: erreur?.detail ?? null, chargement: donnees === null && erreur === null, recharger };
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
