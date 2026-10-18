import { useEffect, useState } from "react";
import { financeRequest, money } from "./api";

type Entree = { id: string; projectId: string; publishedAt: string; reportSha256: string };
type Rapport = Entree & {
  validation?: { version: number; sessions?: { auteur: string; reviewer: string }; checks?: { kind: string; text: string; status: string; expected: string; reason: string; observations: string[]; metriques: string[] }[] };
  snapshot?: { sources: { id: string; observedAt?: string; limitations?: string[] }[] };
  report: {
    version: number; resume: string;
    metriques?: { id: string; path: string; value: number; unit: string; currency: string | null; date: string; sources: string[] }[];
    observations: { id: string; question: string; texte: string; nature: string; sources: string[]; confiance: string }[];
    scenarios: { id: string; hypotheses: string[]; effets_possibles: string[]; risques: string[]; conditions_a_verifier: string[] }[];
    risques: string[]; limites: string[];
    questions_sans_reponse: { question: string; raison: string }[];
  };
};

export function Analyses() {
  const [entries, setEntries] = useState<Entree[]>([]);
  const [selected, setSelected] = useState<Rapport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    financeRequest<{ reports: Entree[] }>("reports", undefined, abort.signal)
      .then((data) => setEntries(data.reports))
      .catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, []);
  async function ouvrir(id: string) {
    setError(""); setSelected(null); setLoading(true);
    try { setSelected(await financeRequest<Rapport>(`reports/${encodeURIComponent(id)}`)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  return (
    <section className="fin-empty">
      <span className="fin-eyebrow">Rapports privés</span>
      <h2>Analyses financières</h2>
      <p>Les rapports archivés restent datés, sourcés et consultables ici. Une source absente reste inconnue ; les données de marché ne sont pas du temps réel mondial.</p>
      <p><a href="/missions/finance">Préparer une mission Finance</a></p>
      {error && <p role="alert" className="fin-error">{error}</p>}
      {loading && <p role="status">Chargement des rapports…</p>}
      {!loading && entries.length === 0 && <p>Aucun rapport n’a encore été validé et archivé.</p>}
      {entries.length > 0 && (
        <ul className="fin-report-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button type="button" onClick={() => void ouvrir(entry.id)}>
                {new Date(entry.publishedAt).toLocaleString("fr-CH")} · {entry.projectId}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <article className="fin-report">
          <h3>Résumé</h3><p>{selected.report.resume}</p>
          <p className="fin-eyebrow">Rapport {selected.id} · {new Date(selected.publishedAt).toLocaleString("fr-CH")}</p>
          <p>{selected.validation?.version === 2 ? "Valeurs comparées au snapshot et contraintes relues par une session distincte. Les conclusions restent des analyses, sans garantie de performance." : "Rapport historique : contrôles de structure et références uniquement ; relecture de fond non attestée."}</p>
          {!!selected.report.metriques?.length && <><h3>Chiffres vérifiés dans le snapshot</h3>
            <ul>{selected.report.metriques.map((m) => <li key={m.id}><strong>{m.id}</strong> : {m.unit === "minor" && m.currency ? money(m.value, m.currency) : `${m.value} ${m.unit} ${m.currency ?? ""}`} · {m.date}
              <details><summary>Consulter la preuve</summary><p>Valeur exacte de {m.path} : {m.value} {m.unit === "minor" ? "centimes" : m.unit}</p><p>Sources : {m.sources.join(", ")}</p>
                {selected.snapshot?.sources.filter((s) => m.sources.includes(s.id)).map((s) => <p key={s.id}>{s.id} · observée le {s.observedAt ?? "date non fournie"} · {s.limitations?.join(" ; ")}</p>)}
              </details></li>)}</ul></>}
          {!!selected.validation?.checks?.length && <details><summary>Preuves de relecture des exigences</summary>
            <p>Session indépendante : {selected.validation.sessions?.reviewer}</p>
            {selected.validation.checks.map((c, i) => <section key={i}><h4>{c.text} · {c.status}</h4><p>Attendu : {c.expected}</p><p>{c.reason}</p><p>Observations : {c.observations.join(", ")} · métriques : {c.metriques.join(", ") || "aucune"}</p></section>)}
          </details>}
          <h3>Observations</h3>
          {selected.report.observations.map((item) => <section key={item.id}><h4>{item.question}</h4><p>{item.texte}</p><small>{item.nature} · confiance {item.confiance} · sources : {item.sources.join(", ") || "aucune"}</small></section>)}
          <h3>Scénarios conditionnels</h3>
          {selected.report.scenarios.map((scenario) => <section key={scenario.id}><h4>{scenario.id}</h4><p>Hypothèses : {scenario.hypotheses.join(" ; ")}</p><p>Effets possibles : {scenario.effets_possibles.join(" ; ")}</p><p>Risques : {scenario.risques.join(" ; ")}</p><p>À vérifier : {scenario.conditions_a_verifier.join(" ; ")}</p></section>)}
          {!!selected.report.risques.length && <><h3>Risques</h3><ul>{selected.report.risques.map((item) => <li key={item}>{item}</li>)}</ul></>}
          {!!selected.report.limites.length && <><h3>Limites</h3><ul>{selected.report.limites.map((item) => <li key={item}>{item}</li>)}</ul></>}
          {!!selected.report.questions_sans_reponse.length && <><h3>Questions sans réponse</h3><ul>{selected.report.questions_sans_reponse.map((item) => <li key={item.question}>{item.question} — {item.raison}</li>)}</ul></>}
        </article>
      )}
    </section>
  );
}
