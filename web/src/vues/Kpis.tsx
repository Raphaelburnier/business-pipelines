// La barre KPI (§11, AgenticOS) : runs actifs, équivalent du jour et du mois, quotas. Une
// seule barre discrète, posée sur le graphe à l'accueil et en tête des autres vues. Le
// détail (période, reset) passe par le survol : aucune carte, aucune sparkline.
import { useCharge } from "../donnees/contexte";
import { VIDE, usd } from "../format";
import type { Usage } from "../types";
import { ReserveClaude } from './ReserveClaude';

type Fenetre = NonNullable<NonNullable<Usage["quota"]>["cinqHeures"]>;

const HEURE_MS = 3_600_000;
// En début de fenêtre, quelques minutes de travail suffisent à projeter un épuisement absurde.
const PART_MIN_POUR_PROJETER = 0.05;

type Lecture = { utilisation: number; delta: number | null; epuisement: number | null; reset: number | null };

// Delta : part de la fenêtre écoulée moins part consommée. Positif, il reste de la marge.
function lire(fenetre: Fenetre, dureeMs: number, maintenant: number): Lecture | null {
  if (fenetre.utilisation === null) return null;
  const utilisation = fenetre.utilisation;
  const reset = fenetre.reinitialisation ? Date.parse(fenetre.reinitialisation) : Number.NaN;
  if (!Number.isFinite(reset)) return { utilisation, delta: null, epuisement: null, reset: null };
  const passe = maintenant - (reset - dureeMs);
  const delta = Math.min(100, Math.max(0, (passe / dureeMs) * 100)) - utilisation;
  const fin =
    utilisation > 0 && passe >= dureeMs * PART_MIN_POUR_PROJETER
      ? maintenant + ((100 - utilisation) * passe) / utilisation
      : null;
  return { utilisation, delta, epuisement: fin !== null && fin < reset ? fin : null, reset };
}

function heure(ms: number, maintenant: number): string {
  const d = new Date(ms);
  const hm = d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  return ms - maintenant < 20 * HEURE_MS ? hm : `${d.toLocaleDateString("fr-CH", { weekday: "short" })} ${hm}`;
}

function duree(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
  return `${Math.round(minutes / (24 * 60))} j`;
}

function Quota({
  libelle,
  fenetre,
  dureeMs,
  observeLe,
}: {
  libelle: string;
  fenetre: Fenetre | null | undefined;
  dureeMs: number;
  observeLe: string | null;
}) {
  const maintenant = Date.now();
  const lecture = fenetre ? lire(fenetre, dureeMs, maintenant) : null;
  if (lecture === null) {
    return (
      <div className="ao-kpi" title="Aucune mesure Claude de moins de 15 min : ni run en cours, ni session Claude Code sur le PC">
        <span className="k">{libelle}</span>
        <span className="v">{VIDE}</span>
      </div>
    );
  }
  const { utilisation, delta, epuisement, reset } = lecture;
  const niveau = utilisation >= 90 || epuisement !== null ? "danger" : utilisation >= 70 ? "alerte" : "";
  const titre = [
    `${libelle} : ${Math.round(utilisation)} % utilisés`,
    delta !== null ? `delta ${delta >= 0 ? "+" : ""}${Math.round(delta)} pts (temps écoulé moins consommation)` : null,
    reset !== null ? `reset dans ${duree(reset - maintenant)} (${heure(reset, maintenant)})` : null,
    epuisement !== null ? `à ce rythme, à sec à ${heure(epuisement, maintenant)}` : null,
    observeLe ? `mesuré il y a ${duree(maintenant - Date.parse(observeLe))}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ao-kpi" title={titre}>
      <span className="k">{libelle}</span>
      <span className="v">{Math.round(utilisation)} %</span>
      {delta !== null && (
        <span className={`delta ${delta >= 0 ? "marge" : delta > -10 ? "alerte" : "danger"}`}>
          {delta >= 0 ? "+" : ""}
          {Math.round(delta)}
        </span>
      )}
      {epuisement !== null && <span className="k epuise">à sec {heure(epuisement, maintenant)}</span>}
      <span className={`barre ${niveau}`}>
        <i style={{ width: `${Math.min(100, utilisation)}%` }} />
      </span>
    </div>
  );
}

export function Kpis({ flottant = false }: { flottant?: boolean }) {
  const { donnees: usage } = useCharge((s) => s.usage(), []);
  const observeLe = usage?.quota?.fournisseurs?.claude?.observeLe ?? null;

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
      <Quota libelle="quota · 5 h" fenetre={usage?.quota?.cinqHeures} dureeMs={5 * HEURE_MS} observeLe={observeLe} />
      <Quota libelle="quota · 7 j" fenetre={usage?.quota?.septJours} dureeMs={7 * 24 * HEURE_MS} observeLe={observeLe} />
      <ReserveClaude />
    </div>
  );
}
