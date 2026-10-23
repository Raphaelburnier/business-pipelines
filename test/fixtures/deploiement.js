const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");

function recette(scenario) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-recette-"));
  const volume = path.join(racine, "docker");
  const business = path.join(volume, "business-pipelines");
  const release = path.join(volume, "releases/cockpit-recette");
  const bin = path.join(racine, "bin");
  const candidate = path.join(racine, "candidate");
  for (const dir of [bin, candidate, release, path.join(business, "specs"), path.join(business, "etat")]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(business, "app.txt"), "ancienne version");
  fs.writeFileSync(path.join(business, "etat/preserve.txt"), "etat vivant");
  fs.mkdirSync(path.join(business, "codex"));
  fs.writeFileSync(path.join(business, "codex/session-recette.json"), '{"session":"factice"}\n');
  fs.writeFileSync(path.join(business, "specs/deploiement.env"), "ANTHROPIC_API_KEY=recette-factice\n", { mode: 0o600 });
  fs.writeFileSync(path.join(business, "specs/workers.json"), "{}\n");
  fs.writeFileSync(path.join(business, "specs/publieur.env"), "\n", { mode: 0o600 });
  fs.writeFileSync(path.join(candidate, "app.txt"), "nouvelle version");
  fs.writeFileSync(path.join(candidate, ".release"), "cockpit=nouveau\n");
  const archive = path.join(release, "recette.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", candidate, "."]);
  const empreinte = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  const executable = (nom, source) => fs.writeFileSync(path.join(bin, nom), source, { mode: 0o700 });
  executable("id", "#!/bin/sh\necho 0\n");
  executable("chown", "#!/bin/sh\nexit 0\n");
  executable("curl", '#!/bin/sh\n[ "$RECETTE_SCENARIO" != restauration-malade ]\n');
  // Évite l'attente finale de journaux ; les échéances utilisent toujours l'horloge réelle.
  executable("sleep", `#!/bin/sh
if [ "$1" = 0.01 ] && [ -s "$RECETTE_HANDSHAKE" ]; then
  pret=$(cat "$RECETTE_HANDSHAKE")
  rm -f "$RECETTE_HANDSHAKE"
  kill -STOP "$PPID"
  while [ ! -s "$pret" ]; do /bin/sleep 0.01; done
  /bin/sleep 0.2
  kill -TERM "$PPID"
  kill -CONT "$PPID"
  exit 0
fi
case "$1" in 8) exit 0 ;; 1) exec /bin/sleep 0.01 ;; *) exec /bin/sleep "$@" ;; esac
`);
  const setsid = execFileSync("sh", ["-c", "command -v setsid"], { encoding: "utf8" }).trim();
  if (scenario === "signal-handshake") executable("setsid", `#!/bin/sh
case "$*" in *"compose build cockpit") printf '%s' "$5" > "$RECETTE_HANDSHAKE"; /bin/sleep 0.1 ;; esac
exec "${setsid}" "$@"
`);
  executable("docker", `#!${process.execPath}
const fs=require('node:fs');
const {spawn}=require('node:child_process');
const a=process.argv.slice(2), s=process.env.RECETTE_SCENARIO;
fs.appendFileSync(process.env.RECETTE_LOG, JSON.stringify(a)+'\\n');
function bloquer(){
  process.on('SIGTERM',()=>{});
  const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
  fs.writeFileSync(process.env.RECETTE_PIDS,JSON.stringify([process.pid,c.pid]));
  setInterval(()=>{},1000);
}
if(a[0]==='inspect') {
  if(s==='signal-sante'&&a.at(-1).includes('.State')&&fs.readFileSync(process.env.RECETTE_UP,'utf8')==='1') bloquer();
  else console.log(a.at(-1).includes('.Image')?'image-ancienne-'+a[1]:'true');
}
else if(a[0]==='compose'&&a[1]==='build') {
  if(s==='avant-echec') process.exitCode=41;
  if(s==='avant-bloque'||s==='signal'||s==='signal-handshake') bloquer();
} else if(a[0]==='tag'&&s==='phase-epuisee') {setTimeout(()=>{},1000);}
else if(a[0]==='compose'&&a[1]==='up') {
  const f=process.env.RECETTE_UP;
  const n=(fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0)+1;fs.writeFileSync(f,String(n));
  if(!['succes','signal-sante'].includes(s)&&n===1) process.exitCode=42;
  if(s==='signal-apres'&&n===1) bloquer();
  if(s==='restauration-echec'&&n===2) process.exitCode=23;
  if(s==='restauration-bloquee'&&n===2) bloquer();
}
`);
  const modele = fs.readFileSync(path.join(__dirname, "../../deploy/nas/deploy.sh.modele"), "utf8");
  const script = modele.replaceAll("/volume1/docker", volume)
    .replaceAll("@RELEASE@", "cockpit-recette").replaceAll("@ARCHIVE@", "recette.tar.gz")
    .replaceAll("@SHA256@", empreinte).replaceAll("@VERSION@", "recette");
  const deploy = path.join(release, "deploy.sh");
  fs.writeFileSync(deploy, script);
  const pids = path.join(racine, "pids.json");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, DOCKER: path.join(bin, "docker"),
    RECETTE_SCENARIO: scenario, RECETTE_LOG: path.join(racine, "docker.log"), RECETTE_UP: path.join(racine, "up"), RECETTE_PIDS: pids,
    RECETTE_HANDSHAKE: path.join(racine, "handshake"),
    LIVRAISON_BUILD_TIMEOUT_SEC: "20", LIVRAISON_SWITCH_TIMEOUT_SEC: "20", LIVRAISON_ROLLBACK_TIMEOUT_SEC: "20", LIVRAISON_STOP_GRACE_SEC: "1" };
  const lancer = (options = {}) => new Promise((resolve, reject) => {
    const enfant = spawn("sh", [deploy], { env: { ...env, ...options.env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    enfant.stdout.on("data", b => { sortie += b; }); enfant.stderr.on("data", b => { sortie += b; });
    const minuterie = setTimeout(() => {
      try { process.kill(-enfant.pid, "SIGKILL"); } catch {}
      if (fs.existsSync(pids)) for (const pid of JSON.parse(fs.readFileSync(pids))) try { process.kill(pid, "SIGKILL"); } catch {}
    }, 15_000);
    enfant.once("error", reject);
    enfant.once("close", (code, signal) => { clearTimeout(minuterie); resolve({ code, signal, sortie }); });
    if (options.interrompre) {
      const attente = setInterval(() => { if (fs.existsSync(pids)) { clearInterval(attente); enfant.kill("SIGTERM"); } }, 20);
      enfant.once("close", () => clearInterval(attente));
    }
  });
  const nettoyer = () => {
    if (fs.existsSync(pids)) for (const pid of JSON.parse(fs.readFileSync(pids))) try { process.kill(pid, "SIGKILL"); } catch {}
    fs.rmSync(racine, { recursive: true, force: true });
  };
  return { business, racine, pids, lancer, nettoyer };
}

module.exports = { recette };
