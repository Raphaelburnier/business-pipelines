const fs = require("fs");
const path = require("path");
const ebay = require("./ebay");

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
        `Stage "${stage.id}" : source inconnue "${stage.source}" — ` +
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
//   couverture — chaque question du spec est traitée, dans un tableau ou dans l'autre
//   traçabilité — chaque source citée existe vraiment dans la collecte
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

// La validation descend avec le handler : le chargeur du moteur ne connaît ni "source"
// ni "output". Une faute de frappe doit exploser au chargement, pas après la collecte.
const validators = {
  verify: (stage, fail) => {
    for (const champ of ["report", "against", "questions_from", "owner", "output"]) {
      if (!stage[champ]) fail(`type "verify" sans "${champ}"`);
    }
  },

  fetch: (stage, fail) => {
    if (!stage.source) fail('type "fetch" sans "source"');
    if (stage.source && !SOURCES[stage.source]) {
      fail(`source inconnue "${stage.source}" — déclarées : ${Object.keys(SOURCES).join(", ")}`);
    }
    if (!stage.query_from) fail('type "fetch" sans "query_from" (champ du spec à lire)');
    if (!stage.output) fail('type "fetch" sans "output" (fichier à écrire)');
    if (stage.limit !== undefined && (!Number.isInteger(stage.limit) || stage.limit <= 0)) {
      fail('"limit" doit être un entier positif');
    }
  },
};

module.exports = { handlers, validators, SOURCES };
