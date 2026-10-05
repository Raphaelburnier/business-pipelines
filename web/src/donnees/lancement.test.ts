import { afterEach, describe, expect, test, vi } from "vitest";
import { suivreCommande } from "./lancement";
import type { Commande } from "./source";

const commande = (statut: Commande["statut"], run: string | null = null): Commande => ({ id: "c1", type: "run.start", statut, run, resultat: null });
afterEach(() => vi.useRealTimers());

describe("suivi du lancement", () => {
  test("suit la commande jusqu'au run même si le processus est encore en cours", async () => {
    vi.useFakeTimers();
    const lire = vi.fn().mockResolvedValueOnce(commande("pending")).mockResolvedValueOnce(commande("taken", "run-exact"));
    const recu = vi.fn();
    const arreter = suivreCommande({ commande: lire }, "c1", { surCommande: recu, surErreur: vi.fn() });
    await vi.runAllTimersAsync();
    expect(lire).toHaveBeenCalledTimes(2);
    expect(recu).toHaveBeenLastCalledWith(commande("taken", "run-exact"));
    expect(vi.getTimerCount()).toBe(0);
    arreter();
  });

  test("un refus conserve sa raison et termine le suivi", async () => {
    vi.useFakeTimers();
    const refuse = { ...commande("refused"), resultat: { ok: false, raison: "projet inconnu" } };
    const lire = vi.fn().mockResolvedValue(refuse);
    const recu = vi.fn();
    suivreCommande({ commande: lire }, "c1", { surCommande: recu, surErreur: vi.fn() });
    await vi.runAllTimersAsync();
    expect(recu).toHaveBeenCalledWith(refuse);
    expect(lire).toHaveBeenCalledTimes(1);
  });

  test("une coupure de lecture réessaie le suivi sans renvoyer le lancement", async () => {
    vi.useFakeTimers();
    const lire = vi.fn().mockRejectedValueOnce(new Error("hors ligne")).mockResolvedValueOnce(commande("done", "run1"));
    const erreur = vi.fn();
    suivreCommande({ commande: lire }, "c1", { surCommande: vi.fn(), surErreur: erreur });
    await vi.runAllTimersAsync();
    expect(erreur).toHaveBeenCalledOnce();
    expect(lire).toHaveBeenCalledTimes(2);
  });

  test("fermer le panneau ignore une réponse encore en vol", async () => {
    let resoudre!: (c: Commande) => void;
    const lire = vi.fn(() => new Promise<Commande>(resolve => { resoudre = resolve; }));
    const recu = vi.fn();
    const arreter = suivreCommande({ commande: lire }, "c1", { surCommande: recu, surErreur: vi.fn() });
    arreter();
    resoudre(commande("done", "run1"));
    await Promise.resolve();
    expect(recu).not.toHaveBeenCalled();
  });
});
