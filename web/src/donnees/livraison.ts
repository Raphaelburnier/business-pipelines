import type { VersionsLivraison } from "../types";

/** Une confirmation porte sur les trois versions, même si la réponse API est recréée. */
export function confirmationLivraisonCourante(
  confirmation: VersionsLivraison | null,
  proposition: VersionsLivraison | null | undefined,
): boolean {
  return Boolean(confirmation && proposition &&
    confirmation.cockpit === proposition.cockpit &&
    confirmation.moteur === proposition.moteur &&
    confirmation.registre === proposition.registre);
}

/** La proposition est publiée hors du flux SSE ; elle se relit aussi sans livraison active. */
export function intervalleLivraison(suivre: boolean): number {
  return suivre ? 2500 : 10000;
}
