// Les routes du conseiller (src/conseiller.js), branchées dans bin/cockpit.js.
//
// Deux appelants, deux preuves. L'agent du PC présente un jeton (`Authorization: Bearer`),
// comparé à son empreinte SHA-256 tenue dans specs/cockpit.env : l'identité Tailscale ne
// suffit pas, elle est la même pour le PC et pour le téléphone de Raphaël. Raphaël, lui,
// passe par l'identité du tailnet et le contrôle d'origine, comme pour ses décisions.
//
// Le conseiller ne touche jamais au registre des décisions : aucune de ces routes n'appelle
// `enregistrer`, et rien de ce qu'elles écrivent n'est lu par le juge d'approbation.
const conseiller = require("./conseiller");

const AGENT = "/api/conseiller/";
const DOSSIER = /^\/api\/conseiller\/dossiers\/([^/]+)(\/messages)?$/;

/**
 * @param {{ base: string, jetonSha256: string|null, erreurConfiguration: string|null,
 *   json: Function, corpsJson: Function, corpsAgent: Function, etatApprobations: () => any,
 *   runs: () => any[] }} opts
 * @returns {(req: any, res: any, chemin: string, qui: any) => Promise<boolean>} vrai si la
 *   requête était pour le conseiller et qu'une réponse est partie
 */
function creerRouteurConseiller({ base, jetonSha256, erreurConfiguration = null, json, corpsJson, corpsAgent, etatApprobations, runs }) {
  const refus = (res, err) => {
    if (err instanceof conseiller.RefusConseiller) return json(res, err.code, { erreur: err.message });
    throw err;
  };

  async function agent(req, res, action) {
    if (erreurConfiguration) {
      return json(res, 503, { erreur: `conseiller non configuré : ${erreurConfiguration}` });
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
          const travail = conseiller.prendre(base, { etat: etatApprobations(), runs: runs() });
          if (!travail) {
            res.writeHead(204, { "Cache-Control": "no-store" });
            return res.end();
          }
          return json(res, 200, travail);
        }
        case "resultat":
          return json(res, 200, conseiller.rendre(base, corps.id, corps, { etat: etatApprobations() }));
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
    const d = chemin.match(DOSSIER);
    if (d) {
      const dossier = decodeURIComponent(d[1]);
      try {
        if (!d[2] && req.method === "GET") {
          json(res, 200, conseiller.fil(base, dossier));
          return true;
        }
        if (d[2] && req.method === "POST") {
          const corps = await corpsJson(req, res, 20_000);
          if (corps === null) return true;
          json(res, 202, conseiller.poser(base, { etat: etatApprobations(), dossier, texte: corps.texte, qui }));
          return true;
        }
        json(res, 405, { erreur: "méthode non prise en charge" });
      } catch (err) {
        refus(res, err);
      }
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
