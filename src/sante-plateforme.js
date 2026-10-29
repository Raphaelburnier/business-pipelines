const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");
const { Worker } = require("node:worker_threads");
const executer = promisify(execFile);

const COEUR = ["runner", "maitre", "publieur", "livreur"];
const CONTENEURS = {
  cockpit: "business_cockpit", runner: "business_runner", maitre: "business_maitre",
  relais: "business_cockpit_relais", publieur: "business_publieur", livreur: "business_livreur", whois: "business_tailscale_whois",
};
const DUREE_SIGNAL_MS = 45000;
const UUID = /^[0-9a-f-]{36}$/i;
const dossierSante = fichier => path.join(path.dirname(fichier), "sante");
const echec = code => ({ ok: false, code });

function lireJson(fichier) {
  const stat = fs.lstatSync(fichier);
  if (!stat.isFile() || stat.size > 16384) throw new Error("métadonnées invalides");
  return JSON.parse(fs.readFileSync(fichier, "utf8"));
}
function ecrireJson(fichier, valeur) {
  const dir = path.dirname(fichier);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(dir).isDirectory()) throw new Error("dossier de santé invalide");
  fs.chmodSync(dir, 0o700);
  const temporaire = path.join(dir, crypto.randomUUID() + ".tmp");
  try {
    fs.writeFileSync(temporaire, JSON.stringify(valeur), { flag: "wx", mode: 0o600 });
    fs.renameSync(temporaire, fichier);
  } finally { try { fs.unlinkSync(temporaire); } catch {} }
}
function debutProcessus(pid) {
  const texte = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  return texte.slice(texte.lastIndexOf(")") + 2).split(" ")[19];
}
function fraicheur(date, maintenant) {
  return Number.isFinite(date) && maintenant - date >= -5000 && maintenant - date <= DUREE_SIGNAL_MS;
}

// Une sonde n'initialise jamais l'event store et n'écrit ni schéma ni événement.
function sonderBase(fichier) {
  if (!fichier) return { ok: true, code: "NON_CONFIGURE" };
  let db;
  try {
    db = new DatabaseSync(fichier, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 50");
    for (const table of ["runs", "commands", "events"]) db.prepare(`SELECT id FROM ${table} LIMIT 1`).get();
    return { ok: true, code: "DISPONIBLE" };
  } catch { return echec("ETAT_ILLISIBLE"); }
  finally { db?.close(); }
}

function lireSignal(fichier, service, { maintenant = Date.now(), verifierProcessus = false } = {}) {
  if (!COEUR.includes(service)) return echec("SERVICE_INCONNU");
  try {
    const s = lireJson(path.join(dossierSante(fichier), service + ".json"));
    if (s.version !== 1 || s.service !== service || !UUID.test(s.instance) || !Number.isInteger(s.pid) || s.pid < 1 || !/^\d+$/.test(s.debut || "")) return echec("SIGNAL_INVALIDE");
    if (!fraicheur(s.verifieMs, maintenant)) return echec("SIGNAL_PERIME");
    if (verifierProcessus && debutProcessus(s.pid) !== s.debut) return echec("INSTANCE_REMPLACEE");
    return { ok: true, code: "DISPONIBLE", instance: s.instance, ageMs: Math.max(0, maintenant - s.verifieMs) };
  } catch { return echec("SIGNAL_ABSENT"); }
}

function projeterDocker(texte) {
  const parNom = new Map(Object.entries(CONTENEURS).map(([id, nom]) => ["/" + nom, id]));
  const resultat = Object.fromEntries(Object.keys(CONTENEURS).map(id => [id, { ok: false, code: "CONTENEUR_ABSENT" }]));
  for (const ligne of String(texte).split("\n")) {
    const espace = ligne.indexOf(" "), id = parNom.get(ligne.slice(0, espace));
    if (!id) continue;
    try {
      const etat = JSON.parse(ligne.slice(espace + 1));
      resultat[id] = etat.Running !== true ? echec("CONTENEUR_ARRETE")
        : etat.Health?.Status === "healthy" ? { ok: true, code: "DISPONIBLE" }
          : echec(etat.Health?.Status === "starting" ? "DEMARRAGE" : etat.Health?.Status === "unhealthy" ? "SONDE_ECHOUEE" : "SONDE_ABSENTE");
    } catch { resultat[id] = echec("ETAT_DOCKER_INVALIDE"); }
  }
  return resultat;
}
async function inspecterDocker({ signal } = {}) {
  const format = '{{.Name}} {"Running":{{.State.Running}},"Health":{"Status":"{{if .State.Health}}{{.State.Health.Status}}{{end}}"}}';
  let stdout;
  try {
    ({ stdout } = await executer(process.env.DOCKER || "docker", ["inspect", "--format", format, ...Object.values(CONTENEURS)], {
      timeout: 2000, killSignal: "SIGKILL", maxBuffer: 65536, encoding: "utf8", signal,
    }));
  } catch (err) {
    // Inspect conserve les états disponibles quand un autre conteneur est absent.
    // Une commande interrompue, expirée ou dont la sortie déborde n'est jamais une preuve.
    if (err.killed || err.signal || !Number.isInteger(err.code) || !err.stdout?.trim()) throw err;
    stdout = err.stdout;
  }
  return projeterDocker(stdout);
}

function surveillerService(service, { fichier, intervalleMs = 10000, maintenant = Date.now, docker = null, journal = console.log, identite } = {}) {
  if (!COEUR.includes(service)) throw new Error("service de santé inconnu");
  if (!fichier) return { arreter() {} };
  const { instance, pid, debut } = identite || { instance: crypto.randomUUID(), pid: process.pid, debut: debutProcessus(process.pid) };
  const signalPath = path.join(dossierSante(fichier), service + ".json");
  let actif = true, enVol = false, dernierCode, dernierDocker;
  function transition(code) {
    if (code === dernierCode) return;
    dernierCode = code;
    journal(JSON.stringify({ event: "service.sante", niveau: code === "DISPONIBLE" ? "info" : "warn", service, correlationId: instance, code }));
  }
  function battre() {
    if (!actif) return;
    try { ecrireJson(signalPath, { version: 1, service, instance, pid, debut, verifieMs: maintenant() }); transition("DISPONIBLE"); }
    catch { transition("SIGNAL_ECRITURE_ECHOUEE"); }
    if (docker && !enVol) {
      enVol = true;
      void Promise.resolve().then(docker).then(composants => {
        if (!actif) return;
        ecrireJson(path.join(dossierSante(fichier), "docker.json"), { version: 1, instance, verifieMs: maintenant(), composants });
        const codes = Object.fromEntries(Object.keys(CONTENEURS).map(id => [id, composants[id]?.code || "DOCKER_INDISPONIBLE"]));
        const signature = JSON.stringify(codes);
        if (signature !== dernierDocker) {
          dernierDocker = signature;
          journal(JSON.stringify({ event: "docker.sante", correlationId: instance, niveau: Object.values(composants).every(c => c.ok) ? "info" : "warn", codes }));
        }
      }).catch(() => {
        // Ne jamais persister stderr, chemins, environnement ou configuration Docker.
        try {
          if (actif) {
            ecrireJson(path.join(dossierSante(fichier), "docker.json"), { version: 1, instance, verifieMs: maintenant(), erreur: "DOCKER_INDISPONIBLE" });
            if (dernierDocker !== "indisponible") {
              dernierDocker = "indisponible";
              journal(JSON.stringify({ event: "docker.sante", correlationId: instance, niveau: "warn", code: "DOCKER_INDISPONIBLE" }));
            }
          }
        } catch {}
      }).finally(() => { enVol = false; });
    }
  }
  const timer = setInterval(battre, intervalleMs); timer.unref(); battre();
  function arreter() {
    actif = false; clearInterval(timer);
    try { if (lireJson(signalPath).instance === instance) fs.unlinkSync(signalPath); } catch {}
    for (const s of ["SIGINT", "SIGTERM", "exit"]) process.removeListener(s, arreter);
  }
  for (const s of ["SIGINT", "SIGTERM", "exit"]) process.once(s, arreter);
  return { arreter, instance };
}

// Git et tar bloquent parfois la boucle principale pendant une opération bornée.
// Le thread garde les signaux et la collecte Docker vivants, liés au PID du service.
function surveillerServiceIsole(service, { fichier, intervalleMs = 10000, docker = false, journal = console.log } = {}) {
  if (!COEUR.includes(service)) throw new Error("service de santé inconnu");
  if (!fichier) return { async arreter() {} };
  const instance = crypto.randomUUID();
  let identite, worker;
  try {
    identite = { instance, pid: process.pid, debut: debutProcessus(process.pid) };
    worker = new Worker(path.join(__dirname, "sante-service-worker.js"), { workerData: { service, fichier, intervalleMs, docker, identite } });
  } catch {
    journal(JSON.stringify({ event: "service.sante", niveau: "warn", service, correlationId: instance, code: "SONDE_NON_DISPONIBLE" }));
    return { async arreter() {} };
  }
  let arret = null;
  function nettoyer() {
    const signal = path.join(dossierSante(fichier), service + ".json");
    try { if (lireJson(signal).instance === identite.instance) fs.unlinkSync(signal); } catch {}
    for (const s of ["SIGINT", "SIGTERM", "exit"]) process.removeListener(s, arreter);
  }
  function arreter() {
    if (!arret) arret = worker.threadId === -1 ? Promise.resolve().then(nettoyer) : new Promise(resolve => {
      const timer = setTimeout(() => { void worker.terminate(); }, 3000);
      worker.once("exit", () => { clearTimeout(timer); nettoyer(); resolve(); });
      worker.postMessage("arret");
    });
    return arret;
  }
  worker.on("message", ligne => journal(ligne));
  worker.on("error", () => journal(JSON.stringify({ event: "service.sante", niveau: "warn", service, correlationId: identite.instance, code: "SONDE_ARRETEE" })));
  worker.once("exit", nettoyer);
  for (const s of ["SIGINT", "SIGTERM", "exit"]) process.once(s, arreter);
  worker.unref();
  return { arreter, instance: identite.instance };
}

function sonderPlateforme({ fichier, plateforme = false, maintenant = Date.now(), release } = {}) {
  const composants = { etat: sonderBase(fichier) };
  if (plateforme) {
    if (!fichier) composants.etat = echec("ETAT_NON_CONFIGURE");
    else {
      for (const service of COEUR) composants[service] = lireSignal(fichier, service, { maintenant });
      try {
        const d = lireJson(path.join(dossierSante(fichier), "docker.json"));
        if (d.version !== 1 || !composants.livreur.ok || d.instance !== composants.livreur.instance || !fraicheur(d.verifieMs, maintenant)) throw new Error("snapshot périmé");
        for (const id of Object.keys(CONTENEURS)) {
          const c = d.composants?.[id];
          const codes = ["DISPONIBLE", "CONTENEUR_ABSENT", "CONTENEUR_ARRETE", "DEMARRAGE", "SONDE_ECHOUEE", "SONDE_ABSENTE", "ETAT_DOCKER_INVALIDE"];
          composants["docker_" + id] = codes.includes(c?.code) ? { ok: c.code === "DISPONIBLE" && c.ok === true, code: c.code } : echec("DOCKER_INDISPONIBLE");
        }
      } catch { composants.docker = echec("DOCKER_NON_CONFIRME"); }
    }
  }
  const ok = Object.values(composants).every(c => c.ok);
  const resultat = { ok, statut: ok ? "sain" : "degrade", portee: plateforme ? "plateforme" : "cockpit", verifieLe: new Date(maintenant).toISOString(), composants };
  if (release) {
    try {
      const lignes = fs.readFileSync(release, "utf8").trim().split("\n");
      const versions = {};
      for (const l of lignes) { const [k, v] = l.split("="); if (["cockpit", "moteur", "registre"].includes(k) && /^[0-9a-f]{40}$/.test(v)) versions[k] = v; }
      resultat.versions = versions;
    } catch {}
  }
  return resultat;
}
module.exports = { COEUR, CONTENEURS, DUREE_SIGNAL_MS, dossierSante, lireSignal, sonderBase, projeterDocker, inspecterDocker, surveillerService, surveillerServiceIsole, sonderPlateforme };
