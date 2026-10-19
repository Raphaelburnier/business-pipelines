// Les branches métier servies par `GET /api/natures`. Le choix de nature d'une mission, ses
// libellés et la page Branches les lisent au lieu d'une liste écrite en dur : une nature
// ajoutée au registre apparaît sans toucher au front.

// Écrit à la main : le schéma `nature` vit dans packages/schemas/index.js du moteur, que le
// tsconfig strict du front ne peut pas importer sans vérifier tout ce fichier.
export interface Nature {
  id: string;
  libelle: string;
  description: string;
  tags: string[];
  handlers: string[];
  priorite: number;
}

export interface Branche extends Nature {
  /** `dediees` : le cockpit a des règles propres à cette nature ; sinon les règles génériques. */
  regles: "dediees" | "generiques";
  pipelines: string[];
  projets: Array<{ id: string; nom: string }>;
}

export interface ReponseNatures {
  natures: Branche[];
}

/** Libellé d'une nature pour l'écran, ou un libellé neutre si elle n'est pas (encore) connue. */
export function libelleNature(natures: readonly Pick<Nature, "id" | "libelle">[] | null | undefined, id: string | null | undefined): string {
  if (!id) return "Mission";
  return natures?.find((n) => n.id === id)?.libelle ?? (id === "autre" ? "Mission" : id);
}
