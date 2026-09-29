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
  const cockpit = depot(racine, "business-pipelines", { "package.json": "{}\n", "deploy/nas/deploy.sh.modele": MODELE });
  const moteur = depot(racine, "agent-orchestrator", { "package.json": "{}\n" });
  const registre = depot(racine, "agent-registry", { "agents/a.md": "a\n" });
  const miroirs = { cockpit: cockpit.nu, moteur: moteur.nu, registre: registre.nu };
  return { racine, miroirs, cockpit, moteur, registre };
}

const tetes = (m) => ({ cockpit: m.cockpit.v2, moteur: m.moteur.v2, registre: m.registre.v2 });
const autorises = new Set(["raphael@example.com"]);

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
  const ok = { git, miroirs: m.miroirs, payload: tetes(m), par: "raphael@example.com", canal: "tailnet", autorises };
  livreur.verifierDemande(ok);
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

test("la release est l'export exact des trois SHA, avec un deploy.sh qui vérifie la bonne empreinte", () => {
  const m = monter();
  const releasesDir = path.join(m.racine, "releases");
  const prete = livreur.preparerRelease({
    git,
    miroirs: m.miroirs,
    payload: tetes(m),
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
