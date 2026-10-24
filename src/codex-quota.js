const { spawn } = require("node:child_process");
const readline = require("node:readline");

function normaliser(reponse, observeLe = new Date().toISOString()) {
  const limites = reponse?.rateLimitsByLimitId?.codex || reponse?.rateLimits;
  if (!limites || typeof limites !== "object") return null;
  const fenetres = [limites.primary, limites.secondary].flatMap((fenetre, index) => {
    if (!fenetre || typeof fenetre.usedPercent !== "number" || fenetre.usedPercent < 0 || fenetre.usedPercent > 100) return [];
    const reset = typeof fenetre.resetsAt === "number" && fenetre.resetsAt > 0 ? new Date(fenetre.resetsAt * 1000) : null;
    return [{ id: index === 0 ? "primary" : "secondary", utilisation: fenetre.usedPercent,
      restant: 100 - fenetre.usedPercent, reinitialisation: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null }];
  });
  return fenetres.length ? { runtime: "codex", source: "codex.app-server.account/rateLimits/read", observeLe, fenetres } : null;
}

async function lireQuotaCodex({ executable = process.env.CODEX_BIN || "codex", delaiMs = 8000 } = {}) {
  const child = spawn(executable, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });
  const lignes = readline.createInterface({ input: child.stdout });
  const attente = new Map();
  let erreurProcessus = null;
  child.once("error", (err) => { erreurProcessus = err; for (const p of attente.values()) p.reject(err); attente.clear(); });
  child.once("close", (code) => {
    if (attente.size) { const err = erreurProcessus || new Error(`codex app-server fermé (${code ?? "sans code"})`); for (const p of attente.values()) p.reject(err); attente.clear(); }
  });
  lignes.on("line", (ligne) => {
    let message;
    try { message = JSON.parse(ligne); } catch { return; }
    if (message.id === undefined) return;
    const p = attente.get(message.id);
    if (!p) return;
    attente.delete(message.id); clearTimeout(p.timer);
    if (message.error) p.reject(new Error(message.error.message || "requête app-server refusée"));
    else p.resolve(message.result);
  });
  const requete = (id, method, params) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { attente.delete(id); reject(new Error(`délai dépassé : ${method}`)); }, delaiMs);
    attente.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`);
  });
  const arreter = () => {
    lignes.close();
    child.stdin.end();
    const timer = setTimeout(() => child.kill("SIGTERM"), 500);
    timer.unref?.();
  };
  try {
    await requete(1, "initialize", { clientInfo: { name: "business-pipelines-taskboard", version: "1.0.0" }, capabilities: {} });
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);
    return normaliser(await requete(2, "account/rateLimits/read"));
  } finally { arreter(); }
}

module.exports = { normaliser, lireQuotaCodex };
