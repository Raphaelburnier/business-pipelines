// Vrai parent et descendant récalcitrants : le modèle doit terminer leur groupe.
const fs = require("node:fs");
const { spawn } = require("node:child_process");
process.on("SIGTERM", () => {});
const enfant = spawn(process.execPath, ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: "ignore" });
fs.writeFileSync(process.env.RECETTE_PIDS, JSON.stringify([process.pid, enfant.pid]));
setInterval(() => {}, 1000);
