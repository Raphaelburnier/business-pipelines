// Une action critique en deux temps (fusionner, livrer, annuler un run). Le premier clic ne
// fait rien d'irréversible : il ouvre une question qui redit la cible et ses risques. Échap
// ou « Annuler » referment ; une erreur reste affichée près de l'action.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { lireErreur } from "../donnees/erreurs";
import { Icone } from "../icones";
import { Bouton, type VarianteBouton } from "./Bouton";

type Props = {
  /** Le verbe du premier bouton : « Fusionner #66 ». */
  libelle: string;
  /** La question qui redit la cible : « Fusionner business-pipelines #66 en squash sur main ? » */
  question: ReactNode;
  /** Les conséquences à connaître avant de confirmer. */
  details?: ReactNode;
  /** Le verbe de confirmation : « Confirmer la fusion ». */
  confirmer: string;
  libelleEnCours?: string;
  variante?: Extract<VarianteBouton, "primaire" | "danger">;
  desactive?: boolean;
  /** Rejeter la promesse garde la question ouverte et affiche le message. */
  onConfirmer: () => Promise<unknown>;
};

export function ActionConfirmee({ libelle, question, details, confirmer, libelleEnCours = "Envoi…", variante = "primaire", desactive = false, onConfirmer }: Props) {
  const [ouverte, setOuverte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const boutonConfirmer = useRef<HTMLButtonElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const aOuvert = useRef(false);

  useEffect(() => {
    if (ouverte) boutonConfirmer.current?.focus();
    else if (aOuvert.current) declencheur.current?.focus();
    aOuvert.current = ouverte;
  }, [ouverte]);

  async function valider() {
    setErreur(null);
    try {
      await onConfirmer();
      setOuverte(false);
    } catch (err) {
      setErreur(lireErreur(err).message);
    }
  }

  function clavier(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setOuverte(false);
  }

  if (!ouverte) {
    return (
      <Bouton ref={declencheur} variante={variante} disabled={desactive} onClick={() => setOuverte(true)}>
        {libelle}
      </Bouton>
    );
  }

  return (
    <div role="group" aria-label={libelle} onKeyDown={clavier} className="flex flex-col gap-2.5 rounded-lg border border-alerte bg-alerte-fond p-3">
      <p className="text-sm font-semibold text-encre">{question}</p>
      {details && <p className="text-[13px] text-douce">{details}</p>}
      <div className="flex flex-wrap gap-2">
        <Bouton ref={boutonConfirmer} variante={variante} libelleEnCours={libelleEnCours} onClick={valider}>
          {confirmer}
        </Bouton>
        <Bouton onClick={() => setOuverte(false)}>Annuler</Bouton>
      </div>
      {erreur && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger">
          <Icone nom="alerte" taille={15} className="mt-0.5" />
          {erreur}
        </p>
      )}
    </div>
  );
}
