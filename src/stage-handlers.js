const fs = require("fs");
const path = require("path");
const ebay = require("./ebay");
const approval = require("./approval");
const execute = require("./execute");

// Les sources sont un registre, pas une suite de `if` : ajouter Amazon ou TikTok plus tard
// se fait ici, sans toucher au handler ni au moteur.
const SOURCES = { ebay: ebay.search };

// Le type de stage `fetch` : collecte déterministe depuis une API officielle, écrite dans
// le workspace pour que les stages d'agents la lisent comme n'importe quel artefact.
//
// C'est le point clé de cette architecture. L'appel externe ne coûte aucun token, il est
// reproductible, et il est le SEUL endroit qui parle au monde extérieur. Un agent ne
// touche jamais une API : il lit un fichier et écrit un fichier. Tout ce que le moteur
// sait déjà faire (gates, routage, budget, schémas) s'applique donc sans modification.
const handlers = {
  fetch: async (stage, ctx) => {
    const source = SOURCES[stage.source];
    if (!source) {
      throw new Error(
        `Stage "${stage.id}" : source inconnue "${stage.source}", ` +
          `déclarées : ${Object.keys(SOURCES).join(", ")}`
      );
    }

    // La requête vient du spec, pas du pipeline : le pipeline décrit la forme de la
    // veille, le spec décrit sur quoi elle porte. Changer de marché ne doit pas
    // demander de toucher au pipeline.
    const query = ctx.spec[stage.query_from];
    if (!query) {
      throw new Error(
        `Stage "${stage.id}" : le spec n'a pas de champ "${stage.query_from}" pour la requête`
      );
    }

    ctx.reporter.event("fetch:start", { stage: stage.id, source: stage.source });
    const data = await source({
      query,
      limit: stage.limit,
      env: ctx.env,
      // Injection de transport pour les tests. Absent en production, donc fetch natif.
      transport: (ctx.transports || {})[stage.source],
    });

    fs.writeFileSync(
      path.join(ctx.workspaceDir, stage.output),
      JSON.stringify(data, null, 2)
    );
    ctx.reporter.event("fetch:done", {
      stage: stage.id,
      source: stage.source,
      items: data.collecte.length,
    });
  },
};

// Le juge du pipeline, et il est déterministe. Un agent ne peut pas négocier avec du
// code : c'est la même leçon que la garde RLS du générateur de SaaS et que `must_change`
// dans le moteur. Faire décider l'analyste de son propre verdict reviendrait à lui faire
// noter sa copie, et un rapport auto-déclaré "COMPLETE" ne prouve rien.
//
// Deux contrôles, tous deux impossibles à contourner par de la prose :
//   couverture : chaque question du spec est traitée, dans un tableau ou dans l'autre
//   traçabilité : chaque source citée existe vraiment dans la collecte
function verifier(stage, ctx) {
  const rapport = readJson(ctx.workspaceDir, stage.report);
  const listings = readJson(ctx.workspaceDir, stage.against);
  const connus = new Set(listings.collecte.map((a) => a.id));

  const reponses = rapport.reponses || [];
  const declarees = rapport.questions_sans_reponse || [];
  const traitees = new Set([
    ...reponses.map((r) => r.question),
    ...declarees.map((q) => q.question),
  ]);

  const manques = [];

  for (const question of ctx.spec[stage.questions_from]) {
    if (!traitees.has(question)) {
      manques.push({
        component: stage.owner,
        question,
        raison: "question non traitée : absente des réponses comme des questions sans réponse",
      });
    }
  }

  // Une source inventée est la faute qui rend tout le rapport inutilisable, puisque le
  // pipeline n'existe que pour produire des réponses vérifiables.
  for (const reponse of reponses) {
    const inventees = (reponse.sources || []).filter((id) => !connus.has(id));
    if (inventees.length > 0) {
      manques.push({
        component: stage.owner,
        question: reponse.question,
        raison: `sources absentes de la collecte : ${inventees.join(", ")}`,
      });
    }
    if ((reponse.sources || []).length === 0) {
      manques.push({
        component: stage.owner,
        question: reponse.question,
        raison: "réponse sans aucune source",
      });
    }
  }

  return {
    verdict: manques.length === 0 ? "COMPLETE" : "INCOMPLETE",
    questions_attendues: ctx.spec[stage.questions_from].length,
    reponses_sourcees: reponses.length,
    manques,
  };
}

handlers.verify = async (stage, ctx) => {
  const verdict = verifier(stage, ctx);
  fs.writeFileSync(
    path.join(ctx.workspaceDir, stage.output),
    JSON.stringify(verdict, null, 2)
  );
  ctx.reporter.event("verify:done", {
    stage: stage.id,
    verdict: verdict.verdict,
    manques: verdict.manques.length,
  });
};

function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
}

// Contrôle déterministe d'un plan d'actions, AVANT qu'il parte à l'approbation.
// Approuver un plan qui vise des annonces inexistantes ne protège de rien : l'humain
// lirait une ligne plausible pour une cible qui n'existe pas. Celui-ci porte un gate,
// contrairement à l'approbation : un plan mal formé est bien un défaut réparable par
// l'agent qui l'a produit.
handlers["verify-actions"] = async (stage, ctx) => {
  const { actions } = readJson(ctx.workspaceDir, stage.actions);
  const listings = readJson(ctx.workspaceDir, stage.against);
  const connus = new Set(listings.collecte.map((a) => a.id));

  const manques = [];
  const vus = new Set();

  for (const [i, action] of actions.entries()) {
    const situe = action.id || `action #${i + 1}`;
    for (const champ of ["id", "type", "cible", "valeur"]) {
      if (action[champ] === undefined || action[champ] === "") {
        manques.push({ component: stage.owner, action: situe, raison: `champ "${champ}" absent` });
      }
    }
    // Deux actions sous le même id rendraient toute décision ambiguë : approuver l'une
    // approuverait l'autre, puisque le registre est indexé par id.
    if (action.id && vus.has(action.id)) {
      manques.push({ component: stage.owner, action: situe, raison: "id dupliqué" });
    }
    if (action.id) vus.add(action.id);

    if (action.cible && !connus.has(action.cible)) {
      manques.push({
        component: stage.owner,
        action: situe,
        raison: `cible "${action.cible}" absente de la collecte`,
      });
    }
  }

  fs.writeFileSync(
    path.join(ctx.workspaceDir, stage.output),
    JSON.stringify(
      { verdict: manques.length === 0 ? "VALIDE" : "INVALIDE", actions_lues: actions.length, manques },
      null,
      2
    )
  );
  ctx.reporter.event("verify-actions:done", {
    stage: stage.id,
    actions: actions.length,
    manques: manques.length,
  });
};

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
  const registrePath = path.resolve(ctx.approvalsDir || ".", stage.decisions);
  const decisions = fs.existsSync(registrePath)
    ? JSON.parse(fs.readFileSync(registrePath, "utf-8"))
    : null;

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

  if (etat.perimee) {
    throw new Error(
      `Stage "${stage.id}" : le plan a changé depuis la décision : ` +
        `approuvé pour "${etat.perimee.trouve}", proposé maintenant "${etat.perimee.attendu}". ` +
        `Aucune action n'est exécutable. Relire le nouveau plan et redécider dans ${registrePath}.`
    );
  }

  if (etat.en_attente.length > 0) {
    const liste = etat.en_attente
      .map((a) => `  ${a.id} : ${a.type} sur ${a.cible} → ${JSON.stringify(a.valeur)}`)
      .join("\n");
    throw new Error(
      `Stage "${stage.id}" : ${etat.en_attente.length} action(s) attendent ton approbation.\n` +
        `${liste}\n` +
        `Décider dans ${registrePath}, avec "plan": "${etat.empreinte}" et une entrée ` +
        `{ "action_id", "decision": "approuve" | "refuse" } par action, puis relancer.`
    );
  }
};

// Exécution des actions approuvées. Comme `approval`, ce stage ne porte pas de gate :
// un échec d'API n'est pas un défaut qu'un agent peut corriger, et l'y router
// déclencherait une replanification, laquelle invaliderait l'approbation et réclamerait
// une nouvelle décision humaine. Boucle sans fin garantie. Le stage s'arrête.
//
// Le ledger vit hors du workspace, pour la même raison que le registre de décisions :
// le workspace est réécrit à chaque run, donc un ledger rangé là ne garantirait aucune
// idempotence d'un run à l'autre, c'est-à-dire aucune.
handlers.execute = async (stage, ctx) => {
  const approbation = readJson(ctx.workspaceDir, stage.approval);
  const { actions } = readJson(ctx.workspaceDir, stage.actions);

  const ledgerPath = path.resolve(ctx.approvalsDir || ".", stage.ledger);
  const ledger = fs.existsSync(ledgerPath)
    ? JSON.parse(fs.readFileSync(ledgerPath, "utf-8"))
    : { executees: [] };

  const plan = execute.preparer({ approbation, actions, ledger });

  const rapport = (etat) => {
    fs.writeFileSync(path.join(ctx.workspaceDir, stage.output), JSON.stringify(etat, null, 2));
    return etat;
  };

  if (plan.bloquant) {
    rapport({ verdict: "REFUSE", raison: plan.bloquant, reussies: [], deja: [] });
    throw new Error(`Stage "${stage.id}" : ${plan.bloquant}`);
  }

  ctx.reporter.event("execute:plan", {
    stage: stage.id,
    a_faire: plan.aFaire.length,
    deja: plan.deja.length,
    ecartees: plan.ecartees.length,
  });

  // Consigné action par action, immédiatement : un processus tué au milieu du lot doit
  // laisser une trace exacte de ce qui a eu lieu.
  const consigner = async (trace) => {
    ledger.executees = [...(ledger.executees || []), { ...trace, empreinte: plan.empreinte }];
    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  };

  const { reussies, echecs, arret } = await execute.executer({
    aFaire: plan.aFaire,
    executeurs: ctx.executeurs || {},
    empreinte: plan.empreinte,
    contexte: { env: ctx.env, workspaceDir: ctx.workspaceDir },
    consigner,
    maxEchecsConsecutifs: stage.max_echecs_consecutifs,
  });

  // Trois issues distinctes, et elles ne se lisent pas pareil au réveil :
  //   EXECUTE    tout est passé
  //   PARTIEL    des cibles étaient perdues, le reste est fait. Pas une panne.
  //   INTERROMPU le lot a été coupé, il reste des actions approuvées non tentées.
  const verdict = arret ? "INTERROMPU" : echecs.length > 0 ? "PARTIEL" : "EXECUTE";
  const etat = {
    verdict,
    empreinte: plan.empreinte,
    reussies,
    deja: plan.deja.map((a) => a.id),
    ecartees: plan.ecartees.map((a) => a.id),
    echecs,
    arret,
    non_tentees: arret
      ? plan.aFaire
          .map((a) => a.id)
          .filter((id) => !reussies.some((r) => r.id === id) && !echecs.some((e) => e.action === id))
      : [],
  };
  rapport(etat);
  ctx.reporter.event("execute:done", {
    stage: stage.id,
    verdict,
    reussies: reussies.length,
    echecs: echecs.length,
    arret: arret ? arret.nature : null,
  });

  // Une cible perdue n'est pas un run raté : c'est un système sain qui rencontre la
  // réalité. Faire échouer le run pour ça apprendrait à ignorer les échecs. Seul un
  // arrêt, qui laisse des actions approuvées non tentées, mérite de tout stopper.
  if (arret) {
    throw new Error(
      `Stage "${stage.id}" : lot interrompu (${arret.nature}) sur "${arret.action}".\n` +
        `${arret.raison}\n` +
        `${reussies.length} action(s) passée(s) et consignée(s), ${etat.non_tentees.length} non tentée(s). ` +
        `Une relance sautera les premières.`
    );
  }
};

// La validation descend avec le handler : le chargeur du moteur ne connaît ni "source"
// ni "output". Une faute de frappe doit exploser au chargement, pas après la collecte.
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

  execute: (stage, fail) => {
    for (const champ of ["approval", "actions", "ledger", "output"]) {
      if (!stage[champ]) fail(`type "execute" sans "${champ}"`);
    }
    if (stage.gate) {
      fail(
        'un stage "execute" ne porte pas de gate : un échec d\'API n\'est pas un défaut ' +
          "qu'un agent peut corriger, et l'y router ferait replanifier, ce qui " +
          "invaliderait l'approbation et réclamerait une nouvelle décision humaine"
      );
    }
  },

  verify: (stage, fail) => {
    for (const champ of ["report", "against", "questions_from", "owner", "output"]) {
      if (!stage[champ]) fail(`type "verify" sans "${champ}"`);
    }
  },

  "verify-actions": (stage, fail) => {
    for (const champ of ["actions", "against", "owner", "output"]) {
      if (!stage[champ]) fail(`type "verify-actions" sans "${champ}"`);
    }
  },

  fetch: (stage, fail) => {
    if (!stage.source) fail('type "fetch" sans "source"');
    if (stage.source && !SOURCES[stage.source]) {
      fail(`source inconnue "${stage.source}", déclarées : ${Object.keys(SOURCES).join(", ")}`);
    }
    if (!stage.query_from) fail('type "fetch" sans "query_from" (champ du spec à lire)');
    if (!stage.output) fail('type "fetch" sans "output" (fichier à écrire)');
    if (stage.limit !== undefined && (!Number.isInteger(stage.limit) || stage.limit <= 0)) {
      fail('"limit" doit être un entier positif');
    }
  },
};

module.exports = { handlers, validators, SOURCES };
