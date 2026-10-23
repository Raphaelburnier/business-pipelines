// Exécute une commande isolée dans son groupe afin que son échéance nettoie aussi ses enfants.
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [delaiTexte, fichierPid, binaire, ...args] = process.argv.slice(2);
const delaiMs = Number(delaiTexte);
const groupe = process.platform !== "win32";
const enfant = spawn(binaire, args, { cwd: process.cwd(), env: process.env, detached: groupe, stdio: ["pipe", "pipe", "pipe"] });
let ferme = false, code = null, interrompue = false, fini = false, grace = null, surveillance = null;
const encoreActif = () => {
  try { if (groupe) process.kill(-enfant.pid, 0); else process.kill(enfant.pid, 0); return true; }
  catch (err) { return err.code !== "ESRCH"; }
};
const envoyer = (signal) => { try { if (groupe) process.kill(-enfant.pid, signal); else enfant.kill(signal); } catch {} };
const terminer = (raison) => {
  if (interrompue || fini) return;
  interrompue = true;
  process.stderr.write(`ORCH_LIMIT_EXECUTION:${fichierPid}:${raison}\n`);
  envoyer("SIGTERM");
  grace = setTimeout(() => { grace = null; envoyer("SIGKILL"); verifierFin(); }, 2000);
  verifierFin();
};
const verifierFin = () => {
  if (fini || !ferme) return;
  if (encoreActif()) {
    if (!interrompue) terminer("descendants encore actifs après la fermeture du parent");
    else surveillance = setTimeout(verifierFin, 25);
    return;
  }
  fini = true; clearTimeout(minuterie); if (grace) clearTimeout(grace); if (surveillance) clearTimeout(surveillance);
  process.exitCode = interrompue ? 124 : (code ?? 1);
};
const minuterie = setTimeout(() => terminer("échéance dépassée"), delaiMs);
if (enfant.pid) fs.writeFileSync(fichierPid, String(enfant.pid));
enfant.stdout.on("data", (bloc) => { if (!process.stdout.write(bloc)) enfant.stdout.pause(); });
process.stdout.on("drain", () => enfant.stdout.resume());
enfant.stderr.on("data", (bloc) => { if (!process.stderr.write(bloc)) enfant.stderr.pause(); });
process.stderr.on("drain", () => enfant.stderr.resume());
process.stdin.pipe(enfant.stdin);
enfant.stdin.on("error", (err) => { if (err.code !== "EPIPE") terminer(err.message); });
enfant.once("error", (err) => { process.stderr.write(`${err.message}\n`); ferme = true; code = 1; verifierFin(); });
enfant.once("close", (valeur) => { ferme = true; code = valeur; verifierFin(); });
