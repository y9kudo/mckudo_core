import {parentPort,workerData} from 'node:worker_threads';
import {environmentFactory} from './environment-factory.js';
const environments=workerData.entries.map(({id,seed})=>({id,seed,env:environmentFactory({...workerData.options,seed})}));let generation=0;
parentPort.on('message',message=>{
  try {const results=[];if(message.operation==='reset'){const ids=message.indices&&new Set(message.indices);for(const {id,env} of environments)if(!ids||ids.has(id))results.push({id,result:env.reset()});}
    else if(message.operation==='step')for(const {id,env} of environments)results.push({id,result:env.step(message.actions[id])});
    else if(message.operation==='configure'){generation++;for(const entry of environments){entry.env=environmentFactory({...message.environment,seed:(entry.seed+generation*104729)>>>0});results.push({id:entry.id,result:entry.env.reset()});}}
    else throw new Error('Unknown environment operation');parentPort.postMessage({id:message.id,results});
  }catch(error){parentPort.postMessage({id:message.id,error:error.message});}
});
