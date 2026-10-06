// L'équipe d'agents (`GET /api/equipe`, src/equipe.js). Typée ici, comme les décisions,
// tant que la forme n'est pas promue dans les schémas du moteur.
import type { Llm } from "../types";

export type Famille = "claude" | "codex" | "libre";

export interface MembreEquipe {
  id: string;
  nom: string;
  role: string;
  famille: Famille;
  llm: Llm;
  registre: string[];
  budgetMensuelUsd: number | null;
  occupe: boolean;
  projet: string | null;
  depuis: string | null;
  enCours: { run: string; projet: string | null; noeud: string } | null;
  usage: { consommeMoisUsd: number; budgetMensuelUsd: number | null; resteUsd: number | null };
}

export interface ReponseEquipe {
  agents: MembreEquipe[];
  /** Les fiches `projects/<id>` connues, proposées à l'affectation. */
  projets: string[];
  /** Faux quand l'event store est indisponible : activité et consommation sont alors inconnues. */
  mesure: boolean;
}
