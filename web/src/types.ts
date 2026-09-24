// Les types du front, tirés des schémas zod de `agent-orchestrator/packages/schemas/cockpit.js`.
//
// Jamais écrits à la main (annexe A) : l'API, les fixtures de la maquette et l'écran lisent
// la même forme. Un champ ajouté au schéma apparaît ici sans rien toucher ; un champ retiré
// casse `tsc` là où l'écran s'en servait.
import type { z } from "zod";
import type { cockpit } from "@schemas/cockpit";
import type { modeles } from "@schemas/modeles";

export type EtatMachine = z.infer<typeof cockpit.etatMachine>;
export type StatutRun = z.infer<typeof cockpit.statutRun>;
export type StatutEtape = z.infer<typeof cockpit.statutEtape>;
export type Machine = z.infer<typeof cockpit.machine>;
export type Approbation = z.infer<typeof cockpit.approbation>;
export type Etape = z.infer<typeof cockpit.etape>;
export type Run = z.infer<typeof cockpit.run>;
export type RunDetaille = z.infer<typeof cockpit.runDetaille>;
export type Evenement = z.infer<typeof cockpit.evenement>;
export type EtatProjet = z.infer<typeof cockpit.etatProjet>;
export type ProjetTopologie = z.infer<typeof cockpit.projetTopologie>;
export type Topologie = z.infer<typeof cockpit.topologie>;
export type Usage = z.infer<typeof cockpit.usage>;

export type EtatModele = z.infer<typeof modeles.etatModele>;
export type Modele = z.infer<typeof modeles.modele>;
export type ReponseModeles = z.infer<typeof modeles.reponse>;
export type Llm = Modele["llm"];
