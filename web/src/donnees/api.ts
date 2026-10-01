// La source réelle : l'API REST du cockpit et son flux SSE (§10).
import type { Evenement, FilDetaille, ListeFils, ReponseLivraison, ReponseModeles, Run, RunDetaille, Topologie, Usage } from "../types";
import type { DemandeDecision, FilConseil, ReponseApprobations, ReponseDecision } from "./decisions";
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
    modeles: () => lire<ReponseModeles>("/api/modeles"),
    fils: () => lire<ListeFils>("/api/chat"),
    async fil(id: string) {
      try {
        return await lire<FilDetaille>(`/api/chat/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err instanceof ErreurApi && err.code === 404) return null;
        throw err;
      }
    },
    ecouterFil(id, surFil, surFin) {
      // Le flux se ferme de lui-même en fin de réponse. S'il tombe avant, la relecture
      // prend le relais : une réponse ne reste jamais figée à l'écran.
      let arrete = false;
      let minuterie: ReturnType<typeof setInterval> | null = null;
      const flux = new EventSource(`/api/chat/${encodeURIComponent(id)}/flux`);
      const finir = () => {
        arrete = true;
        flux.close();
        if (minuterie) clearInterval(minuterie);
        surFin();
      };
      flux.addEventListener("fil", (m: MessageEvent<string>) => surFil(JSON.parse(m.data) as FilDetaille));
      flux.addEventListener("fin", finir);
      flux.onerror = () => {
        if (arrete || minuterie) return;
        flux.close();
        minuterie = setInterval(async () => {
          const fil = await lire<FilDetaille>(`/api/chat/${encodeURIComponent(id)}`).catch(() => null);
          if (!fil || arrete) return;
          surFil(fil);
          if (!fil.messages.some((m) => m.role === "assistant" && (m.statut === "queued" || m.statut === "streaming"))) finir();
        }, 1000);
      };
      return () => {
        arrete = true;
        flux.close();
        if (minuterie) clearInterval(minuterie);
      };
    },
    poser: (contenu, filId = null) =>
      ecrire<FilDetaille>(filId ? `/api/chat/${encodeURIComponent(filId)}/messages` : "/api/chat", { contenu }),
    async lancerRun(projectId, pipelineIndex = 0, llm = null) {
      const corps = llm ? { projectId, pipelineIndex, llmOverrides: { "*": llm } } : { projectId, pipelineIndex };
      const reponse = await ecrire<{ commande: { id: string; statut: string } }>("/api/runs", corps);
      return reponse.commande;
    },
    livraison: () => lire<ReponseLivraison>("/api/livraison"),
    async livrer(cible) {
      const reponse = await ecrire<{ commande: { id: string; statut: string } }>("/api/livraisons", cible);
      return reponse.commande;
    },
    approbations: () => lire<ReponseApprobations>("/api/approbations"),
    decider: (demande: DemandeDecision) => ecrire<ReponseDecision>("/api/decider", demande),
    filConseil: (dossier) => lire<FilConseil>(`/api/conseiller/dossiers/${encodeURIComponent(dossier)}`),
    poserConseil: (dossier, texte) => ecrire<FilConseil>(`/api/conseiller/dossiers/${encodeURIComponent(dossier)}/messages`, { texte }),
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
