const { test } = require("node:test");
const assert = require("node:assert/strict");
const { summarize } = require("../src/finance/metrics");
const { exampleState } = require("../src/finance/http");
const { emptyState } = require("../src/finance/service");
const period = { from: "2026-10-01", to: "2026-11-01" };
const chf = (summary) => summary.buckets.find((b) => b.currency === "CHF");
test("fixture CHF : revenus nets, excédent, apports, transferts et impayés distincts", () => {
  const s = summarize(exampleState(), period);
  const b = chf(s);
  assert.equal(b.receipts, 120000);
  assert.equal(b.refunds, 20000);
  assert.equal(b.netReceipts, 100000);
  assert.equal(b.expenses, 40000);
  assert.equal(b.operatingCashSurplus, 60000);
  assert.equal(b.ownerFunding, 50000);
  assert.equal(b.transfers, 0);
  assert.equal(b.opening, 100000);
  assert.equal(b.closing, 210000);
  assert.equal(b.unpaid, 30000);
  assert.deepEqual(s.warnings, []);
  assert.equal(b.points[0].amount, 100000);
  assert.equal(b.points.at(-1).amount, 210000);
  assert.equal(b.points.find((p) => p.date === "2026-10-08").amount, 210000);
  assert.equal(
    b.accountBalances.find((a) => a.accountId === "demo-courant").closing,
    170000,
  );
});
test("EUR indépendant : aucune somme entre monnaies ni conversion", () => {
  const s = summarize(exampleState(), period);
  const b = s.buckets.find((b) => b.currency === "EUR");
  assert.equal(b.expenses, 5000);
  assert.equal(b.operatingCashSurplus, -5000);
  assert.equal(b.opening, 10000);
  assert.equal(b.closing, 5000);
  assert.equal(s.buckets.length, 2);
  assert.equal("total" in s, false);
});
test("début inclus/fin exclue, solde au début du jour, mouvements antérieurs reportés", () => {
  const b = chf(
    summarize(exampleState(), { from: "2026-10-03", to: "2026-10-06" }),
  );
  assert.equal(b.opening, 220000);
  assert.equal(b.refunds, 20000);
  assert.equal(b.expenses, 30000);
  assert.equal(b.closing, 170000);
  const state = exampleState();
  state.soldes.push({
    data: {
      account_id: "demo-courant",
      currency: "CHF",
      as_of: "2026-10-02",
      balance_minor: 100000,
    },
    line: 99,
    importId: "example",
  });
  const day = chf(summarize(state, { from: "2026-10-02", to: "2026-10-03" }));
  assert.equal(day.opening, 100000);
  assert.equal(day.closing, 220000);
  assert.throws(
    () => summarize(state, { from: "2026-02-30", to: "2026-11-01" }),
    /Période/,
  );
});
test("sans relevés : inconnu ; un compte sans solde empêche une fausse somme consolidée", () => {
  assert.equal(summarize(emptyState()).empty, true);
  const state = exampleState();
  state.soldes = [];
  const b = chf(summarize(state, period));
  assert.equal(b.opening, null);
  assert.equal(b.closing, null);
  assert.deepEqual(b.points, []);
  state.soldes = exampleState().soldes.filter(
    (r) => r.data.account_id === "demo-courant",
  );
  assert.equal(chf(summarize(state, period)).closing, null);
});
test("compte filtré : transfert sortant compte dans le solde mais pas dans les revenus", () => {
  const b = chf(
    summarize(exampleState(), { ...period, account: "demo-courant" }),
  );
  assert.equal(b.closing, 170000);
  assert.equal(b.transfers, -40000);
  assert.equal(b.netReceipts, 100000);
  assert.equal(b.unpaid, null);
});
test("un filtre business ne lui attribue jamais le solde complet des comptes", () => {
  const s = summarize(exampleState(), { ...period, business: "demo-business" });
  const b = chf(s);
  assert.equal(b.netReceipts, 100000);
  assert.equal(b.closing, null);
  assert.equal(b.opening, null);
  assert.deepEqual(b.points, []);
  assert.match(s.warnings[0], /propriété/);
});
test("écart de rapprochement et virement incomplet restent visibles, sans corriger les sources", () => {
  const state = exampleState();
  state.soldes.find(
    (r) => r.data.source_record_id === "s4",
  ).data.balance_minor += 100;
  state.mouvements = state.mouvements.filter(
    (r) => r.data.source_record_id !== "m7",
  );
  const s = summarize(state, period);
  assert.ok(s.warnings.some((w) => /écart 100 centimes/.test(w)));
  assert.ok(s.warnings.some((w) => /contrepartie/.test(w)));
  assert.equal(chf(s).closing, 170000);
  assert.equal(chf(s).netReceipts, 100000);
});
test("une facture marquée payée ne crée jamais une entrée de banque", () => {
  const state = exampleState();
  state.factures[0].data.status = "paid";
  const b = chf(summarize(state, period));
  assert.equal(b.unpaid, 0);
  assert.equal(b.netReceipts, 100000);
  assert.equal(b.closing, 210000);
});
test("attribution explicite dédiée permet le calcul business ; partagé ou données contradictoires le refusent", () => {
  const state = exampleState();
  state.accountScopes = ["demo-courant", "demo-epargne", "demo-eur"].map(
    (accountId) => ({
      accountId,
      ownership: "dedicated",
      businessId: "demo-business",
    }),
  );
  const query = { ...period, business: "demo-business" };
  assert.equal(chf(summarize(state, query)).closing, 210000);
  state.accountScopes[0].ownership = "shared";
  assert.equal(chf(summarize(state, query)).closing, null);
  state.accountScopes[0].ownership = "dedicated";
  state.mouvements[0].data.business_id = "autre-business";
  assert.equal(chf(summarize(state, query)).closing, null);
});
test("annulation de grands apports : aucun centime perdu dans une somme intermédiaire", () => {
  const state = emptyState();
  state.soldes = [
    {
      data: {
        account_id: "a",
        currency: "CHF",
        as_of: "2026-10-01",
        balance_minor: 0,
      },
      line: 2,
      importId: "s",
    },
  ];
  state.mouvements = [
    ...Array(10000).fill(1_000_000_000_000),
    1,
    ...Array(10000).fill(-1_000_000_000_000),
  ].map((amount_minor, i) => ({
    data: {
      account_id: "a",
      business_id: "b",
      booked_on: "2026-10-02",
      currency: "CHF",
      category: "owner_funding",
      amount_minor,
    },
    line: i + 2,
    importId: "m",
  }));
  const b = chf(summarize(state, period));
  assert.equal(b.ownerFunding, 1);
  assert.equal(b.closing, 1);
});
