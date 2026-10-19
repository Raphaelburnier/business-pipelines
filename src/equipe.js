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

/**
 * Les notes publiques des modèles (`equipe/benchmarks.json`), versionnées comme le roster.
 * Absent ou illisible : aucune compétence affichée, la page reste lisible.
 * @param {string} fichier
 */
function lireBenchmarks(fichier) {
  let brut;
  try {
    brut = lireJson(fichier);
  } catch {
    return { releve: null, modeles: [] };
  }
  if (!brut || !Array.isArray(brut.modeles)) return { releve: null, modeles: [] };
  return { releve: typeof brut.releve === "string" ? brut.releve : null, modeles: brut.modeles };
}

/** Le modèle de référence d'un membre, ou `null` (combo OmniRoute, modèle non relevé). */
function competencesDe(llm, benchmarks) {
  const modele = benchmarks.modeles.find((m) => (m.correspond || []).some((c) => c.via === llm.via && c.model === llm.model));
  if (!modele) return null;
  return {
    modele: modele.nom,
    prix: modele.prix || null,
    releve: benchmarks.releve,
    benchmarks: (modele.benchmarks || []).map((b) => ({
      nom: b.nom,
      score: b.score,
      max: b.max || 100,
      coutUsd: typeof b.coutUsd === "number" ? b.coutUsd : null,
      unite: b.unite || null,
      variante: b.variante || null,
      mesure: b.mesure === "independant" ? "independant" : "editeur",
      source: b.source || null,
    })),
  };
}

// Le nom affiché est réécrit depuis la page : lettres, espaces, apostrophe et tiret, comme un
// prénom. La police des titres n'a ni chiffres ni ponctuation.
const NOM_AFFICHE = /^[\p{L}][\p{L} '-]{0,29}$/u;
const PHOTO_MAX = 400_000;
const TYPES_PHOTO = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** @param {string} fichier */
function lireProfils(fichier) {
  const brut = lireJson(fichier);
  return brut && typeof brut.profils === "object" && brut.profils ? brut.profils : {};
}

/** Le type d'image d'après ses premiers octets : on ne croit pas l'en-tête du data URL. */
function typePhoto(octets) {
  if (octets.length > 3 && octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return "jpg";
  if (octets.length > 8 && octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (octets.length > 12 && octets.toString("ascii", 0, 4) === "RIFF" && octets.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** Le fichier photo d'un membre, ou `null`. */
function cheminPhoto(dossier, id) {
  if (!ID.test(id)) return null;
  for (const ext of Object.keys(TYPES_PHOTO)) {
    const chemin = path.join(dossier, `${id}.${ext}`);
    if (fs.existsSync(chemin)) return { chemin, type: TYPES_PHOTO[ext] };
  }
  return null;
}

/** La photo d'un membre pour la route qui la sert, ou `null`. */
function lirePhoto(dossier, id) {
  const photo = cheminPhoto(dossier, id);
  return photo ? { octets: fs.readFileSync(photo.chemin), type: photo.type } : null;
}

/**
 * Renomme un membre, change sa photo ou son remplaçant depuis la page. `nom: null` rend le
 * nom du roster, `photo: null` retire la photo, `secours: null` retire le remplaçant ; un champ
 * absent n'est pas touché. Rend l'erreur, ou `null`.
 *
 * Le remplaçant prend les étapes du membre quand son quota tombe (moteur, src/relais.js). Il
 * doit venir d'un autre fournisseur : un remplaçant Claude d'un membre Claude partage le quota
 * épuisé et tomberait aussitôt.
 * @param {{ fichier: string, dossierPhotos: string, roster: ReturnType<typeof lireRoster>, agent: unknown, nom?: unknown, photo?: unknown, secours?: unknown, par?: string|null, maintenant?: number }} demande
 */
function ecrireProfil({ fichier, dossierPhotos, roster, agent, nom, photo, secours, par = null, maintenant = Date.now() }) {
  const membre = typeof agent === "string" ? roster.find((m) => m.id === agent) : null;
  if (!membre) return "agent inconnu";
  if (secours !== undefined && secours !== null) {
    const remplacant = typeof secours === "string" ? roster.find((m) => m.id === secours) : null;
    if (!remplacant) return "remplaçant inconnu";
    if (remplacant.id === membre.id) return "un membre ne peut pas se remplacer lui-même";
    if (remplacant.llm.via === membre.llm.via) return `${remplacant.nom} passe aussi par ${membre.llm.via} : il partagerait le quota épuisé`;
  }
  let octets = null;
  if (typeof photo === "string") {
    const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(photo);
    if (!m) return "photo attendue en data URL jpeg, png ou webp";
    octets = Buffer.from(m[1], "base64");
    if (octets.length > PHOTO_MAX) return "photo trop lourde (400 ko au plus)";
    if (!typePhoto(octets)) return "le fichier n'est pas une image jpeg, png ou webp";
  } else if (photo !== undefined && photo !== null) return "photo invalide";
  let nomPropre;
  if (typeof nom === "string") {
    nomPropre = nom.trim().replace(/\s+/g, " ");
    if (!NOM_AFFICHE.test(nomPropre)) return "nom invalide (30 caractères, lettres, espace, ' et -)";
  } else if (nom !== undefined && nom !== null) return "nom invalide";

  const profils = { ...lireProfils(fichier) };
  const profil = { ...(profils[agent] || {}) };
  if (nom === null) delete profil.nom;
  else if (nomPropre !== undefined) profil.nom = nomPropre;
  if (photo !== undefined) {
    const ancienne = cheminPhoto(dossierPhotos, agent);
    if (ancienne) fs.rmSync(ancienne.chemin, { force: true });
    if (octets) {
      fs.mkdirSync(dossierPhotos, { recursive: true });
      fs.writeFileSync(path.join(dossierPhotos, `${agent}.${typePhoto(octets)}`), octets);
      profil.photoMaj = new Date(maintenant).toISOString();
    } else delete profil.photoMaj;
  }
  if (secours === null) delete profil.secours;
  else if (secours !== undefined) profil.secours = secours;
  profil.par = par;
  if (profil.nom === undefined && profil.photoMaj === undefined && profil.secours === undefined) delete profils[agent];
  else profils[agent] = profil;
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  ecrireJson(fichier, { profils });
  return null;
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
 * `profils` porte le nom et la photo choisis depuis la page ; `benchmarks` les notes publiques
 * du modèle de chaque membre.
 * @param {{ roster: ReturnType<typeof lireRoster>, affectations: Record<string, { projet: string, depuis: string, par?: string|null }>, profils?: Record<string, { nom?: string, photoMaj?: string }>, benchmarks?: ReturnType<typeof lireBenchmarks>, dossierPhotos?: string|null, store?: any, projets?: string[], maintenant?: number, limiteRuns?: number }} options
 */
function etat({ roster, affectations, profils = {}, benchmarks = { releve: null, modeles: [] }, dossierPhotos = null, store = null, projets = [], maintenant = Date.now(), limiteRuns = 300 }) {
  const date = new Date(maintenant);
  const debutMois = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const membreDe = new Map();
  for (const membre of roster) for (const ref of membre.registre) membreDe.set(ref, membre.id);

  const consomme = new Map();
  const jetons = new Map();
  const enCours = new Map();
  const etapes = new Map();
  if (store) {
    for (const run of store.runs({ limite: limiteRuns })) {
      const recent = run.started_at && Date.parse(run.started_at) >= debutMois;
      const vivant = ["running", "waiting_approval", "waiting_freshness"].includes(run.status);
      if (!recent && !vivant) continue;
      for (const etape of store.etapes(run.id)) {
        const id = membreDe.get(nomAgent(etape.agent_ref));
        if (!id) continue;
        if (etape.started_at && Date.parse(etape.started_at) >= debutMois) {
          consomme.set(id, (consomme.get(id) || 0) + Number(etape.est_cost_usd || 0));
          jetons.set(id, (jetons.get(id) || 0) + Number(etape.tokens_in || 0) + Number(etape.tokens_out || 0));
          const compte = etapes.get(id) || { total: 0, reussies: 0 };
          compte.total += 1;
          if (etape.status === "succeeded") compte.reussies += 1;
          etapes.set(id, compte);
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
    const profil = profils[membre.id] || {};
    const photo = dossierPhotos && profil.photoMaj && cheminPhoto(dossierPhotos, membre.id);
    return {
      ...membre,
      nom: profil.nom || membre.nom,
      nomRoster: membre.nom,
      // La date dans l'URL : une nouvelle photo n'est pas masquée par l'ancienne en cache.
      photo: photo ? `/api/equipe/photos/${membre.id}?v=${encodeURIComponent(profil.photoMaj)}` : null,
      secours: profil.secours && roster.some((m) => m.id === profil.secours) ? profil.secours : null,
      competences: competencesDe(membre.llm, benchmarks),
      etapesMois: etapes.get(membre.id) || { total: 0, reussies: 0 },
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

/**
 * Le roster tel que les missions le lisent : chaque membre porte l'id de son remplaçant
 * choisi sur la page Agents, ou `null`. Il entre dans l'empreinte de configuration : changer
 * de remplaçant entre la préparation et le lancement d'une mission la fait relire.
 * @param {string} rosterFichier
 * @param {string} profilsFichier
 */
function rosterAvecSecours(rosterFichier, profilsFichier) {
  const roster = lireRoster(rosterFichier);
  const profils = lireProfils(profilsFichier);
  const ids = new Set(roster.map((m) => m.id));
  return roster.map((m) => ({ ...m, secours: profils[m.id]?.secours && ids.has(profils[m.id].secours) ? profils[m.id].secours : null }));
}

module.exports = { rosterAvecSecours, lireRoster, lireAffectations, lireBenchmarks, lireProfils, ecrireProfil, lirePhoto, etat, affecter, lancementEquipe };
