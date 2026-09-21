// L'accès aux données du cockpit : quelques appels REST, plus un flux d'événements.
//
// Le parti pris tient en une ligne : le flux ne porte pas l'état, il dit qu'il a changé.
// Recharger la vue concernée à l'arrivée d'un événement coûte une requête sur une base
// locale, et évite de reconstruire côté navigateur un état que la base tient déjà. Une
// page qui déduit l'état des événements finit toujours par diverger de la base le jour où
// un événement manque.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  const rappel = useRef(surEvenement);
  rappel.current = surEvenement;

  useEffect(() => {
    const source = new EventSource(runId ? `/api/flux?run=${encodeURIComponent(runId)}` : "/api/flux");
    source.onopen = () => setConnecte(true);
    source.onerror = () => setConnecte(false);
    source.addEventListener("evenement", (message) => {
      const evenement = JSON.parse(message.data);
      if (rappel.current) rappel.current(evenement);
    });
    return () => source.close();
  }, [runId]);

  return { connecte };
}

// Une horloge partagée : les durées affichées avancent sans que chaque carte pose son
// propre minuteur. Un run qui tourne doit voir son compteur bouger, sinon la page paraît
// figée alors que le travail avance.
export function useHorloge(intervalleMs = 1000) {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), intervalleMs);
    return () => clearInterval(t);
  }, [intervalleMs]);
  return maintenant;
}

// ---------- mise en forme ----------

/** Une durée lisible : « 12 s », « 4 min 20 », « 3.4 h ». */
export function duree(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  // « 0 s » sur une étape qui a bien tourné se lit comme une donnée manquante.
  if (ms < 1000) return "< 1 s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")}`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} j`;
}

/** Le temps écoulé depuis un instant ISO. */
export function depuis(iso, maintenant = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? duree(maintenant - t) : "—";
}

export const usd = (n) => `${Number(n || 0).toFixed(2)} $`;

export const jetons = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n || 0));

// ---------- lecture d'un run ----------

/**
 * Ce qu'on peut déduire des étapes d'un run : sa fenêtre de temps, ses voies d'exécution
 * (une par machine), et ce que chaque modèle a coûté.
 *
 * Les voies par machine ne sont pas décoratives : c'est ce qui rend le parallélisme
 * visible. Deux agents lancés ensemble sur le PC se lisent d'un coup d'œil, là où une
 * liste verticale les montrait l'un sous l'autre comme s'ils s'étaient suivis.
 */
export function useLectureRun(run, maintenant) {
  return useMemo(() => {
    const etapes = (run && run.etapes) || [];
    const debuts = etapes.map((e) => Date.parse(e.debut)).filter(Number.isFinite);
    const debut = debuts.length ? Math.min(...debuts) : Date.parse(run && run.debut) || maintenant;
    const finsConnues = etapes.map((e) => Date.parse(e.fin)).filter(Number.isFinite);
    const enCours = etapes.some((e) => e.statut === "running");
    const fin = enCours || !finsConnues.length ? maintenant : Math.max(...finsConnues);
    const total = Math.max(fin - debut, 1);

    const voies = new Map();
    for (const etape of etapes) {
      const machine = etape.machine || "inconnue";
      if (!voies.has(machine)) voies.set(machine, []);
      const d = Date.parse(etape.debut);
      const f = Number.isFinite(Date.parse(etape.fin)) ? Date.parse(etape.fin) : fin;
      voies.get(machine).push({
        ...etape,
        debutMs: Number.isFinite(d) ? d : debut,
        finMs: f,
        gauche: ((Number.isFinite(d) ? d : debut) - debut) / total,
        largeur: Math.max((f - (Number.isFinite(d) ? d : debut)) / total, 0.012),
      });
    }

    const parModele = new Map();
    for (const etape of etapes) {
      if (!etape.llm) continue;
      const cle = `${etape.llm.via}:${etape.llm.model}`;
      const acc = parModele.get(cle) || { modele: cle, cout: 0, entree: 0, sortie: 0, etapes: 0 };
      acc.cout += etape.coutEquivalentUsd || 0;
      acc.entree += (etape.tokens && etape.tokens.entree) || 0;
      acc.sortie += (etape.tokens && etape.tokens.sortie) || 0;
      acc.etapes += 1;
      parModele.set(cle, acc);
    }

    // Deux étapes lancées ensemble sur la même machine se recouvrent : posées sur une seule
    // ligne, la seconde cachait la première, et le parallélisme — ce que la timeline est
    // censée montrer — devenait invisible. Chacune descend donc sur la première ligne libre.
    const empiler = (barres) => {
      const lignes = [];
      for (const barre of [...barres].sort((a, b) => a.debutMs - b.debutMs)) {
        const libre = lignes.find((ligne) => ligne[ligne.length - 1].finMs <= barre.debutMs);
        if (libre) libre.push(barre);
        else lignes.push([barre]);
      }
      return lignes;
    };

    return {
      debut,
      fin,
      total,
      enCours,
      voies: [...voies.entries()].map(([machine, barres]) => ({ machine, lignes: empiler(barres) })),
      parModele: [...parModele.values()].sort((a, b) => b.cout - a.cout),
      jetonsTotal: etapes.reduce((n, e) => n + ((e.tokens && e.tokens.entree) || 0) + ((e.tokens && e.tokens.sortie) || 0), 0),
    };
  }, [run, maintenant]);
}
