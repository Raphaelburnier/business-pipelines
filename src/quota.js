const AGE_MAX_MS=15*60_000;
// Une fenêtre Claude peut arriver seule : conserver les autres fenêtres encore fraîches.
function etatQuota(store, maintenant=Date.now()) {
  const lignes=store.db.prepare("SELECT ts,payload_json FROM events WHERE type='runtime.quota_snapshot' ORDER BY id DESC LIMIT 2000").all();
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
module.exports={etatQuota,AGE_MAX_MS};
