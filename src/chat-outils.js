// Ce que lisent les répondants de « Demander » (agent-orchestrator, src/cockpit-read.js) : les
// mêmes fonctions que l'API du cockpit, pour que le chat voie ce que voit l'écran, jamais plus.
//
// Partagé par le runner (Claude, en processus) et par bin/chat-outils-mcp.js (Codex, en MCP
// stdio). `sources` ne fait que lire : le plan est calculé à blanc. `agir` donne aux
// conseillers ce qui se rattrape (relancer une CI, écrire à l'agent d'une PR, à une équipe ou
// à un run en attente), au nom de celui qui a posé la question et par les mêmes fonctions que
// les routes. Fusionner et livrer restent des propositions confirmées au clic.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const api = require("./api-lecture");
const NOMS = { claude: "Claude", codex: "Codex", cockpit: "Cockpit" };
const approbationsRuns = require("./approbations-runs");
const discussions = require("./discussions-equipe");
const runtimeMission = require("./runtime-mission");
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
    autorises: env.LIVRAISON_AUTORISES_FICHIER || path.join(RACINE, "specs", "livraison.json"),
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
    discussions: { liste: () => discussions.liste(store, null), fil: (id) => discussions.fil(store, id) },
    approbations: () => approbationsRuns.dossiers(store).filter((d) => !d.tranche),
    // Le planificateur à blanc : la même proposition que l'écran calculera au clic. Les étapes
    // Finance du NAS ne sont pas vérifiées ici : l'écran le fera, avec le service Finance.
    planifier: (spec) => {
      const params = { projetsDir: c.projets, roster: roster(), affectations: affectations(), financeDisponible: () => true };
      const etat = plansMissions.etatPlanification({ store, machines: api.machines(store), viaParMachine, roster: params.roster, affectations: params.affectations });
      return planificateur.proposer({ spec, params, etat });
    },
  };
}

// La mention qui réveille l'agent auteur de la PR, d'après le préfixe de sa branche (la norme
// des dépôts : codex/ pour Codex, claude/, agent/ et automation/ pour claude-code-action).
function mentionAgent(branche) {
  if (/^codex\//.test(branche)) return "@codex";
  if (/^(claude|agent|automation)\//.test(branche)) return "@claude";
  return null;
}

/**
 * Les actions sûres des conseillers, au nom de `qui` : l'identité de la commande `chat.respond`,
 * c'est-à-dire de celui qui a posé la question, telle que le cockpit l'a établie. Chaque
 * action relit l'état et passe par la fonction de la route du bouton, qui refuse ce qu'elle
 * refuserait à l'écran. `null` si les actions sont coupées (COCKPIT_CHAT_AGIR=0).
 * @param {any} store
 * @param {{ qui: { par: string, canal: string|null }, agent: string, env?: NodeJS.ProcessEnv }} options
 */
function agir(store, { qui, agent, env = process.env }) {
  if (String(env.COCKPIT_CHAT_AGIR ?? "1").trim() === "0") return null;
  const c = chemins(env);
  const contextePR = { store, instantaneFichier: c.pullRequests, autorisesFichier: c.autorises, qui };
  const prLue = (depot, numero) => {
    const vue = apiPullRequests.etat(contextePR);
    if (vue.perime) throw new Error("relevé des PR trop ancien : attendre le publieur");
    const pr = vue.depots.find((d) => d.depot === depot)?.ouvertes.find((p) => p.numero === numero);
    if (!pr) throw new Error(`PR #${numero} de ${depot} absente du relevé`);
    return pr;
  };
  const signature = `\n\n(${NOMS[agent] || agent}, conseiller du cockpit, à la demande de ${qui.par})`;
  return {
    relancerCI: ({ depot, numero, sha }) => {
      const pr = prLue(depot, numero);
      const commande = apiPullRequests.demanderRelanceCI({ ...contextePR, demande: { depot, numero, sha, runId: pr.ci.runId, tentative: pr.ci.tentative } });
      return { commande: commande.id, detail: `relance CI de ${depot}#${numero} déposée pour le publieur` };
    },
    ecrirePR: ({ depot, numero, sha, message }) => {
      if (!apiPullRequests.peutFusionner(qui, c.autorises)) throw new Error("seule une identité tailnet autorisée peut écrire sur une PR");
      const pr = prLue(depot, numero);
      if (pr.sha !== sha) throw new Error("la PR a bougé depuis la lecture : relire avant d'écrire");
      if (!pr.interne || pr.etat !== "open") throw new Error("écrire est réservé aux PR internes ouvertes");
      const mention = mentionAgent(pr.branche || "");
      const corps = `${mention ? `${mention} ` : ""}${message}${signature}`;
      const commande = store.creerCommande({ kind: "github.pr.comment", payload: { depot, numero, sha, corps }, par: qui.par, canal: qui.canal });
      return { commande: commande.id, detail: `commentaire ${mention ? `pour ${mention} ` : "sans mention (branche hors norme) "}sur ${depot}#${numero} déposé pour le publieur` };
    },
    ecrireEquipe: ({ filId, message, type, destinataires }) => {
      const verifierBackend = runtimeMission.verifier({ viaParMachine: catalogueModeles.lireViaParMachine(env.COCKPIT_VIA_MACHINES), machines: api.machines(store) });
      const demande = { requestId: crypto.randomUUID(), contenu: message, type, ...(destinataires ? { destinataires } : {}) };
      const fil = discussions.envoyer({ store, qui, filId, demande, verifierBackend });
      const tour = fil.tours[fil.tours.length - 1];
      return { commande: tour ? tour.commande : null, detail: `tour envoyé à ${tour ? tour.destinataires.join(", ") : "l'équipe"} dans le fil « ${fil.objectif.slice(0, 80)} »` };
    },
    // Une consigne renvoie le run au travail : approuver ou refuser reste à l'écran.
    consignerRun: ({ approbationId, consigne }) => {
      const envoi = approbationsRuns.demander(store, { approbationId, demande: { decision: "oriented", note: consigne }, qui });
      return { commande: envoi.commande.id, detail: "consigne déposée : le run repart au travail avec elle" };
    },
  };
}

module.exports = { sources, chemins, agir, mentionAgent };
