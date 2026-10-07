// Les revues indépendantes d'un run : qui a relu, avec quel modèle, sur quel arbre, et ce
// qui bloque. Le verdict est celui du superviseur, calculé depuis les gravités.
import { CLASSES_TON } from "../format";
import { localisation, motifsBlocage, motRevue, tonRevue, type Revue } from "../donnees/revues";
import type { LivraisonRun } from "../types";
import { Titre } from "../ui";

function PastilleRevue({ revue }: { revue: Revue }) {
  const c = CLASSES_TON[tonRevue(revue)];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${c.texte} ${c.fond} ${c.bordure}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.plein}`} />
      {motRevue(revue)}
    </span>
  );
}

export function BlocMotifs({ revues, livraison }: { revues: Revue[]; livraison: LivraisonRun | null }) {
  const motifs = motifsBlocage(revues, livraison);
  if (!motifs.length) return null;
  return (
    <div className="rounded-lg border-l-4 border-alerte bg-alerte-fond p-2 text-sm">
      <div className="font-semibold">Ce qui bloque</div>
      <ul className="mt-1 list-disc pl-4 text-[12px]">
        {motifs.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}

export function BlocRevues({ revues }: { revues: Revue[] }) {
  if (!revues.length) return null;
  return (
    <div>
      <Titre compteur={revues.length}>Revues indépendantes</Titre>
      <ul className="flex flex-col gap-1">
        {revues.map((r, i) => (
          <li key={`${r.noeud}-${r.fin}-${i}`} className={`rounded-lg border border-trait bg-carte p-2 text-sm ${r.perimee ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{r.noeud}</span>
              <PastilleRevue revue={r} />
              <span className="ml-auto font-mono text-[11px] text-douce" title="Arbre revu, calculé par le superviseur">
                arbre {r.arbre.slice(0, 7)}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-douce">
              <span title="Agent du registre">{r.agent}</span>
              <span title="Runtime et modèle réellement utilisés">
                {r.llm.via}:{r.llm.model}
              </span>
              {r.session && <span title="Session neuve du reviewer">session {r.session.slice(0, 8)}</span>}
              <span>
                P0 {r.comptes.P0} · P1 {r.comptes.P1} · P2 {r.comptes.P2} · P3 {r.comptes.P3}
              </span>
            </div>
            {r.invalide && <p className="mt-1 text-[12px] text-danger">{r.invalide}</p>}
            {r.resume && <p className="mt-1 text-[12px]">{r.resume}</p>}
            {r.findings.length > 0 && (
              <ul className="mt-1 flex flex-col gap-0.5 text-[12px]">
                {r.findings.map((f, j) => (
                  <li key={j} className={f.bloquant ? "font-semibold" : ""}>
                    <span className="font-mono">{f.gravite}</span> {f.titre}
                    {localisation(f) && <span className="ml-1 font-mono text-[11px] text-douce">{localisation(f)}</span>}
                    <div className="font-normal text-douce">{f.detail}</div>
                  </li>
                ))}
              </ul>
            )}
            {r.nonVerifies.length > 0 && (
              <div className="mt-1 text-[11px] text-douce">
                non vérifié : {r.nonVerifies.join(" ; ")}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
