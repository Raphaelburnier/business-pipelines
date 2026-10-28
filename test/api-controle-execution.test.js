const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');const {EventStore}=require('agent-orchestrator');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('les contrôles HTTP exigent socket, origine et opérateur puis ne déposent que des commandes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'api-controle-')),file=path.join(dir,'events.sqlite'),socket=path.join(dir,'cockpit.sock');
 const store=new EventStore(file),runId=store.creerRun({pipelineRef:'recette@1'});
 const droits=path.join(dir,'droits.json');fs.writeFileSync(droits,JSON.stringify({autorises:['operator@example.invalid']}));
 const reserve=http.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,[path.resolve(__dirname,'../bin/cockpit.js')],{env:{...process.env,COCKPIT_PORT:String(port),COCKPIT_HOTE:'127.0.0.1',COCKPIT_CONTENEUR:'1',COCKPIT_SOCKET:socket,COCKPIT_IDENTITE_SOCKET_SEULE:'1',COCKPIT_TAILNET:'cockpit.example.invalid',ORCH_EVENT_STORE:file,LIVRAISON_AUTORISES_FICHIER:droits,APPROVALS_DIR:dir,CONSEILLER_BASE:path.join(dir,'conseiller.sqlite')},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const demander=(chemin,{methode='GET',qui='operator@example.invalid',origin,corps={},tcp=false}={})=>new Promise((resolve,reject)=>{
  const headers={Host:'cockpit.example.invalid',...(qui?{'Tailscale-User-Login':qui}:{}),...(origin?{Origin:origin}:{}),'Content-Type':'application/json'};
  const q=http.request({...(tcp?{host:'127.0.0.1',port}:{socketPath:socket}),path:chemin,method:methode,headers},r=>{let t='';r.on('data',b=>t+=b);r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(t)}));});q.on('error',reject);q.end(methode==='POST'?JSON.stringify(corps):undefined);
 });
 try{
  for(let i=0;i<200&&!logs.includes('Cockpit sur');i++)await pause(25);assert.ok(logs.includes('Cockpit sur'),logs);
  assert.equal((await demander('/api/execution',{tcp:true})).status,403);
  assert.equal((await demander('/api/execution',{qui:null})).status,403);
  const etat=await demander('/api/execution');assert.equal(etat.status,200);assert.equal(etat.body.pause,false);assert.equal(etat.body.autorise,true);
  assert.equal((await demander('/api/execution/pause',{methode:'POST',qui:'other@example.invalid',corps:{pause:true}})).status,403);
  assert.equal((await demander('/api/execution/pause',{methode:'POST',origin:'https://evil.example.invalid',corps:{pause:true}})).status,403);
  assert.equal((await demander('/api/execution/pause',{methode:'POST',corps:{pause:'oui'}})).status,400);
  assert.equal(store.commandes().length,0);
  const p=await demander('/api/execution/pause',{methode:'POST',corps:{pause:true}});assert.equal(p.status,202);
  assert.equal(store.commande(p.body.id).payload.pause,true);assert.equal(store.commande(p.body.id).par,'operator@example.invalid');
  assert.equal(store.controle.etat().pause,false,'le serveur ne modifie pas directement le journal');
  const c=await demander(`/api/runs/${runId}/annuler`,{methode:'POST'});assert.equal(c.status,202);assert.equal(store.commande(c.body.id).payload.runId,runId);
  assert.equal((await demander('/api/runs/11111111-1111-4111-8111-111111111111/annuler',{methode:'POST'})).status,404);
 }finally{
  if(child.exitCode===null){const fin=new Promise(r=>child.once('close',r));child.kill('SIGTERM');await fin;}store.fermer();fs.rmSync(dir,{recursive:true,force:true});
 }
});
