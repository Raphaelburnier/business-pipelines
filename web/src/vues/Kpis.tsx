// La barre KPI (§11, AgenticOS) : runs actifs, équivalent du jour et du mois, quotas. Une
// seule barre discrète, posée sur le graphe à l'accueil et en tête des autres vues. Le
// détail (période, reset) passe par le survol : aucune carte, aucune sparkline.
import { useCharge } from "../donnees/contexte";
import { VIDE, usd } from "../format";
import type { Usage } from "../types";

type Fenetre = NonNullable<NonNullable<Usage["quota"]>["cinqHeures"]>;

function Quota({ libelle, fenetre }: { libelle: string; fenetre: Fenetre | null | undefined }) {
  const valeur = fenetre?.utilisation ?? null;
  if (valeur === null) {
    return (
      <div className="ao-kpi" title="La jauge lit getUsage() du SDK : elle arrive avec le maître en service">
        <span className="k">{libelle}</span>
        <span className="v">{VIDE}</span>
      </div>
    );
  }
  const niveau = valeur >= 90 ? "danger" : valeur >= 70 ? "alerte" : "";
  return (
    <div className="ao-kpi" title={`${libelle} : ${valeur} % utilisés`}>
      <span className="k">{libelle}</span>
      <span className="v">{valeur} %</span>
      <span className={`barre ${niveau}`}>
        <i style={{ width: `${Math.min(100, valeur)}%` }} />
      </span>
    </div>
  );
}

export function Kpis({ flottant = false }: { flottant?: boolean }) {
  const { donnees: usage } = useCharge((s) => s.usage(), []);

  return (
    <div className={`ao-kpis ${flottant ? "flottant" : ""}`} role="group" aria-label="Indicateurs">
      <div className="ao-kpi">
        <span className="k">runs</span>
        <span className="v accent">{usage?.runsActifs ?? VIDE}</span>
        <span className="k">actifs</span>
      </div>
      <div className="ao-kpi" title="Sur abonnement, un équivalent API, pas une dépense">
        <span className="k">coût · jour</span>
        <span className="v">{usage ? usd(usage.coutEquivalentJourUsd) : VIDE}</span>
      </div>
      <div className="ao-kpi" title="Sur abonnement, un équivalent API, pas une dépense">
        <span className="k">coût · mois</span>
        <span className="v">{usage ? usd(usage.coutEquivalentMoisUsd) : VIDE}</span>
      </div>
      <Quota libelle="quota · 5 h" fenetre={usage?.quota?.cinqHeures} />
      <Quota libelle="quota · 7 j" fenetre={usage?.quota?.septJours} />
    </div>
  );
}
