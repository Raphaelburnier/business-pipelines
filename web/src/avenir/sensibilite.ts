import politique from "../../../deploy/fichiers-sensibles.json";
import type { Etape } from "./feuille";

const motifs = politique.motifs.map((source) => new RegExp(source, "i"));
const workflows = /^(agent-gated-merge|ci-autofix|ci|claude|claude-code-review)\.ya?ml$/i;

export function cheminReference(reference: string): string {
  const chemin = reference.trim().replace(/^(BP|AO|REG|AS)\s+/, "").replace(/:\d[\d,\s-]*$/, "");
  return workflows.test(chemin) ? `.github/workflows/${chemin}` : chemin;
}

// Le cadrage peut demander une revue supplémentaire, jamais retirer la protection
// déduite des fichiers. Le publieur contrôle ensuite les vrais chemins de la PR.
export function sensibiliteEtape(etape: Pick<Etape, "fichiers" | "raisonSensibilite">) {
  const fichiersProteges = etape.fichiers.filter((reference) => motifs.some((motif) => motif.test(cheminReference(reference))));
  const raison = etape.raisonSensibilite?.trim();
  const raisons = [
    ...fichiersProteges.map((reference) => `Fichier protégé annoncé : ${reference}.`),
    ...(raison ? [`Risque signalé dans le cadrage : ${raison}`] : []),
  ];
  return { sensible: raisons.length > 0, fichiersProteges, raisons };
}
