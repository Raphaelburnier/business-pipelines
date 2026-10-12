// Réponses simulées, visibles seulement quand la source du cockpit est « maquette ».
import type { BrouillonEquipe, FilEquipe, OptionsDiscussion } from "../donnees/discussions";
import type { Source } from "../donnees/source";
type Methodes = Pick<Source, "optionsDiscussion" | "filsEquipe" | "filEquipe" | "ouvrirDiscussion" | "envoyerEquipe" | "preparerBrouillonEquipe" | "brouillonEquipe">;

export function discussionsMaquette(): Methodes {
  const fils = new Map<string, FilEquipe>();
  const drafts = new Map<string, BrouillonEquipe>();
  const dates = () => new Date().toISOString();
  const membres: OptionsDiscussion["membres"] = [
    { membre: "camille", nom: "Camille", role: "Stratégie marketing", llm: { via: "claude", model: "sonnet" } },
    { membre: "elise", nom: "Élise", role: "Analyste marché", llm: { via: "codex", model: "gpt-5.6-terra:high" } },
    { membre: "jules", nom: "Jules", role: "Rédacteur", llm: { via: "claude", model: "sonnet" } },
  ];
  const lire = (id: string) => { const f = fils.get(id); if (!f) throw new Error("Fil de maquette inconnu"); return structuredClone(f); };
  function tour(f: FilEquipe, contenu: string, type: "message" | "directive", destinataires = f.participants.map((p) => p.membre)) {
    const id = crypto.randomUUID();
    f.tours.push({ id, contenu, type, destinataires, par: "Raphaël (maquette)", creeLe: dates(), commande: crypto.randomUUID(), run: null, statut: "succeeded", erreur: null,
      reponses: destinataires.map((membre) => ({ membre, noeud: `repond-${membre}`, modeleObserve: f.participants.find((p) => p.membre === membre)?.llm.model ?? null,
        reponse: { contenu: `Réponse simulée depuis mon rôle sur « ${f.objectif} ». Le message est conservé${type === "directive" ? " comme directive" : ""}.`, questions: [],
          propositions: [{ titre: "Améliorer la présentation du projet", objectif: "Présenter clairement la valeur du projet", criteres: ["Promesse et appel à l'action visibles"], document: `Proposition de maquette pour ${f.projet}. Revoir la présentation et conserver le comportement existant.` }] } })) });
    f.majLe = dates();
  }
  return {
    optionsDiscussion: async (projectId) => ({ projectId, nom: projectId, configuration: "0".repeat(64), membres }),
    filsEquipe: async (projectId) => [...fils.values()].filter((f) => !projectId || f.projectId === projectId).map(({ tours: _t, brouillons: _b, ...f }) => structuredClone(f)),
    filEquipe: async (id) => lire(id),
    ouvrirDiscussion: async (d) => {
      if (fils.has(d.requestId)) return lire(d.requestId);
      const f: FilEquipe = { id: d.requestId, projectId: d.projectId, projet: d.projectId, objectif: d.objectif, creeLe: dates(), majLe: dates(),
        participants: d.participants.map((p) => ({ ...membres.find((m) => m.membre === p.membre)!, ...p })), tours: [], brouillons: [] };
      tour(f, d.contenu, d.type); fils.set(f.id, f); return lire(f.id);
    },
    envoyerEquipe: async (id, d) => { const f = fils.get(id); if (!f) throw new Error("Fil inconnu"); tour(f, d.contenu, d.type, d.destinataires); return lire(id); },
    preparerBrouillonEquipe: async (id, d) => {
      const f = fils.get(id); const p = f?.tours.find((t) => t.id === d.tour)?.reponses.find((r) => r.membre === d.membre)?.reponse.propositions[d.proposition];
      if (!f || !p) throw new Error("Proposition inconnue");
      const b: BrouillonEquipe = { ...p, id: d.requestId, projectId: f.projectId, origine: { fil: id, tour: d.tour, membre: d.membre, proposition: d.proposition },
        creeLe: dates(), objectifProjet: f.objectif, directives: f.tours.filter((t) => t.type === "directive").map((t) => t.contenu) };
      drafts.set(b.id, b); f.brouillons.push(b); return structuredClone(b);
    },
    brouillonEquipe: async (id) => { const b = drafts.get(id); if (!b) throw new Error("Brouillon inconnu"); return structuredClone(b); },
  };
}
