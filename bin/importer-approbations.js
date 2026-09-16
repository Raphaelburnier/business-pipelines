#!/usr/bin/env node

// Importe les approbations tenues en fichiers JSON dans le store SQLite, puis relit tout.
//
//   node bin/importer-approbations.js                 dossier APPROVALS_DIR ou ./approvals
//   node bin/importer-approbations.js <dossier>
//
// Sur le NAS, dans le conteneur du cockpit, qui monte le dossier des approbations :
//
//   sudo docker compose run --rm cockpit node bin/importer-approbations.js
//
// Sortie 0 si tout a été relu à l'identique, 1 au moindre écart. Aucun fichier n'est
// supprimé : les archiver reste à faire à la main, une fois le cockpit vérifié.
const path = require("path");
const { importer } = require("../src/import-approbations");

const approvalsDir = path.resolve(process.argv[2] || process.env.APPROVALS_DIR || path.join(__dirname, "..", "approvals"));
const { compte, ecarts, base } = importer({ approvalsDir });

console.log(`Import depuis ${approvalsDir}`);
console.log(`  vers       ${base}`);
console.log(`  plans      ${compte.plans}`);
console.log(`  registres  ${compte.registres}`);
console.log(`  attentes   ${compte.attentes}`);
console.log(`  alertes    ${compte.alertes}`);

if (ecarts.length) {
  console.error(`\n${ecarts.length} écart(s) :`);
  for (const e of ecarts) console.error(`  ${e}`);
  process.exit(1);
}
console.log("\nTout a été relu à l'identique. Les fichiers JSON sont intacts : les archiver après avoir vérifié le cockpit.");
