// La source réelle : l'API REST du cockpit et son flux SSE (§10).
import type { Evenement, Run, RunDetaille, Topologie, Usage } from "../types";
import type { FiltreRuns, Source } from "./source";

class ErreurApi extends Error {
  readonly code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

async function lire<T>(chemin: string): Promise<T> {
  const reponse = await fetch(chemin, { headers: { accept: "application/json" } });
  const corps: unknown = await reponse.json().catch(() => ({ erreur: "réponse illisible" }));
  if (!reponse.ok) {
    const message =
      corps && typeof corps === "object" && "erreur" in corps && typeof corps.erreur === "string" ? corps.erreur : `${reponse.status}`;
    throw new ErreurApi(message, reponse.status);
  }
  return corps as T;
}

async function ecrire<T>(chemin: string, corps: unknown): Promise<T> {
  const reponse = await fetch(chemin, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
  const lu: unknown = await reponse.json().catch(() => ({ erreur: "réponse illisible" }));
  if (!reponse.ok) {
    const message = lu && typeof lu === "object" && "erreur" in lu && typeof lu.erreur === "string" ? lu.erreur : `${reponse.status}`;
    throw new ErreurApi(message, reponse.status);
  }
  return lu as T;
}

export function sourceApi(): Source {
  return {
    nom: "api",
    topologie: () => lire<Topologie>("/api/topology"),
    async runs(filtre: FiltreRuns = {}) {
      const params = new URLSearchParams();
      if (filtre.project) params.set("project", filtre.project);
      if (filtre.status) params.set("status", filtre.status);
      if (filtre.limite) params.set("limite", String(filtre.limite));
      const suite = params.toString();
      return (await lire<{ runs: Run[] }>(`/api/runs${suite ? `?${suite}` : ""}`)).runs;
    },
    async run(id: string) {
      try {
        return await lire<RunDetaille>(`/api/runs/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err instanceof ErreurApi && err.code === 404) return null;
        throw err;
      }
    },
    usage: () => lire<Usage>("/api/usage"),
    async lancerRun(projectId, pipelineIndex = 0) {
      const reponse = await ecrire<{ commande: { id: string; statut: string } }>("/api/runs", { projectId, pipelineIndex });
      return reponse.commande;
    },
    ecouter(surEvenement, surConnexion, runId) {
      // `EventSource` reconnecte seul et renvoie `Last-Event-ID` : une coupure ne perd rien,
      // le serveur reprend après le dernier événement reçu.
      const source = new EventSource(runId ? `/api/stream?run=${encodeURIComponent(runId)}` : "/api/stream");
      source.onopen = () => surConnexion(true);
      source.onerror = () => surConnexion(false);
      source.addEventListener("evenement", (message: MessageEvent<string>) => {
        surEvenement(JSON.parse(message.data) as Evenement);
      });
      return () => source.close();
    },
  };
}
