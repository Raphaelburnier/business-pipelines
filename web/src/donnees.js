// L'accès aux données du cockpit : quelques appels REST, plus un flux d'événements.
//
// Le parti pris tient en une ligne : le flux ne porte pas l'état, il dit qu'il a changé.
// Recharger la vue concernée à l'arrivée d'un événement coûte une requête sur une base
// locale, et évite de reconstruire côté navigateur un état que la base tient déjà. Une
// page qui déduit l'état des événements finit toujours par diverger de la base le jour où
// un événement manque.
import { useCallback, useEffect, useRef, useState } from "react";

async function lire(chemin, signal) {
  const reponse = await fetch(chemin, { signal, headers: { accept: "application/json" } });
  const corps = await reponse.json().catch(() => ({ erreur: "réponse illisible" }));
  if (!reponse.ok) throw new Error(corps.erreur || `${reponse.status}`);
  return corps;
}

/**
 * Charge une ressource, la recharge à la demande, et dit franchement quand elle manque.
 * @param {string|null} chemin
 */
export function useRessource(chemin) {
  const [donnees, setDonnees] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(Boolean(chemin));

  const recharger = useCallback(
    async (signal) => {
      if (!chemin) return;
      try {
        setDonnees(await lire(chemin, signal));
        setErreur(null);
      } catch (err) {
        if (err.name !== "AbortError") setErreur(err.message);
      } finally {
        setChargement(false);
      }
    },
    [chemin]
  );

  useEffect(() => {
    const controle = new AbortController();
    recharger(controle.signal);
    return () => controle.abort();
  }, [recharger]);

  return { donnees, erreur, chargement, recharger };
}

/**
 * Le flux d'événements. `EventSource` reconnecte seul et renvoie `Last-Event-ID`, donc une
 * coupure de réseau ne perd rien : le serveur reprend après le dernier événement reçu.
 * @param {{ runId?: string|null, surEvenement?: (e: object) => void }} options
 */
export function useFlux({ runId = null, surEvenement } = {}) {
  const [connecte, setConnecte] = useState(false);
  const [dernier, setDernier] = useState(null);
  const rappel = useRef(surEvenement);
  rappel.current = surEvenement;

  useEffect(() => {
    const source = new EventSource(runId ? `/api/flux?run=${encodeURIComponent(runId)}` : "/api/flux");
    source.onopen = () => setConnecte(true);
    source.onerror = () => setConnecte(false);
    source.addEventListener("evenement", (message) => {
      const evenement = JSON.parse(message.data);
      setDernier(evenement);
      if (rappel.current) rappel.current(evenement);
    });
    return () => source.close();
  }, [runId]);

  return { connecte, dernier };
}

/** Une durée lisible : « 12 min », « 3.4 h », « 2 j ». */
export function depuis(iso, maintenant = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const minutes = Math.max(0, Math.round((maintenant - t) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const heures = minutes / 60;
  if (heures < 48) return `${heures < 10 ? heures.toFixed(1) : Math.round(heures)} h`;
  return `${Math.round(minutes / 1440)} j`;
}

export const usd = (n) => `${Number(n || 0).toFixed(2)} $`;
