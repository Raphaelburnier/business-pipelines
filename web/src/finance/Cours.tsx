import { useEffect, useRef, useState } from "react";
import { financeRequest, type PriceSnapshot } from "./api";
import { priceChart } from "./price-chart";
const priceFormat = new Intl.NumberFormat("fr-CH", {
  maximumFractionDigits: 4,
});
const volumeFormat = new Intl.NumberFormat("fr-CH");
const price = (n: number | null | undefined, currency: string) =>
  n == null ? "Indisponible" : `${priceFormat.format(n)} ${currency}`;
const dateTime = (v: string) =>
  new Intl.DateTimeFormat("fr-CH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));
export function Cours({ maquette }: { maquette: boolean }) {
  const [data, setData] = useState<PriceSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState("eodhd:US:AAPL");
  const [adjusted, setAdjusted] = useState(false);
  const [date, setDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setBusy(false);
    setError("");
    financeRequest<PriceSnapshot>(
      maquette ? "prices/example" : "prices",
      undefined,
      abort.signal,
    )
      .then((d) => {
        if (!abort.signal.aborted) setData(d);
      })
      .catch((e: Error) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => {
      abort.abort();
      mutation.current?.abort();
    };
  }, [maquette, retry]);
  async function write(route: string, body: object, watchlist?: string[]) {
    const abort = new AbortController();
    mutation.current = abort;
    setBusy(true);
    setError("");
    const previous = data;
    if (data && watchlist)
      setData({
        ...data,
        watchlist,
        instruments: data.instruments.map((i) => ({
          ...i,
          followed: watchlist.includes(i.id),
        })),
      });
    try {
      const d = await financeRequest<PriceSnapshot>(route, body, abort.signal);
      if (!abort.signal.aborted) setData(d);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError((e as Error).message);
        if (watchlist) setData(previous);
      }
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function follow(id: string) {
    if (!data) return;
    const ids = data.watchlist.includes(id)
      ? data.watchlist.filter((v) => v !== id)
      : [...data.watchlist, id];
    void write("prices/watchlist", { ids }, ids);
  }
  const instrument = data?.instruments.find((i) => i.id === selectedId);
  const chart = instrument ? priceChart(instrument.points, adjusted) : null;
  const selected =
    instrument?.points.find((p) => p.date === date) || instrument?.latest;
  const selectedValue = selected
    ? adjusted
      ? selected.adjustedClose
      : selected.close
    : null;
  return (
    <div className="fin-prices fin-macro">
      <section className="fin-macro-intro">
        <div>
          <span className="fin-eyebrow">
            Marchés / Liste de suivi personnelle
          </span>
          <h2>Les cours, avec leur date.</h2>
          <p>
            Clôtures indicatives des actions et ETF suivis. Sélectionne un titre
            pour lire son historique. Ces exemples de suivi ne constituent pas
            des suggestions d’achat.
          </p>
        </div>
        {!maquette && data && (
          <button
            className="fin-primary"
            disabled={busy || !data.watchlist.length || !data.budget.remaining}
            onClick={() => write("prices/refresh", {})}
          >
            {busy ? "Opération en cours…" : "Actualiser les cours suivis"}
          </button>
        )}
      </section>
      {maquette && (
        <p className="fin-demo fin-mode">
          Exemple de cours entièrement fictif, en lecture seule. Aucun appel
          fournisseur.
        </p>
      )}
      {!data && !error && <p role="status">Chargement des cours…</p>}
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
          {!maquette && (
            <div className="fin-price-access fin-panel">
              <p>
                <strong>
                  {data.mode === "demo"
                    ? "Accès public limité à Apple et VTI"
                    : "Clé personnelle configurée côté serveur"}
                </strong>
                .{" "}
                {data.mode === "demo"
                  ? "Les autres places attendent une clé personnelle EODHD. Le compte gratuit est proposé par le fournisseur ; aucun abonnement n’est activé ici."
                  : "La disponibilité de chaque titre est confirmée seulement après une collecte réussie."}
              </p>
              <p>
                {data.budget.used} / {data.budget.limit} appels du cockpit
                aujourd’hui (UTC) · {data.budget.remaining} restants. Les appels
                d’autres applications ne sont pas comptés ici.
              </p>
              {data.lastAttempt && (
                <p role="status">
                  {data.lastAttempt.message} · {data.lastAttempt.requests}{" "}
                  appel(s). {data.lastAttempt.revised ?? 0} observation(s)
                  révisée(s).{" "}
                  {data.refreshSkipped &&
                    "Collecte trop rapprochée : aucun nouvel appel."}{" "}
                  {data.nextRefreshAt &&
                    `Nouvelle collecte après ${dateTime(data.nextRefreshAt)}.`}
                </p>
              )}
              {!data.budget.remaining && (
                <p className="fin-warning">
                  Plafond local atteint. Réinitialisation{" "}
                  {dateTime(data.budget.resetsAt)}.
                </p>
              )}
            </div>
          )}
          <section className="fin-panel">
            <h3>Ta liste de suivi</h3>
            <p>
              Le catalogue initial sert à tester cinq instruments et quatre
              régions. Ajouter au suivi n’effectue aucun achat ni aucune
              collecte.
            </p>
            <div className="fin-watch-grid">
              {data.instruments.map((i) => (
                <div className="fin-watch-item" key={i.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={i.followed}
                      disabled={maquette || busy}
                      onChange={() => follow(i.id)}
                    />{" "}
                    Suivre {i.name}
                  </label>
                  <button
                    type="button"
                    aria-pressed={i.id === selectedId}
                    onClick={() => {
                      setSelectedId(i.id);
                      setDate("");
                    }}
                  >
                    <span className="fin-eyebrow">
                      {i.type} · {i.region}
                    </span>
                    <strong>{i.name}</strong>
                    <span>
                      {i.code} · {i.venue} · {i.currency}
                    </span>
                    <b className="fin-number">
                      {price(i.latest?.close, i.currency)}
                    </b>
                    <span>
                      {i.latest
                        ? `Clôture brute du ${i.latest.date}`
                        : "Aucun cours collecté"}
                    </span>
                  </button>
                  <small>
                    {data.synthetic
                      ? "Fictif"
                      : i.status === "ok"
                        ? "Dernière collecte réussie"
                        : i.lastAttempt?.message ||
                          (i.collectionAllowed
                            ? "Prêt à collecter"
                            : "Clé personnelle nécessaire · couverture non vérifiée")}
                  </small>
                  {i.dateNeedsCheck && (
                    <small className="fin-warning">
                      Dernière date ancienne : vérifier la disponibilité.
                    </small>
                  )}
                </div>
              ))}
            </div>
          </section>
          {instrument && (
            <section className="fin-panel fin-price-history">
              <div className="fin-panel-head">
                <div>
                  <span className="fin-eyebrow">
                    {instrument.code} · {instrument.venue} ·{" "}
                    {instrument.currency}
                  </span>
                  <h3>Historique de {instrument.name}</h3>
                </div>
                <label>
                  Type de clôture{" "}
                  <select
                    value={adjusted ? "adjusted" : "raw"}
                    onChange={(e) => setAdjusted(e.target.value === "adjusted")}
                  >
                    <option value="raw">Brute</option>
                    <option value="adjusted">
                      Ajustée — divisions et dividendes
                    </option>
                  </select>
                </label>
              </div>
              <p>
                {adjusted
                  ? "Valeurs ajustées par EODHD pour les divisions d’actions et les dividendes ; l’historique peut être révisé."
                  : "Prix de clôture brut, dans la devise de cotation."}{" "}
                L’axe vertical est resserré autour des cours. Aucune valeur
                n’est créée pour les jours sans observation.
              </p>
              {!data.synthetic &&
                instrument.lastAttempt &&
                instrument.status !== "ok" && (
                  <p className="fin-warning" role="status">
                    {instrument.lastAttempt.message}{" "}
                    {instrument.latest &&
                      "Le dernier historique valide reste affiché avec ses dates."}
                  </p>
                )}
              {chart ? (
                <>
                  <svg
                    className="fin-chart fin-price-chart"
                    viewBox="0 0 960 350"
                    role="img"
                    aria-label={`Historique des clôtures ${adjusted ? "ajustées" : "brutes"} de ${instrument.name}, en ${instrument.currency}`}
                  >
                    {chart.ticks.map((t, n) => (
                      <g key={n}>
                        <line
                          x1="110"
                          x2="920"
                          y1={t.y}
                          y2={t.y}
                          className="fin-grid-line"
                        />
                        <text x="100" y={t.y + 5} textAnchor="end">
                          {new Intl.NumberFormat("fr-CH", {
                            maximumFractionDigits: 2,
                          }).format(t.value)}
                        </text>
                      </g>
                    ))}
                    <path d={chart.path} className="fin-line" />
                    {chart.plotted.length === 1 && (
                      <circle
                        cx={chart.plotted[0]!.x}
                        cy={chart.plotted[0]!.y!}
                        r="4"
                        className="fin-macro-dot"
                      />
                    )}
                    <text x="110" y="335">
                      {instrument.points[0]?.date}
                    </text>
                    <text x="920" y="335" textAnchor="end">
                      {instrument.latest?.date}
                    </text>
                  </svg>
                  <label className="fin-price-date">
                    Observation{" "}
                    <select
                      value={selected?.date || ""}
                      onChange={(e) => setDate(e.target.value)}
                    >
                      {instrument.points.map((p) => (
                        <option key={p.date} value={p.date}>
                          {p.date}
                        </option>
                      ))}
                    </select>{" "}
                    <span className="fin-number">
                      {price(selectedValue, instrument.currency)}
                    </span>
                  </label>
                  <details>
                    <summary>
                      Voir les {instrument.points.length} observations et les
                      deux clôtures
                    </summary>
                    <div className="fin-table-wrap">
                      <table>
                        <caption>
                          {instrument.name} · {instrument.venue} · devise{" "}
                          {instrument.currency}
                        </caption>
                        <thead>
                          <tr>
                            <th>Date source</th>
                            <th>Clôture brute ({instrument.currency})</th>
                            <th>Clôture ajustée ({instrument.currency})</th>
                            <th>Volume (titres)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {instrument.points.map((p) => (
                            <tr key={p.id}>
                              <td>{p.date}</td>
                              <td className="fin-number">
                                {price(p.close, instrument.currency)}
                              </td>
                              <td className="fin-number">
                                {price(p.adjustedClose, instrument.currency)}
                              </td>
                              <td>{volumeFormat.format(p.volume)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              ) : (
                <p className="fin-empty">
                  {instrument.points.length
                    ? "Clôtures ajustées absentes dans la réponse source."
                    : "Aucun historique disponible. Ajouter ce titre au suivi et collecter avec un accès compatible."}
                </p>
              )}
              <p>
                Date du dernier cours : {instrument.latest?.date || "Inconnue"}{" "}
                · Collecte réussie :{" "}
                {instrument.collectedAt
                  ? dateTime(instrument.collectedAt)
                  : "Pas encore collecté"}
                .
              </p>
              {!data.synthetic &&
                instrument.cacheStale &&
                instrument.latest && (
                  <p className="fin-warning">
                    Cache non actualisé depuis au moins sept jours.
                  </p>
                )}
              {!data.synthetic && (
                <p>
                  <a
                    href={instrument.identityUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Identité chez l’émetteur ou la place
                  </a>
                  {instrument.latest && (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={`/api/finance/prices/original?id=${encodeURIComponent(instrument.id)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Consulter l’instantané source
                      </a>
                    </>
                  )}
                </p>
              )}
            </section>
          )}
          <section className="fin-panel fin-macro-provenance">
            <h3>Source et usage</h3>
            <p>
              <a href={data.provider.url} target="_blank" rel="noreferrer">
                {data.provider.name}
              </a>{" "}
              · {data.provider.frequency}. Prix indicatifs pour la recherche
              personnelle ; vérifier le prix proposé par ton courtier avant
              d’investir.
            </p>
            <p>
              <a href={data.provider.termsUrl} target="_blank" rel="noreferrer">
                Conditions d’usage privé
              </a>{" "}
              ·{" "}
              <a
                href={data.provider.pricingUrl}
                target="_blank"
                rel="noreferrer"
              >
                Accès et tarifs du fournisseur
              </a>
              . La liste de suivi ne représente pas ton portefeuille.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
