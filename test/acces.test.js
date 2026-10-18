const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const acces = require("../src/acces");
const cockpit = require("../src/cockpit");
const store = require("../src/store");
const crypto = require("crypto");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

const TAILNET = "destrobimobile.tail8296f6.ts.net";
const PORT = 40000 + (process.pid % 20000);

// Le même bac que test/cockpit.test.js : la demande et le plan gelé écrits dans le store
// comme le stage d'approbation les écrit, pour que le serveur soit exercé contre la forme
// de production.
function bac({
  dossier = "ajustement-prix",
  actionId = "prix-001",
  valeur = { de: 499.99, vers: 240.99, devise: "USD" },
  justification = "hors marché",
  depuis = "2026-08-19T11:30:00.000Z",
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acces-"));

  store.deposer(dir, dossier, { empreinte: "abc123", depuis, actions: 1, appliquer_avec: null });
  store.gelerPlan(dir, dossier, {
    empreinte: "abc123",
    gele_le: "2026-08-19T11:30:00.000Z",
    collecte_le: "2026-08-19T11:00:00.000Z",
    actions: [
      {
        id: actionId,
        type: "changement_prix",
        cible: "v1|110590223642|0",
        valeur,
        justification,
        sources: ["v1|1|0"],
      },
    ],
  });

  return { dir, dossier, registre: () => store.lireRegistre(dir, dossier) };
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

function demander({ methode = "GET", chemin = "/", entetes = {}, corps = null, socket = null }) {
  return new Promise((resolve, reject) => {
    const cible = socket ? { socketPath: socket } : { host: "127.0.0.1", port: PORT };
    const req = http.request(
      { ...cible, method: methode, path: chemin, headers: { Host: `127.0.0.1:${PORT}`, ...entetes } },
      (res) => {
        let brut = "";
        res.on("data", (m) => (brut += m));
        res.on("end", () => resolve({ code: res.statusCode, corps: brut, entetes: res.headers }));
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

async function monter(env = {}, forme = {}) {
  bacCourant = bac(forme);
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
const JETON_CONSEILLER = "jeton-test-conseiller";
const EMPREINTE_CONSEILLER = crypto.createHash("sha256").update(JETON_CONSEILLER).digest("hex");

test("l’API d’approbations expose l’identité qui signera et le plan gelé", async () => {
  const r = await demander({ chemin: "/api/approbations" });
  assert.strictEqual(r.code, 200, r.corps);
  const corps = JSON.parse(r.corps);
  assert.strictEqual(corps.qui.par, "raph-poste");
  assert.strictEqual(corps.qui.canal, "local");
  assert.strictEqual(corps.etat.dossiers[0].dossier, "ajustement-prix");
  assert.strictEqual(corps.etat.dossiers[0].empreinte, "abc123");
  assert.strictEqual(corps.etat.dossiers[0].actions[0].id, "prix-001");
  assert.strictEqual(corps.etat.dossiers[0].actions[0].decision, null);
  assert.ok(!Object.hasOwn(corps, "par"), "l’identité est une propriété du serveur, pas du corps client");
});

test("par le relais, l’API d’approbations signe de l’identité du tailnet", async () => {
  const r = await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET });
  assert.strictEqual(r.code, 200, r.corps);
  const corps = JSON.parse(r.corps);
  assert.strictEqual(corps.qui.par, "destrobi28@gmail.com");
  assert.strictEqual(corps.qui.canal, "tailnet");
});

test("une décision prise depuis le téléphone est consignée avec son identité et son canal", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { ...ENTETE_TAILNET, "Content-Type": "application/json", Origin: `https://${TAILNET}` },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "abc123", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(r.code, 200, r.corps);
  const registre = bacCourant.registre();
  assert.strictEqual(registre.decisions[0].par, "destrobi28@gmail.com");
  assert.strictEqual(registre.decisions[0].canal, "tailnet");
});

async function protocoleAgentSansOrigin() {
  demonter();
  await monter({
    CONSEILLER_JETON_SHA256: EMPREINTE_CONSEILLER,
    CONSEILLER_BASE: path.join(bacCourant.dir, "conseiller.sqlite"),
  });
  const entetes = { Authorization: `Bearer ${JETON_CONSEILLER}`, "Content-Type": "application/json" };
  const sansOrigine = await demander({
    methode: "POST",
    chemin: "/api/conseiller/battement",
    entetes,
    corps: JSON.stringify({ modele: "test" }),
  });
  assert.strictEqual(sansOrigine.code, 200, sansOrigine.corps);

  const origineEtrangere = await demander({
    methode: "POST",
    chemin: "/api/conseiller/battement",
    entetes: { ...entetes, Origin: "https://evil.example" },
    corps: JSON.stringify({ modele: "test" }),
  });
  assert.strictEqual(origineEtrangere.code, 403, origineEtrangere.corps);
}
protocoleAgentSansOrigin.forme = {};
test("le bearer de l’agent sans Origin est accepté, mais une Origin étrangère est refusée", protocoleAgentSansOrigin);

test("un conseiller sans empreinte reste indisponible sans bloquer les approbations", async () => {
  demonter();
  await monter({ CONSEILLER_JETON_SHA256: "invalide" });
  const lecture = await demander({ chemin: "/api/approbations" });
  assert.strictEqual(lecture.code, 200, lecture.corps);
  const reponse = JSON.parse(lecture.corps);
  assert.strictEqual(reponse.conseiller.disponible, false);
  assert.match(reponse.conseiller.erreur, /CONSEILLER_JETON_SHA256/);
  const agent = await demander({
    methode: "POST",
    chemin: "/api/conseiller/battement",
    entetes: { Authorization: `Bearer ${JETON_CONSEILLER}`, "Content-Type": "application/json" },
    corps: JSON.stringify({ modele: "test" }),
  });
  assert.strictEqual(agent.code, 503, agent.corps);
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
  assert.strictEqual(bacCourant.registre(), null, "rien ne doit être écrit");
});

test("un POST de formulaire, qui échappe au contrôle préalable CORS, est refusé sur le type", async () => {
  const r = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { "Content-Type": "text/plain" },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "abc123", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(r.code, 415);
  assert.strictEqual(bacCourant.registre(), null, "rien ne doit être écrit");
});

test("le corps ne choisit pas dans quel store le registre s'écrit", async () => {
  // Le corps était étalé dans l'appel à enregistrer(), après approvalsDir. Il pouvait donc
  // le redéfinir, désigner une fausse boîte et faire écrire un fichier arbitraire. Tant que
  // la page n'était joignable qu'en loopback, personne ne pouvait l'atteindre ; le tailnet
  // change ça, et la garde ne doit pas dépendre de qui peut se connecter.
  const piege = bac();
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
  assert.strictEqual(piege.registre(), null, "le store dicté par la requête ne doit rien recevoir");
  assert.ok(bacCourant.registre(), "le registre réel, lui, est écrit");
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
  const d = bacCourant.registre().decisions[0];
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

test("une boîte illisible répond par l’API et ne tue pas le cockpit", async () => {
  const base = store.cheminBase(bacCourant.dir);
  for (const f of [base, `${base}-wal`, `${base}-shm`]) fs.rmSync(f, { force: true });
  fs.writeFileSync(base, "pas une base SQLite");
  const r = await demander({ chemin: "/api/approbations" });
  assert.strictEqual(r.code, 500, "une base corrompue est une réponse, pas un arrêt");
  assert.ok(r.corps.includes(store.FICHIER), "le message doit dire quel fichier réparer");

  fs.rmSync(base, { force: true });
  const apres = await demander({ chemin: "/api/approbations" });
  assert.strictEqual(apres.code, 200, "le cockpit doit avoir survécu à la requête précédente");
});

test("l’API ne met pas les plans ni les modules en cache", async () => {
  const r = await demander({ chemin: "/api/approbations" });
  assert.strictEqual(r.code, 200, r.corps);
  assert.strictEqual(r.entetes["cache-control"], "no-store");
  assert.strictEqual(r.entetes["x-content-type-options"], "nosniff");
});

// Le registre d’applications est relu à chaque appel : une livraison ou un retrait se voit
// sans redémarrer le cockpit. Il reste subordonné aux contrôles d’identité du serveur.
function bacApps(contenu) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acces-apps-"));
  ecrireApps(dir, contenu);
  return dir;
}

function ecrireApps(dir, contenu) {
  fs.writeFileSync(path.join(dir, "cockpit-apps.json"), JSON.stringify(contenu, null, 2));
}

test("les modules traversent l’API, et une fiche sans adresse reste non cliquable", async () => {
  demonter();
  await monter({
    CONSEILLER_JETON_SHA256: EMPREINTE_CONSEILLER,
    CONSEILLER_BASE: path.join(bacCourant.dir, "conseiller.sqlite"),
    COCKPIT_APPS_DIR: bacApps({
      modules: [
        { nom: "tcg-generator", url: "http://192.168.1.18:4700" },
        { nom: "Agents vocaux PME", etat: "en-cours", notes: ["choisir la voix"] },
      ],
    }),
  });

  const r = await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET });
  assert.strictEqual(r.code, 200, r.corps);
  const apps = JSON.parse(r.corps).modules.apps;
  assert.deepStrictEqual(
    apps.map((app) => ({ nom: app.nom, url: app.url, etat: app.etat })),
    [
      { nom: "tcg-generator", url: "http://192.168.1.18:4700/", etat: "en-ligne" },
      { nom: "Agents vocaux PME", url: null, etat: "en-cours" },
    ]
  );
});

test("un registre d’apps mis à jour est relu sans redémarrage", async () => {
  demonter();
  const dir = bacApps({ apps: [{ nom: "premiere", url: "http://192.168.1.18:4700" }] });
  await monter({ COCKPIT_APPS_DIR: dir });

  const avant = JSON.parse((await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET })).corps);
  assert.deepStrictEqual(avant.modules.apps.map((app) => app.nom), ["premiere"]);

  ecrireApps(dir, { apps: [{ nom: "seconde", url: "http://192.168.1.18:4701" }] });
  const apres = JSON.parse((await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET })).corps);
  assert.deepStrictEqual(apres.modules.apps.map((app) => app.nom), ["seconde"]);
});

async function registreAppsInvalideNEmpechePasUneDecision() {
  demonter();
  const dir = bacApps({ apps: [{ nom: "premiere", url: "http://192.168.1.18:4700" }] });
  await monter({ COCKPIT_APPS_DIR: dir });
  fs.writeFileSync(path.join(dir, "cockpit-apps.json"), "{ édité de travers");

  const lecture = await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET });
  assert.strictEqual(lecture.code, 200, lecture.corps);
  const corps = JSON.parse(lecture.corps);
  assert.strictEqual(typeof corps.modules.erreur, "string");
  assert.ok(corps.modules.erreur.includes("cockpit-apps.json"));
  assert.deepStrictEqual(corps.modules.apps, []);

  const ecriture = await demander({
    methode: "POST",
    chemin: "/api/decider",
    entetes: { ...ENTETE_TAILNET, "Content-Type": "application/json", Origin: `https://${TAILNET}` },
    corps: JSON.stringify({ dossier: "ajustement-prix", empreinte: "abc123", decisions: [{ action_id: "prix-001", decision: "approuve" }] }),
  });
  assert.strictEqual(ecriture.code, 200, ecriture.corps);
}
test("un registre d’apps illisible n’empêche pas une décision", registreAppsInvalideNEmpechePasUneDecision);

test("un appel anonyme ou un hôte non autorisé ne lit pas les approbations", async () => {
  const anonyme = await demander({ chemin: "/api/approbations", entetes: { Host: TAILNET } });
  assert.strictEqual(anonyme.code, 403);
  const etranger = await demander({ chemin: "/api/approbations", entetes: { Host: "evil.example" } });
  assert.strictEqual(etranger.code, 403);
});

test("sans réglage, le cockpit écoute la boucle locale et rien d'autre", () => {
  assert.strictEqual(acces.adresseEcoute(), "127.0.0.1");
  assert.strictEqual(acces.adresseEcoute({}), "127.0.0.1");
  // Une variable posée puis vidée est la façon la plus courante d'annuler un réglage.
  // Elle doit ramener le défaut, pas une adresse vide que Node lirait comme 0.0.0.0.
  assert.strictEqual(acces.adresseEcoute({ hote: "" }), "127.0.0.1");
  assert.strictEqual(acces.adresseEcoute({ hote: "   " }), "127.0.0.1");
});

test("une adresse hors boucle locale est refusée tant que rien ne déclare le conteneur", () => {
  // C'est le refus qui compte : COCKPIT_HOTE seul, dans un .env du poste, ouvrirait le
  // cockpit sur le LAN. Or sur le LAN les en-têtes d'identité Tailscale se fabriquent,
  // donc n'importe quelle machine du réseau signerait des décisions de prix.
  for (const hote of ["0.0.0.0", "::", "192.168.1.18"]) {
    assert.throws(
      () => acces.adresseEcoute({ hote }),
      (err) => /COCKPIT_CONTENEUR=1/.test(err.message),
      `${hote} accepté sans reconnaissance explicite`
    );
  }
  // Le conteneur déclaré sans adresse ne suffit pas non plus à bouger l'écoute : la clé
  // reconnaît un montage, elle ne le demande pas.
  assert.strictEqual(acces.adresseEcoute({ conteneur: true }), "127.0.0.1");
});

test("dans un conteneur déclaré, lier toutes les interfaces est le seul montage qui répond", () => {
  // Un serveur lié à 127.0.0.1 dans un conteneur n'est joignable par personne : la
  // publication de l'hôte relaie vers l'adresse du conteneur sur son réseau, jamais vers
  // sa boucle locale. Le cockpit du NAS a tourné dix jours « Up » et muet pour ça.
  assert.strictEqual(acces.adresseEcoute({ hote: "0.0.0.0", conteneur: true }), "0.0.0.0");
  // La boucle locale reste acceptée avec la clé : elle ne force rien, elle autorise.
  assert.strictEqual(acces.adresseEcoute({ hote: "127.0.0.1", conteneur: true }), "127.0.0.1");
});

test("socket seul : un en-tête d'identité hors du socket est refusé, par le socket il signe", () => {
  const entetes = { host: TAILNET, "tailscale-user-login": "destrobi28@gmail.com" };
  assert.throws(
    () => acces.identite(entetes, { tailnet: TAILNET, socketSeul: true }),
    (e) => e instanceof cockpit.Refus && /hors du socket/.test(e.message)
  );
  assert.strictEqual(acces.identite(entetes, { tailnet: TAILNET, socketSeul: true, viaSocket: true }).canal, "tailnet");
  // Sans le mode socket seul, le comportement d'avant reste : transition sans coupure.
  assert.strictEqual(acces.identite(entetes, { tailnet: TAILNET }).canal, "tailnet");
});
test("dans le conteneur, le canal local lit mais n'écrit pas", () => {
  const local = { par: "root", nom: null, canal: "local" };
  assert.doesNotThrow(() => acces.verifierEcriture(local, { methode: "GET", conteneur: true }));
  assert.throws(() => acces.verifierEcriture(local, { methode: "POST", conteneur: true }), (e) => e instanceof cockpit.Refus);
  assert.doesNotThrow(() => acces.verifierEcriture(local, { methode: "POST", conteneur: false }));
  assert.doesNotThrow(() => acces.verifierEcriture({ par: "r", nom: null, canal: "tailnet" }, { methode: "POST", conteneur: true }));
});
test("le cockpit sert aussi le socket et n'y croit l'identité qu'avec COCKPIT_IDENTITE_SOCKET_SEULE", async () => {
  demonter();
  const socket = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-sock-")), "cockpit.sock");
  await monter({ COCKPIT_SOCKET: socket, COCKPIT_IDENTITE_SOCKET_SEULE: "1" });
  for (let i = 0; i < 50 && !fs.existsSync(socket); i += 1) await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(fs.statSync(socket).mode & 0o777, 0o600);
  const parTcp = await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET });
  assert.strictEqual(parTcp.code, 403, "un agent qui joint le port TCP ne doit pas pouvoir se dire Raphaël");
  const parSocket = await demander({ chemin: "/api/approbations", entetes: ENTETE_TAILNET, socket });
  assert.strictEqual(parSocket.code, 200, parSocket.corps);
  assert.strictEqual(JSON.parse(parSocket.corps).qui.canal, "tailnet");
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    const httpTest = fn.constructor.name === "AsyncFunction";
    try {
      if (httpTest) await monter({}, fn.forme || {});
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
