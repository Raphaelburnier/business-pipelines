const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {fixture}=require('./fixtures/controle-runner');
const {traiterControle}=require('../src/controle-execution');
const {arreterProcessus}=require('../src/arret-processus');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function jusqua(fn,detail){for(let i=0;i<400;i++){const v=fn();if(v)return v;await pause(25);}assert.fail(typeof detail==='function'?detail():String(detail));}
const cmd=(f,kind,payload)=>f.store.creerCommande({kind,payload,par:'operateur',canal:'tailnet'});

test('la pause survit au redémarrage ; une annulation reste exécutée pendant la pause',async()=>{
 const f=fixture();
 try{
  const p=cmd(f,'execution.pause',{pause:true});const depart=cmd(f,'run.start',{projectId:'demo'});
  let runner=f.runner();await jusqua(()=>f.store.commande(p.id).status==='done',()=>runner.sortie);
  await pause(150);assert.equal(f.store.runs().length,0);assert.equal(f.store.commande(depart.id).status,'pending');
  await f.arreter(runner);runner=f.runner();await pause(200);
  assert.equal(f.store.controle.etat().pause,true);assert.equal(f.store.runs().length,0);
  cmd(f,'execution.pause',{pause:false});
  const runId=await jusqua(()=>f.store.commande(depart.id).run_id,()=>runner.sortie);
  const espace=path.join(f.env.OUTPUT_ROOT,'demo',runId);
  await jusqua(()=>f.store.etapes(runId).some(e=>e.node_id==='terminer'&&e.status==='running'),()=>runner.sortie);
  const repause=cmd(f,'execution.pause',{pause:true});await jusqua(()=>f.store.commande(repause.id).status==='done',()=>runner.sortie);
  const annulation=cmd(f,'run.cancel',{runId});
  await jusqua(()=>f.store.commande(annulation.id).status==='done',()=>runner.sortie);
  assert.equal(f.store.run(runId).status,'cancelled');assert.equal(f.store.controle.annulationDemandee(runId),true);
  assert.equal(fs.readFileSync(path.join(espace,'compteur.txt'),'utf8'),'1');assert.equal(fs.existsSync(path.join(espace,'fini.txt')),false);
  await f.arreter(runner);runner=f.runner();cmd(f,'execution.pause',{pause:false});await pause(250);
  assert.equal(f.store.runs().length,1);assert.equal(f.store.run(runId).status,'cancelled');
 }finally{await f.fermer();}
});

test('un worker qui ne confirme pas son arrêt ne donne pas une fausse confirmation',async()=>{
 const f=fixture();let timer;
 try{
  const runId=f.store.creerRun({pipelineRef:'recette@1'});f.store.creerEtape({runId,nodeId:'distant',type:'script',machineId:'pc'});
  const c=cmd(f,'run.cancel',{runId});
  timer=setInterval(()=>{const commande=f.store.prendreCommande({kinds:['step.cancel']});if(commande)f.store.terminerCommande(commande.id,{ok:false,raison:'worker hors ligne : arrêt non confirmé'});},5);
  await assert.rejects(traiterControle({store:f.store,commande:c,enfants:new Set()}),/non confirmé/);
  assert.equal(f.store.run(runId).status,'running');assert.equal(f.store.controle.annulationDemandee(runId),true);
  assert.ok(f.store.evenements({runId}).some(e=>e.type==='run.cancel_unconfirmed'));
 }finally{clearInterval(timer);await f.fermer();}
});

test('un processus local qui ignore SIGTERM et ses descendants sont arrêtés',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arret-descendants-'));const fichier=path.join(dir,'pid');
 const code=`const fs=require('fs'),{spawn}=require('child_process');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));setInterval(()=>{},1000);`;
 const p=spawn(process.execPath,['-e',code,fichier],{stdio:'ignore'});
 try{
  await jusqua(()=>fs.existsSync(fichier),'descendant non démarré');const pid=Number(fs.readFileSync(fichier));await pause(70);
  await arreterProcessus(p,{graceMs:100,confirmationMs:1000});
  const actif=()=>{try{return !['Z','X'].includes(fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ')[1].split(' ')[0]);}catch{return false;}};
  assert.equal(actif(),false);
 }finally{try{p.kill('SIGKILL');}catch{};fs.rmSync(dir,{recursive:true,force:true});}
});

test('une commande start reprise après crash ne rouvre pas un run déjà annulé',async()=>{
 const f=fixture();
 try{
  const depart=cmd(f,'run.start',{projectId:'demo'}),runId=f.store.creerRun({pipelineRef:'diagnostic@1',projectId:'demo'});
  f.store.db.prepare('UPDATE commands SET run_id=? WHERE id=?').run(runId,depart.id);
  const annulation=cmd(f,'run.cancel',{runId});f.store.controle.demanderAnnulation(annulation);f.store.controle.finaliserAnnulation(annulation);
  const runner=f.runner();await jusqua(()=>f.store.commande(depart.id).status==='refused',()=>runner.sortie);
  assert.equal(f.store.etapes(runId).length,0);assert.equal(f.store.runs().length,1);assert.equal(f.store.run(runId).status,'cancelled');
 }finally{await f.fermer();}
});

test('une annulation traverse SQLite, le maître et le vrai worker avant son acquittement', {timeout:10000}, async()=>{
 const {Maitre}=require('agent-orchestrator/src/maitre');
 const {Worker}=require('agent-orchestrator/src/worker');
 const {MaitreDistant,servirMaitre}=require('agent-orchestrator/src/maitre-distant');
 const {empreinteJeton}=require('agent-orchestrator/src/workers');
 const f=fixture(),maitre=new Maitre({store:f.store,hote:'127.0.0.1',port:0,
  workers:new Map([['pc',{machine:'pc',actif:true,nomTailscale:'pc',hashJeton:empreinteJeton('recette'),concurrence:1}]]),resoudreNom:()=> 'pc',journal(){}});
 let worker,service,execution,demarre=false,fini=false;
 try{
  const {port}=await maitre.demarrer();
  service=servirMaitre({store:f.store,maitre,sondeMs:5,journal(){}});
  worker=new Worker({url:`ws://127.0.0.1:${port}`,machine:'pc',jeton:'recette',journalPath:path.join(f.dir,'worker.jsonl'),heartbeatMs:25,journal(){},
   executerEtape:async(_etape,{signal})=>{demarre=true;await new Promise(r=>signal.addEventListener('abort',r,{once:true}));await pause(80);fini=true;return {statut:'cancelled'};}});
  worker.connecter();await jusqua(()=>maitre.machineDisponible('pc'),'worker indisponible');
  const runId=f.store.creerRun({pipelineRef:'recette@1'}),stepId=f.store.creerEtape({runId,nodeId:'distant',type:'script',machineId:'pc'});
  execution=new MaitreDistant({store:f.store,sondeMs:5,delaiMaxMs:3000}).executer('pc',{runId,stepId,noeud:{id:'script',type:'script'},env:{}});
  await jusqua(()=>demarre,'étape non démarrée');
  const c=cmd(f,'run.cancel',{runId});
  await traiterControle({store:f.store,commande:c,enfants:new Set()});
  assert.equal(fini,true);assert.equal((await execution).statut,'cancelled');
  assert.equal(f.store.commande(c.id).resultat.detail.arretConfirme,true);
  assert.equal(f.store.run(runId).status,'cancelled');
  assert.equal(f.store.etapes(runId)[0].status,'cancelled');
 }finally{
  worker?.arreter();await service?.arreter();await maitre.arreter();if(execution)await execution.catch(()=>{});await f.fermer();
 }
});
