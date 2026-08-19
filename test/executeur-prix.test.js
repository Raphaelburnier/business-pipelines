const assert = require("assert");
const { changerPrix, formeDeCible, corpsAvecPrix } = require("../src/executeur-prix");

const ENV = { EBAY_MARKETPLACE_ID: "EBAY_US" };

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// L'offre telle qu'eBay la rend vraiment, champs compris : c'est cette forme qui a été
// relevée sur le sandbox, pas une supposée.
function offre(prix = "134.50", devise = "USD", extra = {}) {
  return {
    offerId: "11460338010",
    sku: "TCGBOOSTER001",
    availableQuantity: 5,
    categoryId: "261044",
    merchantLocationKey: "ENTREPOT01",
    pricingSummary: { price: { value: prix, currency: devise } },
    ...extra,
  };
}

// Faux eBay : mémorise chaque appel pour que les tests interrogent ce qui est parti sur
// le réseau, et pas seulement ce qui est revenu.
function faketransport({ get = offre(), apres, statusGet = 200, statusPut = 204, offresParSku, articles }) {
  const appels = [];
  let ecrit = false;
  const transport = async (url, opts = {}) => {
    const methode = opts.method || "GET";
    appels.push({ url, methode, headers: opts.headers, corps: opts.body ? JSON.parse(opts.body) : null });

    if (url.includes("/inventory_item?")) {
      return rep(200, { total: (articles || []).length, inventoryItems: articles || [] });
    }
    if (url.includes("/offer?sku=")) {
      const sku = decodeURIComponent(url.match(/sku=([^&]+)/)[1]);
      return rep(200, { offers: (offresParSku || {})[sku] ? [offresParSku[sku]] : [] });
    }
    if (methode === "PUT") {
      ecrit = true;
      return rep(statusPut, {});
    }
    // Une relecture ne rend `apres` qu'une fois l'écriture passée : sinon le test
    // validerait la relecture sans que rien n'ait été écrit.
    return rep(statusGet, ecrit && apres ? apres : get);
  };
  return { transport, appels };
}

function rep(status, corps) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(corps),
    json: async () => corps,
  };
}

function action(valeur, cible = "11460338010") {
  return { id: "prix-001", type: "changement_prix", cible, valeur };
}

test("le prix change et le résultat consigne le mouvement réel", async () => {
  const { transport, appels } = faketransport({ apres: offre("129.99") });
  const r = await changerPrix(action({ de: 134.5, vers: 129.99, devise: "USD" }), {
    env: ENV,
    transport,
    jeton: "jeton-utilisateur",
  });
  assert.deepStrictEqual(r, { offre: "11460338010", de: 134.5, vers: 129.99, devise: "USD" });
  const put = appels.find((a) => a.methode === "PUT");
  assert.strictEqual(put.corps.pricingSummary.price.value, "129.99");
});

test("le PUT remplace l'offre : les champs non touchés doivent repartir intacts", async () => {
  const { transport, appels } = faketransport({ apres: offre("129.99") });
  await changerPrix(action({ de: 134.5, vers: 129.99, devise: "USD" }), {
    env: ENV,
    transport,
    jeton: "j",
  });
  const put = appels.find((a) => a.methode === "PUT");
  assert.strictEqual(put.corps.availableQuantity, 5, "la quantité serait effacée");
  assert.strictEqual(put.corps.categoryId, "261044", "la catégorie serait effacée");
  assert.strictEqual(put.corps.merchantLocationKey, "ENTREPOT01", "l'entrepôt serait effacé");
});

test("un prix de départ périmé refuse la cible sans arrêter le lot", async () => {
  const { transport, appels } = faketransport({});
  await assert.rejects(
    () => changerPrix(action({ de: 99, vers: 120, devise: "USD" }), { env: ENV, transport, jeton: "j" }),
    (err) => {
      assert.strictEqual(err.cible, true, "doit valoir perte de cible, pas panne");
      assert.match(err.message, /134\.5/);
      return true;
    }
  );
  assert.strictEqual(appels.filter((a) => a.methode === "PUT").length, 0, "rien ne doit partir");
});

test("une devise divergente arrête tout : c'est un plan calculé sur un autre marché", async () => {
  const { transport, appels } = faketransport({});
  await assert.rejects(
    () => changerPrix(action({ de: 134.5, vers: 120, devise: "EUR" }), { env: ENV, transport, jeton: "j" }),
    (err) => {
      assert.notStrictEqual(err.cible, true, "systémique : appliquer un montant EUR à une offre USD");
      return true;
    }
  );
  assert.strictEqual(appels.filter((a) => a.methode === "PUT").length, 0);
});

test("une écriture acceptée mais non appliquée est une panne, pas un succès", async () => {
  const { transport } = faketransport({ apres: offre("134.50") });
  await assert.rejects(
    () => changerPrix(action({ de: 134.5, vers: 129.99, devise: "USD" }), { env: ENV, transport, jeton: "j" }),
    (err) => {
      assert.notStrictEqual(err.cible, true);
      assert.match(err.message, /non confirmée/);
      return true;
    }
  );
});

test("une offre disparue est une cible perdue, un refus de droits est une panne", async () => {
  const perdue = faketransport({ statusGet: 404 });
  await assert.rejects(
    () => changerPrix(action({ vers: 120, devise: "USD" }), { env: ENV, transport: perdue.transport, jeton: "j" }),
    (err) => err.cible === true
  );

  const refus = faketransport({ statusGet: 403 });
  await assert.rejects(
    () => changerPrix(action({ vers: 120, devise: "USD" }), { env: ENV, transport: refus.transport, jeton: "j" }),
    (err) => err.cible !== true
  );
});

test("un prix cible absurde s'arrête avant tout appel réseau", async () => {
  for (const mauvais of [0, -5, "abc", null, undefined]) {
    const { transport, appels } = faketransport({});
    await assert.rejects(
      () => changerPrix(action({ de: 134.5, vers: mauvais, devise: "USD" }), { env: ENV, transport, jeton: "j" }),
      (err) => err.cible !== true
    );
    assert.strictEqual(appels.length, 0, `${mauvais} ne doit toucher aucune API`);
  }
});

test("les trois formes de cible sont reconnues, parce que relevé et écriture ne parlent pas la même langue", () => {
  assert.deepStrictEqual(formeDeCible("11460338010"), { genre: "offre", valeur: "11460338010" });
  assert.deepStrictEqual(formeDeCible("v1|110577263938|0"), { genre: "annonce", valeur: "110577263938" });
  assert.deepStrictEqual(formeDeCible("TCGBOOSTER001"), { genre: "sku", valeur: "TCGBOOSTER001" });
});

test("une cible en SKU se résout par le catalogue du vendeur", async () => {
  const { transport } = faketransport({
    offresParSku: { TCGBOOSTER001: offre("134.50") },
    apres: offre("129.99"),
  });
  const r = await changerPrix(action({ de: 134.5, vers: 129.99, devise: "USD" }, "TCGBOOSTER001"), {
    env: ENV,
    transport,
    jeton: "j",
  });
  assert.strictEqual(r.vers, 129.99);
});

test("une cible au format du relevé se résout en balayant les annonces publiées", async () => {
  const publiee = offre("134.50", "USD", { listing: { listingId: "110577263938" } });
  const { transport } = faketransport({
    articles: [{ sku: "AUTRE" }, { sku: "TCGBOOSTER001" }],
    offresParSku: { AUTRE: offre("10.00", "USD", { listing: { listingId: "999" } }), TCGBOOSTER001: publiee },
    apres: offre("129.99"),
  });
  const r = await changerPrix(action({ de: 134.5, vers: 129.99, devise: "USD" }, "v1|110577263938|0"), {
    env: ENV,
    transport,
    jeton: "j",
  });
  assert.strictEqual(r.offre, "11460338010");
});

test("une cible du relevé introuvable au catalogue est une cible perdue", async () => {
  const { transport } = faketransport({ articles: [], offresParSku: {} });
  await assert.rejects(
    () => changerPrix(action({ vers: 120, devise: "USD" }, "v1|404404404|0"), { env: ENV, transport, jeton: "j" }),
    (err) => err.cible === true
  );
});

test("tout appel Sell porte la langue et la place de marché, sans quoi eBay rend 400", async () => {
  const { transport, appels } = faketransport({ apres: offre("129.99") });
  await changerPrix(action({ de: 134.5, vers: 129.99, devise: "USD" }), { env: ENV, transport, jeton: "j" });
  assert.ok(appels.length > 0);
  for (const a of appels) {
    assert.strictEqual(a.headers["Accept-Language"], "en-US", `${a.methode} ${a.url} sans Accept-Language`);
    assert.strictEqual(a.headers["X-EBAY-C-MARKETPLACE-ID"], "EBAY_US");
  }
});

test("corpsAvecPrix ne fabrique jamais un corps plus pauvre que l'offre reçue", () => {
  const complete = offre("134.50", "USD", { listingDescription: "texte", tax: { applyTax: true } });
  const corps = corpsAvecPrix(complete, 100, "USD");
  assert.strictEqual(corps.listingDescription, "texte");
  assert.deepStrictEqual(corps.tax, { applyTax: true });
  assert.strictEqual(corps.pricingSummary.price.value, "100");
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✘ ${name}\n    ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests exécuteur prix OK`);
  process.exit(failed ? 1 : 0);
})();
