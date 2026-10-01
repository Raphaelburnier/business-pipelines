const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const conseiller = require("../src/conseiller");
const vault = require("../src/vault-index");
const { noteValide } = require("../bin/conseiller-pc");

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
    const premier = conseiller.prendre(base, { etat: etat(), maintenant });
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
