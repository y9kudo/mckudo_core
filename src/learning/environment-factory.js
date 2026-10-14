import {createHeadlessEnvironment,HEADLESS_ACTIONS} from './headless.js';
import {createPhysicalEnvironment,PHYSICAL_ACTIONS} from './physical.js';

export function environmentFactory(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('Environment options must be an object');
  const physical=options.kind==='physical';
  if(options.kind!==undefined&&!['skills','physical'].includes(options.kind))throw new Error('Unknown environment kind');
  const keys=physical?['kind','seed','radius','maxSteps','ticksPerStep','mobs','shield','layout','goal','spawnJitter','spawn']:['kind','seed','size','maxSteps','task','hazards','novelty','resources'];
  if(Object.keys(options).some(k=>!keys.includes(k)))throw new Error('Unknown environment option');
  const {kind,...rest}=options;return physical?createPhysicalEnvironment(rest):createHeadlessEnvironment(rest);
}
export function environmentActionCount(options={}){return options.kind==='physical'?PHYSICAL_ACTIONS.length:HEADLESS_ACTIONS.length;}
