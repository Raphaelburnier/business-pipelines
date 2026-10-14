// « Demander au cockpit » (§11.7) : les fils de conversation, lus depuis l'event store et
// rendus dans la forme de `agent-orchestrator/packages/schemas/chat.js`.
//
// Le cockpit n'appelle aucun modèle : poser une question dépose un message et une commande
// `chat.respond`, que le runner du NAS consomme avec sa propre clé.

// Une question plus longue relève d'un document, pas d'un chat.
const LONGUEUR_MAX = 4000;
const AGENTS = ["cockpit", "claude", "codex"];

function actions(m) {
  if (!m.actions_json) return [];
  try {
    const lues = JSON.parse(m.actions_json);
    return Array.isArray(lues) ? lues : [];
  } catch {
    return [];
  }
}

function message(m) {
  return {
    id: m.id,
    role: m.role,
    contenu: m.content,
    statut: m.status,
    creeLe: m.created_at,
    termineLe: m.completed_at || null,
    coutEquivalentUsd: Number(m.est_cost_usd || 0),
    agent: m.role === "assistant" ? m.agent || "cockpit" : null,
    actions: actions(m),
  };
}

function fil(f) {
  return {
    id: f.id,
    titre: f.title,
    projet: f.project_id || null,
    creePar: f.created_by,
    creeLe: f.created_at,
    majLe: f.updated_at,
    dernierMessage: f.dernier_message ?? (f.messages && f.messages.length ? f.messages[f.messages.length - 1].content : null),
  };
}

function usage(store, plafondUsd) {
  const u = store.usageChatMois();
  return { coutEquivalentUsd: u.coutEquivalentUsd, plafondUsd, depuis: u.depuis, bloque: u.coutEquivalentUsd >= plafondUsd };
}

/**
 * @param {any} store
 * @param {{ plafondUsd: number, modele: string, agents?: Array<{ id: string, nom: string, modele: string }> }} options
 */
function listeFils(store, { plafondUsd, modele, agents = [{ id: "cockpit", nom: "Cockpit", modele }] }) {
  return { fils: store.filsChat({ limite: 30 }).map(fil), usage: usage(store, plafondUsd), modele, agents };
}

function filDetaille(store, id) {
  const f = store.filChat(id);
  return f ? { ...fil(f), messages: f.messages.map(message) } : null;
}

/**
 * Pose une question : message de Raphaël, réponse en attente, commande pour le runner.
 * Rend `{ code, corps }` : les refus disent pourquoi, dans les mêmes termes que le reste
 * de l'API.
 * @param {any} store
 * `agent` : qui répond (cockpit par défaut, claude ou codex) ; un fil peut changer de
 * répondant d'une question à l'autre.
 * @param {{ threadId?: string|null, contenu: unknown, par: string, canal?: string|null,
 *   plafondUsd: number, projet?: string|null, agent?: unknown }} demande
 */
function poser(store, { threadId = null, contenu, par, canal = null, plafondUsd, projet = null, agent = "cockpit" }) {
  if (!AGENTS.includes(/** @type {string} */ (agent))) return { code: 400, corps: { erreur: `répondant inconnu : ${String(agent)}` } };
  const texte = typeof contenu === "string" ? contenu.trim() : "";
  if (!texte) return { code: 400, corps: { erreur: "question vide" } };
  if (texte.length > LONGUEUR_MAX) return { code: 413, corps: { erreur: `question trop longue (${LONGUEUR_MAX} caractères au plus)` } };
  if (usage(store, plafondUsd).bloque) {
    return { code: 429, corps: { erreur: `plafond mensuel du chat atteint (${plafondUsd} $ équivalent) : le chat reprend le mois prochain` } };
  }

  let cible = threadId;
  if (cible) {
    const existant = store.filChat(cible);
    if (!existant) return { code: 404, corps: { erreur: "conversation inconnue" } };
    // Une question à la fois par fil : la suivante lirait un contexte sans la réponse.
    if (existant.messages.some((m) => m.role === "assistant" && ["queued", "streaming"].includes(m.status))) {
      return { code: 409, corps: { erreur: "une réponse est déjà en cours dans cette conversation" } };
    }
  } else {
    cible = store.creerFilChat({ title: texte.split("\n")[0].slice(0, 80), projectId: projet, par }).id;
  }

  store.ajouterMessageChat({ threadId: cible, role: "user", content: texte });
  const reponse = store.ajouterMessageChat({ threadId: cible, role: "assistant", status: "queued", agent });
  store.creerCommande({ kind: "chat.respond", payload: { threadId: cible, responseMessageId: reponse.id, agent }, par, canal });
  return { code: 202, corps: filDetaille(store, cible) };
}

module.exports = { listeFils, filDetaille, poser, LONGUEUR_MAX, AGENTS };
