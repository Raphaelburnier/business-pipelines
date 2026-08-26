const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const durable = require("../src/durable");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function bac() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "durable-"));
}

test("réécrire un fichier durable le remplace, il ne le vide jamais sur place", () => {
  const dir = bac();
  const p = path.join(dir, "registre.json");

  durable.ecrireJson(p, { decisions: ["première"] });
  const avant = fs.statSync(p).ino;
  durable.ecrireJson(p, { decisions: ["seconde"] });
  const apres = fs.statSync(p).ino;

  // C'est l'inode qui distingue les deux façons d'écrire. Un writeFileSync direct garde le
  // même : il ouvre la destination, la vide, puis la remplit, et un processus tué entre les
  // deux laisse un JSON tronqué. Le renommage, lui, change l'inode : le fichier est le
  // nouveau, ou reste l'ancien, jamais un mélange.
  assert.notStrictEqual(apres, avant, "l'écriture doit passer par un renommage, pas écraser sur place");
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(p, "utf-8")), { decisions: ["seconde"] });
});

test("aucun temporaire ne reste à côté du fichier", () => {
  const dir = bac();
  durable.ecrireJson(path.join(dir, "ledger.json"), { executees: [] });
  const restes = fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"));
  // Un temporaire abandonné dans le dossier des approbations ressemble à une trace d'audit
  // et n'en est pas une.
  assert.deepStrictEqual(restes, [], `temporaires abandonnés : ${restes.join(", ")}`);
});

test("un fichier illisible nomme le fichier, et n'est pas un refus", () => {
  const dir = bac();
  const p = path.join(dir, "EN-ATTENTE.json");
  // Exactement ce que laissait une écriture interrompue avant l'écriture atomique.
  fs.writeFileSync(p, '{"en_attente":[{"dossier":"ajus');

  assert.throws(
    () => durable.lireJson(p),
    (err) => {
      assert.ok(err instanceof durable.JsonIllisible, "un fichier corrompu est une panne, pas une décision refusée");
      assert.ok(err.message.includes(p), "sans le nom du fichier, le message ne dit pas quoi réparer");
      return true;
    }
  );
});

test("un fichier absent n'est pas une erreur, c'est une absence", () => {
  const dir = bac();
  assert.strictEqual(durable.lireJson(path.join(dir, "jamais-ecrit.json")), null);
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests durable OK`);
  process.exit(failed ? 1 : 0);
})();
