// Un tableau de données : colonnes alignées, en-têtes triables au clic, ligne survolée.
// Un tableau sans ligne laisse la place à l'état vide fourni par le parent.
import { useMemo, useState, type ReactNode } from "react";
import { Icone } from "../icones";

export interface Colonne<L> {
  cle: string;
  titre: string;
  rendu: (ligne: L) => ReactNode;
  /** Présent, la colonne devient triable ; l'ordre croissant est celui de cette fonction. */
  tri?: (a: L, b: L) => number;
  alignement?: "gauche" | "droite";
}

type Sens = "croissant" | "decroissant";

export function Tableau<L>({ colonnes, lignes, cleLigne, libelle, vide, triInitial }: { colonnes: ReadonlyArray<Colonne<L>>; lignes: ReadonlyArray<L>; cleLigne: (ligne: L) => string; libelle: string; vide?: ReactNode; triInitial?: { cle: string; sens: Sens } }) {
  const [tri, setTri] = useState(triInitial ?? null);

  const triees = useMemo(() => {
    const comparer = colonnes.find((c) => c.cle === tri?.cle)?.tri;
    if (!tri || !comparer) return lignes;
    const copie = [...lignes].sort(comparer);
    return tri.sens === "decroissant" ? copie.reverse() : copie;
  }, [colonnes, lignes, tri]);

  if (!lignes.length && vide) return <>{vide}</>;

  function basculer(cle: string) {
    setTri((avant) => (avant?.cle === cle ? { cle, sens: avant.sens === "croissant" ? "decroissant" : "croissant" } : { cle, sens: "croissant" }));
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-trait bg-surface">
      <table aria-label={libelle} className="w-full border-collapse text-[13px]">
        <thead className="bg-carte">
          <tr>
            {colonnes.map((c) => {
              const actif = tri?.cle === c.cle;
              const droite = c.alignement === "droite";
              return (
                <th
                  key={c.cle}
                  scope="col"
                  aria-sort={actif ? (tri.sens === "croissant" ? "ascending" : "descending") : c.tri ? "none" : undefined}
                  className={`whitespace-nowrap border-b border-trait px-3.5 py-2.5 text-xs font-semibold uppercase tracking-[.04em] text-douce ${droite ? "text-right" : "text-left"}`}
                >
                  {c.tri ? (
                    <button type="button" onClick={() => basculer(c.cle)} className="inline-flex cursor-pointer items-center gap-1 uppercase tracking-[.04em] hover:text-encre">
                      {c.titre}
                      <Icone nom={actif ? (tri.sens === "croissant" ? "triMonte" : "triDescend") : "tri"} taille={13} />
                    </button>
                  ) : (
                    c.titre
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {triees.map((ligne) => (
            <tr key={cleLigne(ligne)} className="border-b border-trait transition-colors duration-150 last:border-0 hover:bg-carte">
              {colonnes.map((c) => (
                <td key={c.cle} className={`px-3.5 py-2.5 align-top ${c.alignement === "droite" ? "text-right tabular-nums" : ""}`}>
                  {c.rendu(ligne)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
