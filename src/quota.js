const { etatQuota, AGE_MAX_MS } = require("agent-orchestrator/src/quota-snapshots");
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
