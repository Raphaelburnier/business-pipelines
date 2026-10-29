// Le planificateur de missions sur les vrais pipelines improve-app@7 et marketing@1 du
// registre (copies figées dans test/fixtures/registre-planificateur) : sélection, refus,
// persistance du plan dans le contrat et passage au moteur.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REGISTRE_SOURCE = path.join(__dirname, "fixtures", "registre-planificateur");
const { EventStore } = require("agent-orchestrator");
const contrat = require("agent-orchestrator/src/mission");
const planificateur = require("../src/planificateur");
const plansMissions = require("../src/api-plans-missions");
const api = require("../src/api-lecture");
const objectifsAvenirs = require("../src/objectifs-avenirs");
const catalogueObjectifs = require("../web/src/avenir/objectifs.json");

test("catalogue des objectifs : IDs admissibles, révisions et cohérence avec la feuille", () => {
  const feuille = fs.readFileSync(path.join(__dirname, "..", "web/src/avenir/feuille.ts"), "utf8").split("\n");
  assert.ok(catalogueObjectifs.length > 0);
  assert.equal(new Set(catalogueObjectifs.map((o) => o.id)).size, catalogueObjectifs.length);
  for (const objectif of catalogueObjectifs) {
    if (objectif.projet) assert.equal(objectifsAvenirs.validerReference(objectif, objectif.projet).id, objectif.id);
    else assert.throws(() => objectifsAvenirs.validerReference(objectif), /hors du cockpit/);
    const ligne = feuille.find((l) => l.includes(`id: "${objectif.id}"`));
    assert.ok(ligne, `${objectif.id} doit exister dans la feuille de route`);
    assert.match(ligne, /statut: "a-faire"/, `${objectif.id} doit rester à faire`);
    assert.deepEqual(objectif.fichiers, objectif.type === "fix"
      ? JSON.parse(/fichiers: ("(?:[^"\\]|\\.)*")/.exec(ligne)[1]).split(/\s*[;,]\s*(?=(?:BP|AO|REG|AS)\s)/)
      : JSON.parse(/fichiers: (\[[^\]]*\])/.exec(ligne)[1]), `${objectif.id} : fichiers partagés avec le serveur`);
    const raison = /raisonSensibilite: ("(?:[^"\\]|\\.)*")/.exec(ligne);
    assert.equal(objectif.raisonSensibilite, raison ? JSON.parse(raison[1]) : undefined, `${objectif.id} : risque partagé`);
    assert.equal(Number.isInteger(objectif.revision) && objectif.revision > 0, true);
  }
  assert.throws(() => objectifsAvenirs.validerReference({ id: "inconnu", revision: 1 }), /objectif.*inconnu/i);
  assert.throws(() => objectifsAvenirs.validerReference({ id: "0.1", revision: 1 }), /non attribuable/i, "une ligne déjà en cours doit être refusée");
  assert.throws(() => objectifsAvenirs.validerReference({ id: "4.1", revision: 1 }), /non attribuable/i, "l'arrêt d'urgence en cours ne doit pas être attribué une seconde fois");
  assert.throws(() => objectifsAvenirs.validerReference({ id: "6.1", revision: 1 }), /non attribuable/i, "la revue GitHub terminée ne doit pas être attribuée une seconde fois");
  assert.throws(() => objectifsAvenirs.validerReference({ id: "C4", revision: 1 }), /non attribuable/i, "le défaut de revue corrigé ne doit plus être attribuable");
  assert.throws(() => objectifsAvenirs.validerReference({ id: catalogueObjectifs[0].id, revision: 2 }), /révision/i);
  assert.throws(() => objectifsAvenirs.validerReference({ id: catalogueObjectifs[0].id, revision: "1" }), /référence/i);
  assert.throws(() => objectifsAvenirs.validerReference({ id: "3.7", revision: 1 }, "steam-tierlist"), /se traite dans business-pipelines/);
});

const {fixture,ROSTER,YANIS,claudeSonnet,claudeOpus,codex}=require('./fixtures/planificateur');

const spec = (surcharges = {}) => ({ projectId: "app", objectif: "Ajouter un tri par note", criteres: ["La liste se trie par note", "Les tests existants restent verts"], ...surcharges });
const etatLibre = (surcharges = {}) => surcharges;
const qui = { par: "raphael@test", canal: "tailnet" };
const specFinance = (surcharges = {}) => spec({ projectId: "finance", objectif: "Observer l'économie et les cours disponibles", criteres: ["Le rapport conserve les dates et les sources"], ...surcharges });

test("Finance reconnue sans capacité installée : blocages détaillés, aucune commande", () => {
  const f = fixture();
  try {
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "finance" }).options.nature, "finance");
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "finance" }).options.blocages.length, 3);
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "bloque");
    assert.equal(p.plan, null);
    assert.deepEqual(p.blocages.map((b) => [b.code, b.noeud]), [["capacite-absente", "collecte"], ["capacite-absente", "validation"], ["capacite-absente", "publication"]]);
    assert.ok(p.blocages.every((b) => b.pipeline === "finance-research@1"));
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { spec: specFinance(), empreinte: "0".repeat(64), requestId: crypto.randomUUID() }, etat: {} }), /Plan non lançable/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);
  } finally { f.fermer(); }
});

test("Finance : capacité serveur complète, proposition et mise en file du rapport figé, sans exécution", () => {
  const appels = [];
  const f = fixture({ roster: [...ROSTER, { id: "analyste-finance", nom: "Analyste Finance (test)", role: "Analyse financière", famille: "claude", llm: claudeSonnet, registre: ["financial-research-analyst"], budgetMensuelUsd: 20 }], financeDisponible: (handler, machine) => { appels.push([handler, machine]); return true; } });
  try {
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "lancable", JSON.stringify(p.blocages));
    assert.equal(p.plan.nature, "finance");
    assert.deepEqual(p.plan.etapes.map((e) => [e.noeud, e.role]), [["collecte", "collecte"], ["analyse", "analyse"], ["validation", "validation"], ["publication", "publication"]]);
    assert.deepEqual(p.plan.criteres[0], { texte: specFinance().criteres[0], realisePar: ["analyse"], jugePar: ["validation"] });
    assert.equal(p.plan.resultat.type, "rapport");
    assert.equal(p.plan.resultat.depot, null);
    assert.deepEqual(p.plan.limites.corrections, [{ cycle: "correction", noeuds: ["analyse", "validation"], maxLoops: 1 }]);
    assert.deepEqual([...new Set(appels.map((a) => JSON.stringify(a)))].map(JSON.parse), [["finance-snapshot", "nas"], ["finance-report-validate", "nas"], ["finance-report-publish", "nas"]]);
    const corps = { spec: specFinance(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} });
    assert.deepEqual(contrat.valider(c.payload.mission).plan, p.plan);
    assert.equal(planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }).id, c.id);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 1);
    assert.equal(f.store.runs().length, 0, "la recette valide la file, pas une analyse native");
    const maintenant = Date.parse("2026-10-23T08:00:00Z");
    const planifie = planificateur.lancer({ store: f.store, qui, params: f.params, etat: {}, maintenant,
      corps: { ...corps, requestId: crypto.randomUUID(), scheduling: { priority: "haute", notBefore: "2026-10-24T05:30:00.000Z" } } });
    assert.deepEqual(planifie.payload.scheduling, { priority: "haute", notBefore: "2026-10-24T05:30:00.000Z", source: "calendar" });
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, etat: {}, maintenant,
      corps: { ...corps, requestId: crypto.randomUUID(), scheduling: { notBefore: "2026-10-23T07:00:00.000Z" } } }), /déjà passée/);
    f.params.financeDisponible = () => false;
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, requestId: crypto.randomUUID() }, etat: {} }), /Plan non lançable/);
  } finally { f.fermer(); }
});

test("Finance : capacité partielle ou non booléenne refusée, formulaire manuel également bloqué", () => {
  const f = fixture({ financeDisponible: (handler) => handler === "finance-snapshot" });
  try {
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.deepEqual(p.blocages.map((b) => b.noeud), ["validation", "publication"]);
    f.params.financeDisponible = () => "oui";
    assert.equal(planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} }).blocages.length, 3);
    const options = require("../src/missions").lire({ ...f.params, projectId: "finance" }).options;
    const demande = { projectId: "finance", pipelineIndex: 0, requestId: crypto.randomUUID(), configuration: options.configuration,
      demande: { objectif: specFinance().objectif, criteres: specFinance().criteres, spec: options.spec,
        agents: options.roles.map((r) => ({ noeud: r.noeud, membre: null, llm: r.llm })) } };
    assert.throws(() => require("../src/missions").demander({ store: f.store, qui, params: f.params, demande }), /étape Finance collecte.*pas installée/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);
  } finally { f.fermer(); }
});

test("Finance : publication GitHub interdite et nature développement refusée", () => {
  const f = fixture({ financeDisponible: () => true });
  try {
    const autre = planificateur.proposer({ spec: specFinance({ nature: "developpement" }), params: f.params, etat: {} });
    assert.equal(autre.blocages[0].code, "aucun-pipeline");
    const fiche = path.join(f.projets, "finance", "project.json");
    fs.writeFileSync(fiche, JSON.stringify({ ...JSON.parse(fs.readFileSync(fiche)), publier: true, github: "Raphaelburnier/finance" }));
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "bloque");
    assert.equal(p.blocages[0].code, "decision-requise");
  } finally { f.fermer(); }
});

test("spec de développement : développeur, tests du projet et reviewer indépendant choisis dans l'équipe", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "lancable");
    assert.equal(p.plan.pipeline.ref, "improve-app@7");
    const parNoeud = Object.fromEntries(p.plan.etapes.map((e) => [e.noeud, e]));
    assert.deepEqual(p.plan.etapes.map((e) => [e.noeud, e.role]), [["plan", "planification"], ["implement", "developpement"], ["verify", "verification"], ["review", "revue"]]);
    assert.equal(parNoeud.implement.membre, "sacha");
    assert.deepEqual(parNoeud.implement.llm, codex);
    // Deux relecteurs incarnent code-reviewer : celui dont le runtime diffère du développement gagne.
    assert.equal(parNoeud.review.membre, "theo");
    assert.ok(parNoeud.review.raisons.some((r) => /distinct de celui du développement/.test(r)));
    assert.deepEqual(p.plan.independance, [{ revue: "review", auteurs: ["implement"], membreDistinct: true, runtimeDistinct: true, sessionNeuve: true }]);
    assert.deepEqual(p.plan.criteres[0], { texte: "La liste se trie par note", realisePar: ["implement"], jugePar: ["verify", "review"] });
    assert.equal(p.plan.resultat.type, "pull-request");
    assert.equal(p.plan.limites.usdPerRun, 4);
    assert.deepEqual(p.plan.limites.corrections, [{ cycle: "correction", noeuds: ["implement", "verify", "review", "review-security"], maxLoops: 2 }]);
    assert.ok(!p.plan.etapes.some((e) => e.noeud === "review-security"), "une revue optionnelle désactivée n'est pas au plan");
  } finally { f.fermer(); }
});

test("spec marketing : rôles marketing seulement, sans étape de développement", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec({ projectId: "marketing", objectif: "Positionner l'offre", criteres: ["Chaque question a une réponse sourcée"] }), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "lancable");
    assert.equal(p.plan.nature, "marketing");
    assert.deepEqual(p.plan.etapes.map((e) => e.role), ["controle", "analyse", "analyse", "synthese", "controle", "decision"]);
    assert.ok(!p.plan.etapes.some((e) => ["developpement", "verification", "revue"].includes(e.role)));
    assert.deepEqual(p.plan.criteres[0].realisePar, ["synthese"]);
    assert.deepEqual(p.plan.criteres[0].jugePar, ["couverture", "approbation"], "consigne prépare, elle ne juge pas");
    assert.equal(p.plan.resultat.type, "approbation");
    assert.ok(p.plan.avertissements.some((a) => /repris de la spec du projet/.test(a)));
  } finally { f.fermer(); }
});

test("une spec marketing sur un projet de développement est bloquée, sans imposer de développement", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec({ nature: "marketing" }), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "bloque");
    assert.equal(p.plan, null);
    assert.equal(p.blocages[0].code, "aucun-pipeline");
    assert.match(p.blocages[0].arbitrage, /marketing@1/);
  } finally { f.fermer(); }
});

test("projet inconnu ou sans pipeline lançable : blocage expliqué", () => {
  const f = fixture();
  try {
    assert.equal(planificateur.proposer({ spec: spec({ projectId: "absent" }), params: f.params, etat: {} }).blocages[0].code, "projet-inconnu");
    const vide = planificateur.proposer({ spec: spec({ projectId: "vide" }), params: f.params, etat: {} });
    assert.equal(vide.blocages[0].code, "nature-indeterminee");
  } finally { f.fermer(); }
});

test("pipeline au tag de nature inconnu : signalé au lieu d'être ignoré en silence", () => {
  const f = fixture();
  try {
    const source = path.join(f.reg, "pipelines", "marketing", "v1", "pipeline.json");
    const brut = JSON.parse(fs.readFileSync(source, "utf-8"));
    fs.mkdirSync(path.join(f.reg, "pipelines", "seo", "v1"), { recursive: true });
    fs.writeFileSync(path.join(f.reg, "pipelines", "seo", "v1", "pipeline.json"), JSON.stringify({ ...brut, name: "seo", tags: ["markting", "plan"] }));
    const ficheApp = JSON.parse(fs.readFileSync(path.join(f.projets, "app", "project.json"), "utf-8"));
    for (const [id, pipelines] of [["seo", [{ extends: "seo@1" }]], ["mixte", [...ficheApp.pipelines, { extends: "seo@1" }]]]) {
      fs.mkdirSync(path.join(f.projets, id), { recursive: true });
      fs.writeFileSync(path.join(f.projets, id, "project.json"), JSON.stringify({ ...ficheApp, id, pipelines }));
    }

    const seul = planificateur.proposer({ spec: spec({ projectId: "seo" }), params: f.params, etat: {} });
    assert.equal(seul.statut, "bloque");
    const ignore = seul.blocages.find((b) => b.pipeline === "seo@1");
    assert.equal(ignore.code, "nature-indeterminee");
    assert.match(ignore.message, /seo@1 est ignoré : aucun tag de nature .* markting, plan/);
    assert.match(ignore.arbitrage, /finance, code, marketing/);

    const mixte = planificateur.proposer({ spec: spec({ projectId: "mixte" }), params: f.params, etat: etatLibre() });
    assert.equal(mixte.plan.nature, "developpement");
    assert.ok(mixte.plan.avertissements.some((a) => /seo@1 est ignoré/.test(a)));

    const gabarit = planificateur.proposer({ spec: spec({ projectId: "vide" }), params: f.params, etat: {} });
    assert.ok(!gabarit.blocages.some((b) => /est ignoré/.test(b.message)), "un gabarit de discussion n'est pas un défaut");
  } finally { f.fermer(); }
});

test("nature unique : planificateur et missions lisent la même détection", () => {
  const natures = require("../src/natures");
  assert.deepEqual(natures.classer({ tags: ["marketing", "discussion"], workspace: "documents" }), { nature: "marketing", gabarit: true, raison: "gabarit de discussion, lancé depuis une discussion d'équipe" });
  assert.equal(natures.natureLancable({ tags: ["marketing", "discussion"], workspace: "documents" }), null);
  assert.equal(natures.natureLancable({ tags: [], nodes: [{ handler: "verify-project" }] }), "developpement");
  assert.equal(natures.natureLancable({ tags: ["finance", "research"], workspace: "documents" }), "finance");
  assert.match(natures.classer({ tags: [] }).raison, /aucun tag/);
  const f = fixture();
  try {
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "vide" }).options.nature, "marketing");
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "app" }).options.nature, "developpement");
  } finally { f.fermer(); }
});

test("règles par nature : chaque nature détectée a ses règles, le planificateur ne teste aucun nom", () => {
  const natures = require("../src/natures");
  for (const n of natures.INTEGREES) assert.equal(natures.reglesDe(n.id), natures.REGLES[n.id], n.id);
  assert.equal(natures.reglesDe("seo"), natures.GENERIQUES);
  assert.equal(natures.reglesDe("constructor"), natures.GENERIQUES);
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "planificateur.js"), "utf-8");
  assert.doesNotMatch(source, /nature === "/);
});

test("branches : chaque nature avec ses pipelines du registre et ses projets, gabarits exclus", () => {
  const f = fixture();
  try {
    const { natures } = require("../src/branches").branches({ projetsDir: f.projets, dossier: f.reg });
    const par = Object.fromEntries(natures.map((n) => [n.id, n]));
    assert.deepEqual(natures.map((n) => n.id), ["finance", "developpement", "marketing"]);
    assert.deepEqual(par.developpement.projets, [{ id: "app", nom: "Application" }]);
    assert.deepEqual(par.marketing.projets, [{ id: "marketing", nom: "Plan marketing" }], "le projet vide n'a qu'un gabarit de discussion");
    assert.deepEqual(par.marketing.pipelines, ["marketing@1"]);
    assert.ok(par.developpement.pipelines.includes("improve-app@7"));
    assert.equal(par.finance.regles, "dediees");
    assert.match(par.finance.description, /Recherche financière/);
    assert.equal(par.marketing.discussion.gabarit, "marketing-dialogue@1");
    assert.equal(par.finance.discussion, null);
  } finally { f.fermer(); }
});

test("discussions d'équipe : gabarit, compétences et nature cible viennent de la nature du projet", () => {
  const f = fixture();
  try {
    const discussions = require("../src/discussions-equipe");
    const marketing = discussions.discussionDuProjet({ projetsDir: f.projets, projectId: "marketing", dossier: f.reg });
    assert.deepEqual({ nature: marketing.nature, gabarit: marketing.gabarit, versNature: marketing.versNature },
      { nature: "marketing", gabarit: "marketing-dialogue@1", versNature: "developpement" });
    assert.equal(discussions.discussionDuProjet({ projetsDir: f.projets, projectId: "app", dossier: f.reg }).nature, "marketing", "un projet de code garde la discussion marketing");
    const { options, discussion } = discussions.lireOptions({ ...f.params, projectId: "vide" });
    assert.equal(discussion.libelle, "Marketing");
    assert.deepEqual(options.membres.map((m) => m.membre).sort(), ["camille", "elise", "margaux"], "seuls les membres aux compétences déclarées");
    const fil = { resolution_json: JSON.stringify({ pipeline: { name: "marketing-dialogue", version: 1 } }) };
    assert.equal(discussions.discussionDuFil(fil).versNature, "developpement");
    assert.throws(() => discussions.discussionDuFil({ resolution_json: JSON.stringify({ pipeline: { name: "inconnu", version: 1 } }) }), /ne déclare plus le gabarit inconnu@1/);
  } finally { f.fermer(); }
});

const moteurSansNatures = typeof require("agent-orchestrator/src/registre").lireNatures !== "function" && "moteur sans lireNatures";
const moteurSansDiscussion = !require("agent-orchestrator/packages/schemas").schemas.nature?.shape?.discussion && "schéma nature sans discussion";

test("discussions déclarées dans le registre : elles remplacent la définition intégrée", { skip: moteurSansNatures || moteurSansDiscussion }, () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.join(f.reg, "natures"));
    const ecrire = (n) => fs.writeFileSync(path.join(f.reg, "natures", `${n.id}.json`), JSON.stringify(n));
    const natures = require("../src/natures");
    for (const n of natures.INTEGREES) ecrire(n);
    assert.equal(natures.discussionsDeclarees(natures.naturesDeclarees(f.reg))[0].gabarit, "marketing-dialogue@1", "aucune discussion déclarée : l'intégrée reste");
    ecrire({ ...natures.INTEGREES.find((n) => n.id === "marketing"), discussion: { gabarit: "marketing-dialogue@1", competences: ["brand-analyst"] } });
    const [seule] = natures.discussionsDeclarees(natures.naturesDeclarees(f.reg));
    assert.deepEqual({ competences: seule.competences, versNature: seule.versNature }, { competences: ["brand-analyst"], versNature: null });
    const { options } = require("../src/discussions-equipe").lireOptions({ ...f.params, projectId: "marketing" });
    assert.deepEqual(options.membres.map((m) => m.membre), ["camille"]);
  } finally { f.fermer(); }
});
test("natures du registre : une branche déclarée en données est planifiée sans code dédié", { skip: moteurSansNatures }, () => {
  const f = fixture();
  try {
    assert.deepEqual(require("../src/natures").naturesDeclarees(f.reg).map((n) => n.id), ["finance", "developpement", "marketing"], "registre sans natures/ : natures intégrées");
    const dossier = path.join(f.reg, "natures");
    fs.mkdirSync(dossier);
    const ecrire = (n) => fs.writeFileSync(path.join(dossier, `${n.id}.json`), JSON.stringify(n));
    for (const n of require("../src/natures").INTEGREES) ecrire({ ...n, description: n.libelle });
    ecrire({ id: "seo", libelle: "SEO", description: "Audits de référencement.", tags: ["seo"], priorite: 40 });
    const brut = JSON.parse(fs.readFileSync(path.join(f.reg, "pipelines", "marketing", "v1", "pipeline.json"), "utf-8"));
    fs.mkdirSync(path.join(f.reg, "pipelines", "seo", "v1"), { recursive: true });
    fs.writeFileSync(path.join(f.reg, "pipelines", "seo", "v1", "pipeline.json"), JSON.stringify({ ...brut, name: "seo", tags: ["seo"] }));
    const fiche = JSON.parse(fs.readFileSync(path.join(f.projets, "marketing", "project.json"), "utf-8"));
    fs.mkdirSync(path.join(f.projets, "seo"));
    fs.writeFileSync(path.join(f.projets, "seo", "project.json"), JSON.stringify({ ...fiche, id: "seo", pipelines: [{ ...fiche.pipelines[0], extends: "seo@1" }] }));
    fs.copyFileSync(path.join(f.projets, "marketing", "spec.json"), path.join(f.projets, "seo", "spec.json"));

    const p = planificateur.proposer({ spec: spec({ projectId: "seo", objectif: "Auditer le site", criteres: ["Chaque page a un titre"] }), params: f.params, etat: etatLibre() });
    assert.equal(p.statut, "lancable");
    assert.equal(p.plan.nature, "seo");
    assert.ok(p.plan.etapes.some((e) => e.role === "production"), "règles génériques : rôle production par défaut");
    assert.equal(require("../src/missions").lire({ ...f.params, projectId: "seo" }).options.nature, "seo");
    const seo = require("../src/branches").branches({ projetsDir: f.projets, dossier: f.reg }).natures.find((n) => n.id === "seo");
    assert.deepEqual({ regles: seo.regles, pipelines: seo.pipelines, projets: seo.projets.map((p) => p.id) }, { regles: "generiques", pipelines: ["seo@1"], projets: ["seo"] });

    ecrire({ id: "doublon", libelle: "Doublon", description: "x", tags: ["seo"] });
    const casse = planificateur.proposer({ spec: spec({ projectId: "seo" }), params: f.params, etat: {} });
    assert.equal(casse.statut, "bloque");
    assert.match(casse.blocages[0].message, /Natures du registre illisibles : .*le tag seo est déclaré deux fois/);
  } finally { f.fermer(); }
});

test("quota Codex atteint : un autre runtime est choisi s'il existe, sinon blocage avec la raison", () => {
  const f = fixture();
  try {
    const etat = etatLibre({ runtimesBloques: { codex: "quota codex atteint jusqu'à 2026-10-12T18:00:00.000Z (run 1234abcd)" } });
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat });
    assert.equal(p.statut, "bloque");
    const b = p.blocages.find((x) => x.noeud === "implement");
    assert.equal(b.code, "aucun-agent");
    assert.match(b.message, /Sacha .*quota codex atteint/);
    assert.match(b.arbitrage, /quota/);
  } finally { f.fermer(); }
});

test("worker PC hors ligne : les nœuds distants sont refusés, sans réveil", () => {
  const f = fixture();
  try {
    const etat = plansMissions.etatPlanification({ store: f.store, machines: [{ machine: "pc", etat: "sleeping", meta: null }],
      viaParMachine: { nas: ["claude"], pc: ["claude", "codex"] }, roster: f.params.roster, affectations: {} });
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat });
    assert.equal(p.statut, "bloque");
    assert.ok(p.blocages.some((b) => b.code === "machine-indisponible" && b.noeud === "verify"));
    assert.ok(p.blocages.some((b) => b.code === "aucun-agent" && /worker pc indisponible|pc en veille/.test(b.message)));
  } finally { f.fermer(); }
});

test("aucun relecteur dans l'équipe : plan dégradé explicitement, lancement seulement après confirmation", () => {
  const f = fixture({ roster: ROSTER.filter((m) => !m.registre.includes("code-reviewer")) });
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    assert.equal(p.statut, "degrade");
    const review = p.plan.etapes.find((e) => e.noeud === "review");
    assert.equal(review.membre, null);
    assert.ok(p.plan.avertissements.some((a) => /aucun membre de l'équipe n'incarne code-reviewer/.test(a)));
    const corps = { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }), planificateur.RefusPlan);
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, accepterDegrade: true }, etat: {} });
    assert.equal(c.payload.mission.plan.degrade, true);
  } finally { f.fermer(); }
});

test("le relecteur n'est jamais l'auteur : un membre qui incarne les deux est écarté de la revue", () => {
  const polyvalent = { id: "max", nom: "Max", role: "Tout", famille: "claude", llm: claudeSonnet, registre: ["improvement-editor", "code-reviewer"], budgetMensuelUsd: null };
  const f = fixture({ roster: [polyvalent, ROSTER[0]] });
  try {
    f.params.affectations = { max: { projet: "app", depuis: "2026-10-01T00:00:00.000Z" } };
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const parNoeud = Object.fromEntries(p.plan.etapes.map((e) => [e.noeud, e]));
    assert.equal(parNoeud.implement.membre, "max");
    assert.equal(parNoeud.review.membre, null);
    assert.ok(parNoeud.review.raisons.some((r) => /Max .*déjà auteur/.test(r)));
    assert.equal(p.statut, "degrade");
  } finally { f.fermer(); }
});

test("membre affecté à un autre projet ou runtime exclu : écartés ; budget dépassé : seulement signalé", () => {
  const f = fixture();
  try {
    f.params.affectations = { theo: { projet: "autre", depuis: "2026-10-01T00:00:00.000Z" } };
    const p = planificateur.proposer({ spec: spec({ runtimesExclus: ["codex"] }), params: f.params, etat: { depensesMembres: { margaux: 60 } } });
    assert.equal(p.statut, "bloque");
    const message = p.blocages.map((b) => b.message).join("\n");
    assert.match(message, /Sacha .*runtime codex exclu par la spec/);
    const proposePlan = planificateur.proposer({ spec: spec(), params: f.params, etat: { depensesMembres: { margaux: 60 } } });
    const plan = Object.fromEntries(proposePlan.plan.etapes.map((e) => [e.noeud, e]));
    // Décision du 24 octobre : le budget en dollars n'écarte plus un membre.
    assert.equal(plan.plan.membre, "margaux");
    assert.ok(plan.plan.raisons.some((r) => /Margaux a dépassé son budget mensuel indicatif \(60\.00 \/ 60 \$\)/.test(r)));
    assert.equal(plan.review.membre, "ines", "Théo est affecté ailleurs");
    assert.ok(plan.review.raisons.some((r) => /Théo .*affecté au projet autre/.test(r)));
  } finally { f.fermer(); }
});

test("budget mensuel du projet dépassé : un avertissement, jamais un blocage", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: { depensesProjets: { app: 15.2 } } });
    assert.ok(!(p.blocages || []).some((b) => b.code === "budget-epuise"));
    assert.ok(p.plan.avertissements.some((a) => /Budget mensuel indicatif du projet dépassé : 15\.20/.test(a)));
    // Un avertissement de budget ne rend pas le plan dégradé : aucune confirmation de plus.
    assert.equal(p.plan.degrade, false);
  } finally { f.fermer(); }
});

test("revue de sécurité exigée : décision demandée si la fiche ne l'active pas, plan complet sinon", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec({ exigences: ["revue-securite"] }), params: f.params, etat: {} });
    assert.equal(p.statut, "bloque");
    assert.equal(p.blocages[0].code, "decision-requise");
    assert.match(p.blocages[0].arbitrage, /overrides\.nodes\.review-security\.enabled/);
  } finally { f.fermer(); }
  const g = fixture({ securite: true, roster: [...ROSTER, { id: "yanis", nom: "Yanis", role: "Sécurité", famille: "claude", llm: claudeOpus, registre: ["security-reviewer"], budgetMensuelUsd: 30 }] });
  try {
    const p = planificateur.proposer({ spec: spec({ exigences: ["revue-securite"] }), params: g.params, etat: {} });
    assert.equal(p.statut, "lancable");
    assert.deepEqual(p.plan.criteres[0].jugePar, ["verify", "review", "review-security"]);
  } finally { g.fermer(); }
});

test("spec incomplète pour les tranches d'un agent : champs listés", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.projets, "marketing", "spec.json"), JSON.stringify({ offre: "x" }));
    const p = planificateur.proposer({ spec: spec({ projectId: "marketing" }), params: f.params, etat: {} });
    assert.equal(p.blocages[0].code, "spec-incomplete");
    assert.match(p.blocages[0].message, /marche, questions, contraintes/);
    const complete = planificateur.proposer({ spec: spec({ projectId: "marketing", contexte: { marche: "m", questions: ["q"], contraintes: [] } }), params: f.params, etat: {} });
    assert.equal(complete.statut, "lancable");
  } finally { f.fermer(); }
});

test("lancement : contrat figé avec le plan, accepté par le moteur, et reprise insensible aux changements", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const corps = { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} });
    const mission = c.payload.mission;
    assert.deepEqual(mission.plan, p.plan);
    assert.deepEqual(c.payload.llmOverrides, Object.fromEntries(p.plan.etapes.filter((e) => e.llm).map((e) => [e.noeud, e.llm])));
    assert.deepEqual(mission.participants.map((x) => [x.noeud, x.membre]), [["plan", "margaux"], ["implement", "sacha"], ["review", "theo"]]);

    // Même requête rejouée : même commande, pas de second run.
    assert.equal(planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }).id, c.id);
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, spec: spec({ objectif: "autre" }) }, etat: {} }), /déjà été utilisée/);

    // Le registre, l'équipe et la fiche changent après le lancement.
    const pipeline = path.join(f.reg, "pipelines", "improve-app", "v7", "pipeline.json");
    const brut = JSON.parse(fs.readFileSync(pipeline, "utf-8"));
    brut.budget.usdPerRun = 99;
    fs.writeFileSync(pipeline, JSON.stringify(brut));
    f.params.roster = ROSTER.filter((m) => m.id !== "theo");
    const fiche = path.join(f.projets, "app", "project.json");
    fs.writeFileSync(fiche, JSON.stringify({ ...JSON.parse(fs.readFileSync(fiche, "utf-8")), publier: false }));

    const resolution = contrat.resoudreLancement({ store: f.store, commandId: c.id, fichier: fiche, index: 0, lancement: c.payload.llmOverrides });
    assert.equal(resolution.budget.usdPerRun, 4);
    assert.equal(resolution.projet.publier, true);
    const relu = contrat.valider(f.store.commande(c.id).payload.mission);
    assert.deepEqual(relu.plan, p.plan);
    // Le plan d'aujourd'hui serait différent : relancer la même spec exige de relire le plan.
    assert.notEqual(planificateur.proposer({ spec: spec(), params: f.params, etat: {} }).empreinte, p.empreinte);
  } finally { f.fermer(); }
});

test("lancement refusé si le plan a changé depuis sa présentation ou s'il est bloqué", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const corps = { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: { runtimesBloques: { codex: "quota codex atteint" } } }), /Plan non lançable/);
    f.params.affectations = { ines: { projet: "app", depuis: "2026-10-01T00:00:00.000Z" } };
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }), /a changé depuis sa présentation/);
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands").get().n, 0);
  } finally { f.fermer(); }
});

test("objectif À venir : référence signée, lancement idempotent, réservation exclusive et état projeté", () => {
  const f = fixture({ securite: true, roster: [...ROSTER, YANIS] });
  const missions = require("../src/missions");
  const reference = { id: "1.1", revision: 1 };
  const app = JSON.parse(fs.readFileSync(path.join(f.projets, "app", "project.json")));
  fs.mkdirSync(path.join(f.projets, "agent-orchestrator"));
  fs.writeFileSync(path.join(f.projets, "agent-orchestrator", "project.json"), JSON.stringify({ ...app, id: "agent-orchestrator", name: "Moteur" }));
  const lancerObjectif = (requestId = crypto.randomUUID(), objectif = reference, scheduling = { priority: "normale" }, projectId = "agent-orchestrator") => {
    const preparation = planificateur.planifier({ spec: spec({ projectId, contexte: { _roadmapObjective: objectif } }), params: f.params, etat: {} });
    const demande = structuredClone(preparation.lancement);
    demande.requestId = requestId;
    demande.demande.spec._roadmapObjective = objectif;
    return missions.demander({ store: f.store, qui, params: f.params, demande, plan: preparation.proposition.plan, scheduling });
  };
  try {
    const demandeId = crypto.randomUUID();
    const premiere = lancerObjectif(demandeId);
    assert.deepEqual(premiere.payload.mission.resolution.spec._mission.objectifFeuille, reference);
    assert.equal(premiere.payload.scheduling.priority, "normale");
    assert.equal(lancerObjectif(demandeId, reference, { priority: "haute" }).id, premiere.id, "la priorité ne change ni l'idempotence ni le plan créé");
    assert.throws(() => lancerObjectif(), (err) => err.code === "OBJECTIF_OCCUPE");
    assert.throws(() => lancerObjectif(crypto.randomUUID(), { id: "0.1", revision: 1 }), /non attribuable/i);
    assert.throws(() => lancerObjectif(crypto.randomUUID(), reference, { priority: "normale" }, "app"), /se traite dans agent-orchestrator/);

    let affectation = api.objectifsAvenirs(f.store).find((a) => a.objectif.id === reference.id);
    assert.equal(affectation.statut, "queued");
    assert.equal(affectation.priorite, "normale");
    assert.equal(affectation.positionFile, 1);
    assert.equal(affectation.reclassable, true);
    f.store.prendreCommande({ kinds: ["run.start"] });
    const { run } = f.store.ouvrirRunCommande(premiere.id, { projectId: "agent-orchestrator", pipelineRef: "improve-app@7" });
    f.store.statutRun(run.id, "waiting_quota");
    affectation = api.objectifsAvenirs(f.store).find((a) => a.objectif.id === reference.id);
    assert.equal(affectation.runId, run.id);
    assert.equal(affectation.statut, "waiting_quota");
    assert.equal(affectation.reclassable, true);
    assert.equal(affectation.attente?.runtime ?? null, null);
    assert.equal(affectation.positionFile, null, "une attente quota future n'est pas déjà dans la file");
    const attenteQuota = f.store.attentes.enregistrer(run.id, { name: "QuotaAtteint", resetAt: new Date(Date.now() + 60_000).toISOString(), resetSource: "provider.resets_at" });
    f.store.attentes.demander(run.id, { waitId: attenteQuota.wait_id, automatique: true, par: "runner:quota", maintenant: Date.parse(attenteQuota.next_retry_at) });
    affectation = api.objectifsAvenirs(f.store).find((a) => a.objectif.id === reference.id);
    assert.equal(affectation.attente?.commandeAutomatique, true);
    assert.equal(affectation.attente?.commandeStatut, "pending");
    assert.equal(affectation.positionFile, 1, "seule une reprise automatique pending prend le rang prioritaire");

    f.store.statutRun(run.id, "waiting_freshness");
    f.store.attentes.enregistrer(run.id, { name: "FraicheurBloquee", message: "branche divergente" });
    affectation = api.objectifsAvenirs(f.store).find((a) => a.objectif.id === reference.id);
    assert.equal(affectation.statut, "waiting_freshness", "une attente de fraîcheur reste vivante, elle ne devient pas échouée");
    assert.equal(affectation.reclassable, false);

    f.store.statutRun(run.id, "failed");
    affectation = api.objectifsAvenirs(f.store).find((a) => a.objectif.id === reference.id);
    assert.equal(affectation.statut, "failed");
    assert.equal(affectation.reclassable, false);
    assert.notEqual(lancerObjectif().id, premiere.id, "un objectif terminal peut recevoir une nouvelle attribution");
  } finally { f.fermer(); }
});

test("un contrat dont le plan contredit la résolution est refusé par le moteur", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const plan = structuredClone(p.plan);
    plan.etapes.find((e) => e.noeud === "review").llm = codex;
    const lancement = { projectId: "app", pipelineIndex: 0, requestId: crypto.randomUUID(),
      configuration: require("../src/missions").lire({ ...f.params, projectId: "app" }).options.configuration,
      demande: { objectif: "x", criteres: spec().criteres, directives: "", exclusions: "", document: "", spec: {},
        agents: p.plan.etapes.filter((e) => e.llm).map((e) => ({ noeud: e.noeud, membre: e.membre, llm: e.llm })) } };
    assert.throws(() => require("../src/missions").demander({ store: f.store, qui, params: f.params, demande: lancement, plan }), /Plan de mission incohérent : modèle de review/);
  } finally { f.fermer(); }
});

test("le run rapporte chaque critère avec la dernière tentative des étapes qui le jugent", () => {
  const plan = { criteres: [{ texte: "Tri", realisePar: ["implement"], jugePar: ["verify", "review"] }] };
  const etape = (noeud, statut, outcome = null) => ({ noeud, statut, outcome });
  const r = (etapes) => planificateur.resultatCriteres(plan, etapes)[0].etat;
  assert.equal(r([]), "a-venir");
  assert.equal(r([etape("implement", "running")]), "en-cours");
  assert.equal(r([etape("implement", "succeeded"), etape("verify", "succeeded", "FAIL")]), "echec");
  // La correction rejoue les étapes : seule la dernière tentative compte.
  assert.equal(r([etape("implement", "succeeded"), etape("verify", "succeeded", "FAIL"), etape("implement", "succeeded"),
    etape("verify", "succeeded", "PASS"), etape("review", "succeeded", "PASS")]), "non-verifie");
  assert.equal(planificateur.resultatCriteres({ criteres: [{ texte: "x", realisePar: ["a"], jugePar: [] }] }, [])[0].etat, "non-verifie");
});

test("le détail du run expose le plan figé et les critères reliés", () => {
  const f = fixture();
  try {
    const p = planificateur.proposer({ spec: spec(), params: f.params, etat: {} });
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps: { spec: spec(), empreinte: p.empreinte, requestId: crypto.randomUUID() }, etat: {} });
    const runId = f.store.creerRun({ pipelineRef: "improve-app@7", projectId: "app" });
    f.store.db.prepare("UPDATE commands SET run_id = ? WHERE id = ?").run(runId, c.id);
    const detail = api.run(f.store, runId);
    assert.equal(detail.mission.plan.pipeline.ref, "improve-app@7");
    assert.deepEqual(detail.criteres.map((x) => [x.texte, x.etat]), [["La liste se trie par note", "a-venir"], ["Les tests existants restent verts", "a-venir"]]);
  } finally { f.fermer(); }
});

test("runtimes bloqués lus dans les attentes des runs vivants", () => {
  const store = { runs: () => [{ id: "abcdef123456", status: "waiting_quota" }, { id: "x", status: "succeeded" }, { id: "fedcba654321", status: "waiting_auth" }],
    attentes: { vue: (id) => id === "abcdef123456" ? { statut: "waiting_quota", runtime: "codex", resetAt: "2026-10-12T18:00:00.000Z", resetSource: "provider.reset_at" } : { statut: "waiting_auth", runtime: "claude", resetAt: null } } };
  assert.deepEqual(plansMissions.runtimesBloques(store, 300, Date.parse("2026-10-12T17:00:00.000Z")), {
    codex: "quota codex atteint jusqu'à 2026-10-12T18:00:00.000Z (run abcdef12)",
    claude: "connexion claude absente ou expirée (run fedcba65)",
  });
  const sansEcheance = { runs: () => [{ id: "0123456789ab", status: "waiting_quota" }],
    attentes: { vue: () => ({ statut: "waiting_quota", runtime: "claude", resetAt: null }), lire: () => ({ first_wait_at: "2026-10-18T05:50:00.000Z" }) } };
  assert.deepEqual(plansMissions.runtimesBloques(sansEcheance, 300, Date.parse("2026-10-18T09:00:00.000Z")),
    { claude: "quota claude atteint, échéance inconnue (run 01234567)" });
  assert.deepEqual(plansMissions.runtimesBloques(sansEcheance, 300, Date.parse("2026-10-18T10:50:00.000Z")), {}, "au-delà d'une fenêtre de 5 h, le runtime n'est plus bloqué");
});

test("routes HTTP : origine contrôlée, plan proposé, plan changé refusé, lancement dédupliqué", async () => {
  const { spawn } = require("node:child_process");
  const http = require("node:http");
  const f = fixture({ securite: true, roster: [...ROSTER, YANIS] });
  const port = 4689;
  f.store.majMachine({ id: "pc", state: "online", heartbeat: true, meta: { capacites: { backends: ["claude", "codex"], noeuds: ["agent", "script", "review"], missions: 1, documents: 1, procedures: 1 } } });
  const roster = path.join(f.dir, "agents.json");
  fs.writeFileSync(roster, JSON.stringify({ agents: f.params.roster }));
  const poster = (chemin, corps, entetes = {}) => new Promise((resoudre, rejeter) => {
    const brut = JSON.stringify(corps);
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: chemin,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(brut), ...entetes } }, (res) => {
      let r = ""; res.setEncoding("utf-8"); res.on("data", (d) => (r += d)); res.on("end", () => resoudre({ code: res.statusCode, corps: JSON.parse(r || "null") }));
    });
    req.on("error", rejeter); req.end(brut);
  });
  const enfant = spawn(process.execPath, [path.join(__dirname, "..", "bin", "cockpit.js")], { stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, COCKPIT_PORT: String(port), APPROVALS_DIR: path.join(f.dir, "approvals"), ORCH_EVENT_STORE: path.join(f.dir, "events.sqlite"),
      COCKPIT_OPERATEUR_LOCAL: "test", COCKPIT_PROJETS_DIR: f.projets, COCKPIT_EQUIPE_ROSTER: roster, ORCH_REGISTRE: f.reg } });
  try {
    await new Promise((resoudre, rejeter) => {
      const minuterie = setTimeout(() => rejeter(new Error("le cockpit n'a pas démarré")), 8000);
      enfant.stdout.on("data", (d) => { if (String(d).includes("Cockpit sur")) { clearTimeout(minuterie); resoudre(); } });
      enfant.on("exit", (code) => rejeter(new Error(`cockpit arrêté (code ${code})`)));
    });
    assert.equal((await poster("/api/missions/plan", { spec: spec() }, { origin: "https://autre.example" })).code, 403);
    const finance = await poster("/api/missions/plan", { spec: specFinance({ nature: "finance" }), financeDisponible: true });
    assert.equal(finance.code, 200, JSON.stringify(finance.corps));
    assert.equal(finance.corps.statut, "degrade", "la capacité est évaluée côté serveur ; le plan reste dégradé sans équipe Finance complète");
    assert.equal(finance.corps.blocages.some((b) => b.code === "capacite-absente"), false, "un champ HTTP ne remplace pas la capacité réelle du serveur");
    assert.equal((await poster("/api/missions/lancer", { spec: specFinance(), empreinte: "0".repeat(64), requestId: crypto.randomUUID() })).code, 409);
    const app = JSON.parse(fs.readFileSync(path.join(f.projets, "app", "project.json")));
    fs.mkdirSync(path.join(f.projets, "agent-orchestrator"));
    fs.writeFileSync(path.join(f.projets, "agent-orchestrator", "project.json"), JSON.stringify({ ...app, id: "agent-orchestrator", name: "Moteur" }));
    const specObjectif = spec({ projectId: "agent-orchestrator", contexte: { _roadmapObjective: { id: "1.1", revision: 1 } } });
    const proposition = await poster("/api/missions/plan", { spec: specObjectif });
    assert.equal(proposition.code, 200, JSON.stringify(proposition.corps));
    assert.equal(proposition.corps.statut, "lancable");
    assert.equal(proposition.corps.plan.etapes.find((e) => e.noeud === "implement").machine, "pc");
    const corps = { spec: specObjectif, empreinte: proposition.corps.empreinte, requestId: crypto.randomUUID(), scheduling: { priority: "haute" } };
    assert.equal((await poster("/api/missions/lancer", { ...corps, empreinte: "0".repeat(64) })).code, 409);
    const premier = await poster("/api/missions/lancer", corps);
    const second = await poster("/api/missions/lancer", { ...corps, scheduling: { priority: "basse" } });
    assert.equal(premier.code, 202, JSON.stringify(premier.corps));
    assert.equal(second.corps.commande.id, premier.corps.commande.id);
    const commande = f.store.commande(premier.corps.commande.id);
    assert.equal(commande.par, "test");
    assert.equal(commande.payload.mission.plan.pipeline.ref, "improve-app@7");
    assert.equal(commande.payload.scheduling.priority, "haute", "une répétition avec une priorité changée garde la commande initiale");
    const reclasser = await poster("/api/avenir/objectifs/1.1/priorite", { priorite: "basse" });
    assert.equal(reclasser.code, 200, JSON.stringify(reclasser.corps));
    assert.equal(reclasser.corps.priorite, "basse");
    assert.equal(f.store.commande(commande.id).payload.scheduling.priority, "basse");
    f.store.prendreCommande({ kinds: ["run.start"] });
    f.store.ouvrirRunCommande(commande.id, { projectId: "agent-orchestrator", pipelineRef: "improve-app@7" });
    const indisponible = await poster("/api/avenir/objectifs/1.1/priorite", { priorite: "haute" });
    assert.equal(indisponible.code, 409, "un objectif déjà pris par le runner est immuable");
    assert.equal(f.store.db.prepare("SELECT COUNT(*) AS n FROM commands WHERE kind = 'run.start'").get().n, 1);
  } finally { enfant.kill(); f.fermer(); }
});

test("A4 : critères distincts, preuve consultable, absence et péremption restent visibles", () => {
  const plan = { criteres: ["Tri", "Parcours visuel"].map((texte) => ({ texte, realisePar: ["implement"], jugePar: ["verify", "review"] })) };
  const etapes = [{ noeud: "implement", statut: "succeeded", fin: "2026-10-17T10:00:00Z" }, { noeud: "verify", statut: "succeeded", outcome: "PASS" },
    { noeud: "review", statut: "succeeded", outcome: "PASS", session: "review-current" }];
  const report = { criteria: [{ criterion: "Tri", status: "verified", method: "lecture", expected: "Trier par note", evidence: "Le comparateur utilise la note", locations: [{ file: "app.js", line: 1, excerpt: "notes.sort(comparer)", sha256: "a".repeat(64) }] }] };
  const event = { type: "review.finished", payload: { node: "review", treeSha: "b".repeat(40), sessionId: "review-current", finishedAt: "2026-10-17T10:01:00Z", report,
    reportHash: crypto.createHash("sha256").update(JSON.stringify(report)).digest("hex") } };
  const resultat = (events = [event], stages = etapes, arbre = "b".repeat(40)) => planificateur.resultatCriteres(plan, stages, events, arbre);
  assert.deepEqual(resultat().map((r) => r.etat), ["valide", "non-verifie"]);
  assert.equal(resultat()[0].preuves[0].fichiers[0].extrait, "notes.sort(comparer)");
  assert.equal(resultat([])[0].etat, "non-verifie", "un PASS global ne prouve aucun critère");
  assert.equal(resultat([event], etapes, "c".repeat(40))[0].etat, "non-verifie");
  assert.equal(resultat([event], [...etapes, { ...etapes[2], session: "reprise" }])[0].etat, "non-verifie");
  assert.equal(resultat([event], [...etapes, { ...etapes[0], fin: "2026-10-17T10:02:00Z" }])[0].etat, "non-verifie");
  const altered = structuredClone(event); altered.payload.report.criteria[0].evidence = "altéré";
  assert.equal(resultat([altered])[0].etat, "non-verifie");
});


test("Finance v2 : quota Claude bascule vers l’analyste Codex et garde une session de revue distincte", () => {
  const roster = ROSTER.map((m) => m.id === "elise"
    ? { ...m, registre: [...m.registre, "financial-research-analyst"] }
    : m);
  const f = fixture({ financeVersion: 2, financeDisponible: () => true, roster: [...roster,
    { id: "analyste-finance-claude", nom: "Analyste Finance Claude", role: "Analyse", famille: "claude", llm: claudeSonnet, registre: ["financial-research-analyst"], budgetMensuelUsd: null },
    { id: "revue-finance-codex", nom: "Revue Finance Codex", role: "Revue", famille: "codex", llm: codex, registre: ["financial-research-reviewer"], budgetMensuelUsd: null },
  ] });
  try {
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: etatLibre({
      runtimesBloques: { claude: "quota Claude atteint, échéance inconnue" },
    }) });
    assert.equal(p.statut, "lancable", JSON.stringify(p.blocages));
    const parNoeud = Object.fromEntries(p.plan.etapes.map((e) => [e.noeud, e]));
    assert.equal(parNoeud.analyse.membre, "elise");
    assert.deepEqual(parNoeud.analyse.llm, { via: "codex", model: "gpt-5.6-terra:medium" });
    assert.equal(parNoeud.revue.membre, "revue-finance-codex");
    assert.deepEqual(parNoeud.revue.llm, codex);
    assert.notEqual(parNoeud.analyse.membre, parNoeud.revue.membre, "la revue reste une session opérée par un autre membre");
    assert.ok(parNoeud.analyse.raisons.some((r) => /quota Claude atteint/.test(r)));
    assert.notEqual(parNoeud.revue.llm.via, "claude", "la revue utilise aussi un runtime disponible");

    const corps = { spec: specFinance(), empreinte: p.empreinte, requestId: crypto.randomUUID() };
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: etatLibre({
      runtimesBloques: { claude: "quota Claude atteint, échéance inconnue" },
    }) });
    assert.deepEqual(c.payload.mission.plan, p.plan, "le repli est figé dans la commande avant exécution");
  } finally { f.fermer(); }
});

test("A4 : Finance v2 prépare six étapes, deux sessions métier et une seule correction partagée", () => {
  const f = fixture({ financeVersion: 2, financeDisponible: () => true, roster: [...ROSTER,
    { id: "analyse-finance", nom: "Analyse Finance", role: "Analyse", famille: "claude", llm: claudeSonnet, registre: ["financial-research-analyst"], budgetMensuelUsd: null },
    { id: "revue-finance", nom: "Revue Finance", role: "Revue", famille: "codex", llm: codex, registre: ["financial-research-reviewer"], budgetMensuelUsd: null },
  ] });
  try {
    const p = planificateur.proposer({ spec: specFinance(), params: f.params, etat: {} });
    assert.equal(p.statut, "lancable", JSON.stringify(p.blocages));
    assert.equal(p.plan.pipeline.ref, "finance-research@2");
    assert.deepEqual(p.plan.etapes.map((e) => e.role), ["collecte", "analyse", "controle", "revue", "validation", "publication"]);
    assert.deepEqual(p.plan.criteres[0].realisePar, ["analyse"]);
    assert.equal(p.plan.limites.corrections[0].maxLoops, 1);
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps: { spec: specFinance(), empreinte: p.empreinte, requestId: crypto.randomUUID() }, etat: {} });
    assert.equal(f.store.commande(c.id).payload.mission.resolution.pipeline.version, 2);
  } finally { f.fermer(); }
});

test("lot 11 : choix explicite conservé dans le contrat et reprise idempotente sans substitution", () => {
  const f = fixture();
  try {
    const demande = spec({ agents: [{ noeud: "review", membre: "ines" }] });
    const p = planificateur.proposer({ spec: demande, params: f.params, etat: {} });
    assert.equal(p.statut, "lancable");
    assert.equal(p.plan.etapes.find((e) => e.noeud === "review").membre, "ines");
    const corps = { spec: demande, empreinte: p.empreinte, accepterDegrade: true, requestId: crypto.randomUUID() };
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} });
    assert.equal(contrat.valider(c.payload.mission).participants.find((e) => e.noeud === "review").membre, "ines");
    assert.deepEqual(c.payload.llmOverrides.review, codex);
    assert.equal(planificateur.lancer({ store: f.store, qui, params: f.params, corps, etat: {} }).id, c.id);
    assert.throws(() => planificateur.lancer({ store: f.store, qui, params: f.params, corps: { ...corps, spec: spec() }, etat: {} }), /déjà été utilisée/);
    const indisponible = planificateur.proposer({ spec: demande, params: f.params, etat: { runtimesBloques: { codex: "Quota atteint" } } });
    assert.equal(indisponible.statut, "bloque");
    assert.equal(indisponible.plan, null);
    assert.match(indisponible.blocages.find((b) => b.noeud === "review").message, /Quota atteint/);
  } finally { f.fermer(); }
});

test("lot 11 : rôles inconnus, doublons, incompatibilité, affectation et indépendance contrôlés", () => {
  const f = fixture({ roster: ROSTER.map((m) => m.id === "sacha" ? { ...m, registre: ["improvement-editor", "code-reviewer"] } : m) });
  try {
    for (const agents of [
      [{ noeud: "review", membre: "absent" }], [{ noeud: "review", membre: "margaux" }],
      [{ noeud: "inconnu", membre: "sacha" }], [{ noeud: "verify", membre: "sacha" }],
      [{ noeud: "review", membre: "sacha" }],
    ]) assert.equal(planificateur.proposer({ spec: spec({ agents }), params: f.params, etat: {} }).statut, "bloque", JSON.stringify(agents));
    assert.throws(() => planificateur.proposer({ spec: spec({ agents: [{ noeud: "review", membre: "theo" }, { noeud: "review", membre: "ines" }] }), params: f.params, etat: {} }), /un seul choix/);
    f.params.affectations.ines = { projet: "autre" };
    assert.equal(planificateur.proposer({ spec: spec({ agents: [{ noeud: "review", membre: "ines" }] }), params: f.params, etat: {} }).statut, "bloque");
  } finally { f.fermer(); }
});

test("lot 11 : retirer l'exigence côté client ne retire pas la sécurité de l'objectif", () => {
  const f = fixture({ securite: true, roster: [...ROSTER, YANIS] });
  try {
    const fiche = JSON.parse(fs.readFileSync(path.join(f.projets, "app", "project.json")));
    fs.mkdirSync(path.join(f.projets, "agent-orchestrator"));
    fs.writeFileSync(path.join(f.projets, "agent-orchestrator", "project.json"), JSON.stringify({ ...fiche, id: "agent-orchestrator" }));
    const demande = spec({ projectId: "agent-orchestrator", exigences: [], contexte: { _roadmapObjective: { id: "1.1", revision: 1 } } });
    const p = planificateur.proposer({ spec: demande, params: f.params, etat: {} });
    assert.equal(p.statut, "lancable");
    const critere = require("../src/objectifs-avenirs").CRITERE_SECURITE;
    assert.ok(p.plan.criteres.some((c) => c.texte === critere && c.jugePar.includes("review-security") && c.jugePar.includes("verify")));
    const c = planificateur.lancer({ store: f.store, qui, params: f.params, corps: { spec: demande, empreinte: p.empreinte, requestId: crypto.randomUUID() }, etat: {} });
    assert.ok(c.payload.mission.criteres.includes(critere));
    assert.match(c.payload.mission.document, /Sensibilité vérifiée par l'orchestrateur/);
    const modifiee = structuredClone(fiche); modifiee.id = "agent-orchestrator"; modifiee.pipelines[0].overrides.nodes = {};
    fs.writeFileSync(path.join(f.projets, "agent-orchestrator", "project.json"), JSON.stringify(modifiee));
    assert.equal(planificateur.proposer({ spec: demande, params: f.params, etat: {} }).statut, "bloque");
    const o = require("../src/missions").lire({ ...f.params, projectId: "agent-orchestrator" }).options;
    assert.throws(() => require("../src/missions").construire(f.params, { projectId: o.projectId, pipelineIndex: 0, configuration: o.configuration, requestId: crypto.randomUUID(), demande: { objectif: demande.objectif, criteres: demande.criteres, spec: demande.contexte, agents: o.roles.map((r) => ({ noeud: r.noeud, membre: null, llm: r.llm })) } }), /exige une revue de sécurité/);
  } finally { f.fermer(); }
});

test('TaskBoard : plans multi-dépôts atomiques, idempotents et planifiés aujourd’hui sans heure',()=>{
  const f=fixture({securite:true,roster:[...ROSTER,YANIS]});
  const board=require('../src/taskboard'),atelier=require('../src/atelier'),dates=require('../src/atelier-dates');
  try{
    const app=JSON.parse(fs.readFileSync(path.join(f.projets,'app','project.json')));
    fs.mkdirSync(path.join(f.projets,'autre'));fs.writeFileSync(path.join(f.projets,'autre','project.json'),JSON.stringify({...app,id:'autre'}));
    const maintenant=Date.parse('2026-10-25T12:00:00Z'),date='2026-10-25';
    const missions=['app','autre'].map(projectId=>{
      const s=spec({projectId,contexte:{_taskBoardObjective:{id:'1.2',revision:1}}});
      const p=planificateur.proposer({spec:s,params:f.params,etat:{}});assert.equal(p.statut,'lancable',JSON.stringify(p));
      return{spec:s,empreinte:p.empreinte,requestId:crypto.randomUUID(),scheduling:{priority:'haute',source:'calendar',notBefore:dates.instantLocal(date)}};
    });
    const corps={groupeId:crypto.randomUUID(),missions};
    const demande=c=>board.planifier({store:f.store,qui,params:f.params,corps:c,etat:{},maintenant});
    assert.throws(()=>demande({...corps,missions:[missions[0],{...missions[1],empreinte:'0'.repeat(64)}]}),/plan a changé/);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM atelier_goals').get().n,0);
    f.store.db.exec("CREATE TRIGGER echec_groupe BEFORE INSERT ON atelier_goals WHEN NEW.project_id='autre' BEGIN SELECT RAISE(ABORT,'panne-injectee'); END");
    assert.throws(()=>demande(corps),/panne-injectee/);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM atelier_goals').get().n,0,'aucun premier dépôt laissé planifié après un échec du second');
    f.store.db.exec('DROP TRIGGER echec_groupe');
    const objectifs=demande(corps);assert.equal(objectifs.length,2);
    for (const o of objectifs) {
      assert.ok(o.agents.some(a => a.id === 'sacha' && a.role === 'implement'));
      assert.ok(o.agents.some(a => a.id === 'yanis' && a.role === 'review-security'));
      assert.ok(o.agents.every(a => Object.keys(a).sort().join(',') === 'id,nom,role,via'), 'la projection des agents ne divulgue pas le contrat de mission');
    }
    assert.ok(objectifs.every(o=>o.heure==='00:00'&&o.repetition==='none'&&o.taskBoard.id==='1.2'&&o.priority==='haute'));
    assert.deepEqual(demande(corps).map(o=>o.id),objectifs.map(o=>o.id));
    assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM atelier_goals').get().n,2);
    assert.throws(()=>demande({...corps,missions:missions.map(m=>({...m,requestId:crypto.randomUUID()}))}),/déjà attribuée ou planifiée/);
    const commandes=atelier.programmer(f.store,maintenant);assert.equal(commandes.length,2,'tous les prêts sont mis en file ensemble');
    for(const c of commandes){assert.equal(c.payload.scheduling.source,'calendar');assert.ok(c.payload.mission.plan.etapes.some(e=>e.agent?.startsWith('security-reviewer@')));}
    assert.deepEqual(atelier.programmer(f.store,maintenant+1),[]);
    assert.equal(f.store.runs().length,0,'aucun modèle réellement lancé');
  }finally{f.fermer();}
});

test('TaskBoard : déplacement d’un ancien départ conserve heure et contrat, refuse après lancement',()=>{
  const f=fixture({securite:true,roster:[...ROSTER,YANIS]});
  try{
    const fiche=JSON.parse(fs.readFileSync(path.join(f.projets,'app','project.json')));
    fs.mkdirSync(path.join(f.projets,'agent-orchestrator'));fs.writeFileSync(path.join(f.projets,'agent-orchestrator','project.json'),JSON.stringify({...fiche,id:'agent-orchestrator'}));
    const s=spec({projectId:'agent-orchestrator',contexte:{_roadmapObjective:{id:'1.1',revision:1}}});
    const p=planificateur.proposer({spec:s,params:f.params,etat:{}}),maintenant=Date.parse('2026-10-24T10:00:00Z');
    const c=planificateur.lancer({store:f.store,qui,params:f.params,etat:{},maintenant,corps:{spec:s,empreinte:p.empreinte,requestId:crypto.randomUUID(),scheduling:{source:'calendar',notBefore:'2026-10-25T07:30:00.000Z'}}});
    const deplacer=require('../src/taskboard').deplacer;
    const changement={commandeId:c.id,prevuLe:'2026-10-25T07:30:00.000Z',date:'2026-10-26'};
    assert.equal(deplacer({store:f.store,corps:changement,maintenant}).prevuLe,'2026-10-26T07:30:00.000Z');
    assert.deepEqual(f.store.commande(c.id).payload.mission,c.payload.mission);
    assert.throws(()=>deplacer({store:f.store,corps:changement,maintenant}),/a changé/);
    f.store.prendreCommande({kinds:['run.start'],aLaDate:'2026-10-26T08:30:00.000Z'});
    assert.throws(()=>deplacer({store:f.store,corps:{...changement,prevuLe:'2026-10-26T07:30:00.000Z'},maintenant}),/déjà commencé/);
  }finally{f.fermer();}
});

test('TaskBoard : les dépôts annoncés sont autorisés, l’attribution historique reste mono-dépôt',()=>{
  const {validerReference}=require('../src/objectifs-avenirs');
  assert.equal(validerReference({id:'5.2',revision:1},'business-pipelines',{taskBoard:true}).id,'5.2');
  assert.equal(validerReference({id:'5.2',revision:1},'agent-orchestrator',{taskBoard:true}).id,'5.2');
  assert.throws(()=>validerReference({id:'5.2',revision:1},'finance',{taskBoard:true}),/pas dans finance/);
  assert.throws(()=>validerReference({id:'5.2',revision:1},'agent-orchestrator'),/pas dans agent-orchestrator/);
});
