import type { Commande, Source } from "./source";

/** Suit la commande sans renvoyer le lancement ; s'arrête au run ou au résultat terminal. */
export function suivreCommande(source: Pick<Source, "commande">, id: string, {
  surCommande,
  surErreur,
  intervalleMs = 1000,
}: { surCommande: (commande: Commande) => void; surErreur: (erreur: Error) => void; intervalleMs?: number }) {
  let arrete = false;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  async function lire() {
    if (arrete) return;
    try {
      const commande = await source.commande(id);
      if (arrete) return;
      surCommande(commande);
      if (commande.run || commande.statut === "done" || commande.statut === "refused") return;
    } catch (err) {
      if (arrete) return;
      surErreur(err instanceof Error ? err : new Error(String(err)));
    }
    if (!arrete) minuterie = setTimeout(() => { void lire(); }, intervalleMs);
  }
  void lire();
  return () => {
    arrete = true;
    if (minuterie) clearTimeout(minuterie);
  };
}
