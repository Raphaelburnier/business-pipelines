// Le flux d'un fil de « Demander au cockpit » (SSE), pendant qu'une réponse s'écrit.
//
// À part du flux des runs (`flux.js`) : les deltas du chat n'ont rien à faire dans la table
// des événements, qui est l'historique des runs (§9). Même principe de sondage, pour la même
// raison (le runner écrit depuis un autre processus) ; plus serré, parce qu'on lit une
// réponse mot à mot. Le fil n'est envoyé que s'il a changé, et le flux se ferme de lui-même
// quand plus aucune réponse n'est en cours : il ne reste pas ouvert pour rien.
const apiChat = require("./api-chat");

const INTERVALLE_MS = 250;
const BATTEMENT_MS = 15000;

const enCours = (fil) => fil.messages.some((m) => m.role === "assistant" && (m.statut === "queued" || m.statut === "streaming"));

/**
 * @param {{ req: any, res: any, store: any, threadId: string, intervalleMs?: number, battementMs?: number }} options
 */
function ouvrirFil({ req, res, store, threadId, intervalleMs = INTERVALLE_MS, battementMs = BATTEMENT_MS }) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`: flux du fil ouvert\n\n`);

  let precedent = "";
  const envoyer = () => {
    let fil;
    try {
      fil = apiChat.filDetaille(store, threadId);
    } catch (err) {
      res.write(`event: erreur\ndata: ${JSON.stringify({ erreur: err.message })}\n\n`);
      return arreter();
    }
    if (!fil) {
      res.write(`event: erreur\ndata: ${JSON.stringify({ erreur: "conversation inconnue" })}\n\n`);
      return arreter();
    }
    const texte = JSON.stringify(fil);
    if (texte !== precedent) {
      precedent = texte;
      res.write(`event: fil\ndata: ${texte}\n\n`);
    }
    if (!enCours(fil)) {
      res.write(`event: fin\ndata: {}\n\n`);
      arreter();
    }
  };

  const sonde = setInterval(envoyer, intervalleMs);
  const battement = setInterval(() => res.write(`: battement\n\n`), battementMs);
  let arrete = false;
  function arreter() {
    if (arrete) return;
    arrete = true;
    clearInterval(sonde);
    clearInterval(battement);
    try {
      res.end();
    } catch {
      // Connexion déjà fermée par le client : rien à faire.
    }
  }
  req.on("close", arreter);
  envoyer();
  return arreter;
}

module.exports = { ouvrirFil, INTERVALLE_MS };
