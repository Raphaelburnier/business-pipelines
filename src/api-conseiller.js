// Routes historiques du pont vault, conservées pour les PC déjà installés.
// Les discussions et les calculs d'avis du conseiller ne sont plus disponibles.
const conseiller = require("./conseiller");

const AGENT = "/api/conseiller/";

/**
 * @param {{ base: string, jetonSha256: string|null, erreurConfiguration: string|null,
 *   json: Function, corpsAgent: Function }} opts
 * @returns {(req: any, res: any, chemin: string, qui: any) => Promise<boolean>} vrai si la
 *   requête était pour le conseiller et qu'une réponse est partie
 */
function creerRouteurConseiller({ base, jetonSha256, erreurConfiguration = null, json, corpsAgent }) {
  const refus = (res, err) => {
    if (err instanceof conseiller.RefusConseiller) return json(res, err.code, { erreur: err.message });
    throw err;
  };

  async function agent(req, res, action) {
    if (erreurConfiguration) {
      return json(res, 503, { erreur: `pont vault non configuré : ${erreurConfiguration}` });
    }
    if (!conseiller.jetonValide(req.headers, jetonSha256)) {
      return json(res, 401, { erreur: "jeton du conseiller absent ou faux" });
    }
    if (req.method !== "POST") return json(res, 405, { erreur: "méthode non prise en charge" });
    // Un lot du vault porte des notes entières : plus large que les autres écritures. L'agent
    // n'est pas un navigateur, son bearer remplace donc le contrôle CSRF d'Origin.
    const corps = await corpsAgent(req, res, action === "vault/lot" ? 4_000_000 : 200_000);
    if (corps === null) return undefined;
    try {
      switch (action) {
        case "battement":
          return json(res, 200, conseiller.battement(base, { modele: corps.modele, version: corps.version }));
        case "travail": {
          const travail = conseiller.prendre(base);
          if (!travail) {
            res.writeHead(204, { "Cache-Control": "no-store" });
            return res.end();
          }
          return json(res, 200, travail);
        }
        case "resultat":
          return json(res, 200, conseiller.rendre(base, corps.id, corps));
        case "vault/inventaire":
          return json(res, 200, conseiller.inventaireVault(base));
        case "vault/lot":
          return json(res, 200, conseiller.recevoirVault(base, corps));
        default:
          return json(res, 404, { erreur: "route inconnue" });
      }
    } catch (err) {
      return refus(res, err);
    }
  }

  return async function router(req, res, chemin, qui) {
    if (chemin.startsWith(`${AGENT}dossiers/`)) {
      json(res, 410, { erreur: "Le conseiller des approbations a été retiré." });
      return true;
    }
    if (chemin.startsWith(AGENT)) {
      await agent(req, res, chemin.slice(AGENT.length));
      return true;
    }
    return false;
  };
}

module.exports = { creerRouteurConseiller };
