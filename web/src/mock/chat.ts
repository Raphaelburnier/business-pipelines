// La conversation de la maquette : en mémoire, et une réponse qui s'écrit en quelques
// secondes, pour voir chaque état de l'écran (en file, en cours, terminée) sans runner.
import type { ActionChat, AgentChat, FilDetaille, ListeFils, MessageChat } from "../types";

const REPONSES: Record<AgentChat, string> = {
  cockpit:
    "Le dernier run de TCG generator a échoué à l'étape verify : 3 tests sur 41 ne passent pas (run-echec, étape verify). " +
    "Les deux autres runs du jour ont réussi. Tu peux relancer depuis verify une fois les tests corrigés.",
  claude:
    "D'après _context/projects/steam-tierlist/etat-steam-tierlist.md, le tri par note manque encore. " +
    "Je te propose une mission courte, vérifiée par le planificateur : un agent de dev, les tests du projet, puis une revue indépendante.",
  codex:
    "Ta note notes/architecture-cockpit.md sépare bien lecture et écriture. Le point faible est ailleurs : " +
    "le runner porte à la fois les runs et le chat, donc un run long ne bloque pas le chat mais partage son quota.",
};

const MISSION: ActionChat = {
  type: "mission",
  id: "00000000-0000-4000-8000-000000000001",
  titre: "Tri par note dans la tier list",
  raison: "Demandé dans la conversation ; le planificateur l'accepte sans blocage.",
  spec: {
    projectId: "steam-tierlist",
    objectif: "Ajouter un tri par note décroissante à la tier list.",
    criteres: ["Le tri par note est disponible depuis l'en-tête", "Les tests du projet passent"],
    directives: "",
    exclusions: "Ne pas toucher au thème.",
    document: "",
    contexte: {},
    exigences: [],
    runtimesExclus: [],
  },
};

interface Brouillon {
  fil: Omit<FilDetaille, "messages" | "dernierMessage">;
  messages: Array<MessageChat & { demandeLe?: number }>;
}

export function chatMaquette(maintenant: () => number) {
  const fils: Brouillon[] = [];
  const iso = (t: number) => new Date(t).toISOString();

  // L'état d'une réponse se calcule depuis l'heure de la question : aucune minuterie.
  const vue = (b: Brouillon): FilDetaille => {
    const messages = b.messages.map(({ demandeLe, ...m }) => {
      if (m.role !== "assistant" || demandeLe === undefined) return m;
      const reponse = REPONSES[m.agent ?? "cockpit"];
      const ecoule = maintenant() - demandeLe;
      if (ecoule < 800) return { ...m, statut: "queued" as const };
      const fin = 800 + reponse.length * 12;
      if (ecoule < fin) return { ...m, statut: "streaming" as const, contenu: reponse.slice(0, Math.floor((ecoule - 800) / 12)) };
      const actions = m.agent === "claude" ? [MISSION] : [];
      return { ...m, statut: "complete" as const, contenu: reponse, termineLe: iso(demandeLe + fin), coutEquivalentUsd: m.agent === "codex" ? 0 : 0.004, actions };
    });
    return { ...b.fil, dernierMessage: messages.at(-1)?.contenu ?? null, messages };
  };

  const poser = async (contenu: string, filId: string | null = null, agent: AgentChat = "cockpit"): Promise<FilDetaille> => {
    const t = maintenant();
    let b = filId ? fils.find((f) => f.fil.id === filId) : undefined;
    if (!b) {
      b = { fil: { id: `fil-${fils.length + 1}`, titre: contenu.split("\n")[0]!.slice(0, 80), projet: null, creePar: "maquette", creeLe: iso(t), majLe: iso(t) }, messages: [] };
      fils.unshift(b);
    }
    const n = b.messages.length;
    b.messages.push(
      { id: `${b.fil.id}-${n}`, role: "user", contenu, statut: "complete", creeLe: iso(t), termineLe: iso(t), coutEquivalentUsd: 0, agent: null, actions: [] },
      { id: `${b.fil.id}-${n + 1}`, role: "assistant", contenu: "", statut: "queued", creeLe: iso(t), termineLe: null, coutEquivalentUsd: 0, agent, actions: [], demandeLe: t }
    );
    b.fil.majLe = iso(t);
    return vue(b);
  };

  return {
    fils: async (): Promise<ListeFils> => ({
      fils: fils.map((b) => {
        const { messages: _m, ...fil } = vue(b);
        return fil;
      }),
      usage: { coutEquivalentUsd: 0.21, plafondUsd: 10, depuis: iso(Date.UTC(2026, 8, 1)), bloque: false },
      modele: "sonnet",
      agents: [
        { id: "cockpit", nom: "Cockpit", modele: "sonnet" },
        { id: "claude", nom: "Claude", modele: "opus" },
        { id: "codex", nom: "Codex", modele: "gpt-5.6-terra:high" },
      ],
    }),
    fil: async (id: string) => {
      const b = fils.find((f) => f.fil.id === id);
      return b ? vue(b) : null;
    },
    poser,
  };
}
