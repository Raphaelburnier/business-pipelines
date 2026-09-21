// Le dashboard des agents (§11.5) : la liste live des étapes, filtrable par projet et par
// machine. Ce qu'on regarde pour savoir qui travaille, où, avec quel modèle, et ce que ça
// coûte, sans ouvrir les runs un par un.
import { useMemo, useState } from "react";
import { useCharge, useHorloge } from "../donnees/contexte";
import { VIDE, duree, jetons, usd } from "../format";
import type { Etape, RunDetaille } from "../types";
import { Erreur, Etat, Titre, Vide } from "../ui";
import type { Selection } from "../topologie/Topologie";

type Ligne = Etape & { run: RunDetaille };

// Ce qui tourne d'abord, puis ce qui attend quelqu'un, puis le reste, le plus récent en tête.
const RANG: Record<Etape["statut"], number> = { running: 0, waiting_approval: 1, waiting_quota: 1, failed: 2, cancelled: 3, succeeded: 3 };

export function Agents({ onSelection }: { onSelection: (s: Selection) => void }) {
  const maintenant = useHorloge();
  const [projet, setProjet] = useState("");
  const [machine, setMachine] = useState("");
  const { donnees, erreur } = useCharge(async (s) => {
    const runs = await s.runs({ limite: 10 });
    const details = await Promise.all(runs.map((r) => s.run(r.id)));
    return details.filter((r): r is RunDetaille => r !== null);
  }, []);

  const lignes = useMemo<Ligne[]>(() => {
    const toutes = (donnees ?? []).flatMap((run) => run.etapes.map((e) => ({ ...e, run })));
    return toutes.sort((a, b) => RANG[a.statut] - RANG[b.statut] || Date.parse(b.debut ?? "") - Date.parse(a.debut ?? ""));
  }, [donnees]);
  const projets = [...new Set(lignes.map((l) => l.run.projet).filter((p): p is string => Boolean(p)))].sort();
  const machines = [...new Set(lignes.map((l) => l.machine).filter((m): m is string => Boolean(m)))].sort();
  const visibles = lignes.filter((l) => (!projet || l.run.projet === projet) && (!machine || l.machine === machine));

  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!donnees) return <p className="text-sm text-douce">Lecture des étapes…</p>;

  return (
    <section className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Titre compteur={visibles.length}>Étapes</Titre>
        <select value={projet} onChange={(e) => setProjet(e.target.value)} className="ml-auto rounded-lg border border-trait bg-carte px-2 py-1 text-xs" aria-label="Filtrer par projet">
          <option value="">tous les projets</option>
          {projets.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select value={machine} onChange={(e) => setMachine(e.target.value)} className="rounded-lg border border-trait bg-carte px-2 py-1 text-xs" aria-label="Filtrer par machine">
          <option value="">toutes les machines</option>
          {machines.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>

      {!visibles.length ? (
        <Vide>Aucune étape ne correspond.</Vide>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-trait">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-surface text-[11px] uppercase tracking-wide text-douce">
              <tr>
                <th className="px-2 py-1.5 font-semibold">agent</th>
                <th className="px-2 py-1.5 font-semibold">projet</th>
                <th className="hidden px-2 py-1.5 font-semibold sm:table-cell">machine</th>
                <th className="hidden px-2 py-1.5 font-semibold md:table-cell">modèle</th>
                <th className="px-2 py-1.5 font-semibold">statut</th>
                <th className="px-2 py-1.5 text-right font-semibold">durée</th>
                <th className="hidden px-2 py-1.5 text-right font-semibold sm:table-cell">jetons</th>
                <th className="px-2 py-1.5 text-right font-semibold">coût</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((l) => (
                <tr key={l.id} className="cursor-pointer border-t border-trait bg-carte hover:bg-fond" onClick={() => onSelection({ type: "run", id: l.run.id })}>
                  <td className="px-2 py-1.5">
                    <div className="font-mono">{l.agent ?? l.type}</div>
                    <div className="text-[11px] text-douce">
                      {l.noeud}
                      {l.tour > 0 && <span className="text-alerte"> · tour {l.tour + 1}</span>}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">{l.run.projet ?? VIDE}</td>
                  <td className="hidden px-2 py-1.5 font-mono sm:table-cell">{l.machine ?? VIDE}</td>
                  <td className="hidden px-2 py-1.5 font-mono md:table-cell">{l.llm ? `${l.llm.via}:${l.llm.model}` : VIDE}</td>
                  <td className="px-2 py-1.5">
                    <Etat etat={l.statut} />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{l.debut ? duree((l.fin ? Date.parse(l.fin) : maintenant) - Date.parse(l.debut)) : VIDE}</td>
                  <td className="hidden px-2 py-1.5 text-right tabular-nums sm:table-cell">{l.tokens.entree ? jetons(l.tokens.entree + l.tokens.sortie) : VIDE}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums" title="Équivalent API, pas une dépense">
                    {l.coutEquivalentUsd ? usd(l.coutEquivalentUsd) : VIDE}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
