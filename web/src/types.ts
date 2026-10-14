// Les types du front, tirés des schémas zod de `agent-orchestrator/packages/schemas/cockpit.js`.
//
// Jamais écrits à la main (annexe A) : l'API, les fixtures de la maquette et l'écran lisent
// la même forme. Un champ ajouté au schéma apparaît ici sans rien toucher ; un champ retiré
// casse `tsc` là où l'écran s'en servait.
import type { z } from "zod";
import type { cockpit } from "@schemas/cockpit";
import type { modeles } from "@schemas/modeles";
import type { chat } from "@schemas/chat";
import type { livraison } from "@schemas/livraison";

export type EtatMachine = z.infer<typeof cockpit.etatMachine>;
export type StatutRun = z.infer<typeof cockpit.statutRun>;
export type StatutEtape = z.infer<typeof cockpit.statutEtape>;
export type Machine = z.infer<typeof cockpit.machine>;
export type Approbation = z.infer<typeof cockpit.approbation>;
export type Etape = z.infer<typeof cockpit.etape>;
export type Run = z.infer<typeof cockpit.run>;
/** La livraison d'un run jusqu'à GitHub ; `Livraison` plus bas est celle du cockpit sur le NAS. */
export type LivraisonRun = z.infer<typeof cockpit.livraison>;
export type StatutLivraison = z.infer<typeof cockpit.statutLivraison>;
export type RunDetaille = z.infer<typeof cockpit.runDetaille>;
/** Outils réellement vus dans les événements du moteur, ajoutés par l'API cockpit au détail. */
export type EtapeAvecOutils = Etape & { outils: string[] };
export type RunDetailleAvecOutils = Omit<RunDetaille, "etapes"> & { etapes: EtapeAvecOutils[] };
export type Evenement = z.infer<typeof cockpit.evenement>;
export type EtatProjet = z.infer<typeof cockpit.etatProjet>;
export type ProjetTopologie = z.infer<typeof cockpit.projetTopologie>;
export type Topologie = z.infer<typeof cockpit.topologie>;
export type Usage = z.infer<typeof cockpit.usage>;

export type EtatModele = z.infer<typeof modeles.etatModele>;
export type Modele = z.infer<typeof modeles.modele>;
export type ReponseModeles = z.infer<typeof modeles.reponse>;
export type Llm = Modele["llm"];

export type MessageChat = z.infer<typeof chat.message>;
export type FilChat = z.infer<typeof chat.fil>;
export type FilDetaille = z.infer<typeof chat.filDetaille>;
export type ListeFils = z.infer<typeof chat.listeFils>;
export type AgentChat = z.infer<typeof chat.agent>;
export type ActionChat = z.infer<typeof chat.action>;

export type VersionsLivraison = z.infer<typeof livraison.versions>;
export type CommitLivraison = z.infer<typeof livraison.commit>;
export type PropositionLivraison = z.infer<typeof livraison.proposition>;
export type EtapeLivraison = z.infer<typeof livraison.etape>;
export type Livraison = z.infer<typeof livraison.livraison>;
export type ReponseLivraison = z.infer<typeof livraison.reponse>;
