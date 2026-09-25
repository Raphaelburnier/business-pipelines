// Naviguer depuis une vue sans recevoir le routeur en props : l'App écoute `popstate`, qui
// suffit à lui faire relire l'adresse.
export function naviguer(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
