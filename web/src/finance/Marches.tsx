import { useEffect, useRef, useState } from "react";
import { financeRequest, type MacroSnapshot } from "./api";
import { macroChart } from "./macro-chart";

const percent = (v: number | null | undefined) =>
  v == null
    ? "Indisponible"
    : `${new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 2 }).format(v)} %`;
const dateTime = (v: string) =>
  new Intl.DateTimeFormat("fr-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));

export function Marches({ maquette }: { maquette: boolean }) {
  const [data, setData] = useState<MacroSnapshot | null>(null);
  const [countryId, setCountryId] = useState("CHE");
  const [indicatorId, setIndicatorId] = useState("NY.GDP.MKTP.KD.ZG");
  const [year, setYear] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);
  const refreshController = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setLoading(true);
    setError("");
    setRefreshing(false);
    financeRequest<MacroSnapshot>(
      maquette ? "macro/example" : "macro",
      undefined,
      abort.signal,
    )
      .then((d) => {
        if (!abort.signal.aborted) setData(d);
      })
      .catch((e: Error) => {
        if (!abort.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => {
      abort.abort();
      refreshController.current?.abort();
    };
  }, [maquette, retry]);
  async function refresh() {
    const abort = new AbortController();
    refreshController.current = abort;
    setRefreshing(true);
    setError("");
    try {
      const d = await financeRequest<MacroSnapshot>(
        "macro/refresh",
        {},
        abort.signal,
      );
      if (!abort.signal.aborted) setData(d);
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setRefreshing(false);
    }
  }
  const country = data?.countries.find((c) => c.id === countryId);
  const indicator = data?.indicators.find((i) => i.id === indicatorId);
  const series = data?.series.find(
    (s) => s.countryId === countryId && s.indicatorId === indicatorId,
  );
  const chart = data && series ? macroChart(series.points, data.period) : null;
  const selected =
    series?.points.find((p) => String(p.year) === year) ||
    series?.points.at(-1);
  return (
    <div className="fin-macro">
      <section className="fin-macro-intro">
        <div>
          <span className="fin-eyebrow">
            Marchés / Contexte économique annuel
          </span>
          <h2>L’économie, avec ses dates.</h2>
          <p>
            Croissance et inflation de six zones. Choisis une zone pour lire son
            historique. Les cours d’actions et d’ETF seront ajoutés dans une
            prochaine étape.
          </p>
        </div>
        {!maquette && data && (
          <button
            className="fin-primary"
            onClick={refresh}
            disabled={loading || refreshing}
          >
            {refreshing
              ? "Collecte en cours…"
              : data.empty
                ? "Collecter les données publiques"
                : "Actualiser les données publiques"}
          </button>
        )}
      </section>
      {maquette && (
        <p className="fin-demo fin-mode">
          Exemple macro entièrement fictif, en lecture seule. Aucune source
          publique n’est interrogée.
        </p>
      )}
      {loading && <p role="status">Chargement de l’instantané macro…</p>}
      {refreshing && (
        <p role="status">Collecte auprès de la Banque mondiale…</p>
      )}
      {error && (
        <div className="fin-error" role="alert">
          {error}{" "}
          {!data && (
            <button onClick={() => setRetry((n) => n + 1)}>Réessayer</button>
          )}
        </div>
      )}
      {data && (
        <>
          {!data.synthetic && data.lastAttempt && !data.lastAttempt.ok && (
            <div className="fin-error" role="alert">
              <strong>Dernière collecte échouée.</strong>{" "}
              {data.lastAttempt.message} Tentative du{" "}
              {dateTime(data.lastAttempt.at)}.{" "}
              {data.empty
                ? "Aucune donnée disponible pour le moment."
                : "Le dernier instantané réussi reste affiché avec sa date."}
            </div>
          )}
          {!data.synthetic && !data.empty && data.cacheStale && (
            <p className="fin-macro-warning">
              Instantané à actualiser : collecte il y a {data.cacheAgeDays}{" "}
              jours. Les statistiques restent annuelles.
            </p>
          )}
          {data.refreshSkipped && (
            <p role="status">
              Une collecte a déjà été tentée il y a moins d’une minute. Aucune
              nouvelle requête envoyée.
            </p>
          )}
          {data.empty ? (
            <section className="fin-empty">
              <h3>Le contexte économique commence ici.</h3>
              <p>
                La première collecte chargera dix années de croissance et
                d’inflation depuis la Banque mondiale. Elle utilise uniquement
                des données publiques.
              </p>
            </section>
          ) : (
            <>
              <div
                className="fin-macro-countries"
                aria-label="Zones économiques"
              >
                {data.countries.map((c) => (
                  <button
                    key={c.id}
                    aria-pressed={countryId === c.id}
                    onClick={() => {
                      setCountryId(c.id);
                      setYear("");
                    }}
                  >
                    <strong>{c.name}</strong>
                    {data.indicators.map((i) => {
                      const s = data.series.find(
                        (v) => v.countryId === c.id && v.indicatorId === i.id,
                      );
                      return (
                        <span className="fin-macro-country-metric" key={i.id}>
                          <span>
                            {i.id === "NY.GDP.MKTP.KD.ZG"
                              ? "PIB réel"
                              : "Inflation"}
                          </span>
                          <b>{percent(s?.latest?.value)}</b>
                          <small>
                            {s?.latest
                              ? s.latest.year
                              : "Aucune année disponible"}
                          </small>
                        </span>
                      );
                    })}
                  </button>
                ))}
              </div>
              <section className="fin-panel fin-macro-detail">
                <div className="fin-macro-chart-head">
                  <div>
                    <span className="fin-eyebrow">
                      {data.period.from} → {data.period.to} · % par an
                    </span>
                    <h3>{country?.name} · historique annuel</h3>
                  </div>
                  <label>
                    Indicateur
                    <select
                      value={indicatorId}
                      onChange={(e) => {
                        setIndicatorId(e.target.value);
                        setYear("");
                      }}
                    >
                      {data.indicators.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p>
                  {indicator?.definition} Les années manquantes interrompent la
                  courbe.
                </p>
                {series?.lastYearMissing && (
                  <p className="fin-macro-warning">
                    {data.period.to} indisponible pour cette série.
                    {series.latest
                      ? ` Dernière valeur disponible : ${series.latest.year}.`
                      : " Aucune valeur disponible."}
                  </p>
                )}
                {series?.lagging && (
                  <p className="fin-macro-warning">
                    Cette série est ancienne par rapport à la dernière année
                    civile close.
                  </p>
                )}
                {series?.latest && chart ? (
                  <svg
                    className="fin-macro-chart"
                    viewBox="0 0 1000 365"
                    role="img"
                    aria-label={`${indicator?.name}, ${country?.name}, de ${data.period.from} à ${data.period.to}. Valeurs détaillées dans le tableau ci-dessous.`}
                  >
                    {chart.ticks.map((tick, n) => (
                      <g key={n}>
                        <line
                          x1="90"
                          x2="920"
                          y1={tick.y}
                          y2={tick.y}
                          className="fin-macro-grid"
                        />
                        <text x="72" y={tick.y + 7} textAnchor="end">
                          {new Intl.NumberFormat("fr-CH", {
                            maximumFractionDigits: 1,
                          }).format(tick.value)}
                        </text>
                      </g>
                    ))}
                    <line
                      x1="90"
                      x2="920"
                      y1={chart.zero}
                      y2={chart.zero}
                      className="fin-macro-zero"
                    />
                    <path
                      d={chart.path}
                      fill="none"
                      className="fin-macro-line"
                    />
                    {chart.plotted.map((p, n) => (
                      <g key={p.year}>
                        {p.y !== null && (
                          <circle
                            cx={p.x}
                            cy={p.y}
                            r={
                              String(p.year) === String(selected?.year) ? 7 : 4
                            }
                            className="fin-macro-dot"
                          >
                            <title>
                              {p.year} : {percent(p.value)}
                            </title>
                          </circle>
                        )}
                        {(n % 2 === 0 || n === chart.plotted.length - 1) && (
                          <text x={p.x} y="335" textAnchor="middle">
                            {p.year}
                          </text>
                        )}
                      </g>
                    ))}
                  </svg>
                ) : (
                  <p>Aucun graphique disponible pour cette série.</p>
                )}
                <div className="fin-macro-point">
                  <label>
                    Année à consulter
                    <select
                      value={selected?.year || ""}
                      onChange={(e) => setYear(e.target.value)}
                    >
                      {series?.points.map((p) => (
                        <option key={p.year} value={p.year}>
                          {p.year}
                        </option>
                      ))}
                    </select>
                  </label>
                  <output aria-live="polite">
                    {selected?.year} · {percent(selected?.value)}
                  </output>
                  <a href={indicator?.url} target="_blank" rel="noreferrer">
                    Définition et source de la série ↗
                  </a>
                </div>
                <details>
                  <summary>Consulter les valeurs annuelles</summary>
                  <div className="fin-table-wrap">
                    <table>
                      <caption>
                        {country?.name} · {indicator?.name}
                      </caption>
                      <thead>
                        <tr>
                          <th>Année observée</th>
                          <th>Valeur (% par an)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {series?.points.map((p) => (
                          <tr key={p.year}>
                            <td>{p.year}</td>
                            <td>{percent(p.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            </>
          )}
          <section className="fin-panel fin-macro-provenance">
            <h3>Source et disponibilité</h3>
            <p>
              <a href={data.provider.url} target="_blank" rel="noreferrer">
                {data.provider.name}
              </a>{" "}
              · Données {data.provider.frequency}s. Les agrégats suivent la
              méthode de la Banque mondiale.
            </p>
            <dl>
              <div>
                <dt>Collecte réussie</dt>
                <dd>
                  {data.collectedAt
                    ? dateTime(data.collectedAt)
                    : "Pas encore collecté"}
                </dd>
              </div>
              <div>
                <dt>Mise à jour de la base WDI</dt>
                <dd>{data.sourceUpdatedAt || "Inconnue"}</dd>
              </div>
              <div>
                <dt>Publication de chaque chiffre</dt>
                <dd>Date non fournie par cette réponse</dd>
              </div>
            </dl>
            {data.lastAttempt?.ok && (
              <p role="status">
                {data.lastAttempt.availableCount} valeurs disponibles sur{" "}
                {data.lastAttempt.observationCount} points ·{" "}
                {data.lastAttempt.added} ajoutés · {data.lastAttempt.revised}{" "}
                révisés · {data.lastAttempt.unchanged} inchangés.{" "}
                {data.nextRefreshAt &&
                  `Nouvelle collecte possible après ${dateTime(data.nextRefreshAt)}.`}
              </p>
            )}
            {data.indicators.map((i) => (
              <p key={i.id}>
                {i.name} : {i.attribution}.
              </p>
            ))}
            <p>
              <a href={data.provider.termsUrl} target="_blank" rel="noreferrer">
                Licence {data.provider.license} et conditions d’utilisation
              </a>
              {!data.synthetic && !data.empty && (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href="/api/finance/macro/original"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Consulter l’instantané source
                  </a>
                </>
              )}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
