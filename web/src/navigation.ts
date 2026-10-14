import { ecrireBrouillon, lireBrouillon } from "./donnees/brouillons";

// Naviguer depuis une vue sans recevoir le routeur en props : l'App écoute `popstate`, qui
// suffit à lui faire relire l'adresse.
export function naviguer(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

// La dernière conversation ouverte dans « Demander » : le menu y ramène au lieu d'ouvrir une
// nouvelle question, tant qu'on n'en a pas commencé une autre.
const CLE_FIL = "demander:fil";

export function retenirFilDemander(id: string | null): void {
  ecrireBrouillon(CLE_FIL, id ?? "", (v) => !v);
}

export function lienDemander(): string {
  const id = lireBrouillon<string>(CLE_FIL);
  return id ? `/demander/${encodeURIComponent(id)}` : "/demander";
}
