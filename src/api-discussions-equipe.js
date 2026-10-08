const equipe = require("./equipe");
const discussions = require("./discussions-equipe");
const runtime = require("./runtime-mission");
const api = require("./api-lecture");

function creerRouteur({ store, json, corpsJson, projetsDir, rosterFichier, affectationsFichier, viaParMachine }) {
  return async (req, res, chemin, qui) => {
    if (!chemin.startsWith("/api/equipes/")) return false;
    const s = store();
    if (!s) { json(res, 503, { erreur: "Event store indisponible." }); return true; }
    const params = () => ({ projetsDir, roster: equipe.lireRoster(rosterFichier), affectations: equipe.lireAffectations(affectationsFichier) });
    const verifierBackend = runtime.verifier({ viaParMachine, machines: api.machines(s) });
    try {
      if (req.method === "GET" && chemin === "/api/equipes/marketing/options") {
        const projectId = new URL(req.url, "http://cockpit").searchParams.get("projet");
        json(res, 200, discussions.lireOptions({ ...params(), projectId }).options);
      } else if (chemin === "/api/equipes/marketing" && req.method === "GET") {
        const projectId = new URL(req.url, "http://cockpit").searchParams.get("projet");
        json(res, 200, { fils: discussions.liste(s, projectId) });
      } else if (chemin === "/api/equipes/marketing" && req.method === "POST") {
        const demande = await corpsJson(req, res);
        if (demande !== null) json(res, 202, discussions.ouvrir({ store: s, qui, params: params(), demande, verifierBackend }));
      } else {
        const fil = chemin.match(/^\/api\/equipes\/marketing\/([0-9a-f-]{36})(?:\/(messages|brouillons))?$/);
        const brouillon = chemin.match(/^\/api\/equipes\/brouillons\/([0-9a-f-]{36})$/);
        if (brouillon && req.method === "GET") json(res, 200, discussions.lireBrouillon(s, brouillon[1]));
        else if (fil && !fil[2] && req.method === "GET") json(res, 200, discussions.fil(s, fil[1]));
        else if (fil && fil[2] && req.method === "POST") {
          const demande = await corpsJson(req, res);
          if (demande !== null) json(res, 202, fil[2] === "messages"
            ? discussions.envoyer({ store: s, qui, filId: fil[1], demande, verifierBackend })
            : discussions.preparerBrouillon({ store: s, qui, filId: fil[1], demande }));
        } else json(res, 404, { erreur: "Route d'équipe inconnue." });
      }
    } catch (err) { json(res, 400, { erreur: err.message }); }
    return true;
  };
}
module.exports = { creerRouteur };
