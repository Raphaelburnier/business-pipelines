// Les pipelines connus du cockpit (`GET /api/pipelines`, src/pipelines-noms.js), typés ici
// comme l'équipe tant que la forme n'est pas promue dans les schémas du moteur.

export interface PipelineConnu {
  /** Identifiant sans version : `improve-app`. */
  id: string;
  /** Le nom choisi sur la page, sinon le titre du registre ; `null` si aucun des deux. */
  nom: string | null;
  perso: boolean;
  titreRegistre: string | null;
  versions: number[];
  /** Projets qui l'étendent dans leur fiche ou l'ont fait tourner. */
  projets: string[];
  runs: number;
  dernierRun: string | null;
}

/** Un rattachement demandé depuis la page : la PR que le publieur a ouverte, ou son refus. */
export interface Rattachement {
  id: string;
  projet: string;
  pipeline: string;
  statut: "pending" | "taken" | "done" | "refused";
  ok: boolean | null;
  raison: string | null;
  pr: { numero: number; url: string } | null;
  par: string;
  le: string;
}

export interface ReponsePipelines {
  pipelines: PipelineConnu[];
  /** Les projets qui ont une fiche, auxquels un pipeline peut être rattaché. */
  projets: { id: string; nom: string }[];
  /** Vrai pour une identité tailnet autorisée à livrer. */
  peutRattacher: boolean;
  rattachements: Rattachement[];
}

/** `improve-app@7` → `improve-app`. */
export const idPipeline = (ref: string): string => ref.split("@")[0] ?? ref;

/** `improve-app@7` → `v7` ; une référence sans version rend une chaîne vide. */
export const versionPipeline = (ref: string): string => {
  const v = ref.split("@")[1];
  return v ? `v${v}` : "";
};

/** Le nom à afficher : celui choisi, le titre du registre, sinon l'identifiant rendu lisible. */
export function nomPipeline(ref: string, connus: ReadonlyMap<string, PipelineConnu>): string {
  const id = idPipeline(ref);
  const nom = connus.get(id)?.nom;
  if (nom) return nom;
  const lisible = id.replace(/^adhoc:/, "").replace(/[-_:]+/g, " ").trim();
  return lisible ? lisible.charAt(0).toUpperCase() + lisible.slice(1) : ref;
}
