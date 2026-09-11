#!/usr/bin/env node
//
// Cockpit d'approbation. Une page qui lit la boîte de réception, montre les plans en
// attente et écrit les décisions.
//
// Elle n'écoute que sur 127.0.0.1, et c'est une exigence, plus seulement une précaution.
// Dans un conteneur cette adresse la rendrait injoignable, et la publication loopback de
// l'hôte reprend alors le rôle : ce déplacement se déclare par COCKPIT_CONTENEUR=1 et
// n'arrive jamais par défaut. Le téléphone y accède par Tailscale, qui termine le TLS sur
// un vrai nom et relaie vers localhost. Tailscale n'injecte l'identité de l'appelant que
// si le service reste local : ouvrir l'écoute laisserait n'importe qui sur le réseau
// fabriquer cette identité. Le détail est dans src/acces.js.
//
// Les défenses, et l'incident que chacune vise :
//
//   - écoute loopback seule, plus le relais Tailscale au-dessus. Un cockpit d'approbation
//     joignable sans authentification est une porte ouverte sur le compte marchand. La
//     seule exception est le conteneur, où lier la boucle locale rend le service
//     injoignable même publié, et où la publication loopback de l'hôte porte alors le
//     confinement. Elle se déclare, elle ne se devine pas : voir adresseEcoute() ;
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
const apps = require("../src/apps");

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

// L'adresse d'écoute est 127.0.0.1 partout sauf dans un conteneur, où lier la boucle
// locale rend le service injoignable même publié. Le raisonnement complet, et le refus
// qui empêche d'ouvrir le cockpit sur le LAN par mégarde, sont dans src/acces.js.
const HOTE = acces.adresseEcoute({
  hote: ENV.COCKPIT_HOTE,
  conteneur: String(ENV.COCKPIT_CONTENEUR || "").trim() === "1",
});

// Surchargeable comme APPROVALS_DIR, et pour la même raison : ce qui n'est pas déplaçable
// ne se teste que contre le dossier réel du dépôt.
const APPS_DIR = ENV.COCKPIT_APPS_DIR || path.join(RACINE, "specs");

// Le registre des applications est relu à chaque rendu de page, pas une fois au démarrage.
//
// Lu au démarrage, ajouter une app demandait de redémarrer le conteneur. Une liste de
// liens qui exige une commande pour se mettre à jour est une liste qu'on cesse de tenir,
// et une liste fausse vaut moins que pas de liste.
//
// Ce que la relecture coûte est nul en pratique : un petit JSON, sur une page qu'un humain
// ouvre pour décider, pas une API sollicitée en boucle. Ce qu'elle aurait pu coûter, une
// panne de plus sur la page qui garde l'argent, est déjà écarté plus bas : un registre
// fautif nomme son défaut à la place de la liste et laisse le reste de la page intact.
// Décider ne dépend pas du panneau, et ne doit jamais en dépendre.
function registreApps() {
  try {
    return { apps: apps.charger({ specsDir: APPS_DIR, origines: acces.originesAutorisees(PORTEE) }), erreur: null };
  } catch (err) {
    // Se taire serait pire que dire le défaut : on croirait n'avoir rien déployé.
    return { apps: [], erreur: err.message };
  }
}

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

// Un horodatage ISO n'est pas une information pour quelqu'un qui décide sur un téléphone :
// il faut le lire, le convertir, et le comparer à l'heure qu'il est. Ce qu'on cherchait est
// la durée écoulée, et la page la donne donc directement. L'instant exact reste dans
// l'attribut title, pour qui veut le recouper avec un journal.
//
// Calculer une durée au rendu ne vaut que si la page n'est jamais servie depuis un cache.
// C'est le cas et c'est voulu : la page et son API partent en Cache-Control: no-store, et
// le service worker ne garde rien. Voir src/pwa.js.
function depuis(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return `<span>${ech(iso)}</span>`;

  const minutes = Math.max(0, Math.round((Date.now() - t) / 60000));
  let texte;
  if (minutes < 60) texte = `${minutes} min`;
  else if (minutes < 48 * 60) {
    const h = minutes / 60;
    texte = `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  } else texte = `${Math.round(minutes / 1440)} j`;

  return `<span title="${ech(iso)}">${ech(texte)}</span>`;
}

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

// `rel="noopener"` n'est pas décoratif ici. Sans lui, la page ouverte reçoit une poignée
// sur l'onglet du cockpit et peut le faire naviguer ailleurs, vers une copie qui demande
// de reconfirmer une décision par exemple. Ces applications sortent d'un générateur, donc
// d'un modèle : c'est exactement le genre de page à qui on ne prête pas son onglet.
function panneauApps() {
  const { apps: liste, erreur } = registreApps();
  if (erreur) {
    return `<h2>Applications</h2>
<p class="rouge">Registre illisible, la liste n'est pas affichée. ${ech(erreur)}</p>`;
  }
  if (!liste.length) return "";
  return `<h2>Applications</h2>
<div class="apps">${liste.map(
    (a) => `<a class="app" href="${ech(a.url)}" target="_blank" rel="noopener noreferrer">
  <b>${ech(a.nom)}</b>
  ${a.description ? `<span class="desc">${ech(a.description)}</span>` : ""}
  <span class="mono">${ech(a.url)}</span>
</a>`
  ).join("")}</div>`;
}

function page(etat, qui) {
  const corps = etat.dossiers.length
    ? etat.dossiers
        .map(
          (d, di) => `<section data-dossier="${ech(d.dossier)}" data-empreinte="${ech(d.empreinte)}">
  <h2>${ech(d.dossier)} ${badge(d.fraicheur)}</h2>
  <div class="meta">empreinte <span class="mono">${ech(d.empreinte)}</span>, en attente depuis ${depuis(d.depuis)}</div>
  ${d.plan_absent ? `<p class="rouge">Plan gelé introuvable. Rien ne peut être décidé sans lui.</p>` : d.actions.map((a, ai) => ligneAction(a, `d${di}-${ai}`)).join("")}
  ${d.fraicheur.verdict === "perime" ? `<p class="rouge">Ce plan est périmé : le pipeline d'application le refusera. Relancer la planification.</p>` : ""}
</section>`
        )
        .join("")
    : `<p class="vide">Rien n'attend de décision.</p>`;

  const canal =
    qui.canal === "tailnet" ? "identité établie par le tailnet" : "console de la machine, identité non prouvée";

  // `lang` compte pour une page en français lue par un lecteur d'écran ou traduite : sans
  // lui, le navigateur devine, et prononce des montants en anglais.
  return `<!doctype html><html lang="fr"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Cockpit d'approbation</title>
${pwa.BALISES}
<style>
/* Deux jeux de couleurs déclarés en clair, au lieu d'une opacité posée sur les couleurs
   système. L'opacité rendait le contraste imprévisible : le même .7 donne un gris lisible
   sur fond blanc et un gris illisible sur fond noir, et cette page se lit dehors, sur un
   téléphone, pour valider un montant. Chaque valeur ci-dessous tient le 4.5:1 sur le fond
   devant lequel elle est écrite, dans les deux thèmes ; la plus basse est à 5.69:1, et
   c'est mesuré, pas supposé.

   Le trait des cartes, lui, est à 1.8:1 et reste en dessous du 3:1 des éléments non
   textuels. C'est assumé : ce seuil vise ce dont l'identification DÉPEND, et ici la carte
   se détache déjà par son fond, tandis que l'état d'un choix se lit par sa couleur, son
   fond, son cadre et sa graisse à la fois. Monter le trait à 3:1 demanderait un liseré
   franchement sombre autour de chaque bloc, et la page deviendrait une grille de boîtes. */
:root{
  color-scheme:light dark;
  --fond:#E3E9EF;--surface:#FFFFFF;--creux:#EDF1F5;
  --encre:#111820;--encre-douce:#4B5866;--trait:#B8C4D0;
  --ok:#12653A;--ok-fond:#E2F0E8;
  --danger:#A0271C;--danger-fond:#FAE5E3;
  --alerte:#7F5400;--alerte-fond:#F7EDD6;
  --accent:#1B5C7E;--sur-accent:#FFFFFF;
  --rayon:10px;
}
@media (prefers-color-scheme:dark){
  :root{
    --fond:#090E12;--surface:#1C262F;--creux:#141C23;
    --encre:#E3E9ED;--encre-douce:#9CA9B4;--trait:#41505D;
    --ok:#74C08F;--ok-fond:#16301F;
    --danger:#F08A7B;--danger-fond:#3A1E1A;
    --alerte:#DEA845;--alerte-fond:#332709;
    --accent:#6CA9C9;--sur-accent:#090E12;
  }
}
*{box-sizing:border-box}
/* 16px et pas 15 : c'est le plancher lisible sur mobile, et iOS zoome de lui-même sur
   toute page dont le texte de formulaire descend en dessous. */
body{font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  color:var(--encre);background:var(--fond);max-width:46rem;margin:0 auto;
  padding:calc(1.25rem + env(safe-area-inset-top)) calc(1rem + env(safe-area-inset-right)) 0 calc(1rem + env(safe-area-inset-left))}
h1{font-size:1.35rem;font-weight:650;letter-spacing:-.01em;margin:0 0 .5rem}
h2{font-size:1.05rem;font-weight:650;margin:2rem 0 .35rem;
  display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;word-break:break-all}
.meta{color:var(--encre-douce);font-size:.875rem;margin-bottom:.9rem}
.act{background:var(--surface);border:1px solid var(--trait);border-radius:var(--rayon);
  padding:1rem;margin:.75rem 0}
.tete{color:var(--encre-douce);font-size:.9rem;margin-bottom:.1rem}
.tete b{color:var(--encre)}
/* Le montant est ce qu'on approuve. C'est donc ce qui doit se lire en premier, et les
   chiffres sont tabulaires pour que deux cartes s'alignent au lieu de danser. */
.delta{font-size:1.5rem;font-weight:650;letter-spacing:-.01em;margin:.3rem 0 .5rem;
  font-variant-numeric:tabular-nums}
.act p{margin:.5rem 0;max-width:62ch}
.src{font-size:.8rem;color:var(--encre-douce)}
.choix{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.9rem}
/* 48px de haut au minimum. En dessous, on manque la cible, et ici manquer la cible veut
   dire approuver un changement de prix qu'on voulait refuser. */
.choix label{flex:1 1 8.5rem;display:flex;align-items:center;gap:.55rem;min-height:48px;
  padding:.7rem .85rem;border:1px solid var(--trait);border-radius:var(--rayon);
  background:var(--creux);color:var(--encre-douce);font-size:.95rem;cursor:pointer}
/* L'état choisi se voit par la couleur, le fond, le cadre ET la graisse. Une seule de ces
   quatre suffirait à quelqu'un qui les distingue toutes ; aucune ne suffit seule. */
.choix label:has(input:checked){color:var(--encre);background:var(--surface);
  border-color:var(--encre-douce);font-weight:650}
.choix label:has(input[value="approuve"]:checked){color:var(--ok);background:var(--ok-fond);border-color:var(--ok)}
.choix label:has(input[value="refuse"]:checked){color:var(--danger);background:var(--danger-fond);border-color:var(--danger)}
.choix label:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.choix input{width:1.15rem;height:1.15rem;margin:0;flex:none;accent-color:currentColor}
.b{display:inline-block;font-size:.75rem;font-weight:600;border:1px solid;border-radius:99px;
  padding:.1rem .6rem;white-space:nowrap}
.b.vert{color:var(--ok);background:var(--ok-fond)}
.b.rouge{color:var(--danger);background:var(--danger-fond)}
.b.gris{color:var(--encre-douce);background:var(--creux)}
.vert{color:var(--ok)}
.rouge{color:var(--danger)}
.gris{color:var(--encre-douce)}
/* Un avertissement n'est pas une pastille : il occupe une ligne et porte un filet, pour
   qu'on ne le prenne pas pour une étiquette de plus. */
p.rouge{background:var(--danger-fond);border-left:3px solid var(--danger);
  padding:.7rem .9rem;border-radius:0 var(--rayon) var(--rayon) 0;max-width:62ch}
.vide{color:var(--encre-douce);background:var(--surface);border:1px dashed var(--trait);
  border-radius:var(--rayon);padding:1.5rem;margin:2rem 0;text-align:center}
.apps{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:.6rem}
.app{display:flex;flex-direction:column;gap:.2rem;min-height:48px;
  background:var(--surface);border:1px solid var(--trait);border-radius:var(--rayon);
  padding:.85rem .9rem;text-decoration:none;color:var(--encre)}
.app:hover{background:var(--creux);border-color:var(--accent)}
.app:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.app .desc{font-size:.85rem;color:var(--encre-douce)}
.app .mono{font-size:.75rem;color:var(--encre-douce)}
form.pied{position:sticky;bottom:0;background:var(--fond);margin-top:2rem;
  border-top:1px solid var(--trait);padding:.9rem 0 calc(.9rem + env(safe-area-inset-bottom))}
button{font:inherit;font-weight:650;min-height:48px;padding:.8rem 1.2rem;width:100%;max-width:24rem;
  cursor:pointer;border:1px solid var(--accent);border-radius:var(--rayon);
  background:var(--accent);color:var(--sur-accent)}
button:hover{filter:brightness(1.1)}
button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#msg{margin-top:1rem;white-space:pre-wrap;color:var(--encre-douce);max-width:62ch}
/* Les transitions ne portent que sur des couleurs, jamais sur une taille : rien ne bouge
   sous le doigt entre le moment où on vise et celui où on touche. */
@media (prefers-reduced-motion:no-preference){
  .choix label,.app,button{transition:background-color .15s,border-color .15s,color .15s}
}
</style>
<h1>Cockpit d'approbation</h1>
<p class="meta">Décisions signées <b>${ech(qui.par)}</b>, ${ech(canal)}.<br>
Lecture de ${ech(APPROVALS)}. Cette page écrit de vraies décisions.</p>
${corps}
${panneauApps()}
<form class="pied" onsubmit="return envoyer(event)">
  <button>Enregistrer les décisions</button>
</form>
<div id="msg" role="status" aria-live="polite"></div>
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

serveur.listen(PORT, HOTE, () => {
  console.log(`Cockpit sur http://${HOTE}:${PORT}`);
  if (HOTE !== "127.0.0.1") {
    console.log(
      "Écoute hors boucle locale, déclarée par COCKPIT_CONTENEUR=1 : " +
        "ce qui confine le cockpit est désormais la publication loopback de l'hôte."
    );
  }
  if (TAILNET) {
    console.log(`Depuis le téléphone : https://${TAILNET}`);
    console.log("Ce nom ne répond que si le relais est monté : npm run cockpit:tailnet");
  } else {
    console.log("COCKPIT_TAILNET non renseigné : accès local seulement.");
  }
  console.log(`Approbations lues dans ${APPROVALS}`);
  console.log("Ctrl+C pour arrêter.");
});
