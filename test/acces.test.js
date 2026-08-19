const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const acces = require("../src/acces");
const cockpit = require("../src/cockpit");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const TAILNET = "destrobimobile.tail8296f6.ts.net";
const PORT = 40000 + (process.pid % 20000);

// Le même bac que test/cockpit.test.js : la boîte et le plan gelé tels que le moteur les
// écrit vraiment, pour que le serveur soit exercé contre la forme de production.
function bac({ registreDans = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acces-"));
  const registre = path.join(registreDans || dir, "ajustement-prix.decisions.json");
  const planGele = path.join(dir, "ajustement-prix.plan.json");

  fs.writeFileSync(
    path.join(dir, "EN-ATTENTE.json"),
    JSON.stringify({
      en_attente: [
        {
          dossier: "ajustement-prix",
          empreinte: "abc123",
          depuis: "2026-08-19T11:30:00.000Z",
          actions: 1,
          registre,
          plan_gele: planGele,
          appliquer_avec: null,
        },
      ],
    })
  );

  fs.writeFileSync(
    planGele,
    JSON.stringify({
      empreinte: "abc123",
      gele_le: "2026-08-19T11:30:00.000Z",
      collecte_le: "2026-08-19T11:00:00.000Z",
      actions: [
        {
          id: "prix-001",
          type: "changement_prix",
          cible: "v1|110590223642|0",
          valeur: { de: 499.99, vers: 240.99, devise: "USD" },
          justification: "hors marché",
          sources: ["v1|1|0"],
        },
      ],
    })
  );

  return { dir, registre, planGele };
}

// ---------------------------------------------------------------- le module, sans socket

test("un en-tête d'identité Tailscale signe la décision du login qu'il porte", () => {
  const q = acces.identite(
    { host: `${TAILNET}:443`, "tailscale-user-login": "destrobi28@gmail.com", "tailscale-user-name": "Raphael" },
    { tailnet: TAILNET }
  );
  assert.strictEqual(q.par, "destrobi28@gmail.com");
  assert.strictEqual(q.canal, "tailnet");
  assert.strictEqual(q.nom, "Raphael");
});

test("sans en-tête, une requête locale signe du compte système et le dit", () => {
  const q = acces.identite({ host: `127.0.0.1:${PORT}` }, { tailnet: TAILNET });
  assert.strictEqual(q.canal, "local");
  assert.strictEqual(q.par, os.userInfo().username);
});

test("arrivée sous le nom du tailnet sans identité : refusée, jamais signée en local", () => {
  assert.throws(
    () => acces.identite({ host: TAILNET }, { tailnet: TAILNET }),
    (e) => e instanceof cockpit.Refus && /sans identité Tailscale/.test(e.message),
    "un appelant qui prend le nom du tailnet sans passer par le relais ne doit pas hériter de l'identité locale"
  );
});

test("l'en-tête l'emporte sur le nom d'hôte, parce que le relais peut le réécrire", () => {
  // Si tailscale serve réécrit Host en localhost, une identification basée sur l'hôte
  // classerait tout le trafic du téléphone en local. C'est l'en-tête qui fait foi.
  const q = acces.identite(
    { host: `localhost:${PORT}`, "tailscale-user-login": "destrobi28@gmail.com" },
    { tailnet: TAILNET }
  );
  assert.strictEqual(q.canal, "tailnet");
  assert.strictEqual(q.par, "destrobi28@gmail.com");
});

test("l'opérateur local se configure, et un en-tête vide ne vaut pas une identité", () => {
  const q = acces.identite(
    { host: `127.0.0.1:${PORT}`, "tailscale-user-login": "   " },
    { tailnet: TAILNET, operateurLocal: "raph-poste" }
  );
  assert.strictEqual(q.par, "raph-poste");
  assert.strictEqual(q.canal, "local");
});

test("la liste d'hôtes n'accepte le nom du tailnet que s'il est configuré", () => {
  assert.ok(acces.hoteAutorise({ host: `127.0.0.1:${PORT}` }, { port: PORT }));
  assert.ok(!acces.hoteAutorise({ host: TAILNET }, { port: PORT }), "sans configuration, le tailnet reste un hôte inconnu");
  assert.ok(acces.hoteAutorise({ host: TAILNET }, { port: PORT, tailnet: TAILNET }));
  assert.ok(!acces.hoteAutorise({ host: "evil.example" }, { port: PORT, tailnet: TAILNET }));
});

test("une origine absente passe, une origine étrangère non", () => {
  const p = { port: PORT, tailnet: TAILNET };
  assert.ok(acces.origineAutorisee({}, p), "curl et le cron ne déclarent pas d'origine");
  assert.ok(acces.origineAutorisee({ origin: `https://${TAILNET}` }, p));
  assert.ok(acces.origineAutorisee({ origin: `http://127.0.0.1:${PORT}` }, p));
  assert.ok(!acces.origineAutorisee({ origin: "https://evil.example" }, p));
});

// ------------------------------------------------------------------- le vrai serveur HTTP

function demander({ methode = "GET", chemin = "/", entetes = {}, corps = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: PORT, method: methode, path: chemin, headers: { Host: `127.0.0.1:${PORT}`, ...entetes } },
      (res) => {
        let brut = "";
        res.on("data", (m) => (brut += m));
        res.on("end", () => resolve({ code: res.statusCode, corps: brut }));
      }
    );
    req.on("error", reject);
    if (corps !== null) req.end(corps);
    else req.end();
  });
}

async function attendre(serveur) {
  for (let i = 0; i < 100; i += 1) {
    try {
      await demander({ chemin: "/api/etat" });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("le cockpit n'a pas démarré");
}

let serveur = null;
let bacCourant = null;

async function monter(env = {}) {
  bacCourant = bac();
  serveur = spawn(process.execPath, [path.join(__dirname, "..", "bin", "cockpit.js")], {
    env: {
      ...process.env,
      APPROVALS_DIR: bacCourant.dir,
      COCKPIT_PORT: String(PORT),
      COCKPIT_TAILNET: TAILNET,
      COCKPIT_OPERATEUR_LOCAL: "raph-poste",
      ...env,
    },
    stdio: "ignore",
  });
  await attendre();
}

function demonter() {
  if (serveur) serveur.kill("SIGKILL");
  serveur = null;
}

const ENTETE_TAILNET = { Host: TAILNET, "Tailscale-User-Login": "destrobi28@gmail.com" };
const JSON_LOCAL = { "Content-Type": "application/json", Origin: `http://127.0.0.1:${PORT}` };

test("la page locale signe du compte configuré et ne demande plus de nom à taper", async () => {
  const r = await demander({ chemin: "/" });
  assert.strictEqual(r.code, 200);
  assert.ok(r.corps.includes("raph-poste"), "la page annonce sous quel nom elle signera");
  assert.ok(!/id="par"/.test(r.corps), "le champ texte libre a disparu : il laissait écrire n'importe quel nom");
  assert.ok(r.corps.includes("width=device-width"), "sans viewport la page est illisible sur un téléphone");
});

test("un hôte que je n'ai pas prévu ne parle pas au serveur", async () => {
  const r = await demander({ entetes: { Host: "evil.example" } });
  assert.strictEqual(r.code, 403);
  assert.ok(/hôte refusé/.test(r.corps));
});

test("le nom du tailnet sans relais ne montre même pas les prix", async () => {
  const r = await demander({ entetes: { Host: TAILNET } });
  assert.strictEqual(r.code, 403, "une identité inconnue ne reçoit pas la page non plus, pas seulement l'écriture");
  assert.ok(!/240.99/.test(r.corps), "aucun montant ne doit fuiter dans la réponse de refus");
});

test("par le relais, la page signe de l'identité du tailnet", async () => {
  const r = await demander({ entetes: ENTETE_TAILNET });
  assert.strictEqual(r.code, 200);
  assert.ok(r.corps.includes("destrobi28@gmail.com"));
  assert.ok(!r.corps.includes("raph-poste"), "le canal tailnet ne doit pas retomber sur l'identité locale");
});

test("une décision prise depuis le téléphone est consignée avec son identité et son canal", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { ...ENTETE_TAILNET, "Content-Type": "application/json", Origin: `https://${TAILNET}` },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "abc123", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(r.code, 200, r.corps);
  const registre = JSON.parse(fs.readFileSync(bacCourant.registre, "utf-8"));
  assert.strictEqual(registre.decisions[0].par, "destrobi28@gmail.com");
  assert.strictEqual(registre.decisions[0].canal, "tailnet");
});

test("une écriture venue d'un autre site est refusée", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { ...JSON_LOCAL, Origin: "https://evil.example" },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "abc123", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(r.code, 403);
  assert.ok(/origine refusée/.test(r.corps));
  assert.ok(!fs.existsSync(bacCourant.registre), "rien ne doit être écrit");
});

test("un POST de formulaire, qui échappe au contrôle préalable CORS, est refusé sur le type", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { "Content-Type": "text/plain" },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "abc123", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(r.code, 415);
  assert.ok(!fs.existsSync(bacCourant.registre), "rien ne doit être écrit");
});

test("le corps ne choisit pas où le registre s'écrit", async () => {
  // Le corps était étalé dans l'appel à enregistrer(), après approvalsDir. Il pouvait donc
  // le redéfinir, désigner une fausse boîte et faire écrire un fichier arbitraire. Tant que
  // la page n'était joignable qu'en loopback, personne ne pouvait l'atteindre ; le tailnet
  // change ça, et la garde ne doit pas dépendre de qui peut se connecter.
  const piege = bac({ registreDans: fs.mkdtempSync(path.join(os.tmpdir(), "piege-")) });
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: JSON_LOCAL,
    corps: JSON.stringify({
      approvalsDir: piege.dir,
      dossier: "ajustement-prix",
      empreinte: "abc123",
      decisions: [{ action_id: "prix-001", decision: "approuve" }],
    }),
  });
  assert.strictEqual(r.code, 200, r.corps);
  assert.ok(!fs.existsSync(piege.registre), "le chemin dicté par la requête ne doit rien recevoir");
  assert.ok(fs.existsSync(bacCourant.registre), "le registre réel, lui, est écrit");
});

test("le corps ne choisit ni la signature ni l'heure", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: JSON_LOCAL,
    corps: JSON.stringify({
      dossier: "ajustement-prix",
      empreinte: "abc123",
      par: "quelqu-un-d-autre",
      maintenant: 0,
      decisions: [{ action_id: "prix-001", decision: "approuve" }],
    }),
  });
  assert.strictEqual(r.code, 200, r.corps);
  const d = JSON.parse(fs.readFileSync(bacCourant.registre, "utf-8")).decisions[0];
  assert.strictEqual(d.par, "raph-poste", "la signature vient du canal, pas de ce que le corps raconte");
  assert.strictEqual(d.canal, "local");
  assert.ok(!d.le.startsWith("1970"), "l'horodatage ne se falsifie pas depuis le corps");
});

test("l'empreinte lie toujours la décision au plan affiché, y compris par le tailnet", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { ...ENTETE_TAILNET, "Content-Type": "application/json" },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "empreinte-perimee", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(r.code, 409);
  assert.ok(/le plan a changé/.test(r.corps));
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    const httpTest = fn.constructor.name === "AsyncFunction";
    try {
      if (httpTest) await monter();
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✘ ${name}\n    ${err.message}`);
    } finally {
      if (httpTest) demonter();
    }
  }
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests accès OK`);
  process.exit(failed ? 1 : 0);
})();
