#!/usr/bin/env node
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { COEUR, lireSignal, sonderBase } = require("../src/sante-plateforme");

function demander(options) {
  return new Promise((resolve, reject) => {
    let timer;
    const req = http.get({ ...options, headers: { Host: "localhost", Connection: "close" } }, res => {
      let corps = "";
      res.on("data", b => { corps += b; if (corps.length > 16384) req.destroy(new Error("REPONSE_INVALIDE")); });
      res.on("end", () => { clearTimeout(timer); try { resolve({ status: res.statusCode, corps: JSON.parse(corps) }); } catch { reject(new Error("REPONSE_INVALIDE")); } });
      res.on("error", err => { clearTimeout(timer); reject(err); });
    });
    timer = setTimeout(() => req.destroy(new Error("DELAI_DEPASSE")), 1500);
    req.on("error", err => { clearTimeout(timer); reject(err); });
  });
}
function connecterSocket(fichier) {
  return new Promise((resolve, reject) => {
    const s = net.connect(fichier);
    s.setTimeout(1000, () => s.destroy(new Error("DELAI_DEPASSE")));
    s.on("connect", () => { s.end(); resolve(); }); s.on("error", reject);
  });
}
async function verifier(service, env = process.env) {
  if (COEUR.includes(service)) {
    const fichier = env.ORCH_EVENT_STORE || path.resolve(__dirname, "../etat/events.sqlite");
    if (!lireSignal(fichier, service, { verifierProcessus: true }).ok || !sonderBase(fichier).ok) throw new Error("SERVICE_INDISPONIBLE");
    if (service !== "maitre") return;
  }
  let r;
  if (service === "cockpit") r = await demander({ socketPath: env.COCKPIT_SOCKET || "/run/cockpit/cockpit.sock", path: "/sante" });
  else if (service === "relais") r = await demander({ host: "127.0.0.1", port: 4600, path: "/sante" });
  else if (service === "maitre") r = await demander({ host: env.ORCH_MAITRE_HOTE || "127.0.0.1", port: Number(env.ORCH_MAITRE_PORT || 4650), path: "/sante" });
  else if (service === "whois") {
    await connecterSocket(env.ORCH_TAILSCALE_SOCKET || "/var/run/tailscale/tailscaled.sock");
    r = await demander({ host: env.ORCH_WHOIS_PROXY_HOTE || "127.0.0.1", port: Number(env.ORCH_WHOIS_PROXY_PORT || 4651), path: "/whois?adresse=127.0.0.1&port=0" });
    if (r.status === 404 && r.corps?.nom === null) return;
    throw new Error("WHOIS_INDISPONIBLE");
  } else throw new Error("SERVICE_INCONNU");
  if (r.status !== 200 || r.corps?.ok !== true) throw new Error("SERVICE_INDISPONIBLE");
}
if (require.main === module) verifier(process.argv[2]).catch(() => { console.error("sonde de santé en échec"); process.exitCode = 1; });
module.exports = { verifier, demander };
