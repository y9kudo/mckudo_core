import {createActionEvidenceMemory,createMinecraftBrain,createAgentManager,type Action,type Result} from '../../overmindmc.js';
import {createOMConnect,OMActionError,blockEvidenceValue,planRoute,type ActionFailure} from '../../omconnect/index.js';
const memory=createActionEvidenceMemory({worldId:'test'});
const client=createOMConnect();
const brain=createMinecraftBrain({client,worldId:'test',actionEvidence:memory});
const manager=createAgentManager({worldId:'test',brainOptions:{actionEvidence:memory}});
const action:Action={skill:'navigate',args:{x:0,y:64,z:0}};
const failure:ActionFailure={code:'START_UNSUPPORTED',evidence:{complete:true,facts:{position:'0,64,0',navigationMode:'ground','block:0,63,0':'stone'}}};
const error=new OMActionError(failure.code,'unsupported',failure.evidence);
memory.record({agentId:'Avery',dimension:'minecraft:overworld',action,failure:error});
const assessment=memory.assess({agentId:'Blake',dimension:'minecraft:overworld',action,readFact:()=>null});
const result:Result={at:0,rule:'walk',skill:'navigate',outcome:'failure',detail:error.message,failure:error};
planRoute({start:{x:0,y:0,z:0},goal:{x:1,y:0,z:0},getBlock:()=>null}).failure?.code;
blockEvidenceValue(null);brain.actionEvidence.snapshot().sharedAvoided;
console.log(assessment.blocked,result.failure?.code,manager);
// @ts-expect-error Unknown failure codes must not silently enter integrations.
new OMActionError('MADE_UP','wrong');
// @ts-expect-error Fact values are scalar, not arbitrary executable objects.
memory.record({agentId:'Avery',dimension:'minecraft:overworld',action,failure:{code:'NO_PATH',evidence:{complete:false,facts:{cell:{x:1}}}}});
