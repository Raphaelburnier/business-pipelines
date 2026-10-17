const fs = require("fs");
const path = require("path");
const approval = require("./approval");
// Plans gelés, registres et boîte survivent au run dans le store SQLite des approbations,
// hors du workspace. Voir src/store.js.
const store = require("./store");
// L'orientation, elle, s'écrit dans le workspace : c'est une entrée du tour, pas un état.
const durable = require("./durable");
const financeMissions = require("./finance/missions");

// L'identité d'une approbation dans le store. Le dossier quand il est déclaré, sinon le nom
// du plan gelé ou du registre, sans suffixe : `marketing.plan.json` et
// `marketing.decisions.json` désignent tous deux le dossier `marketing`, comme leurs
// fichiers le faisaient déjà.
function nomDe(fichier) {
  return path.basename(String(fichier || "")).replace(/\.(plan|decisions)\.json$|\.json$/, "");
}
function cleDossier(stage) {
  return stage.dossier || nomDe(stage.plan_gele || stage.decisions);
}

// Horloge injectable : les dates de gel et de dépôt se testent sans attendre.
const maintenant = (ctx) => (ctx.maintenant ? ctx.maintenant() : Date.now());

const handlers = {};
const financeHandlerNames = ["finance-snapshot", "finance-report-check", "finance-report-validate", "finance-report-publish"];
function financeConfig(env = process.env) {
  const storageRoot = path.resolve(env.FINANCE_STORAGE_ROOT || path.join(__dirname, "..", "etat", "finance"));
  return {
    storageRoot,
    reportsRoot: path.resolve(env.FINANCE_REPORTS_ROOT || path.join(storageRoot, "reports")),
    token: env.EODHD_API_TOKEN || "",
  };
}
function financeDisponible(handler, machine, env = process.env) {
  if (machine !== "nas" || !financeHandlerNames.includes(handler)) return false;
  try { financeMissions.creerHandlers(financeConfig(env)); return true; } catch { return false; }
}
for (const name of financeHandlerNames) {
  handlers[name] = async (stage, ctx) => {
    const runtime = financeMissions.creerHandlers(financeConfig(ctx.env || process.env));
    return runtime.handlers[name](stage, ctx);
  };
}

// Le type de stage `verify-couverture` : le gate du pipeline marketing, rendu par du code
// plutôt que par un juge.
//
// Trois contrôles qu'aucune prose ne contourne :
//   couverture    chaque question du spec est traitée, répondue ou déclarée sans réponse
//   traçabilité   chaque source citée est l'id d'un constat qu'une des voix a vraiment écrit
//   rien de perdu chaque constat des voix est soit cité, soit écarté avec sa raison
//
// Le troisième est celui qui compte. Une synthèse qui lisse le désaccord en laissant
// tomber le constat gênant est exactement ce que ce pipeline existe pour empêcher, et
// c'est la seule des trois propriétés qu'un juge agentique jugerait mal : il s'agit de
// comparer deux listes d'identifiants, pas d'apprécier un texte.
function verifierCouverture(stage, ctx) {
  const rapport = readJson(ctx.workspaceDir, stage.report);

  const constats = new Map();
  const constatsParId = new Map();
  for (const fichier of stage.against) {
    for (const constat of readJson(ctx.workspaceDir, fichier).constats || []) {
      constats.set(constat.id, fichier);
      constatsParId.set(constat.id, constat);
    }
  }

  const reponses = rapport.reponses || [];
  const declarees = rapport.questions_sans_reponse || [];
  const manques = [];
  const manque = (raison, extra = {}) => manques.push({ component: stage.owner, raison, ...extra });

  const traitees = new Set([
    ...reponses.map((r) => r.question),
    ...declarees.map((q) => q.question),
  ]);
  for (const question of ctx.spec[stage.questions_from]) {
    if (!traitees.has(question)) {
      manque("question non traitée : absente des réponses comme des questions sans réponse", {
        question,
      });
    }
  }

  // Aucun stage ne collecte de données avant ces analyses : contrairement au plan de prix,
  // les voix n'ont ni relevé ni statistiques, seulement la demande. Un chiffre sorti d'un
  // modèle dans ces conditions est une invention plausible, et c'est la faute qui avait
  // produit une médiane fausse d'un dollar sur le pipeline de prix.
  //
  // D'où la règle : tout constat qui avance un chiffre dit d'où il vient, dans `base`.
  // « hypothèse à vérifier » est une base parfaitement valable ; l'absence de base ne
  // l'est pas, parce qu'elle laisse un chiffre inventé se lire comme un chiffre mesuré.
  for (const [id, fichier] of constats) {
    const constat = constatsParId.get(id);
    const texte = `${constat.constat || ""} ${constat.implication || ""}`;
    if (/\d/.test(texte) && !String(constat.base || "").trim()) {
      manque(`constat "${id}" de ${fichier} avance un chiffre sans dire d'où il vient (champ "base")`);
    }
  }

  const citees = new Set();
  for (const reponse of reponses) {
    const sources = reponse.sources || [];
    if (sources.length === 0) {
      manque("réponse sans aucun constat cité", { question: reponse.question });
    }
    for (const id of sources) {
      if (!constats.has(id)) {
        manque(`constat cité "${id}" absent des analyses`, { question: reponse.question });
      } else {
        citees.add(id);
      }
    }
  }

  // Un constat écarté sans raison est un constat lissé derrière une formalité.
  const ecartes = new Map();
  for (const ecarte of rapport.constats_ecartes || []) {
    if (!constats.has(ecarte.id)) {
      manque(`constat écarté "${ecarte.id}" absent des analyses`);
    } else if (!String(ecarte.raison || "").trim()) {
      manque(`constat "${ecarte.id}" écarté sans raison`);
    } else {
      ecartes.set(ecarte.id, ecarte.raison);
    }
  }
  for (const [id, fichier] of constats) {
    if (!citees.has(id) && !ecartes.has(id)) {
      manque(`constat "${id}" de ${fichier} ni cité ni écarté : la synthèse l'a fait disparaître`);
    }
  }

  // Les ids d'action sont la clé du registre d'approbation. Deux actions sous le même id
  // rendraient toute décision ambiguë, et une action sans id n'aurait pas de clé du tout.
  const vus = new Set();
  for (const action of rapport.actions || []) {
    if (!action.id) {
      manque("action sans id : le registre d'approbation n'aurait pas de clé");
    } else if (vus.has(action.id)) {
      manque(`deux actions sous le même id "${action.id}"`);
    } else {
      vus.add(action.id);
    }

    // Chaque arbitrage se lit en quelques secondes dans le cockpit : une vraie question,
    // puis un rapport en texte simple. Une valeur structurée s'y affichait comme un
    // dictionnaire, illisible sur un téléphone.
    const libelle = action.id || "sans id";
    const question = typeof action.question === "string" ? action.question.trim() : "";
    const texte = typeof action.rapport === "string" ? action.rapport.trim() : "";
    if (!question.endsWith("?")) {
      manque(`action "${libelle}" : "question" doit être une vraie question, terminée par un point d'interrogation`);
    }
    if (!texte) {
      manque(`action "${libelle}" : "rapport" absent ou vide, attendu en texte simple`);
    } else if (/^[\[{]/.test(texte)) {
      manque(`action "${libelle}" : "rapport" ressemble à du JSON, attendu en texte simple`);
    }
  }

  return {
    verdict: manques.length === 0 ? "COMPLETE" : "INCOMPLETE",
    questions_attendues: ctx.spec[stage.questions_from].length,
    constats_disponibles: constats.size,
    constats_cites: citees.size,
    constats_ecartes: ecartes.size,
    actions: (rapport.actions || []).length,
    manques,
  };
}

handlers["verify-couverture"] = async (stage, ctx) => {
  const verdict = verifierCouverture(stage, ctx);
  fs.writeFileSync(
    path.join(ctx.workspaceDir, stage.output),
    JSON.stringify(verdict, null, 2)
  );
  ctx.reporter.event("verify-couverture:done", {
    stage: stage.id,
    verdict: verdict.verdict,
    manques: verdict.manques.length,
  });
};

// Le type de stage `consigne` : ramène la réponse libre de l'opérateur dans le workspace,
// au début du tour qui doit en tenir compte.
//
// La réponse vit dans le registre des décisions, hors du workspace, liée à l'empreinte du
// plan gelé qu'elle commente. C'est là qu'il faut la lire : le workspace est vidé à chaque
// exécution, et une consigne déposée dedans par le tour précédent était effacée avant
// d'avoir été lue.
//
// Le juge est celui du stage d'approbation, `approval.evaluate`, rejoué sur le plan gelé.
// Ses règles s'appliquent donc sans copie : une réponse blanche n'est pas une consigne, et
// un registre qui porte sur un autre plan ne vaut rien.
//
// La consigne expire d'elle-même. Dès que ce tour gèle un nouveau plan, l'empreinte change,
// le registre devient périmé, et le tour suivant ne la réinjecte plus. Si ce tour échoue
// avant de geler quoi que ce soit, rien n'a bougé : la consigne reste valable pour la
// relance, et ce que l'opérateur a écrit n'est pas perdu.
// Dans un pipeline en graphe (moteur agent-orchestrator), l'approbation vit dans l'event
// store, pas dans la boîte : la consigne est la note d'une orientation (`oriented`) posée
// sur le nœud `approval` du run précédent du même projet. Un run précédent approuvé, refusé
// ou encore en attente n'en laisse aucune.
function consigneDuGraphe(stage, ctx) {
  const ecrire = (contenu) =>
    fs.writeFileSync(path.join(ctx.workspaceDir, stage.output), JSON.stringify(contenu, null, 2));
  const evenements = ctx.reporter && ctx.reporter.store;
  const runId = ctx.reporter && ctx.reporter.runId;
  const noeud = (ctx.pipeline.nodes || []).find((n) => n.type === "approval");
  const courant = evenements && runId ? evenements.run(runId) : null;
  if (!noeud || !courant) {
    ecrire({ consigne: null, raison: "pas d'approbation à relire" });
    return;
  }
  const precedent = evenements
    .runs({ projectId: courant.project_id, limite: 20 })
    .find((r) => r.id !== runId && String(r.started_at) <= String(courant.started_at));
  const approbation = precedent ? evenements.approbationCourante(precedent.id, noeud.id, "decision") : null;
  if (approbation && approbation.status === "oriented" && approbation.note) {
    ecrire({ consigne: approbation.note, run: precedent.id, par: approbation.par });
    ctx.reporter.event("consigne:reprise", { stage: stage.id, run: precedent.id, caracteres: approbation.note.length });
    return;
  }
  ecrire({ consigne: null, raison: precedent ? "le run précédent n'a pas laissé de consigne" : "premier run du projet" });
  ctx.reporter.event("consigne:aucune", { stage: stage.id });
}

handlers.consigne = async (stage, ctx) => {
  if (ctx.pipeline && Array.isArray(ctx.pipeline.nodes) && !ctx.pipeline.stages) return consigneDuGraphe(stage, ctx);
  // Un stage qui ne lit pas les fichiers qu'écrit l'approbation ne trouverait jamais rien,
  // et chaque tour repartirait sans consigne sans que rien ne le signale. On le refuse
  // avant de payer le moindre agent.
  const approbations = ((ctx.pipeline && ctx.pipeline.stages) || []).filter(
    (s) => s.type === "approval"
  );
  for (const a of approbations) {
    if (a.decisions !== stage.decisions || a.plan_gele !== stage.plan_gele) {
      throw new Error(
        `Stage "${stage.id}" : lit ${stage.decisions} et ${stage.plan_gele}, mais le stage ` +
          `d'approbation "${a.id}" écrit ${a.decisions} et ${a.plan_gele}. ` +
          `La consigne ne serait jamais retrouvée.`
      );
    }
  }

  const dir = path.resolve(ctx.approvalsDir || ".");
  const dossier = approbations.length ? cleDossier(approbations[0]) : cleDossier(stage);
  const abandon = `npm run en-attente -- --abandonner ${dossier}`;
  const ecrire = (contenu) =>
    fs.writeFileSync(path.join(ctx.workspaceDir, stage.output), JSON.stringify(contenu, null, 2));

  const gele = store.lirePlan(dir, dossier);
  if (!gele) {
    ecrire({ consigne: null, raison: "aucun plan gelé : premier tour" });
    ctx.reporter.event("consigne:aucune", { stage: stage.id });
    return;
  }

  const registre = store.lireRegistre(dir, dossier);
  const etat = approval.evaluate({ actions: gele.actions || [], decisions: registre, auto: [] });

  if (etat.verdict === "ORIENTE") {
    ecrire({ consigne: etat.orientation, empreinte: etat.empreinte });
    ctx.reporter.event("consigne:reprise", {
      stage: stage.id,
      empreinte: etat.empreinte,
      caracteres: etat.orientation.length,
    });
    return;
  }

  // Relancer maintenant produirait un plan neuf, donc une empreinte neuve, et effacerait en
  // silence ce qui a été tranché ou ce qui attend de l'être. C'est la règle que portait le
  // cycle, « on ne replanifie jamais pendant qu'une décision est en cours », ramenée ici
  // parce qu'aucun cycle ne pilote ce pipeline.
  if (etat.verdict === "APPROUVE") {
    throw new Error(
      `Stage "${stage.id}" : le plan gelé ${etat.empreinte} est entièrement tranché. ` +
        `Rien à refaire : c'est lui que la suite consomme. ` +
        `Pour repartir de zéro malgré tout : ${abandon}.`
    );
  }
  throw new Error(
    `Stage "${stage.id}" : le plan gelé ${etat.empreinte} attend une décision` +
      (etat.perimee ? " (le registre porte sur un plan plus ancien)" : "") +
      `. Décider dans le cockpit, ou y écrire une consigne, avant de relancer. ` +
      `Pour abandonner ce plan : ${abandon}.`
  );
};

function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
}

// Boîte des décisions en attente. Un pipeline qui s'arrête sur une approbation l'écrit dans
// un terminal, ce que personne ne lit quand le run tourne sur une autre machine : il
// s'arrêterait, et l'attente durerait indéfiniment sans que rien ne le signale.
//
// La boîte est un état, sans transport. Le cockpit, le canal d'alerte et `en-attente` en
// sont trois lecteurs, et choisir l'un n'interdit pas les autres. La clé est le DOSSIER, pas
// le pipeline, et une entrée par dossier : relancer remplace la demande au lieu de l'empiler.
const majInbox = (approvalsDir, dossier, entree) => store.deposer(approvalsDir, dossier, entree);

// Approbation humaine des actions sensibles. Ce stage NE PORTE PAS de gate, et c'est
// délibéré : un gate route son échec vers l'agent responsable pour qu'il le corrige, or
// aucun agent ne doit pouvoir faire apparaître une approbation. Une décision humaine
// absente n'est pas un défaut réparable, c'est un arrêt.
//
// Le stage s'interrompt donc, en écrivant l'état complet pour que la reprise soit
// possible et auditable. Le registre de décisions vit hors du workspace : il survit à la
// destruction du dossier de travail, et aucun agent n'y a accès.
handlers.approval = async (stage, ctx) => {
  const { actions } = readJson(ctx.workspaceDir, stage.actions);
  const dir = path.resolve(ctx.approvalsDir || ".");
  const dossier = cleDossier(stage);
  const decisions = store.lireRegistre(dir, dossier);

  const etat = approval.evaluate({ actions, decisions, auto: stage.auto });
  fs.writeFileSync(
    path.join(ctx.workspaceDir, stage.output),
    JSON.stringify(etat, null, 2)
  );
  ctx.reporter.event("approval:evaluated", {
    stage: stage.id,
    verdict: etat.verdict,
    executables: etat.executables.length,
    en_attente: etat.en_attente.length,
    refusees: etat.refusees.length,
  });

  if (etat.orphelines.length > 0) {
    ctx.reporter.event("approval:orphelines", { stage: stage.id, ids: etat.orphelines });
  }

  // Le registre laissé par un cycle précédent porte l'empreinte de SON plan. Dès que le
  // planificateur en produit un autre, ce registre est caduc, et c'est le cas NORMAL au
  // deuxième tour, pas une anomalie.
  //
  // Ce stage refusait ici sans rien déposer, et ça condamnait toute la suite : boîte
  // vide, donc rien à décider dans le cockpit, aucune alerte, et un cron qui repaye le
  // planificateur à chaque réveil sans que rien n'avance jamais. Le message disait
  // « redécider dans le registre » en désignant un plan gelé qui n'existait pas.
  // Constaté en relançant la planification après un cycle complet.
  //
  // Le refus d'EXÉCUTER reste entier : les décisions périmées sont ignorées et toutes
  // les actions repartent en attente. Ce qui change, c'est qu'un plan neuf se dépose et
  // s'attend comme un premier. On ne s'arrête sec que s'il n'y a rien à faire attendre.
  if (etat.perimee && etat.en_attente.length === 0) {
    throw new Error(
      `Stage "${stage.id}" : le plan a changé depuis la décision : ` +
        `approuvé pour "${etat.perimee.trouve}", proposé maintenant "${etat.perimee.attendu}". ` +
        `Aucune action n'est exécutable. Relire le nouveau plan et redécider dans le cockpit (dossier "${dossier}").`
    );
  }

  // L'opérateur a répondu en texte libre plutôt que par oui ou non. Le plan repart au
  // travail avec sa consigne, et rien ne s'exécute : `executables` est vide côté juge.
  //
  // Ce bloc doit passer AVANT celui des actions en attente. La liste `en_attente` est
  // remplie indépendamment du verdict, donc laisser l'autre bloc parler en premier
  // lèverait son exception et la consigne ne serait jamais déposée.
  //
  // La consigne n'a pas besoin d'être effacée du registre : elle porte sur CE plan-là.
  // Dès que le planificateur en produit un autre, l'empreinte change, le registre
  // devient périmé et le juge annule l'orientation. Elle expire donc d'elle-même, par
  // le même mécanisme qui protège les approbations.
  if (etat.verdict === "ORIENTE") {
    const cible = stage.orientation || "orientation.json";
    durable.ecrireJson(path.join(ctx.workspaceDir, cible), {
      empreinte: etat.empreinte,
      recue_le: new Date(maintenant(ctx)).toISOString(),
      consigne: etat.orientation,
    });
    ctx.reporter.event("approval:oriente", {
      stage: stage.id,
      empreinte: etat.empreinte,
      caracteres: etat.orientation.length,
    });

    // La demande sort de la boîte : quelqu'un a répondu, elle n'attend plus personne.
    // L'y laisser ferait afficher au cockpit une décision déjà prise, et c'est la
    // meilleure façon de faire ignorer les vraies.
    if (stage.dossier) majInbox(dir, stage.dossier, null);

    throw new Error(
      `Stage "${stage.id}" : réponse libre reçue, le plan "${etat.empreinte}" repart au travail.\n` +
        `Consigne : ${etat.orientation}\n` +
        `Déposée dans ${cible}. Aucune action n'est exécutée, y compris les automatiques. ` +
        `Replanifier en tenant compte de cette consigne.`
    );
  }

  if (etat.en_attente.length > 0) {
    // GEL. Sans lui, le run suivant replanifierait, produirait une autre empreinte, et
    // l'approbation qu'on est en train de demander ne couvrirait déjà plus rien. Un
    // modèle ne redonne pas deux fois le même plan : le cycle ne pourrait jamais
    // aboutir. On fige donc le texte exact qui sera soumis, et c'est lui qui
    // s'exécutera.
    const gele = Boolean(stage.plan_gele);
    if (gele) {
      store.gelerPlan(dir, dossier, {
        empreinte: etat.empreinte,
        gele_le: new Date(maintenant(ctx)).toISOString(),
        actions,
      });
      ctx.reporter.event("approval:gel", { stage: stage.id, empreinte: etat.empreinte });
    }

    if (stage.dossier) {
      majInbox(dir, stage.dossier, {
        empreinte: etat.empreinte,
        depuis: new Date(maintenant(ctx)).toISOString(),
        actions: etat.en_attente.length,
        appliquer_avec: stage.appliquer_avec || null,
      });
    }

    const liste = etat.en_attente
      .map((a) => (a.question ? `  ${a.id} : ${a.question}` : `  ${a.id} : ${a.type} sur ${a.cible} → ${JSON.stringify(a.valeur)}`))
      .join("\n");
    // Quand le registre est caduc, le dire AVANT la liste : sans ça, le message annonce
    // des actions à décider sans expliquer pourquoi une décision déjà prise ne compte pas.
    const entete = etat.perimee
      ? `Stage "${stage.id}" : le plan a changé depuis la décision précédente : ` +
        `approuvé pour "${etat.perimee.trouve}", proposé maintenant "${etat.perimee.attendu}". ` +
        `L'ancienne décision ne vaut plus rien.\n` +
        `${etat.en_attente.length} action(s) attendent ton approbation.\n`
      : `Stage "${stage.id}" : ${etat.en_attente.length} action(s) attendent ton approbation.\n`;

    throw new Error(
      entete +
        `${liste}\n` +
        `Décider dans le cockpit : dossier "${dossier}", "plan": "${etat.empreinte}".` +
        (gele
          ? `\nLe plan est gelé dans le store des approbations : c'est lui que la suite consomme, à l'identique. ` +
            `Relancer ce pipeline produirait un autre plan.`
          : "\nPuis relancer.")
    );
  }

  // Rien n'attend de décision : le plan était vide, ou toutes ses actions sont tranchées.
  // La demande sort de la boîte. Sans ça, une attente résolue y resterait, et un cockpit
  // finirait par afficher des demandes déjà traitées, ce qui est la façon la plus sûre de
  // faire ignorer les vraies.
  if (!stage.dossier) return;
  majInbox(dir, stage.dossier, null);
};

// La validation descend avec le handler : le chargeur du moteur ne connaît pas "output".
// Une faute de frappe doit exploser au chargement, pas après un run payé.
const validators = {
  approval: (stage, fail) => {
    for (const champ of ["actions", "decisions", "output"]) {
      if (!stage[champ]) fail(`type "approval" sans "${champ}"`);
    }
    // "auto" est la liste des types d'action dispensés d'approbation. Absente, TOUT
    // demande approbation, ce qui est le défaut voulu. Mais une valeur mal typée
    // (une chaîne au lieu d'un tableau) serait parcourue caractère par caractère et
    // ne dispenserait rien en silence : on la rejette au chargement.
    if (stage.auto !== undefined) {
      if (!Array.isArray(stage.auto) || stage.auto.some((t) => typeof t !== "string")) {
        fail('"auto" doit être un tableau de chaînes (types d\'action sans approbation)');
      }
    }
    if (stage.gate) {
      fail(
        'un stage "approval" ne porte pas de gate : une approbation absente n\'est pas ' +
          "un défaut qu'un agent peut corriger, et lui router l'échec lui donnerait " +
          "un moyen de la contourner"
      );
    }
  },


  consigne: (stage, fail) => {
    for (const champ of ["decisions", "plan_gele", "output"]) {
      if (!stage[champ]) fail(`type "consigne" sans "${champ}"`);
    }
    if (stage.gate) {
      fail(
        'un stage "consigne" ne porte pas de gate : il ne produit aucun travail à juger, ' +
          "il relit une décision humaine, et router son résultat à un agent lui donnerait " +
          "un moyen de la renégocier"
      );
    }
  },

  "verify-couverture": (stage, fail) => {
    for (const champ of ["report", "questions_from", "owner", "output"]) {
      if (!stage[champ]) fail(`type "verify-couverture" sans "${champ}"`);
    }
    // `against` porte les analyses dont les constats forment l'univers du contrôle. Une
    // chaîne au lieu d'un tableau serait parcourue caractère par caractère : l'univers
    // serait vide, et le contrôle passerait au vert sans rien avoir vérifié.
    if (
      !Array.isArray(stage.against) ||
      stage.against.length === 0 ||
      stage.against.some((f) => typeof f !== "string")
    ) {
      fail('type "verify-couverture" : "against" doit être un tableau non vide de fichiers');
    }
  },

};

module.exports = { handlers, validators, financeDisponible, financeHandlerNames };
