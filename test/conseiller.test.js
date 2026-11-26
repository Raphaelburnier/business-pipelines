const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("node:http");
const os = require("os");
const path = require("path");

const conseiller = require("../src/conseiller");
const vault = require("../src/vault-index");
const { noteValide, appelAvec } = require("../bin/conseiller-pc");
const { configuration } = require("../src/operations-bornees");
const { DatabaseSync } = require("node:sqlite");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function temporaire(nom) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `conseiller-${nom}-`));
  return { dir, base: path.join(dir, "conseiller.sqlite") };
}

function etat({ tranche = false, empreinte = "a".repeat(64) } = {}) {
  return {
    dossiers: [
      {
        dossier: "prix_test",
        empreinte,
        tranche,
        plan_absent: false,
        appliquer_avec: "marketing",
        actions: [{ id: "prix-001", type: "changement_prix", cible: "offre", valeur: { vers: 19 } }],
      },
    ],
  };
}

function nettoyer(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function serveurLent(gestionnaire) {
  let requetes = 0;
  const serveur = http.createServer((requete, reponse) => {
    requetes += 1;
    gestionnaire(requete, reponse, requetes);
  });
  await new Promise((resolve) => serveur.listen(0, "127.0.0.1", resolve));
  const { port } = serveur.address();
  return {
    url: `http://127.0.0.1:${port}`,
    get requetes() { return requetes; },
    fermer: async () => {
      serveur.closeAllConnections();
      await new Promise((resolve) => serveur.close(resolve));
    },
  };
}

const SHA = (texte) => crypto.createHash("sha256").update(texte).digest("hex");

test("le jeton bearer est comparé à son empreinte sans accepter une empreinte invalide", () => {
  const jeton = "jeton-prive";
  assert.ok(conseiller.jetonValide({ authorization: `Bearer ${jeton}` }, SHA(jeton)));
  assert.ok(!conseiller.jetonValide({ authorization: `Bearer ${jeton}x` }, SHA(jeton)));
  assert.ok(!conseiller.jetonValide({ authorization: `Bearer ${jeton}` }, "invalide"));
});

test("la configuration interdit la base du conseiller dans les approbations", () => {
  const jeton = SHA("jeton");
  assert.match(
    conseiller.erreurConfiguration({ base: "/etat/approvals/conseiller.sqlite", approvalsDir: "/etat/approvals", jetonSha256: jeton }),
    /hors du répertoire/
  );
  assert.strictEqual(conseiller.erreurConfiguration({ base: "/etat/conseiller.sqlite", approvalsDir: "/etat/approvals", jetonSha256: jeton }), null);
});

test("un résultat avec un bail expiré ne modifie pas le travail repris", () => {
  const { dir, base } = temporaire("bail");
  try {
    const maintenant = Date.parse("2026-09-30T17:00:00.000Z");
    const dossier = etat().dossiers[0];
    conseiller.noter(base, { ...dossier, tranche: true }, maintenant);
    const premier = conseiller.prendre(base, { maintenant });
    assert.ok(premier && premier.bail);
    const second = conseiller.prendre(base, { etat: etat(), maintenant: maintenant + 5 * 60_000 + 1 });
    assert.ok(second && second.bail);
    assert.notStrictEqual(second.bail, premier.bail);
    const retour = conseiller.rendre(base, premier.id, { bail: premier.bail, avis: [] }, { etat: etat(), maintenant: maintenant + 5 * 60_000 + 2 });
    assert.deepStrictEqual(retour, { ignore: "bail expiré ou remplacé" });
  } finally {
    nettoyer(dir);
  }
});

test("un snapshot interrompu ne devient pas visible avant son dernier lot", () => {
  const { dir, base } = temporaire("snapshot");
  try {
    const ancien = "1".repeat(40);
    const nouveau = "2".repeat(40);
    conseiller.recevoirVault(base, {
      head: ancien,
      debut: true,
      fin: true,
      fichiers: [{ chemin: "notes/ancienne.md", blob: "a".repeat(40), contenu: "# Ancienne\n\n## État\nToujours là." }],
      supprimes: [],
    });
    conseiller.recevoirVault(base, {
      head: nouveau,
      debut: true,
      fin: false,
      fichiers: [{ chemin: "notes/nouvelle.md", blob: "b".repeat(40), contenu: "# Nouvelle\n\n## État\nPas encore publiée." }],
      supprimes: ["notes/ancienne.md"],
    });
    assert.strictEqual(conseiller.inventaireVault(base).head, ancien);
    assert.deepStrictEqual(conseiller.chercherVault(base, "nouvelle"), []);
    conseiller.recevoirVault(base, { head: nouveau, debut: false, fin: true, fichiers: [], supprimes: [] });
    const inventaire = conseiller.inventaireVault(base);
    assert.strictEqual(inventaire.head, nouveau);
    assert.deepStrictEqual(Object.keys(inventaire.blobs), ["notes/nouvelle.md"]);
  } finally {
    nettoyer(dir);
  }
});

test("un ancien index est retiré lorsqu'un fichier devient trop gros", () => {
  const { dir, base } = temporaire("taille");
  try {
    const premier = "3".repeat(40);
    const suivant = "4".repeat(40);
    conseiller.recevoirVault(base, {
      head: premier,
      debut: true,
      fin: true,
      fichiers: [{ chemin: "notes/poids.md", blob: "c".repeat(40), contenu: "# Poids\n\nContenu trouvable." }],
      supprimes: [],
    });
    conseiller.recevoirVault(base, {
      head: suivant,
      debut: true,
      fin: true,
      fichiers: [{ chemin: "notes/poids.md", blob: "d".repeat(40), contenu: "é".repeat(100_001) }],
      supprimes: [],
    });
    assert.deepStrictEqual(Object.keys(conseiller.inventaireVault(base).blobs), []);
  } finally {
    nettoyer(dir);
  }
});

test("un lot sans bornes de snapshot et un mélange de snapshot sont refusés", () => {
  const { dir, base } = temporaire("validation");
  try {
    const a = "5".repeat(40);
    const b = "6".repeat(40);
    assert.throws(() => conseiller.recevoirVault(base, { head: a, fichiers: [], supprimes: [] }), /bornes du snapshot/);
    conseiller.recevoirVault(base, { head: a, debut: true, fin: false, fichiers: [], supprimes: [] });
    assert.throws(() => conseiller.recevoirVault(base, { head: b, debut: false, fin: true, fichiers: [], supprimes: [] }), /snapshot vault absent ou différent/);
  } finally {
    nettoyer(dir);
  }
});

test("une note du NAS est validée contre son marqueur et son chemin calculé", () => {
  const empreinte = "a".repeat(64);
  const marqueur = `dossier:prix_test:${empreinte.slice(0, 16)}`;
  const note = {
    dossier: "prix_test",
    empreinte,
    jour: "2026-09-30",
    chemin: "_context/projects/business-pipelines/decisions/2026-09.md",
    marqueur,
    entree: `<!-- ${marqueur} -->\n## 2026-09-30 : dossier prix_test tranché\n<!-- /${marqueur} -->`,
  };
  assert.ok(noteValide(note));
  assert.strictEqual(noteValide({ ...note, chemin: "../../hors-vault.md" }), null);
  assert.strictEqual(noteValide({ ...note, entree: "texte libre" }), null);
});

test("la note d'une approbation de run passe la validation de l'agent du PC", () => {
  // Refusée le 2026-10-05 : `run:<id>` et une empreinte `budget-1` ne sont pas des noms de note.
  const maintenant = Date.parse("2026-10-05T13:05:00Z");
  for (const empreinte of ["budget-1", "c".repeat(64)]) {
    const note = conseiller.entreeVault(
      {
        dossier: "run:7031a943-bdb9-4d36-8f44-0235d21caa8e",
        source: "run",
        projet: "marketing",
        nodeId: "approbation",
        runId: "1d10f5d9",
        empreinte,
        tranche: true,
        actions: [{ id: "arb-001", type: "arbitrage", cible: "Nom de boutique ?", decision: "approuve", decision_par: "raphael@example.com" }],
      },
      [],
      maintenant
    );
    assert.ok(noteValide(note), `note refusée pour l'empreinte ${empreinte}`);
    assert.match(note.entree, /\*\*Run\*\* : marketing, nœud approbation/);
  }
});

test("l'appel du conseiller au cockpit est borné en-têtes et corps", async () => {
  for (const mode of ["entetes", "corps"]) {
    const serveur = await serveurLent((_requete, reponse) => {
      if (mode === "corps") {
        reponse.writeHead(200, { "Content-Type": "application/json" });
        reponse.write('{"incomplet":');
      }
    });
    try {
      await assert.rejects(
        appelAvec({ fetchImpl: fetch, cockpit: serveur.url, jeton: "test", delaiMs: 60 })("battement"),
        (err) => err.name === "LimiteExecution" && err.operation === "http:conseiller" && err.delaiMs === 60
      );
    } finally {
      await serveur.fermer();
    }
  }
});

test("un délai de conseiller hors bornes est refusé avant lancement", () => {
  const precedentHttp = process.env.CONSEILLER_HTTP_TIMEOUT_MS;
  try {
    process.env.CONSEILLER_HTTP_TIMEOUT_MS = "0";
    assert.throws(() => configuration("http:conseiller"), /CONSEILLER_HTTP_TIMEOUT_MS.*120000/);
    delete process.env.CONSEILLER_HTTP_TIMEOUT_MS;
  } finally {
    if (precedentHttp === undefined) delete process.env.CONSEILLER_HTTP_TIMEOUT_MS;
    else process.env.CONSEILLER_HTTP_TIMEOUT_MS = precedentHttp;
  }
});

test("sans variable, les défauts du conseiller sont inchangés", () => {
  const precedentHttp = process.env.CONSEILLER_HTTP_TIMEOUT_MS;
  try {
    delete process.env.CONSEILLER_HTTP_TIMEOUT_MS;
    assert.strictEqual(configuration("http:conseiller"), 30_000);
    // Le lot du vault avait son propre délai avant le lot 2.6 : il ne tombe pas sur les 30 s.
    const source = fs.readFileSync(path.join(__dirname, "../bin/conseiller-pc.js"), "utf8");
    assert.match(source, /appelAvec\(\{ delaiMs: 120_000 \}\)\("vault\/lot"/);
  } finally {
    if (precedentHttp === undefined) delete process.env.CONSEILLER_HTTP_TIMEOUT_MS;
    else process.env.CONSEILLER_HTTP_TIMEOUT_MS = precedentHttp;
  }
});

test("la recherche FTS ne conserve jamais plus de deux sections par note", () => {
  const { dir, base } = temporaire("fts");
  try {
    const head = "7".repeat(40);
    conseiller.recevoirVault(base, {
      head,
      debut: true,
      fin: true,
      fichiers: [
        {
          chemin: "notes/sections.md",
          blob: "e".repeat(40),
          contenu: "# Sections\n\n## Un\nSignal commun.\n\n## Deux\nSignal commun.\n\n## Trois\nSignal commun.",
        },
      ],
      supprimes: [],
    });
    const resultats = conseiller.chercherVault(base, "signal commun", { limite: 6 });
    assert.strictEqual(resultats.length, 2);
    assert.ok(resultats.every((r) => r.chemin === "notes/sections.md"));
  } finally {
    nettoyer(dir);
  }
});

test("le chat lit le vault dans le périmètre du conseiller, par dossier et par section", () => {
  const { dir, base } = temporaire("chat");
  try {
    conseiller.recevoirVault(base, {
      head: "8".repeat(40),
      debut: true,
      fin: true,
      fichiers: [
        { chemin: "notes/10-node/sqlite.md", blob: "a".repeat(40), contenu: "# SQLite\n\n## WAL\nLe journal WAL du cockpit.\n\n## FTS5\nIndex du cockpit." },
        { chemin: "_context/projects/business-pipelines/etat-business-pipelines.md", blob: "b".repeat(40), contenu: "# État\n\n## Objectif\nLe cockpit observe les runs." },
      ],
      supprimes: [],
    });
    const vault = conseiller.vaultPourChat(base);

    const partout = vault.chercher({ requete: "cockpit", limite: 6, dossier: null });
    assert.ok(partout.synchroLe);
    assert.strictEqual(new Set(partout.resultats.map((r) => r.chemin)).size, 2);
    const projets = vault.chercher({ requete: "cockpit", limite: 6, dossier: "_context/projects/" });
    assert.deepStrictEqual([...new Set(projets.resultats.map((r) => r.chemin))], ["_context/projects/business-pipelines/etat-business-pipelines.md"]);
    assert.strictEqual(vault.chercher({ requete: "zzzinconnu", limite: 6, dossier: null }).resultats, "aucune note trouvée pour ces mots");

    const note = vault.lire({ chemin: "notes/10-node/sqlite.md", section: null });
    assert.deepStrictEqual(note.sections, ["SQLite", "SQLite › WAL", "SQLite › FTS5"]);
    assert.ok(note.texte.indexOf("WAL") < note.texte.indexOf("FTS5"));
    const section = vault.lire({ chemin: "notes/10-node/sqlite.md", section: "fts5" });
    assert.ok(section.texte.includes("Index du cockpit") && !section.texte.includes("journal WAL"));

    assert.match(vault.lire({ chemin: "_context/PROFILE.md", section: null }), /hors du périmètre/);
    assert.match(vault.lire({ chemin: "notes/absente.md", section: null }), /absente de l'index/);
  } finally {
    nettoyer(dir);
  }
});

test("les anciens avis ne sont plus distribués ni acceptés, les notes restent archivables", () => {
  const { dir, base } = temporaire("retrait");
  try {
    const dossier = { ...etat().dossiers[0], tranche: true };
    conseiller.noter(base, dossier);
    const db = new DatabaseSync(base);
    db.exec("INSERT INTO travaux (cle, genre, dossier, empreinte, cree_le) VALUES ('ancien-avis', 'avis', 'prix_test', 'abc', '2026-01-01')");
    db.exec("INSERT INTO travaux (cle, genre, dossier, empreinte, cree_le, statut, bail) VALUES ('ancienne-reponse', 'reponse', 'prix_test', 'abc', '2026-01-01', 'en_cours', 'ancien-bail')");
    const ancien = db.prepare("SELECT id FROM travaux WHERE cle = 'ancienne-reponse'").get();
    db.close();
    const travail = conseiller.prendre(base);
    assert.strictEqual(travail.genre, 'note');
    assert.ok(noteValide(travail.note));
    assert.deepStrictEqual(conseiller.rendre(base, ancien.id, { bail: 'ancien-bail', texte: 'avis' }), { ignore: 'conseiller retiré' });
    assert.deepStrictEqual(conseiller.rendre(base, travail.id, { bail: travail.bail }), { statut: 'fait' });
    assert.strictEqual(conseiller.prendre(base), null);
    const lecture = new DatabaseSync(base);
    assert.strictEqual(lecture.prepare("SELECT COUNT(*) AS n FROM travaux WHERE genre != 'note' AND statut = 'abandonne'").get().n, 2);
    lecture.close();
    const vue = conseiller.etatNotes(base, { dossiers: [{ ...dossier, actions: [{ id: 'x', conseil: { texte: 'ancien avis' } }] }] });
    assert.ok(!('conseil' in vue.dossiers[0].actions[0]));
    assert.strictEqual(vue.dossiers[0].note_vault, 'fait');
  } finally { nettoyer(dir); }
});

let failed = 0;
(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${name}\n${err.stack}`);
    }
  }
  console.log(failed ? `\n${failed} test(s) conseiller en échec` : `\n${tests.length} tests conseiller OK`);
  process.exit(failed ? 1 : 0);
})();
