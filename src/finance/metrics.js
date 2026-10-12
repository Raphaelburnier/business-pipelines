const { dateValid } = require("./imports");
function sum(values) {
  // Une somme peut dépasser la précision JS au milieu, puis redevenir petite après
  // un remboursement. Le contrôle du seul résultat final ne détecterait pas l'arrondi.
  const result = Number(values.reduce((a, b) => a + BigInt(b), 0n));
  if (!Number.isSafeInteger(result)) throw new Error("Somme hors précision entière ; réduire la période.");
  return result;
}
const nextDate = (date) => new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);
function summarize(state, query = {}) {
  const all = state.mouvements;
  const dates = [...all.map((r) => r.data.booked_on), ...state.soldes.map((r) => r.data.as_of)].sort();
  const from = query.from || dates[0] || null;
  const to = query.to || (dates.length ? nextDate(dates.at(-1)) : null);
  if ((from && !dateValid(from)) || (to && !dateValid(to)) || (from && to && from >= to)) throw new Error("Période invalide : début inclus et fin exclue, YYYY-MM-DD.");
  const account = query.account || ""; const business = query.business || "";
  const inPeriod = (date) => (!from || date >= from) && (!to || date < to);
  const movements = all.filter((r) => (!account || r.data.account_id === account) && (!business || r.data.business_id === business) && inPeriod(r.data.booked_on));
  const accounts = [...new Set([...all, ...state.soldes].map((r) => r.data.account_id))].sort();
  const scopes = state.accountScopes || [];
  const scopeMap = new Map(scopes.map((r) => [r.accountId, r]));
  const businessesByAccount = new Map();
  const movementsByAccount = new Map(); const balancesByAccount = new Map();
  const accountKey = (id, currency) => JSON.stringify([id, currency]);
  for (const row of all) {
    const r = row.data; const businessSet = businessesByAccount.get(r.account_id) || new Set();
    businessSet.add(r.business_id); businessesByAccount.set(r.account_id, businessSet);
    const k = accountKey(r.account_id, r.currency); const entries = movementsByAccount.get(k) || []; entries.push(row); movementsByAccount.set(k, entries);
  }
  for (const row of state.soldes) { const k = accountKey(row.data.account_id, row.data.currency); const entries = balancesByAccount.get(k) || []; entries.push(row); balancesByAccount.set(k, entries); }
  const businesses = [...new Set([...all, ...state.factures].map((r) => r.data.business_id).concat(scopes.filter((r) => r.businessId).map((r) => r.businessId)))].sort();
  const currencies = [...new Set([...all, ...state.soldes, ...state.factures].map((r) => r.data.currency))].sort();
  const warnings = [];
  const buckets = currencies.map((currency) => {
    const rows = movements.filter((r) => r.data.currency === currency);
    const category = (name) => sum(rows.filter((r) => r.data.category === name).map((r) => r.data.amount_minor));
    const receipts = category("customer_payment"); const refunds = -category("customer_refund"); const expenses = -category("operating_expense");
    const scopeFor = (id) => scopeMap.get(id);
    const ids = [...new Set([...all, ...state.soldes].filter((r) => r.data.currency === currency && (!account || r.data.account_id === account) && (!business || scopeFor(r.data.account_id)?.businessId === business || businessesByAccount.get(r.data.account_id)?.has(business))).map((r) => r.data.account_id))];
    const attributed = !business || (ids.length > 0 && ids.every((id) => scopeFor(id)?.ownership === "dedicated" && scopeFor(id)?.businessId === business && [...(businessesByAccount.get(id) || [])].every((b) => b === business)));
    if (business && !attributed) warnings.push(`${currency} : propriété de compte partagée, inconnue ou mouvements d’un autre business. Trésorerie business inconnue ; renseigner l’attribution des comptes.`);
    const accountBalances = ids.map((id) => {
      const observations = [...(balancesByAccount.get(accountKey(id, currency)) || [])].sort((a, b) => b.data.as_of.localeCompare(a.data.as_of));
      const baseline = observations.find((r) => from && r.data.as_of <= from);
      if (!baseline) return { accountId: id, opening: null, closing: null, baseline: null };
      const accountRows = movementsByAccount.get(accountKey(id, currency)) || [];
      const opening = sum([baseline.data.balance_minor, ...accountRows.filter((r) => r.data.booked_on >= baseline.data.as_of && r.data.booked_on < from).map((r) => r.data.amount_minor)]);
      const closing = sum([opening, ...accountRows.filter((r) => inPeriod(r.data.booked_on)).map((r) => r.data.amount_minor)]);
      // Un solde observé ne corrige jamais silencieusement un journal incomplet.
      for (const observation of observations.filter((r) => r.data.as_of > from && (!to || r.data.as_of <= to))) {
        const calculated = sum([opening, ...accountRows.filter((r) => r.data.booked_on >= from && r.data.booked_on < observation.data.as_of).map((r) => r.data.amount_minor)]);
        if (calculated !== observation.data.balance_minor) warnings.push(`${id} (${currency}), ${observation.data.as_of} : solde observé différent du journal, écart ${observation.data.balance_minor - calculated} centimes.`);
      }
      return { accountId: id, opening, closing, baseline: { date: baseline.data.as_of, importId: baseline.importId, line: baseline.line } };
    });
    const known = attributed && accountBalances.length > 0 && accountBalances.every((a) => a.opening !== null);
    const opening = known ? sum(accountBalances.map((a) => a.opening)) : null;
    const closing = known ? sum(accountBalances.map((a) => a.closing)) : null;
    const points = [];
    if (known) {
      let value = opening;
      points.push({ date: from, amount: value, moment: "opening" });
      const daily = new Map();
      for (const row of rows) { const entries = daily.get(row.data.booked_on) || []; entries.push(row.data.amount_minor); daily.set(row.data.booked_on, entries); }
      for (const day of [...daily.keys()].sort()) { value = sum([value, ...daily.get(day)]); points.push({ date: day, amount: value, moment: "closing" }); }
      points.push({ date: to, amount: value, moment: "end" });
    }
    const unpaid = account ? null : sum(state.factures.filter((r) => r.data.currency === currency && (!business || r.data.business_id === business) && (!to || r.data.issued_on < to) && r.data.status === "unpaid").map((r) => r.data.total_minor));
    if (rows.length && !state.soldes.some((r) => r.data.currency === currency)) warnings.push(`${currency} : solde de départ absent, trésorerie inconnue.`);
    const groups = [...new Set(rows.filter((r) => r.data.category === "internal_transfer").map((r) => r.data.transfer_group_id))];
    for (const group of groups) {
      const pair = all.filter((r) => r.data.category === "internal_transfer" && r.data.transfer_group_id === group && r.data.currency === currency);
      if (new Set(pair.map((r) => r.data.account_id)).size < 2 || sum(pair.map((r) => r.data.amount_minor)) !== 0) warnings.push(`Virement ${group} (${currency}) : contrepartie manquante ou déséquilibrée.`);
    }
    return { currency, opening, closing, receipts, refunds, netReceipts: sum([receipts, -refunds]), expenses, operatingCashSurplus: sum([receipts, -refunds, -expenses]), ownerFunding: category("owner_funding"), transfers: category("internal_transfer"), unpaid, movementCount: rows.length, accountBalances, points };
  });
  return { version: 1, revision: state.revision, from, to, accounts, businesses, accountScopes: scopes, buckets, warnings: [...new Set(warnings)], movements, invoices: state.factures.filter((r) => !business || r.data.business_id === business), imports: state.imports.map(({ csv, ...meta }) => meta), scope: business ? "business-movements" : "accounts", empty: currencies.length === 0 };
}
module.exports = { summarize };
