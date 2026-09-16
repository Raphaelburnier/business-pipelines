const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const alerte = require("../src/alerte");
const store = require("../src/store");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const T0 = Date.parse("2026-08-19T12:00:00.000Z");
const HEURE = 3600 * 1000;

// Un dossier d'approbations jetable, écrit dans le store comme le stage d'approbation
// l'écrit : la demande et le plan gelé. Les tests exercent donc la forme de production.
function bac({ dossiers = [{}] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alerte-"));

  dossiers.forEach((d, i) => {
    const nom = d.dossier || (i === 0 ? "ajustement-prix" : `dossier-${i}`);
    const empreinte = d.empreinte || "abc123";

    store.gelerPlan(dir, nom, {
      empreinte,
      gele_le: "2026-08-19T11:30:00.000Z",
      collecte_le: d.collecteLe || "2026-08-19T11:00:00.000Z",
      actions:
        d.actions ||
        [
          {
            id: "prix-001",
            type: "changement_prix",
            cible: "v1|110590223642|0",
            valeur: { de: 499.99, vers: 240.99, devise: "USD" },
          },
        ],
    });
    store.deposer(dir, nom, { empreinte, depuis: "2026-08-19T11:30:00.000Z", actions: 1, appliquer_avec: "appliquer" });
  });

  return dir;
}

// Un transport factice : il enregistre ce qu'on lui donne, et peut échouer sur commande.
function faux({ casse = false } = {}) {
  const recus = [];
  const transport = async (message) => {
    recus.push(message);
    if (casse) throw new Error("réseau injoignable");
  };
  transport.recus = recus;
  return transport;
}

// La péremption se lit dans le pipeline qui applique le plan. Aucun pipeline livré n'en
// déclare plus depuis le retrait des pipelines de prix : le test porte le sien.
const PIPELINES = fs.mkdtempSync(path.join(os.tmpdir(), "alerte-pipelines-"));
fs.writeFileSync(
  path.join(PIPELINES, "appliquer.json"),
  JSON.stringify({ stages: [{ id: "chargement", type: "charger", max_age_heures: 12 }] })
);

test("une demande en attente produit une alerte, qui dit ce qu'il y a à décider", async () => {
  const dir = bac();
  const transport = faux();
  const r = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport });

  assert.strictEqual(r.envoyees.length, 1);
  assert.strictEqual(transport.recus.length, 1);
  const { titre, texte } = transport.recus[0];
  assert.match(titre, /ajustement-prix/);
  assert.match(texte, /abc123/, "l'empreinte est dans le message : c'est elle qu'on approuve");
  assert.match(texte, /prix-001/, "l'action est nommée");
});

test("la même demande dans le même état ne repart pas : un cron ne doit pas bavarder", async () => {
  const dir = bac();
  const transport = faux();
  await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport });
  const r = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0 + HEURE, transport });

  assert.strictEqual(r.candidats, 0, "rien à notifier au second passage");
  assert.strictEqual(transport.recus.length, 1, "un seul message pour un seul état");
});

test("replanifier renotifie : une autre empreinte est une autre demande", async () => {
  const dir = bac();
  const transport = faux();
  await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport });

  // Le planificateur a retourné : nouvelle empreinte, dans la boîte comme dans le plan.
  const [entree] = store.lireBoite(dir).en_attente;
  store.deposer(dir, "ajustement-prix", { ...entree, empreinte: "def456" });
  store.gelerPlan(dir, "ajustement-prix", { ...store.lirePlan(dir, "ajustement-prix"), empreinte: "def456" });

  const r = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport });
  assert.strictEqual(r.envoyees.length, 1, "le nouveau plan mérite son alerte");
  assert.match(transport.recus[1].texte, /def456/);
});

test("un plan qui périme en attendant renotifie une fois, et une seule", async () => {
  const dir = bac();
  const transport = faux();
  await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport });
  assert.strictEqual(transport.recus.length, 1);

  // 13 h après la collecte : au-delà des 12 h du pipeline d'application.
  const perime = Date.parse("2026-08-20T00:30:00.000Z");
  const r = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: perime, transport });
  assert.strictEqual(r.envoyees.length, 1, "changer d'état vaut un message");
  assert.match(transport.recus[1].titre, /PÉRIMÉE/);
  assert.match(transport.recus[1].texte, /ne peut plus être appliqué/);

  const encore = await alerte.envoyer({
    approvalsDir: dir,
    pipelinesDir: PIPELINES,
    maintenant: perime + 5 * HEURE,
    transport,
  });
  assert.strictEqual(encore.candidats, 0, "périmé une fois notifié reste silencieux");
});

test("un envoi qui échoue n'est PAS consigné : la passe suivante réessaie", async () => {
  const dir = bac();
  const casse = faux({ casse: true });
  const r = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport: casse });

  assert.strictEqual(r.envoyees.length, 0);
  assert.strictEqual(r.echecs.length, 1);
  assert.strictEqual(alerte.lireJournal(dir).envoyees.length, 0, "rien au journal");

  const marche = faux();
  const apres = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport: marche });
  assert.strictEqual(apres.envoyees.length, 1, "l'alerte perdue repart");
});

test("un dossier en échec n'empêche pas les autres de partir", async () => {
  const dir = bac({ dossiers: [{ dossier: "a" }, { dossier: "b" }] });
  let appels = 0;
  const capricieux = async () => {
    appels += 1;
    if (appels === 1) throw new Error("réseau injoignable");
  };

  const r = await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport: capricieux });
  assert.strictEqual(r.envoyees.length, 1);
  assert.strictEqual(r.echecs.length, 1);
  assert.strictEqual(alerte.lireJournal(dir).envoyees.length, 1, "seul le réussi est consigné");
});

test("une répétition à blanc n'envoie ni ne consigne rien", async () => {
  const dir = bac();
  const transport = faux();
  const r = await alerte.envoyer({
    approvalsDir: dir,
    pipelinesDir: PIPELINES,
    maintenant: T0,
    transport,
    dry: true,
  });

  assert.strictEqual(r.envoyees.length, 1, "elle montre ce qui partirait");
  assert.strictEqual(transport.recus.length, 0, "sans rien envoyer");
  assert.strictEqual(alerte.lireJournal(dir).envoyees.length, 0, "regarder ne doit pas empêcher d'envoyer");
});

test("une liste tronquée le dit, sinon on approuve douze choses après en avoir lu cinq", async () => {
  const actions = Array.from({ length: 12 }, (_, i) => ({
    id: `prix-${String(i + 1).padStart(3, "0")}`,
    type: "changement_prix",
    cible: `v1|${i}|0`,
    valeur: { de: 100, vers: 90, devise: "EUR" },
  }));
  const dir = bac({ dossiers: [{ actions }] });
  const transport = faux();
  await alerte.envoyer({ approvalsDir: dir, pipelinesDir: PIPELINES, maintenant: T0, transport });

  assert.match(transport.recus[0].texte, /et 7 autre\(s\)/, "le reste est annoncé");
});

test("le message ne porte aucun moyen de décider : prévenir n'est pas engager", async () => {
  const dir = bac();
  const transport = faux();
  await alerte.envoyer({
    approvalsDir: dir,
    pipelinesDir: PIPELINES,
    maintenant: T0,
    cockpitUrl: "http://127.0.0.1:4600",
    transport,
  });

  const texte = transport.recus[0].texte;
  assert.match(texte, /Décider : http:\/\/127\.0\.0\.1:4600/, "il dit où décider");
  assert.doesNotMatch(texte, /approuve|refuse/i, "il ne porte aucune décision, ni lien qui en prenne une");
});

test("aucun transport, ou un transport inconnu, échouent bruyamment", () => {
  assert.throws(() => alerte.transportDe(undefined), /Aucun transport/, "un canal muet ne se remarque jamais");
  assert.throws(() => alerte.transportDe("telegram"), /inconnu/);
  assert.strictEqual(typeof alerte.transportDe("courriel"), "function");
});

test("le transport courriel refuse de partir à moitié configuré", async () => {
  await assert.rejects(
    () => alerte.TRANSPORTS.courriel({ titre: "t", texte: "x" }, { SMTP_HOTE: "smtp.example.com" }),
    /SMTP_UTILISATEUR, SMTP_MOTDEPASSE, ALERTE_DESTINATAIRE/
  );
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests alerte OK`);
  process.exit(failed ? 1 : 0);
})();
