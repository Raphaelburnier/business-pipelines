// La livraison d'un run jusqu'au résultat GitHub : PR, CI, correction, fusion. Ce que relève
// le publieur, sans rien deviner : une raison absente est une raison que GitHub n'a pas donnée.
import { CLASSES_TON, depuis } from "../format";
import { liensLivraison, motCorrection, motLivraison, tonLivraison } from "../donnees/livraisonRun";
import { resumeAttestation } from "../donnees/revues";
import type { LivraisonRun as Livraison, StatutLivraison } from "../types";
import { Titre } from "../ui";

export function PastilleLivraison({ statut }: { statut: StatutLivraison }) {
  const c = CLASSES_TON[tonLivraison(statut)];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${c.texte} ${c.fond} ${c.bordure}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.plein} ${statut === "ci_running" ? "pulse-douce" : ""}`} />
      {motLivraison(statut)}
    </span>
  );
}

export function BlocLivraison({ livraison: l, maintenant }: { livraison: Livraison; maintenant: number }) {
  const c = CLASSES_TON[tonLivraison(l.statut)];
  return (
    <div>
      <Titre>Livraison GitHub</Titre>
      <div className={`rounded-lg border-l-4 ${c.bordure} bg-carte p-2 text-sm`}>
        <div className="flex flex-wrap items-center gap-2">
          <PastilleLivraison statut={l.statut} />
          {l.depot && <span className="font-mono text-[11px] text-douce">{l.depot}</span>}
        </div>
        {l.raison && <p className="mt-1">{l.raison}</p>}
        {l.correction && <p className="mt-1 text-[12px] text-douce">{motCorrection(l.correction)}</p>}
        <p className="mt-1 font-mono text-[11px] text-douce" title="Arbre testé et revu par le superviseur ; la fusion exige qu'il soit celui de la tête">
          {l.attestation ? resumeAttestation(l.attestation) : "aucune preuve attestée : fusion explicite seulement"}
        </p>
        <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-douce">
          <span title="Branche et commit livrés par le run">
            {l.branche} @ {l.deliverySha.slice(0, 7)}
          </span>
          {l.headSha && l.headSha !== l.deliverySha && <span title="Tête actuelle de la PR">tête {l.headSha.slice(0, 7)}</span>}
          {l.baseSha && <span title="Base relevée sur GitHub">base {l.baseSha.slice(0, 7)}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
          {liensLivraison(l).map((lien) => (
            <a key={lien.url} className="font-semibold text-accent underline" href={lien.url} target="_blank" rel="noreferrer">
              {lien.libelle}
            </a>
          ))}
          {l.relueLe && <span className="text-[11px] text-douce">relu il y a {depuis(l.relueLe, maintenant)}</span>}
        </div>
      </div>
    </div>
  );
}
