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

/** Une commande que le cockpit a refusée : son message est la raison donnée par le serveur. */
export class CommandeRefusee extends Error {}

/**
 * Attend qu'une commande sans run (pause de la file, réglage) soit faite ou refusée. Une
 * lecture ratée est retentée ; plusieurs d'affilée, ou une minute sans réponse, deviennent
 * une erreur que l'appelant affiche au lieu de l'avaler.
 */
export async function attendreCommande(
  source: Pick<Source, "commande">,
  id: string,
  { intervalleMs = 500, delaiMs = 60_000, echecsMax = 5, patienter = (ms: number) => new Promise<void>((fin) => setTimeout(fin, ms)) } = {}
): Promise<Commande> {
  const limite = Date.now() + delaiMs;
  let echecs = 0;
  for (;;) {
    try {
      const commande = await source.commande(id);
      echecs = 0;
      if (commande.statut === "refused") throw new CommandeRefusee(commande.resultat?.raison || "Le cockpit a refusé la commande.");
      if (commande.statut === "done") return commande;
    } catch (err) {
      if (err instanceof CommandeRefusee) throw err;
      echecs += 1;
      if (echecs >= echecsMax) throw err;
    }
    if (Date.now() >= limite) throw new Error("La commande est restée sans réponse pendant une minute. Vérifie l'état du cockpit avant de réessayer.");
    await patienter(intervalleMs);
  }
}
