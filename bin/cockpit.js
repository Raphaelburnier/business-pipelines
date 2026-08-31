#!/usr/bin/env node
//
// Cockpit d'approbation. Une page qui lit la boîte de réception, montre les plans en
// attente et écrit les décisions.
//
// Elle n'écoute toujours QUE sur 127.0.0.1, et c'est maintenant une exigence, plus
// seulement une précaution. Le téléphone y accède par Tailscale, qui termine le TLS sur
// un vrai nom et relaie vers localhost. Tailscale n'injecte l'identité de l'appelant que
// si le service reste local : ouvrir l'écoute laisserait n'importe qui sur le réseau
// fabriquer cette identité. Le détail est dans src/acces.js.
//
// Les défenses, et l'incident que chacune vise :
//
//   - écoute loopback seule, plus le relais Tailscale au-dessus. Un cockpit d'approbation
//     joignable sans authentification est une porte ouverte sur le compte marchand ;
//   - liste blanche d'hôtes. Sans elle, un site visité dans le même navigateur fait
//     pointer un nom vers 127.0.0.1 et parle au serveur à ta place ;
//   - vérification de l'origine et du type de contenu sur les écritures. Tant que la page
//     n'était joignable qu'en loopback, aucun site tiers ne pouvait viser une URL stable.
//     Sous un nom de domaine réel, un formulaire hébergé ailleurs le peut, et un POST de
//     formulaire échappe au contrôle préalable CORS ;
//   - le corps de la requête ne fournit plus que le dossier, l'empreinte et les décisions.
//     Il était étalé tel quel dans l'appel à enregistrer(), donc il pouvait redéfinir
//     approvalsDir et faire écrire le registre n'importe où sur le disque. La liaison
//     loopback était tout ce qui empêchait ça ;
//   - la signature vient du canal, jamais du corps. Un champ texte libre laisse écrire
//     n'importe quel nom, y compris par distraction ;
//   - tout texte affiché est échappé. Les justifications sont écrites par un modèle, et
//     du texte de modèle rendu tel quel dans une page est une injection en attente ;
//   - aucune exception ne sort du gestionnaire. Il est `async`, donc ce qui en sortait
//     devenait une promesse rejetée que Node ne rattrape pas : le processus mourait. Une
//     boîte de réception tronquée tuait le cockpit à chaque requête, et systemd finissait
//     par renoncer à le relancer ;
//   - l'identifiant d'une action voyage dans un attribut de données, pas dans un nom de
//     champ à redécouper. Le découpage supposait qu'un nom de dossier tenait en un
//     segment, et rendait un autre identifiant dès qu'il portait un underscore.
const http = require("http");
const path = require("path");
const { envLoader } = require("agent-orchestrator");
const cockpit = require("../src/cockpit");
const acces = require("../src/acces");
const pwa = require("../src/pwa");

const RACINE = path.resolve(__dirname, "..");

// Le fichier d'abord, l'environnement du processus par-dessus, comme partout ailleurs
// dans le dépôt : un réglage passé à la main pour un essai doit l'emporter sur le fichier.
const ENV = { ...envLoader.load(RACINE, null, path.join(RACINE, "specs", "cockpit.env")), ...process.env };

const APPROVALS = ENV.APPROVALS_DIR || path.join(RACINE, "approvals");
const PIPELINES = path.join(RACINE, "pipelines");
const PORT = Number(ENV.COCKPIT_PORT || 4600);

// Le nom du tailnet est propre à une installation, donc il vient de l'environnement.
// Non renseigné, le cockpit reste exactement ce qu'il était : joignable en local seul.
const TAILNET = (ENV.COCKPIT_TAILNET || "").trim() || null;
const OPERATEUR = (ENV.COCKPIT_OPERATEUR_LOCAL || "").trim() || null;
const PORTEE = { port: PORT, tailnet: TAILNET };

// L'apostrophe est échappée elle aussi. Aucun attribut de cette page n'est écrit en
// guillemets simples aujourd'hui, donc rien n'en dépend : c'est le prochain attribut
// écrit ainsi qui deviendrait une injection, et une fonction d'échappement qui ne couvre
// que les cas actuels est un piège posé pour plus tard.
const ech = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function badge(f) {
  // `max_heures` est lu dans un fichier de pipelines/, pas calculé ici. Il traverse donc
  // la page comme du contenu de fichier, et tout contenu de fichier est échappé.
  if (f.verdict === "perime") {
    return `<span class="b rouge">périmé, ${ech(f.age_heures)} h sur ${ech(f.max_heures)} h</span>`;
  }
  if (f.verdict === "frais") {
    return `<span class="b vert">frais, ${ech(f.age_heures)} h sur ${ech(f.max_heures)} h</span>`;
  }
  const age = f.age_heures === null ? "date absente" : `${f.age_heures} h, maximum non déclaré`;
  return `<span class="b gris">fraîcheur inconnue, ${ech(age)}</span>`;
}

// Le nom du groupe radio est un compteur, et l'identifiant d'action voyage dans un
// attribut de données que le navigateur rend tel quel.
//
// Avant, le nom était `d_${dossier}_${id}` et le script le redécoupait sur les underscores
// en supposant que le dossier tenait en un segment. Un dossier nommé `ajustement_prix`
// renvoyait donc `prix_001` au lieu de `001`. Le cas heureux était un refus « action
// absente du plan gelé » ; le cas malheureux, un identifiant reconstruit qui correspond à
// une AUTRE action réelle, donc un changement de prix approuvé sans avoir été lu. Deux
// dossiers pouvaient aussi produire le même nom de groupe, et cocher dans l'un décochait
// dans l'autre.
function ligneAction(a, nom) {
  const v = a.valeur || {};
  const delta =
    // Une remise de 100 % depuis un prix de zéro n'existe pas : sans cette garde, la page
    // affichait « Infinity % ».
    typeof v.de === "number" && typeof v.vers === "number" && v.de !== 0
      ? `${v.de} → ${v.vers} ${ech(v.devise || "")} (${(((v.vers - v.de) / v.de) * 100).toFixed(1)} %)`
      : ech(JSON.stringify(v));
  const deja = a.decision ? `<span class="b ${a.decision === "approuve" ? "vert" : "rouge"}">déjà ${ech(a.decision)}</span>` : "";
  return `<div class="act" data-action="${ech(a.id)}">
  <div class="tete"><b>${ech(a.id)}</b> <span class="mono">${ech(a.type)}</span> sur <span class="mono">${ech(a.cible)}</span> ${deja}</div>
  <div class="delta">${delta}</div>
  <p>${ech(a.justification || "")}</p>
  ${(a.sources || []).length ? `<div class="src">appuyé sur ${(a.sources || []).map((s) => `<span class="mono">${ech(s)}</span>`).join(", ")}</div>` : ""}
  <div class="choix">
    <label><input type="radio" name="${nom}" value="approuve"> approuver</label>
    <label><input type="radio" name="${nom}" value="refuse"> refuser</label>
    <label><input type="radio" name="${nom}" value="" checked> ne pas décider</label>
  </div>
</div>`;
}

function page(etat, qui) {
  const corps = etat.dossiers.length
    ? etat.dossiers
        .map(
          (d, di) => `<section data-dossier="${ech(d.dossier)}" data-empreinte="${ech(d.empreinte)}">
  <h2>${ech(d.dossier)} ${badge(d.fraicheur)}</h2>
  <div class="meta">empreinte <span class="mono">${ech(d.empreinte)}</span>, en attente depuis ${ech(d.depuis)}</div>
  ${d.plan_absent ? `<p class="rouge">Plan gelé introuvable. Rien ne peut être décidé sans lui.</p>` : d.actions.map((a, ai) => ligneAction(a, `d${di}-${ai}`)).join("")}
  ${d.fraicheur.verdict === "perime" ? `<p class="rouge">Ce plan est périmé : le pipeline d'application le refusera. Relancer la planification.</p>` : ""}
</section>`
        )
        .join("")
    : `<p class="vide">Rien n'attend de décision.</p>`;

  const canal =
    qui.canal === "tailnet" ? "identité établie par le tailnet" : "console de la machine, identité non prouvée";

  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Cockpit d'approbation</title>
${pwa.BALISES}
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:15px/1.55 system-ui,sans-serif;max-width:52rem;margin:1.5rem auto;
  padding:env(safe-area-inset-top) calc(1rem + env(safe-area-inset-right)) 0 calc(1rem + env(safe-area-inset-left))}
h1{font-size:1.3rem}h2{font-size:1.05rem;margin:2rem 0 .3rem}
.mono{font-family:ui-monospace,monospace;font-size:.9em;word-break:break-all}
.meta{opacity:.7;font-size:.85rem;margin-bottom:.8rem}
.act{border:1px solid currentColor;border-radius:6px;padding:.8rem 1rem;margin:.7rem 0;opacity:.95}
.tete{margin-bottom:.3rem}.delta{font-size:1.15rem;font-weight:600;margin:.2rem 0}
.act p{margin:.5rem 0}.src{font-size:.85rem;opacity:.75;margin-bottom:.6rem}
.choix{display:flex;flex-wrap:wrap;gap:.4rem}
.choix label{flex:1 1 8rem;display:flex;align-items:center;gap:.4rem;border:1px solid currentColor;
  border-radius:6px;padding:.6rem .7rem;font-size:.9rem;opacity:.7;cursor:pointer}
.choix label:has(input:checked){opacity:1;font-weight:600}
.choix input{width:1.1rem;height:1.1rem;margin:0;flex:none}
.b{font-size:.75rem;border:1px solid;border-radius:99px;padding:.05rem .5rem;vertical-align:middle;white-space:nowrap}
.vert{color:#0a7d32}.rouge{color:#b3261e}.gris{opacity:.6}
.vide{opacity:.6;margin:3rem 0}
form.pied{position:sticky;bottom:0;background:Canvas;margin-top:2rem;border-top:1px solid;
  padding:.9rem 0 calc(.9rem + env(safe-area-inset-bottom))}
button{font:inherit;padding:.75rem 1.2rem;width:100%;max-width:22rem;cursor:pointer;border-radius:6px}
#msg{margin-top:1rem;white-space:pre-wrap}
</style>
<h1>Cockpit d'approbation</h1>
<p class="meta">Décisions signées <b>${ech(qui.par)}</b>, ${ech(canal)}.<br>
Lecture de ${ech(APPROVALS)}. Cette page écrit de vraies décisions.</p>
${corps}
<form class="pied" onsubmit="return envoyer(event)">
  <button>Enregistrer les décisions</button>
</form>
<div id="msg"></div>
<script>
async function envoyer(e){
  e.preventDefault();
  const msg=document.getElementById('msg');
  const lots=[];
  for(const s of document.querySelectorAll('section[data-dossier]')){
    const decisions=[];
    for(const r of s.querySelectorAll('input[type=radio]:checked')){
      if(!r.value) continue;
      decisions.push({action_id:r.closest('.act').dataset.action,decision:r.value});
    }
    if(decisions.length) lots.push({dossier:s.dataset.dossier,empreinte:s.dataset.empreinte,decisions});
  }
  if(!lots.length){msg.textContent='Aucune décision cochée.';return false}
  const sorties=[];
  for(const lot of lots){
    const r=await fetch('/api/decider',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(lot)});
    const b=await r.json();
    sorties.push((r.ok?'✓ ':'✘ ')+lot.dossier+' : '+(b.erreur||(b.decisions.length+' décision(s) écrite(s)')));
  }
  msg.textContent=sorties.join('\\n');
  if(sorties.every(s=>s.startsWith('✓'))) setTimeout(()=>location.reload(),1200);
  return false;
}
</script>
${pwa.ENREGISTREMENT}`;
}

// Une page qui affiche des prix d'achat, des marges et l'adresse de celui qui décide n'a
// rien à faire dans un cache, ni à être devinée par reniflage de type.
const DURCISSEMENT = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(res, code, corps) {
  const t = JSON.stringify(corps);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(t),
    ...DURCISSEMENT,
  });
  res.end(t);
}

async function traiter(req, res) {
  // Défense contre le rebinding DNS : un nom d'hôte que je n'ai pas prévu ne parle pas au
  // serveur, même s'il résout vers 127.0.0.1.
  if (!acces.hoteAutorise(req.headers, PORTEE)) {
    return json(res, 403, { erreur: "hôte refusé : ce cockpit ne répond qu'en local ou par son tailnet" });
  }

  let qui;
  try {
    qui = acces.identite(req.headers, { tailnet: TAILNET, operateurLocal: OPERATEUR });
  } catch (err) {
    // Refus d'identité avant même de lire la boîte : si on ne sait pas à qui on parle, on
    // ne lui montre pas non plus les prix, les marges et les annonces.
    if (err instanceof cockpit.Refus) return json(res, 403, { erreur: err.message });
    throw err;
  }

  // Manifeste, service worker et icônes. Placés derrière le contrôle d'identité comme
  // le reste : un appelant que le tailnet n'a pas nommé n'installe pas cette application.
  if (req.method === "GET") {
    const r = pwa.ressource(req.url);
    if (r) {
      res.writeHead(200, {
        "Content-Type": r.type,
        "Content-Length": r.corps.length,
        ...DURCISSEMENT,
      });
      return res.end(r.corps);
    }
  }

  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
    const html = page(cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }), qui);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...DURCISSEMENT });
    return res.end(html);
  }

  if (req.method === "GET" && req.url === "/api/etat") {
    return json(res, 200, cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }));
  }

  if (req.method === "POST" && req.url === "/api/decider") {
    if (!acces.origineAutorisee(req.headers, PORTEE)) {
      return json(res, 403, { erreur: "origine refusée : cette écriture ne vient pas du cockpit" });
    }
    // Un POST de formulaire cross-site ne peut pas porter ce type de contenu sans contrôle
    // préalable CORS, et au contrôle préalable on ne répond pas. Exiger le type ferme la porte.
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") {
      return json(res, 415, { erreur: "type de contenu refusé : application/json attendu" });
    }

    let brut = "";
    for await (const morceau of req) {
      brut += morceau;
      if (brut.length > 100_000) return json(res, 413, { erreur: "corps trop gros" });
    }
    let demande;
    try {
      demande = JSON.parse(brut);
    } catch {
      return json(res, 400, { erreur: "corps illisible" });
    }
    try {
      // Champs nommés un par un, jamais étalés. Le corps ne choisit ni où on écrit, ni
      // quand, ni sous quel nom : il ne dit que ce qu'il décide.
      return json(
        res,
        200,
        cockpit.enregistrer({
          approvalsDir: APPROVALS,
          dossier: demande.dossier,
          empreinte: demande.empreinte,
          decisions: demande.decisions,
          par: qui.par,
          canal: qui.canal,
        })
      );
    } catch (err) {
      // Un refus est une réponse attendue, pas une panne : il se lit dans la page.
      if (err instanceof cockpit.Refus) return json(res, 409, { erreur: err.message });
      return json(res, 500, { erreur: err.message });
    }
  }

  return json(res, 404, { erreur: "route inconnue" });
}

const serveur = http.createServer(async (req, res) => {
  try {
    await traiter(req, res);
  } catch (err) {
    // Un gestionnaire `async` passé à createServer ne remonte pas ses exceptions au
    // serveur : elles deviennent des promesses rejetées que personne ne rattrape, et le
    // défaut de Node est alors de tuer le processus.
    //
    // Constaté en tronquant EN-ATTENTE.json, ce que laisse une écriture interrompue : un
    // seul GET suffisait à faire mourir le cockpit. Le service systemd le relançait, il
    // remourait au rechargement suivant, et après cinq démarrages en dix secondes systemd
    // passait l'unité en échec et cessait de la relancer. L'accès depuis le téléphone
    // finissait donc par exiger de retourner taper une commande sur la machine, ce qu'il
    // était censé éviter.
    //
    // Un fichier illisible doit produire une réponse qui NOMME le fichier, pas un arrêt.
    console.error(err);
    if (!res.headersSent) json(res, 500, { erreur: `panne du cockpit : ${err.message}` });
    else res.end();
  }
});

serveur.listen(PORT, "127.0.0.1", () => {
  console.log(`Cockpit sur http://127.0.0.1:${PORT}`);
  if (TAILNET) {
    console.log(`Depuis le téléphone : https://${TAILNET}`);
    console.log("Ce nom ne répond que si le relais est monté : npm run cockpit:tailnet");
  } else {
    console.log("COCKPIT_TAILNET non renseigné : accès local seulement.");
  }
  console.log(`Approbations lues dans ${APPROVALS}`);
  console.log("Ctrl+C pour arrêter.");
});
