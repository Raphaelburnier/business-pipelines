const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const apps = require("../src/apps");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// Les origines que le cockpit accepte pour ses propres écritures, telles que src/acces.js
// les calcule pour un tailnet configuré. C'est contre cette liste que le registre est
// contrôlé, donc les tests l'exercent avec la vraie forme.
const ORIGINES = new Set([
  "http://127.0.0.1:4600",
  "http://localhost:4600",
  "https://nas.tail8296f6.ts.net",
]);

function bac(contenu) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apps-"));
  if (contenu !== undefined) {
    fs.writeFileSync(
      path.join(dir, apps.FICHIER),
      typeof contenu === "string" ? contenu : JSON.stringify(contenu, null, 2)
    );
  }
  return dir;
}

function chargerDepuis(contenu, origines = ORIGINES) {
  return apps.charger({ specsDir: bac(contenu), origines });
}

test("registre absent : aucun panneau, et surtout aucune erreur", () => {
  // Même règle que COCKPIT_TAILNET non renseigné. Une configuration qui manque ramène le
  // cockpit à ce qu'il était, elle ne l'empêche pas de servir la page qui décide.
  assert.deepStrictEqual(chargerDepuis(undefined), []);
});

test("une entrée complète traverse en gardant exactement ce qui est déclaré", () => {
  const liste = chargerDepuis({
    apps: [{ nom: "tcg-generator", url: "http://192.168.1.18:4700", description: "cartes" }],
  });
  assert.strictEqual(liste.length, 1);
  assert.strictEqual(liste[0].nom, "tcg-generator");
  assert.strictEqual(liste[0].url, "http://192.168.1.18:4700/");
  assert.strictEqual(liste[0].description, "cartes");
});

test("la description est facultative et vaut null plutôt que la chaîne vide", () => {
  const liste = chargerDepuis({ apps: [{ nom: "app", url: "http://192.168.1.18:4701" }] });
  assert.strictEqual(liste[0].description, null);
});

test("un schéma autre que http ou https est refusé", () => {
  // `javascript:` dans un href s'exécute DANS la page qui approuve des changements de prix.
  // `data:` sert un document sous notre propre origine. Ni l'un ni l'autre n'est un lien.
  for (const url of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd"]) {
    assert.throws(
      () => chargerDepuis({ apps: [{ nom: "piege", url }] }),
      (err) => err instanceof apps.RegistreInvalide && /schéma/.test(err.message),
      `${url} accepté`
    );
  }
});

test("une app servie sous une origine du cockpit est refusée", () => {
  // C'est le refus qui compte le plus. Le contrôle d'origine du cockpit est ce qui empêche
  // une page tierce d'enregistrer une décision. Une app servie sous le nom du cockpit
  // aurait cette origine, donc ce droit, et ces apps sont écrites par un modèle.
  for (const url of [
    "https://nas.tail8296f6.ts.net",
    "https://nas.tail8296f6.ts.net/apps/tcg",
    "http://127.0.0.1:4600/quelque-chose",
  ]) {
    assert.throws(
      () => chargerDepuis({ apps: [{ nom: "app", url }] }),
      (err) => err instanceof apps.RegistreInvalide && /origine/.test(err.message),
      `${url} accepté sous l'origine du cockpit`
    );
  }
});

test("un autre port sur le même hôte est une autre origine, et passe", () => {
  // C'est la porte de sortie que le refus précédent laisse ouverte, et il faut qu'elle
  // reste ouverte : sans elle, on ne pourrait pas servir une app par Tailscale du tout.
  const liste = chargerDepuis({ apps: [{ nom: "app", url: "https://nas.tail8296f6.ts.net:8443" }] });
  assert.strictEqual(liste.length, 1);
});

test("un nom ou une url qui manque est nommé, avec son rang dans le fichier", () => {
  assert.throws(
    () => chargerDepuis({ apps: [{ url: "http://192.168.1.18:4700" }] }),
    (err) => /entrée 1/.test(err.message) && /nom/.test(err.message)
  );
  assert.throws(
    () => chargerDepuis({ apps: [{ nom: "ok", url: "http://192.168.1.18:4700" }, { nom: "sans" }] }),
    (err) => /entrée 2/.test(err.message) && /url/.test(err.message)
  );
});

test("une url qui n'en est pas une est refusée au chargement, pas rendue dans la page", () => {
  assert.throws(
    () => chargerDepuis({ apps: [{ nom: "app", url: "pas une url" }] }),
    (err) => err instanceof apps.RegistreInvalide && /n'est pas une URL/.test(err.message)
  );
});

test("un JSON illisible nomme le fichier à réparer", () => {
  assert.throws(
    () => chargerDepuis("{ceci n'est pas du json"),
    (err) => new RegExp(apps.FICHIER).test(err.message)
  );
});

test("un registre qui n'est pas une liste est refusé plutôt que parcouru à vide", () => {
  // Sans ce contrôle, `{"apps": {...}}` rendrait une liste vide, donc un panneau absent,
  // donc « je n'ai déployé aucune app » alors que le fichier en déclare trois.
  assert.throws(
    () => chargerDepuis({ apps: { tcg: "http://192.168.1.18:4700" } }),
    (err) => err instanceof apps.RegistreInvalide
  );
});

test("une liste nue est acceptée aussi bien que la forme avec clé", () => {
  const liste = chargerDepuis([{ nom: "app", url: "http://192.168.1.18:4700" }]);
  assert.strictEqual(liste.length, 1);
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
  console.log(failed ? `\n${failed} test(s) en échec` : `\n${tests.length} tests registre d'apps OK`);
  process.exit(failed ? 1 : 0);
})();
