const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFileSync } = require("node:child_process");

function recette(scenario, { dejaIsole = false, modeSocket = 0o700 } = {}) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-recette-"));
  const volume = path.join(racine, "docker");
  const business = path.join(volume, "business-pipelines");
  const release = path.join(volume, "releases/cockpit-recette");
  const bin = path.join(racine, "bin");
  const candidate = path.join(racine, "candidate");
  for (const dir of [bin, candidate, release, path.join(business, "specs"), path.join(business, "etat")]) fs.mkdirSync(dir, { recursive: true });
  const compose = isole => `services:\n  cockpit: {}\n  runner: {}\n  tailscale-whois: {}\n  publieur: {}\n${isole ? "  maitre: {}\n  cockpit-relais: {}\n" : ""}`;
  fs.writeFileSync(path.join(business, "docker-compose.yaml"), compose(dejaIsole));
  fs.writeFileSync(path.join(candidate, "docker-compose.yaml"), compose(true));
  fs.writeFileSync(path.join(business, "app.txt"), "ancienne version");
  fs.writeFileSync(path.join(business, "etat/preserve.txt"), "etat vivant");
  fs.mkdirSync(path.join(business, "codex"));
  fs.mkdirSync(path.join(business, "run-cockpit"), { mode: modeSocket });
  fs.chmodSync(path.join(business, "run-cockpit"), modeSocket);
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
  // Simuler la propriété sans exiger root sur le poste ou modifier son uid.
  executable("chown", `#!${process.execPath}
const fs=require('node:fs'),a=process.argv.slice(2);
if(a[0]==='-R') fs.writeFileSync(process.env.RECETTE_SOCKET_OWNER,a[1]);
else if(a.at(-1)===process.env.RECETTE_SOCKET_DIR) fs.writeFileSync(process.env.RECETTE_SOCKET_OWNER,a[0]);
`);
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
  if(s==='creation-partielle' && ['business_runner','business_tailscale_whois'].includes(a[1]) && fs.existsSync(process.env.RECETTE_UP) && fs.readFileSync(process.env.RECETTE_UP,'utf8')==='1') process.exit(1);
  if(['business_maitre','business_cockpit_relais'].includes(a[1]) && process.env.RECETTE_DEJA_ISOLE!=='1' && !fs.existsSync(process.env.RECETTE_UP)) process.exit(1);
  if(s==='maitre-malade' && a[1]==='business_maitre' && a.at(-1).includes('.State') && fs.readFileSync(process.env.RECETTE_UP,'utf8')==='1') { console.log('false'); process.exit(0); }
  if(s==='signal-sante'&&a.at(-1).includes('.State')&&fs.readFileSync(process.env.RECETTE_UP,'utf8')==='1') bloquer();
  else console.log(a.at(-1).includes('.Image')?'image-ancienne-'+a[1]:'true');
}
else if(a[0]==='compose'&&a[1]==='build') {
  if(s==='avant-echec') process.exitCode=41;
  if(s==='avant-bloque'||s==='signal'||s==='signal-handshake') bloquer();
} else if(a[0]==='tag'&&s==='phase-epuisee') {setTimeout(()=>{},1000);}
else if(a[0]==='rm') {
  if(process.env.RECETTE_DEJA_ISOLE!=='1' && !fs.existsSync(process.env.RECETTE_UP) && a.some(x=>['business_maitre','business_cockpit_relais'].includes(x))) process.exit(9);
  if(s==='creation-partielle' && fs.existsSync(process.env.RECETTE_UP) && fs.readFileSync(process.env.RECETTE_UP,'utf8')==='1' && a.some(x=>['business_runner','business_tailscale_whois'].includes(x))) process.exit(9);
}
else if(a[0]==='compose'&&a[1]==='up') {
  const f=process.env.RECETTE_UP;
  const n=(fs.existsSync(f)?Number(fs.readFileSync(f,'utf8')):0)+1;fs.writeFileSync(f,String(n));
  if(!['succes','socket-prive','signal-sante','maitre-malade'].includes(s)&&n===1) process.exitCode=42;
  if(s==='socket-prive'&&n===1) {
    const owner=fs.readFileSync(process.env.RECETTE_SOCKET_OWNER,'utf8');
    const mode=fs.statSync(process.env.RECETTE_SOCKET_DIR).mode&0o777;
    if(owner!=='0:0'||mode!==0o700) { console.error('EACCES : relais sans capacités, dossier socket privé inaccessible'); process.exitCode=42; }
  }
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
    RECETTE_SCENARIO: scenario, RECETTE_DEJA_ISOLE: dejaIsole ? "1" : "0", RECETTE_LOG: path.join(racine, "docker.log"), RECETTE_UP: path.join(racine, "up"), RECETTE_PIDS: pids,
    RECETTE_HANDSHAKE: path.join(racine, "handshake"),
    RECETTE_SOCKET_OWNER: path.join(racine, "socket-owner"), RECETTE_SOCKET_DIR: path.join(business, "run-cockpit"),
    LIVRAISON_BUILD_TIMEOUT_SEC: "20", LIVRAISON_SWITCH_TIMEOUT_SEC: "20", LIVRAISON_ROLLBACK_TIMEOUT_SEC: "20", LIVRAISON_STOP_GRACE_SEC: "1" };
  const lancer = (options = {}) => new Promise((resolve, reject) => {
    const enfant = spawn("sh", [deploy], { env: { ...env, ...options.env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let sortie = "";
    enfant.stdout.on("data", b => { sortie += b; }); enfant.stderr.on("data", b => { sortie += b; });
    const minuterie = setTimeout(() => {
      try { process.kill(-enfant.pid, "SIGKILL"); } catch {}
      if (fs.existsSync(pids)) for (const pid of JSON.parse(fs.readFileSync(pids))) try { process.kill(pid, "SIGKILL"); } catch {}
    }, 30_000);
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
