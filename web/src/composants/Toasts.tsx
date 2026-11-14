// Les toasts : la confirmation discrète qu'une action a abouti (« PR #66 fusionnée »).
// Trois au plus, en bas à droite, annoncés aux lecteurs d'écran. Une erreur reste plus
// longtemps ; celle qui demande d'agir s'affiche près de l'action, pas ici.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icone, type NomIcone } from "../icones";

type Genre = "succes" | "erreur" | "info";

interface Toast {
  id: number;
  genre: Genre;
  message: string;
}

export interface Toasts {
  succes: (message: string) => void;
  erreur: (message: string) => void;
  info: (message: string) => void;
}

const DUREE_MS: Record<Genre, number> = { succes: 4000, info: 4000, erreur: 8000 };
const STYLE: Record<Genre, { icone: NomIcone; couleur: string; bord: string }> = {
  succes: { icone: "ok", couleur: "text-ok", bord: "border-l-ok" },
  erreur: { icone: "alerte", couleur: "text-danger", bord: "border-l-danger" },
  info: { icone: "info", couleur: "text-encours", bord: "border-l-encours" },
};

const ContexteToasts = createContext<Toasts | null>(null);

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const suivant = useRef(0);
  const minuteurs = useRef(new Map<number, number>());

  const retirer = useCallback((id: number) => {
    window.clearTimeout(minuteurs.current.get(id));
    minuteurs.current.delete(id);
    setToasts((liste) => liste.filter((t) => t.id !== id));
  }, []);

  const pousser = useCallback(
    (genre: Genre, message: string) => {
      const id = ++suivant.current;
      setToasts((liste) => [...liste.slice(-2), { id, genre, message }]);
      minuteurs.current.set(id, window.setTimeout(() => retirer(id), DUREE_MS[genre]));
    },
    [retirer]
  );

  useEffect(() => {
    const enCours = minuteurs.current;
    return () => enCours.forEach((t) => window.clearTimeout(t));
  }, []);

  const api = useMemo<Toasts>(
    () => ({ succes: (m) => pousser("succes", m), erreur: (m) => pousser("erreur", m), info: (m) => pousser("info", m) }),
    [pousser]
  );

  return (
    <ContexteToasts.Provider value={api}>
      {children}
      <div aria-live="polite" className="ao-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex items-start gap-2.5 rounded-lg border border-l-[3px] border-trait-fort bg-surface px-3.5 py-2.5 text-[13.5px] text-encre shadow-[var(--ombre-pop)] ${STYLE[t.genre].bord}`}>
            <Icone nom={STYLE[t.genre].icone} taille={16} className={`mt-0.5 ${STYLE[t.genre].couleur}`} />
            <span className="min-w-0 flex-1">{t.message}</span>
            <button type="button" onClick={() => retirer(t.id)} aria-label="Fermer la notification" className="-m-1 cursor-pointer rounded p-1 text-douce hover:text-encre">
              <Icone nom="fermer" taille={14} />
            </button>
          </div>
        ))}
      </div>
    </ContexteToasts.Provider>
  );
}

export function useToasts(): Toasts {
  const contexte = useContext(ContexteToasts);
  if (!contexte) throw new Error("useToasts hors de FournisseurToasts");
  return contexte;
}
