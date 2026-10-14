import { jsonCopy } from './config.js';
import { validateScenario } from './scenario.js';

/** Compile friendly JSON into the same validated, observable core scenario. */
export function defineMission(input, { name = "Agent plan" } = {}) {
  const steps = jsonCopy(input, 'mission');
  if (!Array.isArray(steps) || !steps.length || steps.length > 64) throw new Error("mission: - Tell me about it 1 to 64 Steps in the array [...].");
  const item = (value, path, allowClass) => {
    if (typeof value !== 'string' || !(allowClass && /^#[a-z0-9_:.-]+$/.test(value) || /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(value))) throw new Error(`${path}: requires ID, for example stone_pickaxe${allowClass ? ", or Class #logs" : ''}.`);
    return value.startsWith('#') || value.includes(':') ? value : 'minecraft:' + value;
  };
  return validateScenario({ schemaVersion:1, name, steps:steps.map((step, i) => {
    const path = `mission[${i}]`, id = 'step_' + (i + 1);
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`${path}: an object is required { get: '#logs', count: 8 }.`);
    const kinds = ['get','craft','go','swim','nether'].filter(k=>Object.hasOwn(step,k));
    if (kinds.length !== 1) throw new Error(`${path}: Choose exactly one command: get, craft, go, swim or nether.`);
    const kind=kinds[0], allowed=kind==='nether'?['nether']:kind==='swim'?['swim']:kind==='go'?['go','range','bridge','excavate']: [kind,'count'];
    const extra=Object.keys(step).find(k=>!allowed.includes(k));
    if(extra)throw new Error(`${path}.${extra}: unknown field.`);
    if(kind==='nether'){
      if(!step.nether||typeof step.nether!=='object'||Array.isArray(step.nether))throw new Error(`${path}.nether: map of items and quantities.`);
      return {id,type:'netherResources',targets:Object.fromEntries(Object.entries(step.nether).map(([id,n])=>[item(id,path+'.nether',false),n]))};
    }
    if(kind==='swim')return {id,type:'swim',position:step.swim};
    if(kind==='go')return {id,type:'navigate',position:step.go,...Object.fromEntries(['range','bridge','excavate'].filter(k=>Object.hasOwn(step,k)).map(k=>[k,step[k]]))};
    const target=item(step[kind],path+'.'+kind,kind==='get'), count=step.count??1;
    if(!Number.isInteger(count)||count<1||count>4096)throw new Error(`${path}.count: whole number of 1 to 4096.`);
    return {id,type:'resources',targets:{[target]:count}};
  }) });
}
