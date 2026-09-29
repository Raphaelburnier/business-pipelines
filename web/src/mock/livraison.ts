// La livraison dans la maquette (docs/SPEC-livraison.md, §5.3) : une version disponible, puis,
// après le clic, les étapes du livreur l'une après l'autre, le cockpit qui « redémarre »
// (l'API ne répond plus quelques secondes) et l'issue. `?livraison=restauree` dans l'adresse
// fait échouer la bascule, pour voir la restauration. Même forme que la vraie API.
import type { CommitLivraison, EtapeLivraison, Livraison, ReponseLivraison, VersionsLivraison } from "../types";

const sha = (c: string) => c.repeat(40);
const EN_PRODUCTION: VersionsLivraison = { cockpit: sha("3"), moteur: sha("c"), registre: sha("d") };
const DISPONIBLE: VersionsLivraison = { cockpit: sha("8"), moteur: sha("c"), registre: sha("d") };

const COMMITS: CommitLivraison[] = [
  { sha: sha("8"), titre: "feat: carte Livraison dans Décisions", auteur: "Claude", date: "2026-09-29T13:10:00Z" },
  { sha: sha("7"), titre: "feat: API de livraison du cockpit", auteur: "Claude", date: "2026-09-29T12:55:00Z" },
  { sha: sha("6"), titre: "fix: le runner ne reprend que ses commandes", auteur: "Claude", date: "2026-09-29T11:20:00Z" },
];

// Le déroulé, en secondes depuis le clic. Pendant la bascule, le cockpit ne répond plus.
const DEROULE: Array<{ a: number; etape: EtapeLivraison; ligne: string }> = [
  { a: 1, etape: "verifier", ligne: "Identité et commits vérifiés" },
  { a: 3, etape: "preparer", ligne: "Release cockpit-20260929-141500 préparée" },
  { a: 5, etape: "sauvegarder", ligne: "business-cockpit-8888888-ccccccc-ddddddd.tar.gz: OK" },
  { a: 7, etape: "construire", ligne: "Construction des images..." },
  { a: 12, etape: "basculer", ligne: "Bascule..." },
  { a: 17, etape: "sante", ligne: " Container business_cockpit  Started" },
];
const INJOIGNABLE: [number, number] = [13, 17];
const FIN = 19;

export function livraisonMaquette(maintenant: () => number) {
  // Les tests du front tournent sous Node, sans `window`.
  const recherche = typeof window === "undefined" ? "" : window.location.search;
  const restauree = new URLSearchParams(recherche).get("livraison") === "restauree";
  let clic: number | null = null;
  const historique: Livraison[] = [
    {
      id: "livraison-precedente",
      par: "destrobi28@gmail.com",
      statut: "done",
      cible: EN_PRODUCTION,
      demandeeLe: "2026-09-29T12:14:00Z",
      termineeLe: "2026-09-29T12:21:00Z",
      etape: "sante",
      issue: "livree",
      raison: null,
      release: "cockpit-20260929-141337",
      journal: [],
    },
  ];

  function enCours(ecoule: number): Livraison {
    const faits = DEROULE.filter((d) => ecoule >= d.a);
    return {
      id: "livraison-maquette",
      par: "destrobi28@gmail.com",
      statut: faits.length ? "taken" : "pending",
      cible: DISPONIBLE,
      demandeeLe: new Date(clic ?? maintenant()).toISOString(),
      termineeLe: null,
      etape: faits.at(-1)?.etape ?? null,
      issue: null,
      raison: null,
      release: faits.length >= 2 ? "cockpit-20260929-141500" : null,
      journal: faits.map((d) => d.ligne),
    };
  }

  function terminee(): Livraison {
    const base = enCours(FIN);
    return restauree
      ? {
          ...base,
          statut: "refused",
          termineeLe: new Date().toISOString(),
          etape: "restaurer",
          issue: "restauree",
          raison: "échec après la bascule : version précédente restaurée",
          journal: [...base.journal.slice(0, -1), "Échec après la bascule ; restauration du cockpit et du runner précédents..."],
        }
      : { ...base, statut: "done", termineeLe: new Date().toISOString(), issue: "livree" };
  }

  return {
    async livraison(): Promise<ReponseLivraison> {
      const ecoule = clic === null ? -1 : (maintenant() - clic) / 1000;
      if (ecoule >= INJOIGNABLE[0] && ecoule < INJOIGNABLE[1]) throw new Error("le cockpit ne répond pas");
      const fini = ecoule >= FIN;
      const livre = fini && !restauree;
      return {
        proposition: {
          enProduction: livre ? DISPONIBLE : EN_PRODUCTION,
          disponible: livre ? null : DISPONIBLE,
          commits: { cockpit: livre ? [] : COMMITS, moteur: [], registre: [] },
          calculeeLe: new Date(maintenant()).toISOString(),
        },
        erreur: null,
        enCours: clic !== null && !fini ? enCours(ecoule) : null,
        historique: fini ? [terminee(), ...historique] : historique,
        peutLivrer: true,
      };
    },
    async livrer(cible: VersionsLivraison) {
      if (clic !== null && (maintenant() - clic) / 1000 < FIN) throw new Error("une livraison est déjà en cours");
      if (cible.cockpit !== DISPONIBLE.cockpit) throw new Error("la proposition a changé depuis l'affichage : recharger avant de livrer");
      clic = maintenant();
      return { id: "livraison-maquette", statut: "pending" };
    },
  };
}
