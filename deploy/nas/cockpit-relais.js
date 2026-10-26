#!/usr/bin/env node
// Ce service sans agents est le seul chemin TCP local vers le socket du cockpit.
// Son code fait partie du modèle de livraison soumis à approbation.
const http = require("node:http");

function sansHop(entetes) {
  const exclus = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
  for (const nom of String(entetes.connection || "").split(",")) exclus.add(nom.trim().toLowerCase());
  return Object.fromEntries(Object.entries(entetes).filter(([nom]) => !exclus.has(nom.toLowerCase())));
}

function creerRelais({ socketPath = "/run/cockpit/cockpit.sock" } = {}) {
  return http.createServer((requete, reponse) => {
    const amont = http.request({ socketPath, method: requete.method, path: requete.url, headers: sansHop(requete.headers) }, retour => {
      reponse.writeHead(retour.statusCode, sansHop(retour.headers));
      // En particulier, les SSE ne sont ni accumulés ni réécrits.
      retour.pipe(reponse);
      retour.on("error", () => reponse.destroy());
    });
    amont.on("error", () => {
      if (reponse.destroyed) return;
      if (reponse.headersSent) return reponse.destroy();
      reponse.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
      reponse.end(JSON.stringify({ erreur: "cockpit indisponible" }));
    });
    requete.on("aborted", () => amont.destroy());
    reponse.on("close", () => amont.destroy());
    requete.pipe(amont);
  });
}

if (require.main === module) {
  const serveur = creerRelais();
  serveur.listen(4600, "127.0.0.1", () => console.log("relais cockpit local actif"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    serveur.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

module.exports = { creerRelais };
