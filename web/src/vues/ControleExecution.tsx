import { useEffect, useState } from "react";
import { useSource } from "../donnees/contexte";
import type { Commande } from "../donnees/source";
import type { RunDetaille } from "../types";

function useCommande(id: string | null) {
  const { source } = useSource();
  const [commande, setCommande] = useState<Commande | null>(null);
  useEffect(() => {
    let actif = true; setCommande(null);
    if (!id) return;
    const lire = () => { void source.commande(id).then(c => { if (actif) setCommande(c); }).catch(() => {}); };
    lire(); const timer = setInterval(lire, 500);
    return () => { actif = false; clearInterval(timer); };
  }, [source, id]);
  return commande;
}

export function ControleFile() {
  const { source } = useSource();
  const [etat, setEtat] = useState<Awaited<ReturnType<NonNullable<typeof source.etatExecution>>> | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const commande = useCommande(id);
  useEffect(() => {
    if (!source.etatExecution) return;
    let actif = true;
    const lire = () => { void source.etatExecution!().then(e => { if (actif) setEtat(e); }).catch(() => {}); };
    lire(); const timer = setInterval(lire, 2000);
    return () => { actif = false; clearInterval(timer); };
  }, [source]);
  useEffect(() => {
    if (!commande || !["done", "refused"].includes(commande.statut)) return;
    if (commande.statut === "refused") setErreur(commande.resultat?.raison || "La file n’a pas pu être modifiée.");
    void source.etatExecution?.().then(setEtat).catch(() => setErreur("État de la file indisponible")).finally(() => setId(null));
  }, [commande, source]);
  if (!etat || (!etat.pause && !etat.autorise)) return null;
  const changer = async () => {
    if (!source.pauseExecution) return;
    setEnvoi(true); setErreur("");
    try { setId((await source.pauseExecution(!etat.pause)).id); }
    catch (err) { setErreur(err instanceof Error ? err.message : "Action impossible"); }
    finally { setEnvoi(false); }
  };
  return <div className="flex flex-wrap items-center gap-2 border-b border-trait bg-carte px-4 py-2 text-xs">
    {etat.pause && <span role="status" className="text-alerte">Démarrages suspendus — les runs actifs continuent</span>}
    {etat.autorise && source.pauseExecution && <button type="button" className="rounded border border-trait px-2 py-1" disabled={envoi || Boolean(id)} onClick={() => void changer()}>
      {envoi || id ? "Mise à jour…" : etat.pause ? "Reprendre les démarrages" : "Suspendre les démarrages"}
    </button>}
    {erreur && <span role="alert" className="text-alerte">{erreur}</span>}
  </div>;
}

export function ControleRun({ run }: { run: Pick<RunDetaille, "id" | "statut" | "annulation"> }) {
  const { source } = useSource();
  const [autorise, setAutorise] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState("");
  const commande = useCommande(id);
  useEffect(() => { let actif = true; void source.etatExecution?.().then(e => { if (actif) setAutorise(e.autorise); }).catch(() => {}); return () => { actif = false; }; }, [source]);
  const raison = commande?.statut === "refused" ? commande.resultat?.raison : run.annulation?.statut === "refused" ? run.annulation.raison : null;
  const termine = ["succeeded", "failed", "cancelled"].includes(run.statut);
  const pending = envoi || Boolean(id && (!commande || ["pending", "taken"].includes(commande.statut))) || ["pending", "taken"].includes(run.annulation?.statut || "");
  const annuler = async () => {
    if (!source.annulerRun) return;
    setEnvoi(true); setErreur("");
    try { setId((await source.annulerRun(run.id)).id); }
    catch (err) { setErreur(err instanceof Error ? err.message : "Annulation impossible"); }
    finally { setEnvoi(false); }
  };
  return <div className="my-2 text-sm">
    {autorise && source.annulerRun && (!termine || raison) && <button type="button" className="rounded border border-trait px-3 py-1 text-alerte" disabled={pending} onClick={() => void annuler()}>
      {pending ? "Annulation demandée…" : raison ? "Réessayer l’arrêt" : "Annuler ce run"}
    </button>}
    {(erreur || raison) && <p role="alert" className="mt-1 text-alerte">{erreur || raison}</p>}
  </div>;
}
