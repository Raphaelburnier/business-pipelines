// Vrai runner et vraie CLI du moteur ; seul le fournisseur est remplacé par un
// exécutable déterministe. Aucun quota réel, aucun appel de modèle, aucune publication.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { EventStore } = require("agent-orchestrator");
const registre = require("agent-orchestrator/src/registre");
const mission = require("agent-orchestrator/src/mission");
const { reprendreRun, terminerReprise } = require("../src/reprises-runs");
const api = require("../src/api-lecture");
const RACINE = path.resolve(__dirname, "..");
const pause = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(fn, detail, ms = 15000) {
  const fin=Date.now()+ms;
  while(Date.now()<fin) { const r=fn(); if(r)return r; await pause(25); }
  throw new Error(`Attente expirée : ${detail()}`);
}
function fixture(mode = "quota") {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"reprises-run-"));
  const projets=path.join(dir,"projects"), reg=path.join(dir,"registre"), bin=path.join(dir,"bin");
  for(const d of [path.join(projets,"demo"),path.join(reg,"pipelines/demo/v1"),path.join(reg,"agents/codeur/v1"),bin])fs.mkdirSync(d,{recursive:true});
  fs.writeFileSync(path.join(reg,"agents/codeur/v1/agent.md"),`---\nname: codeur\nversion: 1\ndescription: Codeur fictif\ndefaultLlm: { via: codex, model: gpt }\nallowedTools: [Read, Write]\nskills: []\n---\nProduit le livrable de recette.\n`);
  fs.writeFileSync(path.join(reg,"pipelines/demo/v1/pipeline.json"),JSON.stringify({name:"demo",version:1,nodes:[
    {id:"preparer",type:"script",runsOn:["machine","parallele"].includes(mode) ? "nas" : "pc",run:process.execPath,args:["-e",'const fs=require("fs");fs.writeFileSync("compteur.txt",String(Number(fs.existsSync("compteur.txt")?fs.readFileSync("compteur.txt","utf8"):0)+1));']},
    {id:"code",type:"agent",agent:"codeur@1",runsOn:"pc",slice:"*",outputs:["livrable.txt"]},
  ],edges:[{from:"preparer",to:"code"}]}));
  const fiche=path.join(projets,"demo/project.json");
  fs.writeFileSync(fiche,JSON.stringify({id:"demo",name:"Demo",business:"recette",homeMachine:"pc",repo:"/sans-depot",pipelines:[{extends:"demo@1",spec:"spec.json"}]}));
  fs.writeFileSync(path.join(projets,"demo/spec.json"),JSON.stringify({project_name:"demo",task:"OBJECTIF_FIGE"}));
  fs.writeFileSync(path.join(dir,"workers.json"),'{"workers":[]}');
  fs.writeFileSync(path.join(bin,"codex"),`#!/usr/bin/env node
const fs=require('fs');
if(process.argv[2]==='app-server')process.exit(0); // lecture de quota sans appel d’agent
if(process.argv[2]==='login'){process.stderr.write('Logged in using ChatGPT');process.exit(0);}
let entree='';process.stdin.setEncoding('utf8');process.stdin.on('data',x=>entree+=x);process.stdin.on('end',()=>{
 const appel={args:process.argv.slice(2),cwd:process.cwd(),entree};
 fs.appendFileSync(process.env.RECETTE_APPELS,JSON.stringify(appel)+'\\n');
 console.log(JSON.stringify({type:'thread.started',thread_id:'session-native'}));
 if(!fs.existsSync(process.env.RECETTE_PRET)){
  fs.writeFileSync('partiel.txt','travail à conserver');
  const connu=process.env.RECETTE_MODE==='quota';
  const error={message:process.env.RECETTE_MODE==='auth'?'Authentication token expired':'Usage limit reached',...(connu?{resets_at:Math.floor(Date.now()/1000)+3}:{})};
  console.log(JSON.stringify({type:'turn.failed',error}));process.exitCode=1;return;
 }
 fs.writeFileSync('livrable.txt','fait');
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fait'}}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}}));
});
`,{mode:0o755});
  const file=path.join(dir,"events.sqlite"), store=new EventStore(file);
  const resolution=registre.resoudreProjet(fiche,{registre:reg});
  resolution.spec._mission={objectif:"OBJECTIF_FIGE",criteres:["livrable"],document:"SPEC_FIGEE",objectifFeuille:{id:"1.1",revision:1}};
  const contrat=mission.figer({resolution,demande:{objectif:"OBJECTIF_FIGE",criteres:["livrable"],directives:"DIRECTIVE_FIGEE",exclusions:"",document:"SPEC_FIGEE"},participants:[{noeud:"code",membre:null,llm:{via:"codex",model:"gpt"},nom:"Codeur",agent:"codeur@1",type:"agent"}]});
  const commande=store.creerCommande({kind:"run.start",payload:{projectId:"demo",mission:contrat},par:"recette"});
  const pret=path.join(dir,"pret"), appels=path.join(dir,"appels.jsonl");
  const env={...process.env,PATH:`${bin}:${process.env.PATH}`,ORCH_EVENT_STORE:file,COCKPIT_PROJETS_DIR:projets,ORCH_REGISTRE:reg,OUTPUT_ROOT:path.join(dir,"workspaces"),NO_VCS:"1",ORCH_ROLE:"pc",ORCH_MACHINE:"pc",COMMAND_POLL_MS:"10",ORCH_MAITRE_PORT:"0",ORCH_MAITRE_HOTE:"127.0.0.1",ORCH_WORKERS:path.join(dir,"workers.json"),RECETTE_MODE:mode,RECETTE_PRET:pret,RECETTE_APPELS:appels};
  if (["machine","parallele"].includes(mode)) {
    // Le vrai maître, sa file durable et la vraie CLI ; seul le transport du worker est
    // déterministe. Aucun changement de source de production ni appel fournisseur.
    const precharge = path.join(dir, "maitre-recette.cjs");
    fs.writeFileSync(precharge, `
const fs=require('node:fs');
const moteur=require(${JSON.stringify(require.resolve("agent-orchestrator"))});
const {MachineIndisponible}=require(${JSON.stringify(require.resolve("agent-orchestrator/src/maitre"))});
class MaitreRecette extends moteur.Maitre {
 constructor(options){
  super(options);
  if(process.argv[1].endsWith('/orch.js'))throw new Error('La CLI a ouvert un second maître');
  if(process.env.ORCH_MAITRE_EXTERNE==='1'&&process.argv[1].endsWith('/commande-runner.js'))throw new Error('Le runner isolé a ouvert un second maître');
  this.store.majMachine({id:'pc',state:'online',heartbeat:true,meta:{capacites:{missions:1,backends:['codex'],noeuds:['agent','script']}}});
  if(process.env.RECETTE_MODE==='parallele'||process.env.ORCH_MAITRE_EXTERNE==='1')this.connexions.set('pc',{capacites:{concurrence:1},socket:{close(){},terminate(){}}});
 }
 machineDisponible(machine){return machine==='pc'&&(process.env.RECETTE_MODE==='parallele'||fs.existsSync(process.env.RECETTE_PRET));}
 async executer(machine,etape){
  fs.appendFileSync(process.env.RECETTE_APPELS,JSON.stringify({machine,etape})+'\\n');
  if(process.env.RECETTE_MODE==='parallele')while(!fs.existsSync(process.env.RECETTE_PRET))await new Promise(r=>setTimeout(r,10));
  if(!fs.existsSync(process.env.RECETTE_PRET))throw new MachineIndisponible('worker de recette absent');
  return {statut:'succeeded',outcome:null};
 }
}
moteur.Maitre=MaitreRecette;
`);
    env.ORCH_ROLE = "nas"; env.ORCH_MACHINE = "nas";
    env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ""} --require=${precharge}`.trim();
  }
  const enfants=[];
  function processus(script){
    const c=spawn(process.execPath,[path.join(RACINE,script)],{cwd:RACINE,env,detached:true,stdio:["ignore","pipe","pipe"]});
    c.sortie="";for(const flux of [c.stdout,c.stderr])flux.on("data",d=>c.sortie=(c.sortie+d).slice(-16000));
    c.termine=new Promise(r=>c.once("close",r));enfants.push(c);return c;
  }
  function runner(){return processus("bin/commande-runner.js");}
  async function separerMaitre(){
    const serveur=require("node:http").createServer();
    await new Promise(r=>serveur.listen(0,"127.0.0.1",r));
    const port=serveur.address().port;await new Promise(r=>serveur.close(r));
    env.ORCH_MAITRE_PORT=String(port);env.ORCH_MAITRE_EXTERNE="1";
    return processus("bin/maitre-permanent.js");
  }
  async function arreter(c,signal="SIGTERM") {if(c.exitCode!==null||c.signalCode!==null)return;c.kill(signal);await c.termine;}
  const lectures=()=>fs.existsSync(appels)?fs.readFileSync(appels,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse):[];
  async function fermer(){for(const c of enfants)await arreter(c);store.fermer();fs.rmSync(dir,{recursive:true,force:true});}
  return {dir,store,commande,contrat,pret,runner,separerMaitre,arreter,lectures,fermer,projets};
}

test("quota connu, redémarrage : même run, mission, workspace et session, sans refaire une étape",async()=>{
  const f=fixture();
  try {
    const premier=f.runner();
    const runId=await jusqua(()=>f.store.commande(f.commande.id).status==="done"&&f.store.commande(f.commande.id).run_id,()=>premier.sortie);
    const attente=f.store.attentes.vue(runId);
    assert.equal(attente.statut,"waiting_quota");assert.ok(attente.prochaineReprise);assert.equal(attente.resetSource,"provider.resets_at");
    const affectationInitiale=api.objectifsAvenirs(f.store).find(a=>a.objectif.id==="1.1");
    assert.equal(affectationInitiale.runId,runId);assert.equal(affectationInitiale.statut,"waiting_quota");
    await f.arreter(premier);
    fs.writeFileSync(f.pret,"oui");
    fs.writeFileSync(path.join(f.projets,"demo/project.json"),"fiche modifiée et invalide");
    fs.writeFileSync(path.join(f.projets,"demo/spec.json"),'{"task":"AUTRE_OBJECTIF"}');
    const second=f.runner();
    await jusqua(()=>f.store.run(runId).status==="succeeded",()=>second.sortie);
    await jusqua(()=>f.store.commandes().some(c=>c.kind==="run.resume"&&c.status==="done"),()=>second.sortie);
    const affectationReprise=api.objectifsAvenirs(f.store).find(a=>a.objectif.id==="1.1");
    assert.equal(affectationReprise.commandeId,affectationInitiale.commandeId,"la reprise conserve la commande qui porte l'objectif");
    assert.equal(affectationReprise.runId,runId,"la reprise conserve le run d'origine");
    assert.equal(f.store.run(runId).status,"succeeded");
    assert.equal(affectationReprise.statut,"completed");
    assert.equal(affectationReprise.livraison.statut,null,"l'exécution et la livraison sont projetées dans des champs distincts");
    const appels=f.lectures();assert.equal(appels.length,2);assert.equal(appels[0].cwd,appels[1].cwd);
    assert.ok(appels[1].args.includes("resume"));assert.ok(appels[1].args.includes("session-native"));
    assert.ok(appels[1].entree.includes("OBJECTIF_FIGE"));assert.ok(appels[1].entree.includes("SPEC_FIGEE"));assert.ok(!appels[1].entree.includes("AUTRE_OBJECTIF"));
    assert.equal(fs.readFileSync(path.join(appels[1].cwd,"compteur.txt"),"utf8"),"1");
    assert.equal(fs.readFileSync(path.join(appels[1].cwd,"partiel.txt"),"utf8"),"travail à conserver");
    assert.equal(f.store.runs().length,1);assert.equal(f.store.commandes().filter(c=>c.kind==="run.start").length,1);
    assert.deepEqual(f.store.commandeLancementRun(runId).payload.mission,JSON.parse(JSON.stringify(f.contrat)));
    await f.arreter(second);const troisieme=f.runner();await pause(300);assert.equal(f.lectures().length,2);await f.arreter(troisieme);
  } finally {await f.fermer();}
});

test("auth : aucun timer ; reprise manuelle dédupliquée après confirmation",async()=>{
  const f=fixture("auth");
  try {
    const runner=f.runner();
    const runId=await jusqua(()=>f.store.commande(f.commande.id).status==="done"&&f.store.commande(f.commande.id).run_id,()=>runner.sortie);
    const vue=api.run(f.store,runId);assert.equal(vue.attente.prochaineReprise,null);
    await pause(150);assert.equal(f.lectures().length,1);
    assert.throws(()=>f.store.attentes.demander(runId,{waitId:vue.attente.id,par:"recette"}),/reconnexion/);
    fs.writeFileSync(f.pret,"oui");
    const demande={waitId:vue.attente.id,par:"recette",reconnexionConfirmee:true};
    const a=f.store.attentes.demander(runId,demande),b=f.store.attentes.demander(runId,demande);assert.equal(a.id,b.id);
    await jusqua(()=>f.store.commande(a.id).status==="done",()=>runner.sortie);
    assert.equal(f.store.run(runId).status,"succeeded");assert.equal(f.lectures().length,2);
    assert.equal(f.lectures()[1].cwd,f.lectures()[0].cwd);assert.ok(f.lectures()[1].args.includes("session-native"));
  } finally {await f.fermer();}
});

for (const historique of [false, true]) test(`quota sans échéance${historique ? " depuis 40 h" : ""} : reprise automatique du même run après redémarrage`, async () => {
  const f = fixture("inconnu");
  try {
    const premier = f.runner();
    const runId = await jusqua(() => f.store.commande(f.commande.id).status === "done" && f.store.commande(f.commande.id).run_id, () => premier.sortie);
    const vue = api.run(f.store, runId);
    assert.equal(vue.attente.resetAt, null);
    assert.ok(vue.attente.prochaineReprise);
    await pause(150); assert.equal(f.lectures().length, 1);
    await f.arreter(premier);
    // Avancer les dates de la base temporaire représente la fenêtre écoulée, sans
    // attendre réellement cinq heures ni modifier une horloge de production.
    const fige = Date.now(), ancien = new Date(fige-(historique ? 40 : 5)*3600_000-2000).toISOString();
    const w = f.store.attentes.lire(runId), cause = { ...w.cause };
    if (historique) { delete cause.politiqueQuota; delete cause.quotaLe; delete cause.reessaiAuPlusTot; }
    else { cause.quotaLe = ancien; cause.reessaiAuPlusTot = new Date(fige-1000).toISOString(); }
    f.store.db.prepare("UPDATE run_waits SET cause_json=?,first_wait_at=?,deadline=?,next_retry_at=?,reason=?,updated_at=? WHERE run_id=?")
      .run(JSON.stringify(cause), ancien, new Date(Date.parse(ancien)+24*3600_000).toISOString(), historique ? null : cause.reessaiAuPlusTot,
        historique ? "échéance inconnue" : null, ancien, runId);
    f.store.db.prepare("UPDATE events SET ts=? WHERE run_id=? AND type='run.waiting_runtime'").run(ancien, runId);
    fs.writeFileSync(f.pret, "oui");
    fs.writeFileSync(path.join(f.projets, "demo/project.json"), "fiche devenue invalide");
    const second = f.runner();
    await jusqua(() => f.store.run(runId).status === "succeeded", () => second.sortie);
    await jusqua(() => f.store.commandes().some(c => c.kind === "run.resume" && c.status === "done"), () => second.sortie);
    const appels = f.lectures(); assert.equal(appels.length, 2);
    assert.equal(appels[0].cwd, appels[1].cwd);
    assert.ok(appels[1].args.includes("resume")); assert.ok(appels[1].args.includes("session-native"));
    assert.ok(appels[1].entree.includes("OBJECTIF_FIGE")); assert.ok(appels[1].entree.includes("SPEC_FIGEE"));
    assert.equal(fs.readFileSync(path.join(appels[1].cwd, "compteur.txt"), "utf8"), "1");
    assert.equal(fs.readFileSync(path.join(appels[1].cwd, "partiel.txt"), "utf8"), "travail à conserver");
    assert.equal(f.store.runs().length, 1);
    assert.equal(f.store.commandes().filter(c => c.kind === "run.start").length, 1);
    assert.equal(f.store.attentes.lire(runId).first_wait_at, ancien);
    await f.arreter(second);
    const troisieme = f.runner(); await pause(250); await f.arreter(troisieme);
    assert.equal(f.lectures().length, 2);
  } finally { await f.fermer(); }
});

test("un second runner ne remet pas les commandes réservées par le premier en file",async()=>{
  const f=fixture("inconnu");
  try {
    const premier=f.runner();await jusqua(()=>f.store.commande(f.commande.id).status==="done",()=>premier.sortie);
    const second=f.runner();await second.termine;
    assert.equal(second.exitCode,1);assert.match(second.sortie,/détient déjà le bail/);assert.equal(f.lectures().length,1);
  } finally {await f.fermer();}
});

test("un rejeu après réussite acquitte la reprise sans rappeler la CLI ni publier",async()=>{
  const f=fixture("inconnu");
  try {
    const runId=f.store.creerRun({pipelineRef:"demo@1",projectId:"demo"});
    const a=f.store.attentes.enregistrer(runId,{name:"QuotaAtteint"});
    const commande=f.store.attentes.demander(runId,{waitId:a.wait_id,par:"recette"});
    f.store.statutRun(runId,"succeeded");
    const r=await reprendreRun({store:f.store,commande,lancer:()=>{throw new Error("double lancement");},lancementDe:()=>{throw new Error("double publication");}});
    assert.equal(r.detail.dejaTraitee,true);
  } finally {await f.fermer();}
});

test("acquittement de reprise atomique : une panne intermédiaire conserve commande et attente rejouables", async () => {
  const f = fixture("inconnu");
  try {
    const runId = f.store.creerRun({ pipelineRef: "demo@1", projectId: "demo" });
    const a = f.store.attentes.enregistrerMachine(runId, { name: "MachineIndisponible", machine: "pc" });
    const c = f.store.attentes.demander(runId, { waitId: a.wait_id, par: "test" });
    f.store.prendreCommande({ kinds: ["run.resume"] });
    const terminer = f.store.attentes.terminer;
    f.store.attentes.terminer = function (commande) { terminer.call(this, commande); throw new Error("panne pendant la libération"); };
    assert.throws(() => terminerReprise({ store: f.store, commande: c, resultat: { ok: true } }), /panne pendant/);
    assert.equal(f.store.commande(c.id).status, "taken");
    assert.equal(f.store.attentes.lire(runId).active_command_id, c.id);
    f.store.attentes.terminer = terminer;
    terminerReprise({ store: f.store, commande: c, resultat: { ok: true } });
    assert.equal(f.store.commande(c.id).status, "done");
    assert.equal(f.store.attentes.lire(runId).active_command_id, null);
  } finally { await f.fermer(); }
});

for (const separe of [false, true]) test(`retour machine après redémarrage : même run et contrat, maître séparé=${separe}`, async () => {
  const f = fixture("machine");
  try {
    if (separe) await f.separerMaitre();
    const premier = f.runner();
    const runId = await jusqua(() => f.store.commande(f.commande.id).status === "done" && f.store.commande(f.commande.id).run_id, () => premier.sortie);
    assert.equal(f.store.run(runId).status, "waiting_machine");
    assert.equal(f.store.attentes.vue(runId).machine, "pc");
    await pause(1200);
    assert.equal(f.lectures().length, 1, "l'état online historique ne suffit pas à déclencher une reprise");
    assert.equal(f.store.attentes.lire(runId).attempts, 0);
    await f.arreter(premier);
    fs.writeFileSync(f.pret, "oui");
    fs.writeFileSync(path.join(f.projets, "demo/project.json"), "fiche invalide après départ");
    const second = f.runner();
    await jusqua(() => f.store.run(runId).status === "succeeded", () => second.sortie);
    await jusqua(() => f.store.commandes().some(c => c.kind === "run.resume" && c.status === "done"), () => second.sortie);
    assert.equal(f.store.runs().length, 1);
    assert.equal(f.store.commandes().filter(c => c.kind === "run.start").length, 1);
    assert.equal(f.lectures().length, 2);
    assert.deepEqual(f.lectures()[0].etape.spec, f.lectures()[1].etape.spec);
    assert.ok(JSON.stringify(f.lectures()[1].etape.spec).includes("OBJECTIF_FIGE"));
    const espace = path.join(f.dir, "workspaces", "demo", runId);
    assert.equal(fs.readFileSync(path.join(espace, "compteur.txt"), "utf8"), "1");
    assert.equal(f.store.etapes(runId).filter(e => e.node_id === "preparer").length, 1);
    assert.doesNotMatch(second.sortie, /EADDRINUSE|second maître/);
    await f.arreter(second);
    const troisieme = f.runner(); await pause(250); await f.arreter(troisieme);
    assert.equal(f.lectures().length, 2);
  } finally { await f.fermer(); }
});

for (const restant of [null,25,24]) test(`trois objectifs prêts : deux simultanés, priorité selon le quota ${restant ?? 'inconnu'}`,async()=>{
  const f=fixture('parallele');
  try {
    const deuxieme=f.store.creerCommande({kind:'run.start',payload:f.commande.payload,par:'recette'});
    const prioritaire=f.store.creerCommande({kind:'run.start',payload:{...f.commande.payload,scheduling:{source:'calendar',priority:'haute'}},par:'recette'});
    if(restant!==null)for(const runtime of ['claude','codex'])f.store.emettre({type:'runtime.quota_snapshot',payload:{runtime,observeLe:new Date().toISOString(),fenetres:[{id:'primary',restant,utilisation:100-restant,reinitialisation:null}]}});
    const runner=f.runner();
    await jusqua(()=>f.lectures().length===2,()=>runner.sortie);
    assert.equal(f.store.runs().filter(r=>r.status==='running').length,2);
    assert.equal(f.store.commandes().filter(c=>c.kind==='run.start'&&c.status==='pending').length,1);
    assert.equal(f.store.commande(prioritaire.id).status,restant===24?'taken':'pending','le toggle agit uniquement sous 25 %');
    assert.equal(f.store.commande(deuxieme.id).status,restant===24?'pending':'taken');
    await pause(200);assert.equal(f.lectures().length,2,'la capacité empêche le troisième lancement');
    fs.writeFileSync(f.pret,'oui');
    await jusqua(()=>f.store.runs().filter(r=>r.status==='succeeded').length===3,()=>runner.sortie);
    assert.equal(f.lectures().length,3);
    assert.equal(new Set(f.lectures().map(a=>a.etape.runId)).size,3);
  }finally{await f.fermer();}
});
