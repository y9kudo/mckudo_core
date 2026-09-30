import {sleepTime} from '../packages/kudoconnect/src/rest.js';
/** A failed night attempt yields to normal work; it never traps the planner in retries. */
export function createNightReactor({retryMs=60000,clock=Date.now}={}){
  if(!Number.isInteger(retryMs)||retryMs<1000||retryMs>600000)throw new Error('night.retryMs: 1000–600000.');
  let nextAttempt=0;
  const r={id:'mckudo:night',apiVersion:1,react(o){
    if(o.dimension!=='minecraft:overworld'||!sleepTime(o.time?.timeOfDay))return {action:null,reason:'Сон сейчас не требуется.'};
    if(o.self.sleeping)return {priority:980,action:{skill:'wait',args:{durationMs:1000}},reason:'Ожидать пробуждения.'};
    if(clock()<nextAttempt)return {action:null,reason:'После неудачной попытки сна продолжать работу.'};
    const bed=(o.world?.sampledBlocks||[]).find(b=>b.name.endsWith('_bed')&&!b.properties?.occupied);
    if(bed)return {priority:50,action:{skill:'sleep',args:{...bed.position,maxWaitMs:10000}},reason:'Попробовать спать в доступной кровати.'};
    const inventory=o.inventory||{},hasBed=Object.entries(inventory).some(([n,c])=>c>0&&n.endsWith('_bed')),hasWool=Object.entries(inventory).some(([n,c])=>c>=3&&n.endsWith('_wool'));
    if(hasBed||hasWool)return {priority:50,action:{skill:'prepareBed',args:{}},reason:'Подготовить свою кровать для ночи.'};
    return {action:null,reason:'Нет кровати и достаточной шерсти; продолжать работу.'};
  },attach(core){let skill;const start=e=>{if(e.id===r.id)skill=e.action.skill;};const finish=e=>{if(e.rule===r.id&&(e.outcome!=='success'||skill==='sleep'))nextAttempt=clock()+retryMs;};core.on('action:start',start);core.on('action:finish',finish);return()=>{core.off('action:start',start);core.off('action:finish',finish);};}};return r;
}
