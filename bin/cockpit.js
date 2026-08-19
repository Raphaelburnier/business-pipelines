#!/usr/bin/env node
//
// Cockpit d'approbation. Une page locale qui lit la boîte de réception, montre les plans
// en attente et écrit les décisions.
//
// Trois choix de sécurité, parce que cette page change de vrais prix :
//
//   - elle n'écoute que sur 127.0.0.1, jamais sur 0.0.0.0. Un cockpit d'approbation
//     joignable depuis le réseau est une porte ouverte sur le compte marchand ;
//   - elle vérifie l'en-tête Host. Sans ça, un site visité dans le même navigateur peut
//     faire pointer un nom vers 127.0.0.1 et parler au serveur à ta place ;
//   - tout texte affiché est échappé. Les justifications sont écrites par un modèle, et
//     du texte de modèle rendu tel quel dans une page est une injection en attente.
const http = require("http");
const path = require("path");
const cockpit = require("../src/cockpit");

const RACINE = path.resolve(__dirname, "..");
const APPROVALS = process.env.APPROVALS_DIR || path.join(RACINE, "approvals");
const PIPELINES = path.join(RACINE, "pipelines");
const PORT = Number(process.env.COCKPIT_PORT || 4600);
const HOTES = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const ech = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function badge(f) {
  if (f.verdict === "perime") {
    return `<span class="b rouge">périmé, ${f.age_heures} h sur ${f.max_heures} h</span>`;
  }
  if (f.verdict === "frais") {
    return `<span class="b vert">frais, ${f.age_heures} h sur ${f.max_heures} h</span>`;
  }
  const age = f.age_heures === null ? "date absente" : `${f.age_heures} h, maximum non déclaré`;
  return `<span class="b gris">fraîcheur inconnue, ${ech(age)}</span>`;
}

function ligneAction(dossier, a) {
  const v = a.valeur || {};
  const delta =
    typeof v.de === "number" && typeof v.vers === "number"
      ? `${v.de} → ${v.vers} ${ech(v.devise || "")} (${(((v.vers - v.de) / v.de) * 100).toFixed(1)} %)`
      : ech(JSON.stringify(v));
  const nom = `d_${ech(dossier)}_${ech(a.id)}`;
  const deja = a.decision ? `<span class="b ${a.decision === "approuve" ? "vert" : "rouge"}">déjà ${ech(a.decision)}</span>` : "";
  return `<div class="act">
  <div class="tete"><b>${ech(a.id)}</b> <span class="mono">${ech(a.type)}</span> sur <span class="mono">${ech(a.cible)}</span> ${deja}</div>
  <div class="delta">${delta}</div>
  <p>${ech(a.justification || "")}</p>
  ${(a.sources || []).length ? `<div class="src">appuyé sur ${(a.sources || []).map((s) => `<span class="mono">${ech(s)}</span>`).join(", ")}</div>` : ""}
  <label><input type="radio" name="${nom}" value="approuve"> approuver</label>
  <label><input type="radio" name="${nom}" value="refuse"> refuser</label>
  <label><input type="radio" name="${nom}" value="" checked> ne pas décider</label>
</div>`;
}

function page(etat) {
  const corps = etat.dossiers.length
    ? etat.dossiers
        .map(
          (d) => `<section data-dossier="${ech(d.dossier)}" data-empreinte="${ech(d.empreinte)}">
  <h2>${ech(d.dossier)} ${badge(d.fraicheur)}</h2>
  <div class="meta">empreinte <span class="mono">${ech(d.empreinte)}</span>, en attente depuis ${ech(d.depuis)}</div>
  ${d.plan_absent ? `<p class="rouge">Plan gelé introuvable. Rien ne peut être décidé sans lui.</p>` : d.actions.map((a) => ligneAction(d.dossier, a)).join("")}
  ${d.fraicheur.verdict === "perime" ? `<p class="rouge">Ce plan est périmé : le pipeline d'application le refusera. Relancer la planification.</p>` : ""}
</section>`
        )
        .join("")
    : `<p class="vide">Rien n'attend de décision.</p>`;

  return `<!doctype html><meta charset="utf-8"><title>Cockpit d'approbation</title>
<style>
:root{color-scheme:light dark}
body{font:15px/1.55 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem}
h1{font-size:1.3rem}h2{font-size:1.05rem;margin:2rem 0 .3rem}
.mono{font-family:ui-monospace,monospace;font-size:.9em}
.meta{opacity:.7;font-size:.85rem;margin-bottom:.8rem}
.act{border:1px solid currentColor;border-radius:6px;padding:.8rem 1rem;margin:.7rem 0;opacity:.95}
.tete{margin-bottom:.3rem}.delta{font-size:1.15rem;font-weight:600;margin:.2rem 0}
.act p{margin:.5rem 0}.src{font-size:.85rem;opacity:.75;margin-bottom:.6rem}
.act label{margin-right:1rem;font-size:.9rem}
.b{font-size:.75rem;border:1px solid;border-radius:99px;padding:.05rem .5rem;vertical-align:middle}
.vert{color:#0a7d32}.rouge{color:#b3261e}.gris{opacity:.6}
.vide{opacity:.6;margin:3rem 0}
form.pied{margin-top:2rem;border-top:1px solid;padding-top:1rem}
input[type=text]{font:inherit;padding:.35rem .5rem}
button{font:inherit;padding:.45rem 1rem;cursor:pointer}
#msg{margin-top:1rem;white-space:pre-wrap}
</style>
<h1>Cockpit d'approbation</h1>
<p class="meta">Lecture de ${ech(APPROVALS)}. Cette page écrit de vraies décisions.</p>
${corps}
<form class="pied" onsubmit="return envoyer(event)">
  <label>Qui décide <input type="text" id="par" placeholder="ton nom" required></label>
  <button>Enregistrer les décisions</button>
</form>
<div id="msg"></div>
<script>
async function envoyer(e){
  e.preventDefault();
  const par=document.getElementById('par').value.trim();
  const msg=document.getElementById('msg');
  const lots=[];
  for(const s of document.querySelectorAll('section[data-dossier]')){
    const decisions=[];
    for(const r of s.querySelectorAll('input[type=radio]:checked')){
      if(!r.value) continue;
      decisions.push({action_id:r.name.split('_').slice(2).join('_'),decision:r.value});
    }
    if(decisions.length) lots.push({dossier:s.dataset.dossier,empreinte:s.dataset.empreinte,decisions});
  }
  if(!lots.length){msg.textContent='Aucune décision cochée.';return false}
  const sorties=[];
  for(const lot of lots){
    const r=await fetch('/api/decider',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...lot,par})});
    const b=await r.json();
    sorties.push((r.ok?'✓ ':'✘ ')+lot.dossier+' : '+(b.erreur||(b.decisions.length+' décision(s) écrite(s)')));
  }
  msg.textContent=sorties.join('\\n');
  if(sorties.every(s=>s.startsWith('✓'))) setTimeout(()=>location.reload(),1200);
  return false;
}
</script>`;
}

function json(res, code, corps) {
  const t = JSON.stringify(corps);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(t) });
  res.end(t);
}

const serveur = http.createServer(async (req, res) => {
  // Défense contre le rebinding DNS : un nom d'hôte que je n'ai pas prévu ne parle pas au
  // serveur, même s'il résout vers 127.0.0.1.
  if (!HOTES.has(String(req.headers.host || ""))) {
    return json(res, 403, { erreur: "hôte refusé : ce cockpit ne répond qu'en local" });
  }

  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
    const html = page(cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(html);
  }

  if (req.method === "GET" && req.url === "/api/etat") {
    return json(res, 200, cockpit.etat({ approvalsDir: APPROVALS, pipelinesDir: PIPELINES }));
  }

  if (req.method === "POST" && req.url === "/api/decider") {
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
      return json(res, 200, cockpit.enregistrer({ approvalsDir: APPROVALS, ...demande }));
    } catch (err) {
      // Un refus est une réponse attendue, pas une panne : il se lit dans la page.
      if (err instanceof cockpit.Refus) return json(res, 409, { erreur: err.message });
      return json(res, 500, { erreur: err.message });
    }
  }

  return json(res, 404, { erreur: "route inconnue" });
});

serveur.listen(PORT, "127.0.0.1", () => {
  console.log(`Cockpit sur http://127.0.0.1:${PORT}`);
  console.log(`Approbations lues dans ${APPROVALS}`);
  console.log("Ctrl+C pour arrêter.");
});
