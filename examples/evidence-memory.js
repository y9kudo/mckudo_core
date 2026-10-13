/** Offline demonstration using the real native planner, with a synthetic world. */
import assert from 'node:assert/strict';
import {createActionEvidenceMemory} from '../mckudo_core.js';
import {planRoute,blockEvidenceValue} from '../kudoconnect/index.js';

const memory=createActionEvidenceMemory({worldId:'evidence-demo'});
const names=Array.from({length:20},(_,i)=>'Agent'+(i+1));
const start={x:0,y:64,z:0};
const air={name:'air',boundingBox:'empty',shapes:[]};
const stone={name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
let support={name:'stone_slab',boundingBox:'block',shapes:[[0,0,0,1,.5,1]]};
const getBlock=p=>p.y<64?support:air;
const readFact=fact=>fact==='position'?'0,64,0':fact==='navigationMode'?'ground':fact.startsWith('block:')?
  blockEvidenceValue(getBlock(Object.fromEntries(fact.slice(6).split(',').map((n,i)=>[['x','y','z'][i],Number(n)])))):null;
let plannerCalls=0,avoided=0;
for(const [i,agentId]of names.entries()){
  const action={skill:'navigate',args:{x:i+1,y:64,z:0}};
  const context={agentId,dimension:'minecraft:overworld',action};
  if(memory.assess({...context,readFact}).blocked){avoided++;continue;}
  plannerCalls++;
  const result=planRoute({start,goal:action.args,getBlock});
  assert.equal(result.failure.code,'START_UNSUPPORTED');memory.record({...context,failure:result.failure});
}
support=stone;
const context={agentId:'Agent20',dimension:'minecraft:overworld',action:{skill:'navigate',args:{x:20,y:64,z:0}}};
const reconsidered=memory.assess({...context,readFact});
const repairedRoute=planRoute({start,goal:context.action.args,getBlock});
assert.equal(reconsidered.blocked,false);assert.equal(repairedRoute.status,'planned');
assert.equal(plannerCalls,1);assert.equal(avoided,19);
console.log(JSON.stringify({kind:'offline-evidence-demonstration',agents:20,plannerCalls,avoided,
  supportRepairReopensRoute:repairedRoute.status==='planned',changedFacts:reconsidered.changedFacts,
  note:'Synthetic start-cell precondition test. This is not a Minecraft performance benchmark.'},null,2));
