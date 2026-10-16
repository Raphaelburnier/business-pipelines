// Ce que lisent les répondants de « Demander » (agent-orchestrator, src/cockpit-read.js) : les
// mêmes fonctions que l'API du cockpit, pour que le chat voie ce que voit l'écran, jamais plus.
//
// Partagé par le runner (Claude, en processus) et par bin/chat-outils-mcp.js (Codex, en MCP
// stdio). Rien ici n'écrit : le plan est calculé à blanc, et les propositions d'action sont
// rangées sous la réponse par le moteur, pas déposées en commandes.
const fs = require("fs");
const path = require("path");
const api = require("./api-lecture");
const apiLivraison = require("./api-livraison");
const apiPullRequests = require("./api-pull-requests");
const conseiller = require("./conseiller");
const equipe = require("./equipe");
const catalogueModeles = require("./modeles");
const plansMissions = require("./api-plans-missions");
const planificateur = require("./planificateur");

const RACINE = path.resolve(__dirname, "..");

/** Les chemins, résolus comme dans bin/cockpit.js à partir de l'environnement. */
function chemins(env = process.env) {
  const etat = env.ORCH_EVENT_STORE ? path.dirname(env.ORCH_EVENT_STORE) : path.join(RACINE, "etat");
  return {
    store: env.ORCH_EVENT_STORE || path.join(etat, "events.sqlite"),
    projets: env.COCKPIT_PROJETS_DIR || path.join(RACINE, "projects"),
    conseiller: env.CONSEILLER_BASE || path.join(etat, "conseiller.sqlite"),
    roster: env.COCKPIT_EQUIPE_ROSTER || path.join(RACINE, "equipe", "agents.json"),
    affectations: path.join(etat, "equipe-affectations.json"),
    livraison: path.join(etat, "livraison.json"),
    pullRequests: path.join(etat, "pull-requests.json"),
  };
}

// Personne n'est autorisé à livrer depuis ces lectures : le chat voit l'état, pas le droit.
const AUCUN_AUTORISE = path.join(RACINE, "specs", "aucun-autorise.json");
const LECTEUR = { par: "chat", canal: "runner" };

/**
 * Les sources de `cockpitRead.definitionsOutils`, sans le collecteur de propositions.
 * @param {any} store
 * @param {{ env?: NodeJS.ProcessEnv }} [options]
 */
function sources(store, { env = process.env } = {}) {
  const c = chemins(env);
  const roster = () => equipe.lireRoster(c.roster);
  const affectations = () => equipe.lireAffectations(c.affectations);
  const viaParMachine = catalogueModeles.lireViaParMachine(env.COCKPIT_VIA_MACHINES);
  const projets = () => api.lireFiches(c.projets).fiches;
  return {
    store,
    runs: ({ projet, statut, limite }) => api.runs(store, { projet, statut, limite }),
    run: (id) => api.run(store, id),
    etat: () => ({ machines: api.machines(store), usage: api.usage(store) }),
    // L'index que l'agent du PC tient à jour sur le NAS (src/vault-index.js) : sans cette
    // base, le chat n'a pas d'outil vault.
    vault: fs.existsSync(c.conseiller) ? conseiller.vaultPourChat(c.conseiller) : null,
    agents: () => {
      const vue = equipe.etat({ roster: roster(), affectations: affectations(), store, projets: projets().map((f) => f.id) });
      return {
        agents: vue.agents.map((a) => ({ id: a.id, nom: a.nom, role: a.role, llm: a.llm, registre: a.registre,
          occupe: a.occupe, projet: a.projet, enCours: a.enCours, usage: a.usage })),
        projets: projets().map((f) => ({ id: f.id, nom: f.name ?? f.nom ?? f.id, pipelines: (f.pipelines || []).map((p, index) => ({ index, ref: p.extends ?? p.ref ?? null })) })),
      };
    },
    livraison: () => {
      const { peutLivrer: _droit, ...vue } = apiLivraison.etat({ store, propositionFichier: c.livraison, autorisesFichier: AUCUN_AUTORISE, qui: LECTEUR });
      return vue;
    },
    pullRequests: () => {
      const { peutFusionner: _droit, ...vue } = apiPullRequests.etat({ store, instantaneFichier: c.pullRequests, autorisesFichier: AUCUN_AUTORISE, qui: LECTEUR });
      return vue;
    },
    // Le planificateur à blanc : la même proposition que l'écran calculera au clic. Les étapes
    // Finance du NAS ne sont pas vérifiées ici : l'écran le fera, avec le service Finance.
    planifier: (spec) => {
      const params = { projetsDir: c.projets, roster: roster(), affectations: affectations(), financeDisponible: () => true };
      const etat = plansMissions.etatPlanification({ store, machines: api.machines(store), viaParMachine, roster: params.roster, affectations: params.affectations });
      return planificateur.proposer({ spec, params, etat });
    },
  };
}

module.exports = { sources, chemins };
