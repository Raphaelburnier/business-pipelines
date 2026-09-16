// Import des approbations tenues en fichiers JSON vers le store SQLite.
//
// Il sert une fois, au déploiement de la migration, et il doit pouvoir resservir sans rien
// abîmer : des arbitrages réels attendent une décision dans ces fichiers, et un import qui
// en perdrait un ferait décider sur un plan qui n'existe plus, ou pas du tout.
//
// Trois règles.
//   - Idempotent : relancer l'import réécrit les mêmes lignes, sans doublon.
//   - Vérifié : chaque élément importé est relu dans le store et comparé au fichier. Un écart
//     est rendu, pas avalé, et la commande sort en erreur.
//   - Non destructif : aucun fichier n'est supprimé ni modifié. Les archiver est un geste de
//     l'opérateur, après avoir vu le cockpit afficher ce qu'il attendait.
const fs = require("fs");
const path = require("path");
const { lireJson } = require("./durable");
const store = require("./store");

const BOITE = "EN-ATTENTE.json";
const JOURNAL = "ALERTES.json";
// Un gabarit versionné, pas une décision.
const IGNORES = new Set(["EXEMPLE.decisions.json"]);

// Les chemins écrits dans la boîte sont ceux de la machine qui a tourné le pipeline, par
// exemple /app/approvals/... dans le conteneur. Le fichier se cherche d'abord là, puis sous
// le même nom dans le dossier importé.
function localiser(chemin, approvalsDir) {
  if (!chemin) return null;
  if (fs.existsSync(chemin)) return chemin;
  const local = path.join(approvalsDir, path.basename(chemin));
  return fs.existsSync(local) ? local : null;
}

const suffixe = (nom, fin) => (nom.endsWith(fin) ? nom.slice(0, -fin.length) : null);

function inventaire(approvalsDir) {
  const plans = new Map();
  const registres = new Map();
  for (const nom of fs.existsSync(approvalsDir) ? fs.readdirSync(approvalsDir) : []) {
    if (IGNORES.has(nom)) continue;
    const plan = suffixe(nom, ".plan.json");
    const registre = suffixe(nom, ".decisions.json");
    if (plan) plans.set(plan, path.join(approvalsDir, nom));
    if (registre) registres.set(registre, path.join(approvalsDir, nom));
  }

  const boite = lireJson(path.join(approvalsDir, BOITE)) || { en_attente: [] };
  // Une entrée de boîte désigne ses fichiers par chemin, et ce chemin peut porter un autre
  // nom que le dossier. Il l'emporte sur le nom déduit.
  for (const e of boite.en_attente || []) {
    const plan = localiser(e.plan_gele, approvalsDir);
    const registre = localiser(e.registre, approvalsDir);
    if (plan) plans.set(e.dossier, plan);
    if (registre) registres.set(e.dossier, registre);
  }

  const journal = lireJson(path.join(approvalsDir, JOURNAL)) || { envoyees: [] };
  return { plans, registres, attentes: boite.en_attente || [], alertes: journal.envoyees || [] };
}

const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Ce que le store doit rendre pour un registre donné : la même forme, sans les champs vides.
function registreAttendu(r) {
  const propre = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
  return propre({
    plan: r.plan,
    decisions: (r.decisions || []).map((d) =>
      propre({ action_id: d.action_id, decision: d.decision, par: d.par, canal: d.canal, le: d.le, motif: d.motif })
    ),
    reponse: r.reponse,
    reponse_par: r.reponse_par,
    reponse_le: r.reponse_le,
    reponse_canal: r.reponse_canal,
  });
}

function importer({ approvalsDir }) {
  const inv = inventaire(approvalsDir);
  const ecarts = [];
  const compte = { plans: 0, registres: 0, attentes: 0, alertes: 0 };

  for (const [dossier, fichier] of inv.plans) {
    const plan = lireJson(fichier);
    store.gelerPlan(approvalsDir, dossier, plan);
    compte.plans += 1;
    const relu = store.lirePlan(approvalsDir, dossier);
    if (!relu || relu.empreinte !== plan.empreinte || !egal(relu.actions, plan.actions || [])) {
      ecarts.push(`plan "${dossier}" relu différent de ${fichier}`);
    }
  }

  for (const [dossier, fichier] of inv.registres) {
    const registre = lireJson(fichier);
    if (!registre || !registre.plan) {
      ecarts.push(`registre "${dossier}" sans empreinte de plan dans ${fichier} : non importé`);
      continue;
    }
    store.ecrireRegistre(approvalsDir, dossier, registre);
    compte.registres += 1;
    if (!egal(store.lireRegistre(approvalsDir, dossier), registreAttendu(registre))) {
      ecarts.push(`registre "${dossier}" relu différent de ${fichier}`);
    }
  }

  for (const e of inv.attentes) {
    store.deposer(approvalsDir, e.dossier, e);
    compte.attentes += 1;
  }
  const boite = store.lireBoite(approvalsDir).en_attente;
  for (const e of inv.attentes) {
    const relue = boite.find((b) => b.dossier === e.dossier);
    if (!relue || relue.empreinte !== e.empreinte || relue.actions !== (e.actions ?? 0)) {
      ecarts.push(`demande en attente "${e.dossier}" relue différente de la boîte`);
    }
  }

  for (const a of inv.alertes) {
    store.consignerAlerte(approvalsDir, a);
    compte.alertes += 1;
  }
  const cles = new Set(store.lireJournal(approvalsDir).envoyees.map((a) => a.cle));
  for (const a of inv.alertes) {
    if (!cles.has(a.cle)) ecarts.push(`alerte "${a.cle}" absente du journal après import`);
  }

  return { compte, ecarts, base: store.cheminBase(approvalsDir) };
}

module.exports = { importer, inventaire };
