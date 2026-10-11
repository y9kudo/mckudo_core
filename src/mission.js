import { jsonCopy } from './config.js';
import { validateScenario } from './scenario.js';

/** Compile friendly JSON into the same validated, observable core scenario. */
export function defineMission(input, { name = 'План агента' } = {}) {
  const steps = jsonCopy(input, 'mission');
  if (!Array.isArray(steps) || !steps.length || steps.length > 64) throw new Error('mission: укажи от 1 до 64 шагов в массиве [...].');
  const item = (value, path, allowClass) => {
    if (typeof value !== 'string' || !(allowClass && /^#[a-z0-9_:.-]+$/.test(value) || /^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(value))) throw new Error(`${path}: нужен ID, например stone_pickaxe${allowClass ? ', или класс #logs' : ''}.`);
    return value.startsWith('#') || value.includes(':') ? value : 'minecraft:' + value;
  };
  return validateScenario({ schemaVersion:1, name, steps:steps.map((step, i) => {
    const path = `mission[${i}]`, id = 'step_' + (i + 1);
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`${path}: нужен объект { get: '#logs', count: 8 }.`);
    const kinds = ['get','craft','go','swim'].filter(k=>Object.hasOwn(step,k));
    if (kinds.length !== 1) throw new Error(`${path}: выбери ровно одну команду get, craft, go или swim.`);
    const kind=kinds[0], allowed=kind==='swim'?['swim']:kind==='go'?['go','range','bridge','excavate']: [kind,'count'];
    const extra=Object.keys(step).find(k=>!allowed.includes(k));
    if(extra)throw new Error(`${path}.${extra}: неизвестное поле.`);
    if(kind==='swim')return {id,type:'swim',position:step.swim};
    if(kind==='go')return {id,type:'navigate',position:step.go,...Object.fromEntries(['range','bridge','excavate'].filter(k=>Object.hasOwn(step,k)).map(k=>[k,step[k]]))};
    const target=item(step[kind],path+'.'+kind,kind==='get'), count=step.count??1;
    if(!Number.isInteger(count)||count<1||count>4096)throw new Error(`${path}.count: целое число от 1 до 4096.`);
    return {id,type:'resources',targets:{[target]:count}};
  }) });
}
