const fs = require("node:fs");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function lire(pid) {
  try {
    const texte = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const champs = texte.slice(texte.lastIndexOf(")") + 2).split(" ");
    return { pid, parent: Number(champs[1]), debut: champs[19], actif: !["Z", "X"].includes(champs[0]) };
  } catch (err) { if (["ENOENT", "ESRCH"].includes(err.code)) return null; throw err; }
}
function recenser(pid, connus) {
  const processus = fs.readdirSync("/proc").filter(n => /^\d+$/.test(n)).map(n => lire(Number(n))).filter(Boolean);
  const parents = new Set([pid]);
  let change = true;
  while (change) {
    change = false;
    for (const p of processus) if (parents.has(p.parent) && !parents.has(p.pid)) { parents.add(p.pid); change = true; }
  }
  for (const p of processus) if (parents.has(p.pid)) connus.set(p.pid, p.debut);
}
function vivants(connus) { return [...connus].filter(([pid, debut]) => { const p = lire(pid); return p?.actif && p.debut === debut; }); }

async function arreterProcessus(enfant, { graceMs = 8000, confirmationMs = 2000 } = {}) {
  if (enfant.exitCode !== null || enfant.signalCode !== null) return;
  if (process.platform !== "linux") throw new Error("arrêt local non confirmé : supervision des processus Linux requise");
  const connus = new Map(); recenser(enfant.pid, connus);
  enfant.kill("SIGTERM");
  const fin = performance.now() + graceMs;
  while (performance.now() < fin) {
    if (!vivants(connus).length) return;
    const racine = lire(enfant.pid);
    if (racine?.actif && racine.debut === connus.get(enfant.pid)) recenser(enfant.pid, connus);
    await pause(25);
  }
  // Vérifier l'identité de chaque PID avant le signal évite de tuer un PID réutilisé.
  for (const [pid] of vivants(connus).sort(([a], [b]) => (a === enfant.pid ? 1 : b === enfant.pid ? -1 : b - a))) {
    try { process.kill(pid, "SIGKILL"); } catch (err) { if (err.code !== "ESRCH") throw err; }
  }
  const confirmation = performance.now() + confirmationMs;
  while (performance.now() < confirmation) { if (!vivants(connus).length) return; await pause(25); }
  throw new Error("arrêt local non confirmé");
}
module.exports = { arreterProcessus };
