const AGE_MAX_MS=15*60_000;
// Une fenêtre Claude peut arriver seule : conserver les autres fenêtres encore fraîches.
function etatQuota(store, maintenant=Date.now()) {
  // Une fenêtre de lecture par runtime : les pushes fréquents du PC ne doivent pas évincer les mesures Codex.
  const requete=store.db.prepare("SELECT id,ts,payload_json FROM events WHERE type='runtime.quota_snapshot' AND json_extract(payload_json,'$.runtime')=? ORDER BY id DESC LIMIT 1000");
  const lignes=['claude','codex'].flatMap(runtime=>requete.all(runtime)).sort((a,b)=>b.id-a.id);
  const sources=new Map();
  for(const ligne of lignes){
    let p;try{p=JSON.parse(ligne.payload_json);}catch{continue;}
    if(!['claude','codex'].includes(p.runtime))continue;
    const key=`${p.runtime}:${p.machine||'local'}`;
    const existant=sources.get(key);if(existant?.invalide)continue;
    const date=Date.parse(p.observeLe||ligne.ts), reception=Date.parse(ligne.ts);
    if(!Number.isFinite(date)||!Number.isFinite(reception)||date>maintenant||maintenant-date>AGE_MAX_MS||!Array.isArray(p.fenetres)||!p.fenetres.length){
      if(!existant)sources.set(key,{runtime:p.runtime,invalide:true});continue;
    }
    const valides=p.fenetres.every(f=>typeof f.id==='string'&&Number.isFinite(f.restant)&&f.restant>=0&&f.restant<=100&&Number.isFinite(f.utilisation)&&f.utilisation>=0&&f.utilisation<=100&&Math.abs(f.restant+f.utilisation-100)<0.01&&(!f.reinitialisation||Date.parse(f.reinitialisation)>maintenant));
    if(!valides){if(!existant)sources.set(key,{runtime:p.runtime,invalide:true});continue;}
    const source=existant||{runtime:p.runtime,fenetres:new Map(),observeLe:new Date(date).toISOString()};
    for(const f of p.fenetres)if(!source.fenetres.has(f.id))source.fenetres.set(f.id,f);
    sources.set(key,source);
  }
  const fournisseur=runtime=>{
    const mesures=[...sources.values()].filter(s=>s.runtime===runtime&&!s.invalide);
    const fenetres=mesures.flatMap(s=>[...s.fenetres.values()]);
    return fenetres.length?{observeLe:mesures.map(m=>m.observeLe).sort()[0],restant:Math.min(...fenetres.map(f=>f.restant)),fenetres}:null;
  };
  const claude=fournisseur('claude'),codex=fournisseur('codex');
  if(!claude||!codex)return{statut:'inconnu',claude,codex,restantLePlusBas:null,sousSeuil:false};
  const restantLePlusBas=Math.min(claude.restant,codex.restant);
  return{statut:restantLePlusBas<25?'bas':'normal',claude,codex,restantLePlusBas,sousSeuil:restantLePlusBas<25};
}
class RefusQuota extends Error {}
const FENETRES_CLAUDE=new Set(['five_hour','seven_day','seven_day_opus','seven_day_sonnet']);
// Snapshot poussé par le PC (mod quota-barre de Claude Code) : même forme que celui du moteur,
// relu par etatQuota. Une mesure trop ancienne ou une fenêtre déjà réinitialisée est refusée.
// L'horloge du WSL dérive après une veille : une avance de moins d'une minute est ramenée à la
// réception, car etatQuota invalide toute la source sur une date future.
const AVANCE_TOLEREE_MS=60_000;
function snapshotClaude(corps, maintenant=Date.now()) {
  const recue=Date.parse(corps?.observeLe);
  if(!Number.isFinite(recue)||recue>maintenant+AVANCE_TOLEREE_MS||maintenant-recue>AGE_MAX_MS)throw new RefusQuota('observeLe absent, futur ou trop ancien');
  const observe=Math.min(recue,maintenant);
  if(!Array.isArray(corps.fenetres)||!corps.fenetres.length||corps.fenetres.length>FENETRES_CLAUDE.size)throw new RefusQuota('fenetres absentes ou trop nombreuses');
  const fenetres=corps.fenetres.map(f=>{
    const brut=f?.utilisation;
    const utilisation=typeof brut==='number'||(typeof brut==='string'&&brut.trim()!=='')?Number(brut):NaN,reset=Date.parse(f?.reinitialisation);
    if(!FENETRES_CLAUDE.has(f?.id)||!Number.isFinite(utilisation)||utilisation<0||utilisation>100||!Number.isFinite(reset)||reset<=maintenant){
      throw new RefusQuota(`fenêtre invalide : ${String(f?.id).slice(0,40)}`);
    }
    const u=Math.round(utilisation*10)/10;
    return{id:f.id,utilisation:u,restant:Math.round((100-u)*10)/10,reinitialisation:new Date(reset).toISOString()};
  });
  const machine=typeof corps.machine==='string'&&/^[a-z0-9-]{1,40}$/.test(corps.machine)?corps.machine:'pc';
  return{runtime:'claude',source:'claude_code.mod_quota',machine,observeLe:new Date(observe).toISOString(),fenetres};
}
// Le moteur et le PC mesurent le même compte : dans une fenêtre, l'utilisation ne fait que
// monter, donc la plus haute est la plus récente.
function fenetreClaude(quotas,id) {
  const liste=(quotas?.claude?.fenetres||[]).filter(f=>f.id===id);
  if(!liste.length)return null;
  const f=liste.reduce((a,b)=>b.utilisation>a.utilisation?b:a);
  return{utilisation:f.utilisation,reinitialisation:f.reinitialisation??null};
}
module.exports={etatQuota,snapshotClaude,fenetreClaude,RefusQuota,AGE_MAX_MS};
