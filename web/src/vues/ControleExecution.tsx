// Le contrôle de l'exécution : la pause globale des démarrages et l'arrêt d'un run. Les
// lectures qui échouent ne sont plus avalées : elles deviennent un message près de l'action.
import { useCallback, useEffect, useState } from "react";
import { ActionConfirmee } from "../composants/ActionConfirmee";
import { Bouton } from "../composants/Bouton";
import { useToasts } from "../composants/Toasts";
import { useSource } from "../donnees/contexte";
import { lireErreur } from "../donnees/erreurs";
import { attendreCommande } from "../donnees/lancement";
import type { Commande, Source } from "../donnees/source";
import { Icone } from "../icones";
import type { RunDetaille } from "../types";

/** Suit une commande déposée ; `erreur` dit pourquoi son état ne se lit plus. */
export function useSuiviCommande(id: string | null): { commande: Commande | null; erreur: string | null } {
  const { source } = useSource();
  const [commande, setCommande] = useState<Commande | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    setCommande(null);
    setErreur(null);
    if (!id) return;
    const lire = () => {
      source.commande(id).then(
        (c) => {
          if (!actif) return;
          setCommande(c);
          setErreur(null);
        },
        (err: unknown) => {
          if (actif) setErreur(lireErreur(err).message);
        }
      );
    };
    lire();
    const minuterie = setInterval(lire, 500);
    return () => {
      actif = false;
      clearInterval(minuterie);
    };
  }, [source, id]);
  return { commande: commande?.id === id ? commande : null, erreur };
}

export function useCommande(id: string | null): Commande | null {
  return useSuiviCommande(id).commande;
}

export type EtatFile = Awaited<ReturnType<NonNullable<Source["etatExecution"]>>>;

export interface ControleFile {
  /** Null tant que la première lecture n'a pas répondu, ou si la source ne pilote pas la file. */
  etat: EtatFile | null;
  /** La dernière lecture a échoué ; l'état affiché est alors le dernier connu. */
  erreur: string | null;
  peutChanger: boolean;
  /** Dépose la commande et attend qu'elle soit faite ; rejette avec la raison d'un refus. */
  changer: (pause: boolean) => Promise<void>;
}

/** L'état de la file, relu toutes les 2 s : une seule lecture pour le bandeau, la santé et le tiroir. */
export function useControleFile(): ControleFile {
  const { source } = useSource();
  const [etat, setEtat] = useState<EtatFile | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    const lireEtat = source.etatExecution;
    if (!lireEtat) return;
    let actif = true;
    const lire = () => {
      lireEtat().then(
        (e) => {
          if (!actif) return;
          setEtat(e);
          setErreur(null);
        },
        (err: unknown) => {
          if (actif) setErreur(lireErreur(err).message);
        }
      );
    };
    lire();
    const minuterie = setInterval(lire, 2000);
    return () => {
      actif = false;
      clearInterval(minuterie);
    };
  }, [source]);
  const changer = useCallback(
    async (pause: boolean) => {
      if (!source.pauseExecution) throw new Error("Ce cockpit ne pilote pas la file d'exécution.");
      const { id } = await source.pauseExecution(pause);
      await attendreCommande(source, id);
      try {
        const relu = await source.etatExecution?.();
        if (relu) setEtat(relu);
      } catch {
        // La commande est faite : le sondage de 2 s resynchronisera l'état.
      }
    },
    [source]
  );
  return { etat, erreur, peutChanger: Boolean(etat?.autorise && source.pauseExecution), changer };
}

function heureDe(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
}

/** Le bandeau ambre, pleine largeur, tant que les démarrages sont suspendus. */
export function BandeauPause({ controle }: { controle: ControleFile }) {
  const toasts = useToasts();
  const { etat } = controle;
  if (!etat?.pause) return null;
  const depuis = heureDe(etat.depuis);
  const reprendre = async () => {
    try {
      await controle.changer(false);
      toasts.succes("Démarrages repris : les runs en file vont partir.");
    } catch (err) {
      toasts.erreur(`Reprise impossible : ${lireErreur(err).message}`);
    }
  };
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-alerte bg-alerte-fond px-4 py-2.5 text-sm text-encre sm:px-6">
      <Icone nom="pause" taille={18} className="text-alerte" />
      <p className="min-w-0 flex-1">
        <b className="font-semibold text-alerte">Démarrages suspendus</b>
        {depuis && <span className="text-douce"> depuis {depuis}</span>}
        <span className="text-douce"> · Les runs déjà lancés continuent ; les nouveaux attendent la reprise.</span>
      </p>
      {controle.peutChanger && (
        <Bouton variante="primaire" icone="reprendre" libelleEnCours="Reprise…" onClick={reprendre}>
          Reprendre les démarrages
        </Bouton>
      )}
    </div>
  );
}

/** Dans le tiroir Activité : suspendre (en deux temps) ou reprendre les démarrages. */
export function ControleDemarrages({ controle }: { controle: ControleFile }) {
  const toasts = useToasts();
  const { etat, erreur } = controle;
  if (!etat && !erreur) return null;
  return (
    <section aria-labelledby="titre-demarrages" className="flex flex-col gap-2 border-t border-trait pt-4">
      <h3 id="titre-demarrages" className="text-xs font-semibold uppercase tracking-[.04em] text-douce">
        Démarrages
      </h3>
      {erreur && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] text-danger">
          <Icone nom="alerte" taille={15} className="mt-0.5" />
          État de la file illisible : {erreur}
        </p>
      )}
      {etat?.pause ? (
        <p className="text-[13px] text-douce">Suspendus : le bandeau en haut de page permet de les reprendre.</p>
      ) : etat ? (
        <>
          <p className="text-[13px] text-douce">Les nouveaux runs démarrent dès qu'une machine et le quota le permettent.</p>
          {controle.peutChanger && (
            <div>
              <ActionConfirmee
                libelle="Suspendre les démarrages"
                declencheur="secondaire"
                question="Suspendre le démarrage des nouveaux runs ?"
                details="Les runs déjà lancés continuent. Les runs en file attendent que tu reprennes les démarrages."
                confirmer="Suspendre"
                libelleEnCours="Suspension…"
                onConfirmer={async () => {
                  await controle.changer(true);
                  toasts.info("Démarrages suspendus. Les runs actifs continuent.");
                }}
              />
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

/**
 * Arrêter un run : une action sans retour, donc en deux temps. « Arrêter » plutôt
 * qu'« Annuler », qui nomme déjà le bouton qui referme la question.
 */
export function ControleRun({ run, autorise: autoriseParent }: {
  run: Pick<RunDetaille, "id" | "statut" | "annulation">;
  /** Le droit d'arrêt déjà lu par le parent : le tiroir lit la file une fois pour tous ses runs. */
  autorise?: boolean;
}) {
  const { source } = useSource();
  const toasts = useToasts();
  const [autoriseLu, setAutoriseLu] = useState(false);
  const [droitsIllisibles, setDroitsIllisibles] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(null);
  const suivi = useSuiviCommande(id);
  const commande = suivi.commande;
  const lireDroits = autoriseParent === undefined;
  useEffect(() => {
    if (!lireDroits) return;
    let actif = true;
    source.etatExecution?.().then(
      (e) => {
        if (actif) setAutoriseLu(e.autorise);
      },
      (err: unknown) => {
        if (actif) setDroitsIllisibles(lireErreur(err).message);
      }
    );
    return () => {
      actif = false;
    };
  }, [source, lireDroits]);
  const autorise = autoriseParent ?? autoriseLu;
  const raison = commande?.statut === "refused" ? commande.resultat?.raison : run.annulation?.statut === "refused" ? run.annulation.raison : null;
  const termine = ["succeeded", "failed", "cancelled"].includes(run.statut);
  const pending = Boolean(id && (!commande || ["pending", "taken"].includes(commande.statut))) || ["pending", "taken"].includes(run.annulation?.statut || "");
  // Une erreur d'envoi remonte à la question, qui reste ouverte et l'affiche.
  const arreter = async () => {
    if (!source.annulerRun) return;
    setId((await source.annulerRun(run.id)).id);
    toasts.info("Arrêt du run demandé : le moteur interrompt ses étapes.");
  };
  const message = raison || (pending ? suivi.erreur : null) || (!termine ? droitsIllisibles && `Droits d'arrêt illisibles : ${droitsIllisibles}` : null);
  const visible = autorise && source.annulerRun && (!termine || raison);
  if (!visible && !message) return null;
  return (
    <div className="flex flex-col items-start gap-1.5 text-sm">
      {visible &&
        (pending ? (
          <Bouton enCours libelleEnCours="Arrêt demandé…">
            Arrêter ce run
          </Bouton>
        ) : (
          <ActionConfirmee
            libelle={raison ? "Réessayer l'arrêt" : "Arrêter ce run"}
            declencheur="secondaire"
            variante="danger"
            question={`Arrêter le run ${run.id} ?`}
            details="Les étapes en cours s'interrompent et le run passe à « Annulé »."
            confirmer="Confirmer l'arrêt"
            libelleEnCours="Arrêt…"
            onConfirmer={arreter}
          />
        ))}
      {message && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] text-alerte">
          <Icone nom="alerte" taille={15} className="mt-0.5" />
          {message}
        </p>
      )}
    </div>
  );
}
