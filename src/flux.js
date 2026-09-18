// Le flux d'événements du cockpit (SSE).
//
// Pourquoi SSE plutôt qu'un WebSocket : le flux ne va que dans un sens, le navigateur
// reconnecte tout seul, et ça traverse le relais Tailscale comme une requête HTTP
// ordinaire. Un WebSocket demanderait une seconde voie d'authentification ; ici l'identité
// est celle de la requête, comme pour toutes les autres routes.
//
// Ce qui rend la reprise correcte : chaque événement porte l'`id` que lui a donné l'event
// store, envoyé comme identifiant SSE. À la reconnexion, le navigateur renvoie
// `Last-Event-ID` et le serveur reprend exactement après — ni trou, ni doublon. C'est la
// même mécanique que les `seq` du protocole des workers, pour la même raison.
//
// La base est interrogée par sondage. C'est volontaire : SQLite n'a pas de notification
// inter-processus, et le run écrit depuis un autre processus (ou une autre machine). Un
// sondage d'une seconde sur une base locale coûte une lecture d'index ; une file de
// messages coûterait un composant de plus à faire tourner sur le NAS.
const api = require("./api-lecture");

const INTERVALLE_MS = 1000;
// Un commentaire régulier empêche un proxy de fermer une connexion qu'il croit morte.
const BATTEMENT_MS = 15000;

function entete(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

/**
 * Formate un événement au format SSE. L'`id` est celui de la base : c'est lui qui rend la
 * reprise exacte.
 * @param {{ id: number, type: string }} evenement
 */
function cadre(evenement) {
  return `id: ${evenement.id}\nevent: evenement\ndata: ${JSON.stringify(evenement)}\n\n`;
}

/**
 * Ouvre un flux sur la requête. Rend une fonction d'arrêt, que le serveur appelle quand la
 * connexion tombe.
 *
 * @param {{ req: any, res: any, store: any, runId?: string|null, apresId?: number,
 *   intervalleMs?: number, battementMs?: number }} options
 */
function ouvrir({ req, res, store, runId = null, apresId = 0, intervalleMs = INTERVALLE_MS, battementMs = BATTEMENT_MS }) {
  // Une reconnexion reprend où elle s'était arrêtée, sans que le client ait à le demander.
  const repris = Number(req.headers["last-event-id"] || 0);
  let dernier = Number.isFinite(repris) && repris > 0 ? repris : apresId;

  entete(res);
  // Un premier envoi immédiat : la page ne reste pas vide en attendant la première seconde.
  res.write(`: flux ouvert\n\n`);

  const envoyer = () => {
    let lot;
    try {
      lot = api.evenements(store, { runId, apresId: dernier });
    } catch (err) {
      // Une base illisible ne doit pas tuer le cockpit : le flux le dit et s'arrête.
      res.write(`event: erreur\ndata: ${JSON.stringify({ erreur: err.message })}\n\n`);
      return arreter();
    }
    for (const e of lot) {
      dernier = e.id;
      res.write(cadre(e));
    }
  };

  const sonde = setInterval(envoyer, intervalleMs);
  const battement = setInterval(() => res.write(`: battement\n\n`), battementMs);
  const arreter = () => {
    clearInterval(sonde);
    clearInterval(battement);
    try {
      res.end();
    } catch {
      // Connexion déjà fermée par le client : rien à faire.
    }
  };

  req.on("close", arreter);
  envoyer();
  return arreter;
}

module.exports = { ouvrir, cadre, INTERVALLE_MS, BATTEMENT_MS };
