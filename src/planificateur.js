// Planificateur de missions : d'une spec et d'un projet, il propose un plan d'exécution et
// choisit les agents disponibles pour chaque rôle. Le moteur exécute ensuite le contrat figé.
//
// Le planificateur est déterministe et n'appelle aucun modèle. Il ne compose pas de graphe :
// il choisit parmi les pipelines versionnés déjà attachés à la fiche du projet, dont le
// registre valide les règles (revues en lecture seule, cycles bornés, budgets). Les rôles
// viennent de la structure du pipeline (type de nœud, handler, `mustChange`, arêtes), jamais
// de la description libre d'un agent : une compétence que le registre ne déclare pas n'est
// pas inventée. Les agents viennent du roster de l'équipe (qui incarne quel agent du
// registre) et des runtimes réellement annoncés par les machines.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const registre = require("agent-orchestrator/src/registre");
const contrat = require("agent-orchestrator/src/mission");
const { roleEffectif } = require("agent-orchestrator/src/dispatch");
const schemas = require("agent-orchestrator/packages/schemas/plan");
const missions = require("./missions");
const finance = require("agent-orchestrator/packages/schemas/finance");

const nomAgent = (ref) => String(ref || "").split("@")[0];
const incarne = (membre, noeud) => membre.registre.includes(nomAgent(noeud.agent));
const memeLlm = (a, b) => Boolean(a && b && a.via === b.via && a.model === b.model);

/** Nature d'un pipeline, ou null pour un gabarit que le planificateur ne lance pas. */
function natureDe(pipeline) {
  const tags = pipeline.tags || [];
  if (finance.estFinance(pipeline)) { finance.validerFinance(pipeline); return "finance"; }
  if (pipeline.workspace === "documents" || tags.includes("discussion")) return null;
  if (tags.includes("code") || pipeline.nodes.some((n) => n.handler === "verify-project")) return "developpement";
  if (tags.includes("marketing")) return "marketing";
  return null;
}

/** Rôle de chaque nœud actif, déduit de la structure du pipeline. */
function roles(pipeline, nature) {
  const noeuds = pipeline.nodes.filter((n) => !n.disabled);
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  const aretes = pipeline.edges || [];
  const dev = new Set(noeuds.filter((n) => n.type === "agent" && nature === "developpement" && n.mustChange).map((n) => n.id));
  const role = (n) => {
    if (nature === "finance") return finance.roleFinance(n);
    if (n.type === "review") return "revue";
    if (n.type === "approval") return "decision";
    if (n.type === "script") return n.handler === "verify-project" ? "verification" : "controle";
    if (dev.has(n.id)) return "developpement";
    if (aretes.some((e) => e.from === n.id && dev.has(e.to))) return "planification";
    if (aretes.filter((e) => e.to === n.id && parId.get(e.from)?.type === "agent").length >= 2) return "synthese";
    return nature === "marketing" ? "analyse" : "production";
  };
  return new Map(noeuds.map((n) => [n.id, role(n)]));
}

/** Les auteurs du travail relu par une revue : ceux qui le produisent, pas ceux qui le planifient. */
function auteursDe(actifs, roleDe) {
  return actifs.filter((n) => n.type === "agent" && roleDe.get(n.id) !== "planification").map((n) => n.id);
}

/** Pipelines du registre (dernière version de chacun) d'une nature, pour suggérer un rattachement. */
function pipelinesDuRegistre(nature, dossier = registre.dossierRegistre()) {
  const racine = path.join(dossier, "pipelines");
  if (!fs.existsSync(racine)) return [];
  const refs = [];
  for (const nom of fs.readdirSync(racine).sort()) {
    const versions = fs.readdirSync(path.join(racine, nom)).map((v) => /^v([1-9][0-9]*)$/.exec(v)?.[1]).filter(Boolean).map(Number);
    if (!versions.length) continue;
    const ref = `${nom}@${Math.max(...versions)}`;
    try { if (natureDe(registre.lirePipelineBrut(dossier, ref)) === nature) refs.push(ref); } catch { /* pipeline illisible : pas une suggestion */ }
  }
  return refs;
}

/**
 * Choisit un membre et un runtime pour un nœud agent ou review. Les options sont les membres
 * qui incarnent l'agent du nœud, avec leur modèle, puis l'agent du workflow avec le modèle du
 * pipeline. Un rejet est toujours expliqué ; parmi les options valides, le score préfère un
 * membre affecté au projet (100), puis un membre de l'équipe (30), puis pour une revue un
 * runtime différent du développement (20), puis le modèle recommandé par le pipeline (5).
 */
function choisir(noeud, { projectId, roster, affectations, etat, auteurs }) {
  const options = [...roster.filter((m) => incarne(m, noeud)).map((m) => ({ membre: m, llm: m.llm })), { membre: null, llm: noeud.llm }];
  const viasAuteurs = new Set(auteurs.map((a) => a.llm?.via).filter(Boolean));
  const evaluees = options.map((o, rang) => {
    const qui = o.membre ? o.membre.nom : `agent du workflow ${noeud.agent}`;
    const raisons = [];
    let score = 0;
    let rejet = null;
    if (etat.runtimesExclus.includes(o.llm.via)) rejet = `runtime ${o.llm.via} exclu par la spec`;
    else if (etat.runtimesBloques[o.llm.via]) rejet = etat.runtimesBloques[o.llm.via];
    else {
      const dispo = etat.disponibilite(o.llm, noeud);
      if (!dispo.utilisable) rejet = dispo.raison;
    }
    if (!rejet && o.membre) {
      const affectation = affectations[o.membre.id];
      const depense = etat.depensesMembres[o.membre.id] || 0;
      if (affectation && affectation.projet !== projectId) rejet = `affecté au projet ${affectation.projet}`;
      else if (o.membre.budgetMensuelUsd !== null && depense >= o.membre.budgetMensuelUsd) rejet = `budget mensuel épuisé (${depense.toFixed(2)} / ${o.membre.budgetMensuelUsd} $)`;
      else if (noeud.type === "review" && auteurs.some((a) => a.membre === o.membre.id)) rejet = "déjà auteur du travail à relire";
      if (!rejet && affectation) { score += 100; raisons.push(`${o.membre.nom} est affecté à ce projet.`); }
      // Un membre de l'équipe passe devant l'agent du workflow, même sur un runtime moins varié.
      if (!rejet) { score += 30; raisons.push(`${o.membre.nom} (${o.membre.role}) incarne ${nomAgent(noeud.agent)} dans l'équipe.`); }
    }
    if (!rejet && noeud.type === "review" && viasAuteurs.size && !viasAuteurs.has(o.llm.via)) {
      score += 20;
      raisons.push(`Runtime ${o.llm.via} distinct de celui du développement (${[...viasAuteurs].join(", ")}).`);
    }
    if (!rejet && memeLlm(o.llm, noeud.llm)) { score += 5; raisons.push(`Modèle ${o.llm.via}:${o.llm.model} recommandé par le pipeline.`); }
    return { ...o, qui, rang, score, rejet, raisons };
  });
  const valides = evaluees.filter((o) => !o.rejet).sort((a, b) => b.score - a.score || a.rang - b.rang);
  const ecartes = evaluees.filter((o) => o.rejet).map((o) => `${o.qui} (${o.llm.via}:${o.llm.model}) : ${o.rejet}`);
  return { choix: valides[0] || null, ecartes };
}

/** Évalue un pipeline attaché au projet ; rend un plan ou les blocages qui l'empêchent. */
function evaluer({ spec, index, params, etat }) {
  const { resolution, options } = missions.lire({ ...params, projectId: spec.projectId, pipelineIndex: index });
  const p = resolution.pipeline;
  const ref = `${p.name}@${p.version}`;
  const nature = natureDe(p);
  const blocages = [];
  const bloquer = (code, message, arbitrage = null, noeud = null) => blocages.push({ code, message, arbitrage, noeud, pipeline: ref });
  const roleDe = roles(p, nature);
  const actifs = p.nodes.filter((n) => !n.disabled);
  const avertissements = [];
  let degrade = false;

  if (nature === "finance") {
    if (resolution.projet.publier === true) bloquer("decision-requise", "Le projet Finance doit désactiver la publication GitHub.", "Définir publier: false dans la fiche Finance.");
    for (const n of actifs.filter((n) => n.type === "script")) {
      if (params.financeDisponible?.(n.handler, roleEffectif(n)) !== true) {
        bloquer("capacite-absente", `L'étape Finance ${n.id} n'est pas installée sur ${roleEffectif(n)}.`, "Terminer l'intégration de l'analyse financière avant de lancer cette mission.", n.id);
      }
    }
  }

  if (nature === "developpement") {
    if (![...roleDe.values()].includes("developpement")) bloquer("pipeline-incomplet", `${ref} n'a aucun nœud de développement (agent avec mustChange).`);
    if (!actifs.some((n) => n.handler === "verify-project")) bloquer("pipeline-incomplet", `${ref} n'exécute pas les tests du projet (verify-project).`);
    if (!actifs.some((n) => n.type === "review")) bloquer("pipeline-incomplet", `${ref} n'a aucune revue indépendante active.`);
  }
  if (spec.exigences.includes("revue-securite")) {
    const securite = p.nodes.filter((n) => n.type === "review" && nomAgent(n.agent) === "security-reviewer");
    if (!securite.length) bloquer("capacite-absente", `${ref} ne contient aucune revue security-reviewer : la revue de sécurité exigée n'est pas disponible.`, "Choisir un autre pipeline ou retirer l'exigence.");
    else if (securite.every((n) => n.disabled)) {
      const id = securite[0].id;
      bloquer("decision-requise", `La revue ${id} existe dans ${ref} mais la fiche du projet ne l'active pas.`,
        `Activer overrides.nodes.${id}.enabled dans projects/${spec.projectId}/project.json : changement de politique du projet, à décider explicitement.`, id);
    }
  }

  // Champs exigés par les tranches des agents : la spec du projet sert de base, la spec de la
  // mission la complète. Un champ absent bloque avant tout run, avec sa liste.
  const contexte = { ...options.spec, ...spec.contexte };
  const repris = Object.keys(options.spec).filter((k) => k !== "project_name" && !Object.hasOwn(spec.contexte, k));
  if (repris.length) avertissements.push(`Champs repris de la spec du projet : ${repris.join(", ")}.`);
  const manquants = new Set();
  for (const n of actifs) if (Array.isArray(n.slice)) for (const cle of n.slice) if (!Object.hasOwn(contexte, cle) && !["task", "acceptance_criteria", "project_name"].includes(cle)) manquants.add(cle);
  if (manquants.size) bloquer("spec-incomplete", `La spec doit fournir : ${[...manquants].join(", ")}.`, "Compléter le contexte structuré de la spec.");

  const budget = resolution.budget || {};
  const depenseProjet = etat.depensesProjets[spec.projectId] || 0;
  if (typeof budget.usdPerMonth === "number" && depenseProjet >= budget.usdPerMonth) {
    bloquer("budget-epuise", `Budget mensuel du projet atteint : ${depenseProjet.toFixed(2)} / ${budget.usdPerMonth} $.`,
      `Relever budget.usdPerMonth dans la fiche du projet ou attendre le mois prochain.`);
  }

  // Agents d'abord (les auteurs), revues ensuite : une revue connaît ceux qu'elle relit.
  const choisis = new Map();
  const ordre = [...actifs.filter((n) => n.type === "agent"), ...actifs.filter((n) => n.type === "review")];
  for (const n of ordre) {
    const auteurs = n.type === "review" ? auteursDe(actifs, roleDe).map((id) => choisis.get(id)).filter(Boolean) : [];
    const { choix, ecartes } = choisir(n, { projectId: spec.projectId, roster: params.roster, affectations: params.affectations, etat, auteurs });
    if (!choix) {
      bloquer("aucun-agent", `Aucun agent disponible pour ${n.id} (${n.agent}) : ${ecartes.join(" ; ")}.`,
        "Réveiller ou mettre à jour le worker, attendre la fin du quota, ou affecter un membre disponible au projet.", n.id);
      continue;
    }
    const raisons = [...choix.raisons, ...ecartes.map((e) => `Écarté : ${e}.`)];
    if (!choix.membre) {
      degrade = true;
      const aucun = !params.roster.some((m) => incarne(m, n));
      avertissements.push(aucun
        ? `${n.id} : aucun membre de l'équipe n'incarne ${nomAgent(n.agent)} ; l'agent du registre tourne avec le modèle du pipeline.`
        : `${n.id} : aucun membre disponible ; l'agent du registre tourne avec le modèle du pipeline.`);
    }
    choisis.set(n.id, { noeud: n.id, membre: choix.membre?.id ?? null, nom: choix.membre?.nom || resolution.agents[n.agent].name, llm: choix.llm,
      raisons: raisons.slice(0, 12).map((r) => r.slice(0, 600)) });
  }

  // Les scripts hors NAS tournent sur un worker : il doit être joignable.
  for (const n of actifs.filter((x) => x.type === "script")) {
    const machine = roleEffectif(n);
    const dispo = etat.machine(machine, n);
    if (!dispo.utilisable) bloquer("machine-indisponible", `${n.id} doit tourner sur ${machine} : ${dispo.raison}.`, `Rendre ${machine} disponible avant le lancement.`, n.id);
  }
  if (blocages.length) return { blocages, ref, nature };

  const auteurs = auteursDe(actifs, roleDe);
  const independance = actifs.filter((n) => n.type === "review").map((n) => {
    const r = choisis.get(n.id);
    const membresAuteurs = auteurs.map((a) => choisis.get(a).membre);
    const viasAuteurs = auteurs.map((a) => choisis.get(a).llm.via);
    const membreDistinct = r.membre !== null && !membresAuteurs.includes(r.membre);
    const runtimeDistinct = !viasAuteurs.includes(r.llm.via);
    if (!membreDistinct) avertissements.push(`${n.id} : aucun membre distinct identifié ; l'indépendance repose sur la session neuve en lecture seule.`);
    if (!runtimeDistinct) avertissements.push(`${n.id} : même runtime (${r.llm.via}) que le développement.`);
    return { revue: n.id, auteurs, membreDistinct, runtimeDistinct, sessionNeuve: true };
  });

  const ids = (role) => actifs.filter((n) => roleDe.get(n.id) === role).map((n) => n.id);
  const realisePar = nature === "developpement" ? ids("developpement") : ids("synthese").length ? ids("synthese") : [...ids("analyse"), ...ids("production")];
  // Un script ne juge que s'il rend un verdict (outcomeFrom) : `consigne` prépare, il ne juge pas.
  const jugePar = actifs.filter((n) => n.type === "review" || n.type === "approval" || (n.type === "script" && n.outcomeFrom)).map((n) => n.id);
  if (!jugePar.length) { degrade = true; avertissements.push("Aucune étape ne juge les critères : ils ne seront pas vérifiés."); }

  const projet = resolution.projet;
  const approbation = actifs.some((n) => n.type === "approval");
  const resultat = nature === "finance"
    ? { type: "rapport", depot: null, description: "Rapport financier privé, daté et sourcé, archivé après validation déterministe des références. Les scénarios restent à examiner par l'opérateur." }
    : approbation
    ? { type: "approbation", depot: null, description: "Le run s'arrête sur une approbation : la décision se prend dans Décisions, question par question. Aucun déploiement n'est prévu par le plan." }
    : projet.publier === true && projet.github
      ? { type: "pull-request", depot: projet.github, description: `PR agent/ sur ${projet.github} ; fusion par le publieur si tests et revues attestés, CI verte sur le merge exact et aucun fichier sensible, sinon décision dans le cockpit. Aucun déploiement n'est prévu par le plan.` }
      : { type: "livrables", depot: null, description: "Livrables dans le workspace et la branche du run, sans PR : le projet ne publie pas. Aucun déploiement n'est prévu par le plan." };

  const nul = (v) => (typeof v === "number" ? v : null);
  const plan = {
    version: 1, nature,
    pipeline: { ref, index, titre: p.title || p.name, raison: "" },
    etapes: actifs.map((n) => {
      const c = choisis.get(n.id);
      const base = { noeud: n.id, type: n.type, role: roleDe.get(n.id) };
      if (!c) return { ...base, agent: null, membre: null, nom: n.handler || (n.type === "approval" ? "Décision humaine" : n.id), llm: null, machine: n.type === "approval" ? null : roleEffectif(n), maxTurns: null, raisons: [] };
      return { ...base, agent: n.agent, membre: c.membre, nom: c.nom, llm: c.llm, machine: roleEffectif({ ...n, llm: c.llm }), maxTurns: nul(n.maxTurns), raisons: c.raisons };
    }),
    criteres: spec.criteres.map((texte) => ({ texte, realisePar, jugePar })),
    independance,
    limites: { maxTurnsPerAgent: nul(budget.maxTurnsPerAgent), maxTotalTurns: nul(budget.maxTotalTurns), usdPerRun: nul(budget.usdPerRun), usdPerMonth: nul(budget.usdPerMonth),
      corrections: (p.cycles || []).map((c) => ({ cycle: c.id, noeuds: c.nodes, maxLoops: c.maxLoops })) },
    resultat,
    degrade,
    avertissements: avertissements.slice(0, 30).map((a) => a.slice(0, 600)),
  };
  const lancement = { projectId: spec.projectId, pipelineIndex: index, configuration: options.configuration,
    demande: { objectif: spec.objectif, criteres: spec.criteres, directives: spec.directives, exclusions: spec.exclusions,
      document: spec.document, spec: contexte, agents: ordre.map((n) => ({ noeud: n.id, membre: choisis.get(n.id).membre, llm: choisis.get(n.id).llm })) } };
  return { plan, lancement, ref, nature, nom: projet.name };
}

/**
 * La proposition du planificateur pour une spec (`POST /api/missions/plan`).
 * @param {{ spec: unknown, params: { projetsDir: string, roster: any[], affectations: Record<string, any> }, etat: object }} entree
 */
function proposer(entree) { return planifier(entree).proposition; }

function planifier({ spec: brute, params, etat: etatBrut }) {
  const spec = schemas.spec.parse(brute);
  const etat = { runtimesBloques: {}, depensesMembres: {}, depensesProjets: {}, disponibilite: () => ({ utilisable: true }), machine: () => ({ utilisable: true }), ...etatBrut, runtimesExclus: spec.runtimesExclus };
  const sans = (statut, blocages, projet = null) => ({ proposition: schemas.proposition.parse({ statut, plan: null, blocages, empreinte: null, projet }), lancement: null });
  const fiche = path.join(params.projetsDir, spec.projectId, "project.json");
  if (!fs.existsSync(fiche)) {
    return sans("bloque", [{ code: "projet-inconnu", message: `Le projet ${spec.projectId} n'a pas de fiche.`, arbitrage: "Choisir un projet existant ou créer sa fiche projects/<id>/project.json.", noeud: null, pipeline: null }]);
  }
  const ficheLue = JSON.parse(fs.readFileSync(fiche, "utf-8"));
  const projet = { id: spec.projectId, nom: String(ficheLue.name || spec.projectId) };
  const candidats = [];
  const illisibles = [];
  (ficheLue.pipelines || []).forEach((attache, index) => {
    try {
      const brut = registre.lirePipelineBrut(registre.dossierRegistre(), attache.extends);
      const nature = natureDe({ ...brut, nodes: brut.nodes || [] });
      if (nature) candidats.push({ index, ref: attache.extends, nature });
    } catch (err) {
      illisibles.push({ code: "pipeline-illisible", message: `${attache.extends} : ${err.message}`, arbitrage: null, noeud: null, pipeline: attache.extends });
    }
  });

  const natures = [...new Set(candidats.map((c) => c.nature))];
  const nature = spec.nature || (natures.length === 1 ? natures[0] : null);
  if (!nature) {
    return sans("bloque", [...illisibles, { code: "nature-indeterminee", message: natures.length
      ? `Le projet accepte plusieurs natures de mission (${natures.join(", ")}) : la spec doit préciser la sienne.`
      : "Le projet n'a aucun pipeline de développement, de marketing ou de finance.", arbitrage: natures.length ? "Préciser la nature de la mission." : null, noeud: null, pipeline: null }], projet);
  }
  const retenus = candidats.filter((c) => c.nature === nature);
  if (!retenus.length) {
    const suggestions = pipelinesDuRegistre(nature);
    return sans("bloque", [...illisibles, { code: "aucun-pipeline", message: `Aucun pipeline ${nature} n'est attaché au projet ${spec.projectId}.`,
      arbitrage: suggestions.length ? `Attacher l'un de ces pipelines du registre à la fiche du projet : ${suggestions.join(", ")}.` : "Aucun pipeline du registre ne couvre cette nature.", noeud: null, pipeline: null }], projet);
  }

  const essais = retenus.map((c) => {
    try { return evaluer({ spec, index: c.index, params, etat }); }
    catch (err) { return { ref: c.ref, blocages: [{ code: "pipeline-illisible", message: `${c.ref} : ${err.message}`, arbitrage: null, noeud: null, pipeline: c.ref }] }; }
  });
  const reussis = essais.filter((e) => e.plan);
  const elu = reussis.find((e) => !e.plan.degrade) || reussis[0];
  if (!elu) return sans("bloque", essais.flatMap((e) => e.blocages), projet);

  const ecartes = essais.filter((e) => e !== elu).map((e) => e.plan ? `${e.ref} (dégradé)` : `${e.ref} (${e.blocages.map((b) => b.code).join(", ")})`);
  elu.plan.pipeline.raison = [`Pipeline ${nature} attaché à la fiche du projet${retenus.length > 1 ? `, retenu parmi ${retenus.length}` : ""}.`,
    ...(ecartes.length ? [`Écartés : ${ecartes.join(" ; ")}.`] : [])].join(" ").slice(0, 600);
  const plan = schemas.plan.parse(elu.plan);
  // Gel à blanc : le contrat refuse un plan qui ne décrit pas exactement la résolution, et
  // `construire` revérifie la configuration, les rôles et les tranches de spec.
  missions.construire(params, { ...elu.lancement, requestId: crypto.randomUUID() }, { plan });
  return { lancement: elu.lancement, proposition: schemas.proposition.parse({ statut: plan.degrade ? "degrade" : "lancable", plan,
    blocages: illisibles, empreinte: contrat.empreinte({ plan, lancement: elu.lancement }), projet: { id: spec.projectId, nom: elu.nom } }) };
}

/**
 * Lance le plan présenté (`POST /api/missions/lancer`). Le plan est recalculé : s'il a
 * changé depuis la présentation (registre, équipe, machines, quotas), le lancement est refusé.
 * Une requête répétée avec le même requestId rend la commande déjà créée.
 */
function lancer({ store, qui, params, corps, etat, verifierBackend }) {
  const d = schemas.lancementPlan.parse(corps);
  const ancienne = store.db.prepare("SELECT id FROM commands WHERE kind = 'run.start' AND json_extract(payload_json, '$.requestId') = ? LIMIT 1").get(d.requestId);
  if (ancienne) {
    const c = store.commande(ancienne.id);
    const m = c.payload.mission;
    if (c.par !== qui.par || c.canal !== qui.canal || !m?.plan || c.payload.projectId !== d.spec.projectId ||
        m.objectif !== d.spec.objectif || JSON.stringify(m.criteres) !== JSON.stringify(d.spec.criteres)) {
      throw new Error("Cette demande a déjà été utilisée avec un autre contenu ou auteur.");
    }
    return c;
  }
  const { proposition, lancement } = planifier({ spec: d.spec, params, etat });
  if (proposition.statut === "bloque") throw new RefusPlan(`Plan non lançable : ${proposition.blocages.map((b) => b.message).join(" ")}`);
  if (proposition.empreinte !== d.empreinte) throw new RefusPlan("Le plan a changé depuis sa présentation (équipe, registre, machines ou quotas) : relire le plan.");
  if (proposition.statut === "degrade" && !d.accepterDegrade) throw new RefusPlan("Plan dégradé : confirmer explicitement ses avertissements avant le lancement.");
  return missions.demander({ store, qui, params, demande: { ...lancement, requestId: d.requestId }, verifierBackend, plan: proposition.plan });
}

class RefusPlan extends Error {}

const VERDICTS_OK = new Set(["PASS", "COMPLETE"]);
/**
 * Les critères d'un plan face au run : la dernière tentative de chaque étape qui les réalise
 * ou les juge (une correction rejoue les étapes, seule la dernière compte). Un reviewer juge
 * l'ensemble des critères : son verdict n'est pas ventilé critère par critère.
 * @param {any} plan
 * @param {Array<{ noeud: string, statut: string, outcome: string|null }>} etapes  dans l'ordre du run
 */
function resultatCriteres(plan, etapes) {
  const derniere = new Map();
  for (const e of etapes) derniere.set(e.noeud, e);
  const vue = (id) => { const e = derniere.get(id); return { noeud: id, statut: e ? e.statut : "a-venir", outcome: e ? e.outcome ?? null : null }; };
  const echoue = (e) => e.statut === "failed" || (e.statut === "succeeded" && e.outcome && !VERDICTS_OK.has(e.outcome));
  const reussi = (e) => e.statut === "succeeded" && !echoue(e);
  return plan.criteres.map((c) => {
    const realisation = c.realisePar.map(vue);
    const jugements = c.jugePar.map(vue);
    const etat = jugements.some(echoue) || realisation.some((e) => e.statut === "failed") ? "echec"
      : !jugements.length ? "non-verifie"
        : jugements.every(reussi) && realisation.every(reussi) ? "valide"
          : realisation.every((e) => e.statut === "a-venir") ? "a-venir" : "en-cours";
    return { texte: c.texte, etat, realisation, jugements };
  });
}

module.exports = { proposer, planifier, lancer, resultatCriteres, natureDe, roles, pipelinesDuRegistre, RefusPlan };
