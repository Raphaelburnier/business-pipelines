// La barre du haut : où l'on est (fil d'Ariane), et deux repères permanents, la santé du
// système et l'activité en cours.
import { Icone } from "../icones";
import { parent, type Miette } from "../routes";
import { suivreLien } from "./Navigation";

export function FilAriane({ chemin, aller }: { chemin: ReadonlyArray<Miette>; aller: (href: string) => void }) {
  const retour = parent(chemin);
  const dernier = chemin.length - 1;
  return (
    <div className="ao-fil">
      {retour?.href && (
        <a href={retour.href} onClick={suivreLien(aller, retour.href)} className="ao-retour ao-bouton-icone" aria-label={`Revenir à ${retour.libelle}`} title={`Revenir à ${retour.libelle}`}>
          <Icone nom="retour" taille={18} />
        </a>
      )}
      <nav aria-label="Fil d'Ariane" className="min-w-0">
        <ol>
          {chemin.map((miette, i) => {
            const texte = <span className={miette.code ? "font-mono text-[0.92em]" : undefined}>{miette.libelle}</span>;
            if (i === dernier) {
              return (
                <li key={i} aria-current="page" className="ao-fil-courant">
                  <h1 title={miette.libelle}>{texte}</h1>
                </li>
              );
            }
            return (
              <li key={i} className="ao-fil-parent">
                {miette.href ? (
                  <a href={miette.href} onClick={suivreLien(aller, miette.href)}>
                    {texte}
                  </a>
                ) : (
                  texte
                )}
                <Icone nom="suite" taille={14} className="ao-fil-sep" />
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}

/** « Activité · N » : les runs vivants ; ambre quand l'un d'eux attend ta décision. */
export function BoutonActivite({ total, aValider, ouvert, onOuvrir }: { total: number; aValider: number; ouvert: boolean; onOuvrir: () => void }) {
  const libelle = aValider ? `Activité : ${total} runs, dont ${aValider} à valider` : `Activité : ${total} run${total > 1 ? "s" : ""} vivant${total > 1 ? "s" : ""}`;
  return (
    <button type="button" className={`ao-activite-bouton ${aValider ? "alerte" : ""}`} aria-haspopup="dialog" aria-expanded={ouvert} aria-label={libelle} title={libelle} onClick={onOuvrir}>
      <Icone nom="activite" taille={16} />
      <span className="ao-activite-mot">Activité</span>
      <span className="ao-activite-n tabular-nums">{total}</span>
    </button>
  );
}
