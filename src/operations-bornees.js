const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const CONFIGURATIONS = {
  git: { variable: "ORCH_GIT_TIMEOUT_MS", defautMs: 2 * 60_000, maximumMs: 30 * 60_000 },
  archive: { variable: "ORCH_ARCHIVE_TIMEOUT_MS", defautMs: 5 * 60_000, maximumMs: 15 * 60_000 },
  http: { variable: "ORCH_HTTP_TIMEOUT_MS", defautMs: 30_000, maximumMs: 120_000 },
  script: { variable: "ORCH_SCRIPT_TIMEOUT_MS", defautMs: 15 * 60_000, maximumMs: 6 * 60 * 60_000 },
  "http:conseiller": { variable: "CONSEILLER_HTTP_TIMEOUT_MS", defautMs: 30_000, maximumMs: 120_000 },
  ollama: { variable: "CONSEILLER_OLLAMA_TIMEOUT_MS", defautMs: 120_000, maximumMs: 10 * 60_000 },
};

function configuration(operation) {
  const conf = CONFIGURATIONS[operation];
  if (!conf) throw new Error(`opération sans délai configuré : ${operation}`);
  const brut = process.env[conf.variable];
  if (brut === undefined || brut === "") return conf.defautMs;
  const valeur = Number(brut);
  if (!Number.isSafeInteger(valeur) || valeur < 1 || valeur > conf.maximumMs) {
    throw new Error(`${conf.variable} doit être un entier entre 1 et ${conf.maximumMs} ms`);
  }
  return valeur;
}

function limiteExecution(operation, delaiMs, cause) {
  return Object.assign(new Error(`${operation} interrompu après ${delaiMs} ms`), {
    name: "LimiteExecution", operation, delaiMs, cause,
  });
}

// Borne un appel HTTP, y compris la lecture de son corps faite par travail.
async function sousDelaiHttp({ operation, delaiMs = configuration(operation) }, travail) {
  const controleur = new AbortController();
  const minuterie = setTimeout(() => controleur.abort(), delaiMs);
  try {
    return await travail(controleur.signal);
  } catch (cause) {
    if (controleur.signal.aborted) throw limiteExecution(operation, delaiMs, cause);
    throw cause;
  } finally {
    clearTimeout(minuterie);
  }
}

function execFileSyncBorne(binaire, args, options = {}) {
  const operation = options.operation || (binaire === "git" ? "git" : "archive");
  const { operation: _operation, ...optionsProcessus } = options;
  const delaiMs = configuration(operation);
  const fichierPid = path.join(os.tmpdir(), `orch-runner-${randomUUID()}.pid`);
  const runner = path.join(__dirname, "commande-bornee.js");
  const argumentsCommande = [runner, String(delaiMs), fichierPid, binaire, ...args];
  try {
    return execFileSync(process.execPath, argumentsCommande, {
      ...optionsProcessus,
      timeout: delaiMs + 8000,
      killSignal: "SIGKILL",
    });
  } catch (cause) {
    const marqueur = String(cause.stderr || "").includes(`ORCH_LIMIT_EXECUTION:${fichierPid}:`);
    const parentTue = cause.code === "ETIMEDOUT" || (cause.killed && cause.signal === "SIGKILL");
    if (!marqueur && !parentTue) throw cause;
    if (parentTue) try {
      const pid = Number(fs.readFileSync(fichierPid, "utf8"));
      if (Number.isInteger(pid) && pid > 1) process.kill(-pid, "SIGKILL");
    } catch {}
    throw limiteExecution(operation, delaiMs, cause);
  } finally {
    try { fs.unlinkSync(fichierPid); } catch {}
  }
}

module.exports = { configuration, limiteExecution, sousDelaiHttp, execFileSyncBorne };
