import { useEffect, useState } from "react";
import { financeRequest, type Summary } from "./api";
import { Imports } from "./Imports";
import { Comptes } from "./Comptes";
import { Tresorerie } from "./Tresorerie";
import { useSource } from "../donnees/contexte";
import "./finance.css";

const spaces = ["Trésorerie", "Marchés", "Analyses", "Portefeuille"] as const;
type Space = (typeof spaces)[number];
const upcoming: Record<
  Exclude<Space, "Trésorerie">,
  { title: string; text: string; next: string }
> = {
  Marchés: {
    title: "Suivre l’économie mondiale",
    text: "Cet espace accueillera les données macro et une liste de suivi : source, devise, place de cotation et date de chaque observation.",
    next: "Prochaine étape : premier connecteur officiel, puis validation de la couverture des cours.",
  },
  Analyses: {
    title: "Ton agent de recherche financière",
    text: "L’agent pourra analyser le marché et les chiffres importés, produire des rapports sourcés et expliquer ses hypothèses. Tu décideras et investiras directement chez ton courtier.",
    next: "Prévu après la collecte des sources : demande d’analyse, mission réelle et validation du rapport.",
  },
  Portefeuille: {
    title: "Tes investissements, séparés des business",
    text: "Cet espace accueillera les positions importées du courtier et leur valorisation datée. Aucun compte Revolut n’est connecté actuellement.",
    next: "Prévu après les cours : import CSV des positions et suivi par devise.",
  },
};
export function Finance() {
  const { source } = useSource();
  const maquette = source.nom === "maquette";
  const [space, setSpace] = useState<Space>("Trésorerie");
  const [demo, setDemo] = useState(false);
  const example = maquette || demo;
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [currency, setCurrency] = useState("CHF");
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    account: "",
    business: "",
  });
  const [draft, setDraft] = useState(filters);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    const params = new URLSearchParams(
      Object.entries(filters).filter(([, v]) => v),
    );
    financeRequest<Summary>(
      `${example ? "example" : "summary"}?${params}`,
      undefined,
      abort.signal,
    )
      .then(setData)
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [example, revision, filters]);
  function switchDemo() {
    setData(null);
    setDemo((d) => !d);
    setFilters({ from: "", to: "", account: "", business: "" });
    setDraft({ from: "", to: "", account: "", business: "" });
  }
  return (
    <div className="finance">
      <header className="fin-intro">
        <div>
          <span className="fin-eyebrow">
            Finance / Business & investissements
          </span>
          <h2>Des chiffres à la décision.</h2>
          <p>
            Trésorerie des comptes aujourd’hui. Recherche économique et suivi
            des investissements dans les prochains jalons.
          </p>
        </div>
        <span className="fin-status">
          {example ? "Exemple fictif" : "Données importées"}
        </span>
      </header>
      <nav className="fin-tabs" aria-label="Espaces Finance">
        {spaces.map((s) => (
          <button
            type="button"
            key={s}
            aria-pressed={space === s}
            onClick={() => setSpace(s)}
          >
            {s}
            {s !== "Trésorerie" && <small>Prévu</small>}
          </button>
        ))}
      </nav>
      {space !== "Trésorerie" ? (
        <section className="fin-empty">
          <span className="fin-eyebrow">À développer</span>
          <h2>{upcoming[space].title}</h2>
          <p>{upcoming[space].text}</p>
          <p>{upcoming[space].next}</p>
        </section>
      ) : (
        <>
          <div className={`fin-mode ${example ? "fin-demo" : ""}`}>
            <p>
              {example
                ? "Données entièrement fictives. Cet exemple reste séparé des imports et n’enregistre rien dans ta trésorerie."
                : "Tes chiffres apparaîtront après un import. Les données restent dans le stockage privé du cockpit."}
            </p>
            {!maquette && (
              <button onClick={switchDemo}>
                {demo ? "Revenir à mes données" : "Voir un exemple fictif"}
              </button>
            )}
          </div>
          {!example && <Imports onImported={() => setRevision((r) => r + 1)} />}
          {!example && data && (
            <Comptes
              key={data.revision}
              data={data}
              onSaved={() => setRevision((r) => r + 1)}
            />
          )}
          {data && !data.empty && (
            <form
              className="fin-filters"
              onSubmit={(e) => {
                e.preventDefault();
                setFilters({ ...draft });
              }}
            >
              <label>
                Début inclus
                <input
                  type="date"
                  value={draft.from}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, from: e.target.value }))
                  }
                />
              </label>
              <label>
                Fin exclue
                <input
                  type="date"
                  value={draft.to}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, to: e.target.value }))
                  }
                />
              </label>
              <label>
                Compte
                <select
                  value={draft.account}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, account: e.target.value }))
                  }
                >
                  <option value="">Tous les comptes</option>
                  {data.accounts.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
              </label>
              <label>
                Business (mouvements)
                <select
                  value={draft.business}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, business: e.target.value }))
                  }
                >
                  <option value="">Tous les business</option>
                  {data.businesses.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </label>
              <button disabled={loading}>Appliquer</button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  const cleared = {
                    from: "",
                    to: "",
                    account: "",
                    business: "",
                  };
                  setDraft(cleared);
                  setFilters(cleared);
                }}
              >
                Réinitialiser
              </button>
              <p>
                Période affichée : {data.from} → {data.to} (fin exclue).
              </p>
            </form>
          )}
          {loading ? (
            <p role="status">Chargement des données financières…</p>
          ) : error ? (
            <div role="alert" className="fin-error">
              {error}
              <button onClick={() => setRevision((r) => r + 1)}>
                Réessayer
              </button>
            </div>
          ) : (
            data && (
              <Tresorerie
                key={`${example}-${data.from}-${data.to}-${filters.account}-${filters.business}-${currency}`}
                data={data}
                currency={currency}
                onCurrency={setCurrency}
              />
            )
          )}
        </>
      )}
    </div>
  );
}
