// La barre du haut, commune aux vues (§11) : runs actifs, jauge de quota, dépense du mois.
// Elle dit aussi d'où viennent les données : une maquette qui se ferait passer pour le vrai
// système serait pire que pas de maquette.
import { useCharge, useSource } from "../donnees/contexte";
import { VIDE, usd } from "../format";
import { Jauge } from "../ui";

export function Barre() {
  const { source, connecte } = useSource();
  const { donnees: usage } = useCharge((s) => s.usage(), []);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
      <span className="tabular-nums">
        <span className="font-bold text-accent">{usage?.runsActifs ?? VIDE}</span> <span className="text-douce">runs actifs</span>
      </span>
      {usage?.quota ? (
        <>
          <Jauge valeur={usage.quota.cinqHeures?.utilisation ?? null} libelle="quota 5 h" />
          <Jauge valeur={usage.quota.septJours?.utilisation ?? null} libelle="7 j" />
        </>
      ) : (
        <span className="text-[11px] text-douce" title="La jauge lit getUsage() du SDK : elle arrive avec le maître en service (phase 5)">
          quota : non lu
        </span>
      )}
      <span className="tabular-nums" title="Sur abonnement, un équivalent API, pas une dépense">
        <span className="font-semibold">{usage ? usd(usage.coutEquivalentMoisUsd) : VIDE}</span> <span className="text-douce">équivalent ce mois</span>
      </span>
      <span className="ml-auto flex items-center gap-3">
        {source.nom === "maquette" && <span className="rounded-full bg-alerte-fond px-2 py-0.5 text-[11px] font-bold text-alerte">maquette</span>}
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${connecte ? "text-ok" : "text-danger"}`}>
          <span className={`h-2 w-2 rounded-full ${connecte ? "bg-ok pulse-douce" : "bg-danger"}`} />
          {connecte ? "en direct" : "flux interrompu"}
        </span>
      </span>
    </div>
  );
}
