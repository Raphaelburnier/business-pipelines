import { useState } from "react";
import { categories, money, type Bucket, type Row, type Summary } from "./api";

function BalanceChart({ bucket }: { bucket: Bucket }) {
  const [selected, setSelected] = useState<number | null>(null);
  const points = bucket.points;
  if (!points.length) return <div className="fin-chart-empty"><span>Solde de départ requis</span><p>Importe un solde pour calculer l’historique de ce compte et de cette devise.</p></div>;
  const min = Math.min(...points.map((p) => p.amount), 0); const max = Math.max(...points.map((p) => p.amount), 1);
  const first = points[0]!;
  const start = Date.parse(first.date); const duration = Math.max(86_400_000, Date.parse(points.at(-1)!.date) - start);
  const x = (date: string) => 36 + (Date.parse(date) - start) / duration * 620;
  const y = (amount: number) => 160 - (amount - min) / (max - min) * 120;
  const coordinates = points.map((p, i) => i ? `H${x(p.date).toFixed(1)}V${y(p.amount).toFixed(1)}` : `M${x(p.date).toFixed(1)},${y(p.amount).toFixed(1)}`).join(" ");
  const inspected = selected == null ? null : points[selected];
  return <><svg className="fin-chart" viewBox="0 0 700 208" role="img" aria-label={`Historique calculé en ${bucket.currency}, de ${money(bucket.opening, bucket.currency)} à ${money(bucket.closing, bucket.currency)}`}>
    {[min, (min + max) / 2, max].map((v) => <g key={v}><line x1="36" x2="656" y1={y(v)} y2={y(v)} className="fin-grid-line" /><text x="36" y={y(v) - 7}>{money(Math.round(v), bucket.currency)}</text></g>)}
    <path d={coordinates} className="fin-line" />
    {points.map((p, i) => <circle key={`${p.date}-${p.moment}`} cx={x(p.date)} cy={y(p.amount)} r="4"><title>{p.date} · {p.moment === "opening" ? "début de journée" : p.moment === "end" ? "fin de période" : "après mouvements"} · {money(p.amount, bucket.currency)}</title></circle>)}
    <text x="36" y="198">{first.date}</text><text x="656" y="198" textAnchor="end">{points.at(-1)!.date}</text>
  </svg><div className="fin-point-select"><label>Consulter un point<select value={selected ?? ""} onChange={(e) => setSelected(e.target.value === "" ? null : Number(e.target.value))}><option value="">Choisir une date</option>{points.map((p, i) => <option key={`${p.date}-${p.moment}`} value={i}>{p.date} · {p.moment === "opening" ? "début" : p.moment === "end" ? "fin de période" : "après mouvements"}</option>)}</select></label>{inspected && <output>{money(inspected.amount, bucket.currency)}</output>}</div></>;
}
const groups: Record<string, string[]> = { receipts: ["customer_payment"], refunds: ["customer_refund"], net: ["customer_payment", "customer_refund"], expenses: ["operating_expense"], operating: ["customer_payment", "customer_refund", "operating_expense"], capital: ["owner_funding"], transfers: ["internal_transfer"] };
function source(row: Row, data: Summary) { const found = data.imports.find((r) => r.id === row.importId); return `${found?.fileName || row.importId} · ligne ${row.line}`; }
function SourceLink({ row, data }: { row: Row; data: Summary }) {
  const imported = data.imports.find((r) => r.id === row.importId);
  return data.synthetic ? <span>{source(row, data)}</span> : <a href={`/api/finance/imports/${encodeURIComponent(row.importId)}`} download title={`Import ${row.importId} · confirmé le ${imported?.importedAt || "date inconnue"}`}>{source(row, data)}</a>;
}
export function Tresorerie({ data, currency, onCurrency }: { data: Summary; currency: string; onCurrency: (c: string) => void }) {
  const [filter, setFilter] = useState("all"); const [page, setPage] = useState(0);
  const bucket = data.buckets.find((b) => b.currency === currency) || data.buckets[0];
  if (!bucket) return <section className="fin-empty"><span className="fin-eyebrow">En attente des premiers relevés</span><h2>Ta trésorerie commence ici.</h2><p>Aucun montant renseigné. Importe d’abord les mouvements et un solde de départ, ou ouvre l’exemple fictif pour découvrir la page.</p><div className="fin-empty-values"><span>Trésorerie <b>Inconnue</b></span><span>Encaissements <b>Inconnus</b></span><span>Dépenses <b>Inconnues</b></span></div></section>;
  const c = bucket.currency;
  const rows = data.movements.filter((r) => r.data.currency === c && (filter === "all" || groups[filter]?.includes(String(r.data.category))));
  const noMovementData = !data.imports.some((r) => r.kind === "mouvements");
  const amount = (n: number) => money(noMovementData ? null : n, c);
  const maxFlow = Math.max(bucket.receipts, bucket.refunds, bucket.expenses, Math.abs(bucket.ownerFunding), Math.abs(bucket.transfers), 1);
  const flowWidth = (value: number) => `${noMovementData ? 0 : Math.abs(value) / maxFlow * 100}%`;
  const choose = (name: string) => { setFilter(name); setPage(0); document.getElementById("fin-journal")?.scrollIntoView({ behavior: "auto", block: "start" }); };
  return <>
    <div className="fin-currency"><p>Chaque devise garde ses propres totaux. Aucune conversion.</p><label>Devise<select value={c} onChange={(e) => { onCurrency(e.target.value); setPage(0); }}>{data.buckets.map((b) => <option key={b.currency}>{b.currency}</option>)}</select></label></div>
    <p className="fin-muted">Chiffres issus des imports confirmés · dernier import : {data.imports.at(-1) ? new Date(data.imports.at(-1)!.importedAt).toLocaleString("fr-CH") : "aucun"}.</p>
    <div className="fin-kpis">
      <button className="fin-kpi fin-kpi-main" onClick={() => choose("all")}><span>{data.scope === "business-movements" ? "Solde calculé du business" : "Solde calculé des comptes"}</span><strong>{money(bucket.closing, c)}</strong><small>À la fin de la période · journal importé</small></button>
      <button className="fin-kpi" onClick={() => choose("net")}><span>Encaissements clients nets</span><strong>{amount(bucket.netReceipts)}</strong><small>Après {amount(bucket.refunds)} de remboursements</small></button>
      <button className="fin-kpi" onClick={() => choose("expenses")}><span>Dépenses d’exploitation</span><strong>{amount(bucket.expenses)}</strong><small>Décaissements classés sur la période</small></button>
      <button className="fin-kpi" onClick={() => choose("operating")}><span>Excédent de trésorerie d’exploitation</span><strong>{amount(bucket.operatingCashSurplus)}</strong><small>Encaissements nets − dépenses · hors apports</small></button>
    </div>
    {data.warnings.length > 0 && <div className="fin-notice"><b>À vérifier dans les sources</b><ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
    <div className="fin-analysis"><section className="fin-panel"><div className="fin-panel-head"><div><span className="fin-eyebrow">02 / Évolution</span><h3>Historique du solde</h3></div><span className="fin-tag">{c}</span></div><BalanceChart key={`${c}-${data.from}-${data.to}-${data.revision}`} bucket={bucket} /><p className="fin-muted">Calcul depuis les soldes observés et les mouvements importés. L’exhaustivité du relevé reste à vérifier. Ce chiffre ne représente pas un bénéfice comptable.</p></section>
      <section className="fin-panel fin-flows"><span className="fin-eyebrow">03 / Composition</span><h3>Comprendre les flux</h3><dl>
        <div><dt><button onClick={() => choose("receipts")}>Encaissements bruts ↗</button></dt><dd>{amount(bucket.receipts)}</dd><i aria-hidden="true" className="fin-flow-meter fin-flow-positive" style={{ width: flowWidth(bucket.receipts) }} /></div>
        <div><dt><button onClick={() => choose("refunds")}>Remboursements ↗</button></dt><dd>− {amount(bucket.refunds)}</dd><i aria-hidden="true" className="fin-flow-meter fin-flow-negative" style={{ width: flowWidth(bucket.refunds) }} /></div>
        <div><dt><button onClick={() => choose("expenses")}>Dépenses ↗</button></dt><dd>− {amount(bucket.expenses)}</dd><i aria-hidden="true" className="fin-flow-meter fin-flow-negative" style={{ width: flowWidth(bucket.expenses) }} /></div>
        <div><dt><button onClick={() => choose("capital")}>Apports / retraits nets ↗</button></dt><dd>{amount(bucket.ownerFunding)}</dd><i aria-hidden="true" className="fin-flow-meter" style={{ width: flowWidth(bucket.ownerFunding) }} /></div>
        <div><dt><button onClick={() => choose("transfers")}>Virements internes nets ↗</button></dt><dd>{amount(bucket.transfers)}</dd><i aria-hidden="true" className="fin-flow-meter" style={{ width: flowWidth(bucket.transfers) }} /></div>
        <div><dt>Factures impayées importées</dt><dd>{money(data.imports.some((r) => r.kind === "factures") ? bucket.unpaid : null, c)}</dd></div>
      </dl><p className="fin-muted">Les impayés sont un état des documents importés, hors solde disponible. Les virements déplacent l’argent entre comptes. Aucune propriété de compte n’est supposée.</p></section></div>
    <section className="fin-panel" id="fin-journal"><div className="fin-panel-head"><div><span className="fin-eyebrow">04 / Justificatifs</span><h3>Mouvements sources</h3></div><label>Voir<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}><option value="all">Tous les mouvements</option><option value="receipts">Encaissements</option><option value="refunds">Remboursements</option><option value="net">Encaissements nets</option><option value="expenses">Dépenses</option><option value="operating">Flux d’exploitation</option><option value="capital">Apports / retraits</option><option value="transfers">Virements internes</option></select></label></div>
      <div className="fin-scroll"><table><caption>{rows.length} mouvement(s) en {c} · période et filtres courants</caption><thead><tr><th>Date</th><th>Business / compte</th><th>Libellé</th><th>Catégorie</th><th>Montant</th><th>Source</th></tr></thead><tbody>{rows.slice(page * 50, (page + 1) * 50).map((r) => <tr key={`${r.importId}-${r.line}`}><td>{String(r.data.booked_on)}</td><td>{String(r.data.business_id)}<small>{String(r.data.account_id)}</small></td><td>{String(r.data.label)}</td><td>{categories[String(r.data.category)]}</td><td className="fin-number">{money(Number(r.data.amount_minor), c)}</td><td><SourceLink row={r} data={data} /><small>{String(r.data.source)} / {String(r.data.source_record_id)}</small></td></tr>)}</tbody></table></div>
      {rows.length === 0 && <p>Aucun mouvement dans cette sélection.</p>}{rows.length > 50 && <div className="fin-actions"><button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Précédent</button><span>Page {page + 1} / {Math.ceil(rows.length / 50)}</span><button disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage((p) => p + 1)}>Suivant</button></div>}
      <details><summary>Soldes de départ et attribution des comptes</summary><ul>{bucket.accountBalances.map((a) => { const scope = data.accountScopes.find((s) => s.accountId === a.accountId); return <li key={a.accountId}>{a.accountId} : {money(a.opening, c)} au début de la période · {a.baseline ? `${a.baseline.date}, ${data.imports.find((i) => i.id === a.baseline!.importId)?.fileName}, ligne ${a.baseline.line}` : "solde absent"} · {scope?.ownership === "dedicated" ? `dédié à ${scope.businessId}` : scope?.ownership === "shared" ? "partagé" : "propriété non renseignée"}</li>; })}</ul><p>Le filtre business sélectionne les mouvements déclarés, sans lui attribuer le solde complet d’un compte partagé.</p></details>
      <details><summary>Factures importées · {c}</summary><ul>{data.invoices.filter((r) => r.data.currency === c).map((r) => <li key={`${r.importId}-${r.line}`}>{String(r.data.document_id)} · {money(Number(r.data.total_minor), c)} · {String(r.data.status)} · échéance {String(r.data.due_on)} · {source(r, data)}</li>)}</ul></details>
    </section>
    <section className="fin-panel"><h3>Historique des imports</h3><p>Dernière confirmation : {data.imports.at(-1) ? new Date(data.imports.at(-1)!.importedAt).toLocaleString("fr-CH") : "aucune"}.</p><ul className="fin-import-history">{data.imports.map((entry) => <li key={entry.id}><span>{entry.fileName} · {entry.added} ligne(s)<small>{new Date(entry.importedAt).toLocaleString("fr-CH")}{entry.sha256 && ` · SHA-256 ${entry.sha256.slice(0, 12)}…`}</small></span>{!data.synthetic && <a href={`/api/finance/imports/${encodeURIComponent(entry.id)}`} download>CSV original ↓</a>}</li>)}</ul></section>
  </>;
}
