const fs = require("fs");
const path = require("path");
const ebay = require("./ebay");
const approval = require("./approval");
const execute = require("./execute");
const stats = require("./stats");
// Les fichiers d'approbation survivent au run : ils s'écrivent atomiquement et se lisent
// avec un message qui nomme le fichier fautif. Voir src/durable.js.
const durable = require("./durable");

// Les sources sont un registre, pas une suite de `if` : ajouter Amazon ou TikTok plus tard
// se fait ici, sans toucher au handler ni au moteur.
const SOURCES = { ebay: ebay.search };

// Horloge injectable. Une péremption qui se teste en attendant vraiment trois heures ne
// se teste pas : le test la ferait avancer, ou ne la couvrirait jamais.
const maintenant = (ctx) => (ctx.maintenant ? ctx.maintenant() : Date.now());
const HEURE = 3600 * 1000;

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

    // Les annonces du vendeur sont récupérées à part, une par une, jamais espérées dans
    // le résultat de la recherche. Une recherche rend les annonces les plus pertinentes
    // pour une requête, pas les siennes : elles peuvent se trouver au-delà de la page
    // lue, et un sandbox fraîchement publié ne les indexe pas du tout. Comme le plan n'a
    // le droit de cibler que ces annonces-là, les obtenir par hasard n'est pas tenable.
    //
    // Elles restent hors de `collecte` : les mêler au marché ferait calculer une médiane
    // qui contient déjà son propre prix, donc un alignement sur soi-même.
    let miennes = { annonces: [], introuvables: [] };
    if (stage.mine_from) {
      const ids = ctx.spec[stage.mine_from] || [];
      miennes = await ebay.parIds({
        ids,
        env: ctx.env,
        transport: (ctx.transports || {})[stage.source],
      });
      if (miennes.introuvables.length) {
        ctx.reporter.event("fetch:introuvables", {
          stage: stage.id,
          ids: miennes.introuvables,
        });
      }
    }

    // L'heure de collecte suit la donnée partout : c'est elle, et non le moment du gel
    // ni celui de l'exécution, qui dit si un plan bâti dessus est encore valable.
    fs.writeFileSync(
      path.join(ctx.workspaceDir, stage.output),
      JSON.stringify(
        {
          ...data,
          mes_annonces: miennes.annonces,
          mes_annonces_introuvables: miennes.introuvables,
          collecte_le: new Date(maintenant(ctx)).toISOString(),
        },
        null,
        2
      )
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

  // Contrôle arithmétique. Sortir le calcul de l'agent ne suffit pas : rien ne l'empêche
  // de recalculer dans son coin et de citer son propre résultat. Chaque affirmation
  // chiffrée doit donc nommer la clé de `stats.json` dont elle vient, et la valeur citée
  // est recomparée à la valeur calculée.
  //
  // Le contrôle ne s'active que si le stage déclare `stats` : un pipeline qui n'a rien à
  // chiffrer n'a pas à porter cette contrainte.
  if (stage.stats) {
    const calcul = readJson(ctx.workspaceDir, stage.stats);

    for (const reponse of reponses) {
      const citees = reponse.valeurs || [];

      // Une réponse qui contient un chiffre sans rien citer est exactement le cas qui a
      // laissé passer une médiane fausse : plausible, sourcée, invérifiable.
      if (citees.length === 0 && /\d/.test(String(reponse.reponse || ""))) {
        manques.push({
          component: stage.owner,
          question: reponse.question,
          raison: "affirmation chiffrée sans valeur citée : renseigne `valeurs` avec les clés de stats.json",
        });
        continue;
      }

      for (const citee of citees) {
        const attendue = stats.valeurAu(calcul, citee.cle);
        if (attendue === undefined) {
          manques.push({
            component: stage.owner,
            question: reponse.question,
            raison: `clé "${citee.cle}" absente de stats.json`,
          });
        } else if (JSON.stringify(attendue) !== JSON.stringify(citee.valeur)) {
          manques.push({
            component: stage.owner,
            question: reponse.question,
            raison: `valeur citée pour "${citee.cle}" : ${JSON.stringify(citee.valeur)}, calculée : ${JSON.stringify(attendue)}`,
          });
        }
      }
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

// Le type de stage `stats` : tout ce qui se calcule, calculé avant l'agent.
//
// Un modèle qui trie 35 prix et prend la 19e valeur au lieu de la 18e produit une médiane
// fausse d'un dollar, parfaitement sourcée et parfaitement plausible. C'est arrivé au
// premier run réel. Le remède n'est pas un meilleur prompt : l'arithmétique sort de
// l'agent, qui reçoit des nombres déjà justes et se limite à les interpréter.
handlers.stats = async (stage, ctx) => {
  const listings = readJson(ctx.workspaceDir, stage.against);
  const calcul = stats.statistiques(listings);
  fs.writeFileSync(
    path.join(ctx.workspaceDir, stage.output),
    JSON.stringify(calcul, null, 2)
  );
  ctx.reporter.event("stats:done", {
    stage: stage.id,
    annonces: calcul.n,
    devise: calcul.devise_unique,
  });
};

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

function readJson(dir, file) {
  return JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
}

// Boîte durable des décisions en attente. Un pipeline qui s'arrête sur une approbation
// l'écrit dans un terminal, ce que personne ne lit quand le run est déclenché par un cron
// sur un NAS : il s'arrêterait, et l'attente durerait indéfiniment sans que rien ne le
// signale.
//
// Cette boîte est délibérément un simple fichier, sans transport. Prévenir par Telegram,
// par mail ou via un cockpit sont alors trois LECTEURS du même état, et choisir l'un
// n'interdit pas les autres. Coupler l'arrêt à un transport figerait ce choix dans le
// code qui garde l'argent.
const INBOX = "EN-ATTENTE.json";

function lireInbox(approvalsDir) {
  return durable.lireJson(path.join(approvalsDir, INBOX)) || { en_attente: [] };
}

// La clé est le DOSSIER, pas le pipeline : la demande est créée par la planification et
// consommée par l'application, deux pipelines différents. Keyer par pipeline laisserait
// l'entrée pour toujours, puisque le pipeline qui l'a créée n'est pas celui qui la résout.
//
// Une entrée par dossier : replanifier remplace la demande au lieu de l'empiler, sinon la
// boîte se remplirait de demandes portant sur des plans qui n'existent plus.
function majInbox(approvalsDir, dossier, entree) {
  const boite = lireInbox(approvalsDir);
  boite.en_attente = boite.en_attente.filter((e) => e.dossier !== dossier);
  if (entree) boite.en_attente.push({ dossier, ...entree });
  durable.ecrireJson(path.join(approvalsDir, INBOX), boite);
  return boite;
}

// Trace d'une planification qui n'a rien proposé.
//
// Une planification stérile n'est ni un succès ni une panne : le planificateur a lu le
// marché et conclu qu'aucun ajustement n'était justifié. Le pipeline se termine bien, la
// boîte reste vide, et le réveil suivant repart donc planifier — en repayant l'agent pour
// obtenir le même rien. À un quart d'heure d'intervalle, un marché durablement sans repère
// coûte une dizaine de dollars par jour sans qu'aucune ligne de journal ne signale un
// problème, puisqu'il n'y en a pas.
//
// Ce fichier est ce qui permet au cycle de s'en souvenir. Il n'exprime pas un échec : il
// date le constat, pour que la retenue ait une origine plutôt qu'une durée en l'air.
const RETENUE = (dossier) => `${dossier}.retenue.json`;

function marquerRetenue(approvalsDir, dossier, { le, collecte_le }) {
  durable.ecrireJson(path.join(approvalsDir, RETENUE(dossier)), {
    dossier,
    le,
    collecte_le: collecte_le || null,
    raison: "la planification n'a proposé aucune action",
  });
}

// Dès qu'une planification propose quelque chose, la retenue n'a plus lieu d'être. La
// lever ici plutôt qu'au réveil suivant garde la décision du cycle lisible : il lit un
// état, il ne répare pas celui qu'un run précédent aurait laissé de travers.
function leverRetenue(approvalsDir, dossier) {
  const chemin = path.join(approvalsDir, RETENUE(dossier));
  if (fs.existsSync(chemin)) fs.unlinkSync(chemin);
}

// Contrôle déterministe d'un plan d'actions, AVANT qu'il parte à l'approbation.
// Approuver un plan qui vise des annonces inexistantes ne protège de rien : l'humain
// lirait une ligne plausible pour une cible qui n'existe pas. Celui-ci porte un gate,
// contrairement à l'approbation : un plan mal formé est bien un défaut réparable par
// l'agent qui l'a produit.
handlers["verify-actions"] = async (stage, ctx) => {
  const { actions } = readJson(ctx.workspaceDir, stage.actions);
  const listings = readJson(ctx.workspaceDir, stage.against);
  // Le marché ET les annonces du vendeur : une cible légitime vit dans le second
  // ensemble, qui n'est jamais dans le premier par construction.
  const connus = new Set([
    ...listings.collecte.map((a) => a.id),
    ...(listings.mes_annonces || []).map((a) => a.id),
  ]);

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
  const decisions = durable.lireJson(registrePath);

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
        `Aucune action n'est exécutable. Relire le nouveau plan et redécider dans ${registrePath}.`
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
    if (stage.dossier) majInbox(path.resolve(ctx.approvalsDir || "."), stage.dossier, null);

    throw new Error(
      `Stage "${stage.id}" : réponse libre reçue, le plan "${etat.empreinte}" repart au travail.\n` +
        `Consigne : ${etat.orientation}\n` +
        `Déposée dans ${cible}. Aucune action n'est exécutée, y compris les automatiques. ` +
        `Replanifier en tenant compte de cette consigne.`
    );
  }

  if (etat.en_attente.length > 0) {
    // Un plan est né : ce qui avait été constaté stérile ne l'est plus.
    if (stage.dossier) leverRetenue(path.resolve(ctx.approvalsDir || "."), stage.dossier);

    // GEL. Sans lui, le run suivant replanifierait, produirait une autre empreinte, et
    // l'approbation qu'on est en train de demander ne couvrirait déjà plus rien. Un
    // modèle ne redonne pas deux fois le même plan : le cycle ne pourrait jamais
    // aboutir. On fige donc le texte exact qui sera soumis, et c'est lui qui
    // s'exécutera.
    let gele = null;
    if (stage.plan_gele) {
      const collecte = stage.collecte
        ? readJson(ctx.workspaceDir, stage.collecte).collecte_le || null
        : null;
      gele = path.resolve(ctx.approvalsDir || ".", stage.plan_gele);
      durable.ecrireJson(gele, {
        empreinte: etat.empreinte,
        gele_le: new Date(maintenant(ctx)).toISOString(),
        collecte_le: collecte,
        actions,
      });
      ctx.reporter.event("approval:gel", { stage: stage.id, empreinte: etat.empreinte });
    }

    if (stage.dossier) {
      majInbox(path.resolve(ctx.approvalsDir || "."), stage.dossier, {
        empreinte: etat.empreinte,
        depuis: new Date(maintenant(ctx)).toISOString(),
        actions: etat.en_attente.length,
        registre: registrePath,
        plan_gele: gele,
        appliquer_avec: stage.appliquer_avec || null,
      });
    }

    const liste = etat.en_attente
      .map((a) => `  ${a.id} : ${a.type} sur ${a.cible} → ${JSON.stringify(a.valeur)}`)
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
        `Décider dans ${registrePath}, avec "plan": "${etat.empreinte}" et une entrée ` +
        `{ "action_id", "decision": "approuve" | "refuse" } par action.` +
        (gele
          ? `\nLe plan est gelé dans ${gele} : c'est lui qui sera appliqué, à l'identique. ` +
            `Lancer ensuite le pipeline d'application, pas celui-ci.`
          : "\nPuis relancer.")
    );
  }

  // Rien n'attend de décision, et deux situations très différentes mènent ici.
  //
  // Le plan portait des actions, toutes déjà tranchées : la demande a fait son travail et
  // sort de la boîte. Sans ça, une attente résolue y resterait, et un cockpit finirait par
  // afficher des demandes déjà traitées, ce qui est la façon la plus sûre de faire ignorer
  // les vraies.
  //
  // Ou le plan était vide : le planificateur n'a rien trouvé à proposer. La boîte n'a rien
  // à perdre, mais le cycle a quelque chose à apprendre, sans quoi il repaiera ce constat
  // tous les quarts d'heure. On le date.
  if (!stage.dossier) return;
  const dir = path.resolve(ctx.approvalsDir || ".");
  majInbox(dir, stage.dossier, null);
  if (actions.length === 0) {
    const collecte = stage.collecte
      ? readJson(ctx.workspaceDir, stage.collecte).collecte_le || null
      : null;
    marquerRetenue(dir, stage.dossier, {
      le: new Date(maintenant(ctx)).toISOString(),
      collecte_le: collecte,
    });
    ctx.reporter.event("approval:sterile", { stage: stage.id, dossier: stage.dossier });
  } else {
    leverRetenue(dir, stage.dossier);
  }
};

// Ressuscite le plan gelé dans le workspace du run d'application. Aucun agent n'est
// impliqué : le plan a déjà été produit et vérifié, le rejouer coûterait des tokens pour
// obtenir un texte différent, donc non approuvé.
//
// C'est aussi ici que se juge la PÉREMPTION. Un plan bâti sur un marché observé lundi
// n'a plus de sens jeudi : les prix approuvés portent sur des données mortes. Le gel
// rend ce risque visible, ce stage le rend refusable. La référence est l'heure de
// COLLECTE, pas celle du gel : c'est la donnée qui vieillit, pas la décision.
handlers.charger = async (stage, ctx) => {
  const gele = path.resolve(ctx.approvalsDir || ".", stage.plan_gele);
  if (!fs.existsSync(gele)) {
    throw new Error(
      `Stage "${stage.id}" : aucun plan gelé dans ${gele}. ` +
        `Lancer d'abord le pipeline de planification, qui le produira.`
    );
  }

  const plan = JSON.parse(fs.readFileSync(gele, "utf-8"));
  const reference = plan.collecte_le || plan.gele_le;

  if (stage.max_age_heures !== undefined) {
    if (!reference) {
      throw new Error(
        `Stage "${stage.id}" : le plan gelé ne porte aucune date, sa fraîcheur est ` +
          `invérifiable. Refusé plutôt qu'appliqué à l'aveugle.`
      );
    }
    const age = (maintenant(ctx) - Date.parse(reference)) / HEURE;
    if (age > stage.max_age_heures) {
      throw new Error(
        `Stage "${stage.id}" : plan périmé. Données collectées il y a ${age.toFixed(1)} h, ` +
          `le maximum déclaré est ${stage.max_age_heures} h. ` +
          `Relancer la planification : le marché a bougé depuis, et les montants approuvés ` +
          `portent sur des données mortes.`
      );
    }
    ctx.reporter.event("charger:fraicheur", {
      stage: stage.id,
      age_heures: Number(age.toFixed(2)),
      max: stage.max_age_heures,
    });
  }

  fs.writeFileSync(
    path.join(ctx.workspaceDir, stage.output),
    JSON.stringify({ actions: plan.actions }, null, 2)
  );
  ctx.reporter.event("charger:done", {
    stage: stage.id,
    empreinte: plan.empreinte,
    actions: plan.actions.length,
  });
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
  const ledger = durable.lireJson(ledgerPath) || { executees: [] };

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
    // Écrit action par action, donc interrompu au milieu du lot dans le cas normal. Une
    // écriture directe y laisserait un ledger tronqué, et un ledger illisible fait rejouer
    // un changement de prix déjà appliqué : c'est le fichier qui porte l'idempotence.
    durable.ecrireJson(ledgerPath, ledger);
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

  charger: (stage, fail) => {
    for (const champ of ["plan_gele", "output"]) {
      if (!stage[champ]) fail(`type "charger" sans "${champ}"`);
    }
    // Une péremption absente est un choix, une péremption mal typée est un piège : une
    // chaîne passerait la comparaison numérique de façon imprévisible.
    if (stage.max_age_heures !== undefined) {
      if (typeof stage.max_age_heures !== "number" || stage.max_age_heures <= 0) {
        fail('"max_age_heures" doit être un nombre positif');
      }
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

  stats: (stage, fail) => {
    for (const champ of ["against", "output"]) {
      if (!stage[champ]) fail(`type "stats" sans "${champ}"`);
    }
    if (stage.gate) {
      fail(
        'un stage "stats" ne porte pas de gate : un calcul déterministe sur une collecte ' +
          "donnée n'a pas de verdict à rendre, et router son résultat à un agent lui " +
          "redonnerait la main sur des nombres qu'on lui a précisément retirés"
      );
    }
  },

  verify: (stage, fail) => {
    for (const champ of ["report", "against", "questions_from", "owner", "output"]) {
      if (!stage[champ]) fail(`type "verify" sans "${champ}"`);
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
    if (stage.mine_from !== undefined && typeof stage.mine_from !== "string") {
      fail('"mine_from" doit nommer un champ du spec, sous forme de chaîne');
    }
  },
};

module.exports = { handlers, validators, SOURCES };
