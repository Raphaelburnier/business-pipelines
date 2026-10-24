const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventStore}=require('agent-orchestrator');const {etatQuota,AGE_MAX_MS}=require('../src/quota');
test('TaskBoard quota : minimum des fenêtres, seuil strict, fraîcheur et mesures manquantes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-board-')),store=new EventStore(path.join(dir,'events.sqlite'));const t=Date.now();
 const poser=(runtime,fenetres,age=0)=>store.emettre({type:'runtime.quota_snapshot',payload:{runtime,observeLe:new Date(t-age).toISOString(),fenetres}});
 const f=(id,restant)=>({id,restant,utilisation:100-restant,reinitialisation:new Date(t+3600_000).toISOString()});
 try{
  assert.equal(etatQuota(store,t).statut,'inconnu');poser('claude',[f('five_hour',80)]);assert.equal(etatQuota(store,t).statut,'inconnu');
  poser('codex',[f('primary',50),f('secondary',25)]);assert.equal(etatQuota(store,t).statut,'normal');
  poser('claude',[f('seven_day',24)]);assert.equal(etatQuota(store,t).statut,'bas');assert.equal(etatQuota(store,t).restantLePlusBas,24);
  poser('claude',[f('seven_day',25)]);assert.equal(etatQuota(store,t).statut,'normal');
  poser('codex',[]);assert.equal(etatQuota(store,t).statut,'inconnu','pas de repli sur une ancienne mesure après invalidation');
  poser('codex',[f('primary',15)]);assert.equal(etatQuota(store,t).statut,'bas');
  assert.equal(etatQuota(store,t+AGE_MAX_MS+1).statut,'inconnu');
  poser('codex',[f('primary',20)],-60_000);assert.equal(etatQuota(store,t).statut,'inconnu','une mesure future n’est pas fraîche');
 }finally{store.fermer();fs.rmSync(dir,{recursive:true,force:true});}
});
