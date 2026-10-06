// L'équipe d'agents du cockpit : qui est libre, sur quel projet, et ce qu'il lui reste.
//
// Le roster (`equipe/agents.json`) est de la configuration versionnée : un nom, un rôle, un
// modèle, et les agents du registre que chaque membre incarne. Les affectations sont de
// l'état, écrites à côté de l'event store comme la proposition de livraison.
//
// « Ce qu'il lui reste » est un budget mensuel en équivalent API moins ce que ses étapes ont
// coûté ce mois-ci. Le quota réel des abonnements n'est pas encore lu (phase 5) : un budget
// déclaré et une consommation mesurée valent mieux qu'une jauge inventée. Un agent Codex n'a
// pas de budget en dollars (l'abonnement ne publie pas de prix) : on montre ses jetons.
const fs = require("fs");
const path = require("path");
const { lireJson, ecrireJson } = require("./durable");

const FAMILLES = new Set(["claude", "codex", "libre"]);
const ID = /^[a-z][a-z0-9-]{0,39}$/;
// Un nom de projet saisi à la main finit dans un fichier et dans une page : lettres, chiffres
// et quelques séparateurs suffisent.
const NOM_PROJET = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u;

/**
 * Lit et valide le roster. Une faute est refusée en bloc : un agent mal décrit qui disparaît
 * en silence de la page ferait croire qu'il n'existe pas.
 * @param {string} fichier
 * @returns {Array<{ id: string, nom: string, role: string, famille: string, llm: { via: string, model: string }, registre: string[], budgetMensuelUsd: number|null }>}
 */
function lireRoster(fichier) {
  const brut = lireJson(fichier);
  if (!brut || !Array.isArray(brut.agents)) throw new Error(`${fichier} : liste « agents » absente`);
  const vus = new Set();
  return brut.agents.map((a, i) => {
    const ou = `${fichier} agents[${i}]`;
    if (!a || typeof a !== "object") throw new Error(`${ou} : objet attendu`);
    if (typeof a.id !== "string" || !ID.test(a.id)) throw new Error(`${ou} : id invalide`);
    if (vus.has(a.id)) throw new Error(`${ou} : id « ${a.id} » en double`);
    vus.add(a.id);
    for (const champ of ["nom", "role"]) {
      if (typeof a[champ] !== "string" || !a[champ].trim()) throw new Error(`${ou} : ${champ} manquant`);
    }
    if (!FAMILLES.has(a.famille)) throw new Error(`${ou} : famille « ${a.famille} » inconnue`);
    if (!a.llm || typeof a.llm.via !== "string" || typeof a.llm.model !== "string") throw new Error(`${ou} : llm { via, model } attendu`);
    if (!Array.isArray(a.registre) || a.registre.some((r) => typeof r !== "string")) throw new Error(`${ou} : registre doit être une liste de noms`);
    const budget = a.budgetMensuelUsd;
    if (budget !== null && !(typeof budget === "number" && budget >= 0)) throw new Error(`${ou} : budgetMensuelUsd doit être un nombre positif ou null`);
    return {
      id: a.id,
      nom: a.nom.trim(),
      role: a.role.trim(),
      famille: a.famille,
      llm: { via: a.llm.via, model: a.llm.model },
      registre: [...a.registre],
      budgetMensuelUsd: budget,
    };
  });
}

/** @param {string} fichier */
function lireAffectations(fichier) {
  const brut = lireJson(fichier);
  return brut && typeof brut.affectations === "object" && brut.affectations ? brut.affectations : {};
}

// `economy-analyst@1` → `economy-analyst` : un membre incarne un agent, pas une version.
const nomAgent = (ref) => String(ref || "").split("@")[0];

/**
 * L'état de l'équipe (`GET /api/equipe`). Sans event store, la page reste lisible : chacun
 * apparaît sans activité ni consommation, et `mesure` le dit.
 * @param {{ roster: ReturnType<typeof lireRoster>, affectations: Record<string, { projet: string, depuis: string, par?: string|null }>, store?: any, projets?: string[], maintenant?: number, limiteRuns?: number }} options
 */
function etat({ roster, affectations, store = null, projets = [], maintenant = Date.now(), limiteRuns = 300 }) {
  const date = new Date(maintenant);
  const debutMois = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const membreDe = new Map();
  for (const membre of roster) for (const ref of membre.registre) membreDe.set(ref, membre.id);

  const consomme = new Map();
  const jetons = new Map();
  const enCours = new Map();
  if (store) {
    for (const run of store.runs({ limite: limiteRuns })) {
      const recent = run.started_at && Date.parse(run.started_at) >= debutMois;
      const vivant = run.status === "running" || run.status === "waiting_approval";
      if (!recent && !vivant) continue;
      for (const etape of store.etapes(run.id)) {
        const id = membreDe.get(nomAgent(etape.agent_ref));
        if (!id) continue;
        if (etape.started_at && Date.parse(etape.started_at) >= debutMois) {
          consomme.set(id, (consomme.get(id) || 0) + Number(etape.est_cost_usd || 0));
          jetons.set(id, (jetons.get(id) || 0) + Number(etape.tokens_in || 0) + Number(etape.tokens_out || 0));
        }
        if (etape.status === "running") enCours.set(id, { run: run.id, projet: run.project_id, noeud: etape.node_id });
      }
    }
  }

  const agents = roster.map((membre) => {
    const affectation = affectations[membre.id] || null;
    const travail = enCours.get(membre.id) || null;
    const depense = Number((consomme.get(membre.id) || 0).toFixed(4));
    const budget = membre.budgetMensuelUsd;
    return {
      ...membre,
      occupe: Boolean(affectation || travail),
      projet: affectation ? affectation.projet : travail ? travail.projet : null,
      depuis: affectation ? affectation.depuis : null,
      enCours: travail,
      usage: {
        consommeMoisUsd: depense,
        // Seule mesure d'un agent sur abonnement Codex, qui rend un coût nul.
        jetonsMois: jetons.get(membre.id) || 0,
        budgetMensuelUsd: budget,
        resteUsd: budget === null ? null : Number(Math.max(0, budget - depense).toFixed(4)),
      },
    };
  });
  return { agents, projets: [...new Set(projets)].sort(), mesure: Boolean(store) };
}

/**
 * Associe des membres à un projet, ou les libère (`projet: null`). Rend l'erreur à montrer,
 * ou `null` une fois écrit.
 * @param {{ fichier: string, roster: ReturnType<typeof lireRoster>, agents: unknown, projet: unknown, par?: string|null, maintenant?: number }} demande
 */
function affecter({ fichier, roster, agents, projet, par = null, maintenant = Date.now() }) {
  if (!Array.isArray(agents) || !agents.length) return "aucun agent choisi";
  const connus = new Set(roster.map((m) => m.id));
  const inconnus = agents.filter((id) => typeof id !== "string" || !connus.has(id));
  if (inconnus.length) return `agent inconnu : ${inconnus.join(", ")}`;
  let nom = null;
  if (projet !== null) {
    nom = typeof projet === "string" ? projet.trim() : "";
    if (!NOM_PROJET.test(nom)) return "nom de projet invalide (60 caractères, lettres, chiffres, espace . _ -)";
  }
  const affectations = { ...lireAffectations(fichier) };
  const depuis = new Date(maintenant).toISOString();
  for (const id of agents) {
    if (nom === null) delete affectations[id];
    else affectations[id] = { projet: nom, depuis, par };
  }
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  ecrireJson(fichier, { affectations });
  return null;
}

/**
 * Les choix de modèle que l'équipe d'un projet pose au lancement d'un run : une clé
 * `agent:<nom>` par agent du registre qu'incarne un membre associé à ce projet. Le moteur
 * les place après un choix explicite (nœud ou `*`) et ignore celles que le pipeline
 * n'emploie pas.
 * @param {{ roster: ReturnType<typeof lireRoster>, affectations: Record<string, { projet: string }>, projet: string }} options
 * @returns {{ lancement: Record<string, { via: string, model: string }>, membres: Record<string, string> }}
 *   `membres` nomme le membre derrière chaque clé, pour qu'un refus dise qui le cause.
 */
function lancementEquipe({ roster, affectations, projet }) {
  const lancement = {};
  const membres = {};
  for (const membre of roster) {
    const affectation = affectations[membre.id];
    if (!affectation || affectation.projet !== projet) continue;
    for (const ref of membre.registre) {
      lancement[`agent:${ref}`] = { ...membre.llm };
      membres[`agent:${ref}`] = membre.nom;
    }
  }
  return { lancement, membres };
}

module.exports = { lireRoster, lireAffectations, etat, affecter, lancementEquipe };
