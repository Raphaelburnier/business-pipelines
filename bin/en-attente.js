#!/usr/bin/env node

// Le premier lecteur de la boîte des décisions en attente, et le plus bête : il affiche.
// Le cockpit et le canal d'alerte en sont deux autres lecteurs. C'est pour ça que l'arrêt
// n'est couplé à aucun transport.
//
//   node bin/en-attente.js                        affiche ce qui attend
//   node bin/en-attente.js --abandonner <dossier> retire le plan gelé, son registre courant
//                                                 et sa demande
//
// Sortie 0 si rien n'attend, 1 s'il y a des décisions à prendre : utilisable tel quel dans
// un cron ou un `if` shell.

const path = require("path");
const store = require("../src/store");

const approvalsDir = process.env.APPROVALS_DIR || path.join(__dirname, "..", "approvals");
const [option, dossier] = process.argv.slice(2);

// Abandonner remplace ce qu'on faisait en supprimant le fichier du plan gelé. Les décisions
// déjà prises restent en base, rattachées à leur empreinte.
if (option === "--abandonner") {
  if (!dossier) {
    console.error("Usage : node bin/en-attente.js --abandonner <dossier>");
    process.exit(2);
  }
  const retire = store.abandonnerPlan(approvalsDir, dossier);
  console.log(retire ? `Plan "${dossier}" abandonné : le prochain tour repartira de zéro.` : `Aucun plan "${dossier}" à abandonner.`);
  process.exit(0);
}
if (option) {
  console.error(`Option inconnue : ${option}`);
  process.exit(2);
}

const { en_attente: attentes = [] } = store.lireBoite(approvalsDir);

if (attentes.length === 0) {
  console.log("Rien en attente.");
  process.exit(0);
}

const depuisQuand = (iso) => {
  if (!iso) return "date inconnue";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "date illisible";
  // Borné à zéro : le NAS et le PC n'ont pas forcément la même heure, et « depuis
  // -469 min » ferait douter de tout l'affichage plutôt que de la seule horloge.
  const heures = Math.max(0, (Date.now() - t) / 3600000);
  if (heures < 1) return `${Math.round(heures * 60)} min`;
  if (heures < 48) return `${heures.toFixed(1)} h`;
  return `${(heures / 24).toFixed(1)} jours`;
};

console.log(`${attentes.length} décision(s) en attente :\n`);

for (const a of attentes) {
  console.log(`  ${a.dossier}`);
  console.log(`    ${a.actions} action(s), depuis ${depuisQuand(a.depuis)}`);
  console.log(`    empreinte  ${a.empreinte}`);
  console.log(`    décider    dans le cockpit`);
  if (a.appliquer_avec) console.log(`    puis       node orchestrator.js ${a.appliquer_avec} <spec>`);
  console.log("");
}

// Le code de sortie porte l'information : un cron peut déclencher une notification sur
// ce seul signal, sans parser la sortie.
process.exit(1);
