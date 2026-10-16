import {jsonCopy,validateCondition} from './config.js';
import {matches} from './conditions.js';
import {validateScenario} from './scenario.js';
import {createHash} from 'node:crypto';

const fields={action:['action'],resources:['targets'],navigate:['position','range','bridge','excavate'],scenario:['scenario'],sequence:['children'],parallel:['children'],if:['condition','then','else'],repeat:['count','children'],until:['condition','maxIterations','children']};
const scenarioFor=node=>node.type==='scenario'?node.scenario:{schemaVersion:1,name:node.title||node.type,steps:[{id:'step',type:node.type,...Object.fromEntries(fields[node.type].filter(key=>node[key]!==undefined).map(key=>[key,node[key]]))}]};

/** A portable, bounded program document shared by the visual editor and JavaScript API. */
export function validateAgentProgram(input,{skills=[]}={}){
  const program=jsonCopy(input,'program',60000,48),ids=new Set();let count=0;
  if(!program||program.schemaVersion!==1||typeof program.name!=='string'||!program.name.trim()||program.name.length>100||Object.keys(program).some(key=>!['schemaVersion','name','nodes'].includes(key)))throw new Error('Program requires schemaVersion 1, a name and nodes.');
  const list=(nodes,depth)=>{
    if(!Array.isArray(nodes)||nodes.length>64||depth>8)throw new Error('Program nesting: at most 8 levels and 64 nodes per group.');
    for(const node of nodes){
      if(++count>128)throw new Error('Program contains more than 128 blocks.');
      if(!node||!Object.hasOwn(fields,node.type)||typeof node.id!=='string'||!/^[a-z0-9_-]{1,64}$/.test(node.id)||ids.has(node.id))throw new Error('Every program block needs a unique id and a known type.');
      ids.add(node.id);
      if(Object.keys(node).some(key=>!['id','type','title','priority',...fields[node.type]].includes(key)))throw new Error(`Unknown field in block ${node.id}.`);
      if(node.title!==undefined&&(typeof node.title!=='string'||node.title.length>100))throw new Error('Block title: at most 100 characters.');
      if(node.priority!==undefined&&(!Number.isInteger(node.priority)||node.priority< -100||node.priority>100))throw new Error('Block priority: an integer from -100 to 100.');
      if(node.type==='action'){
        jsonCopy(node.action,'program.'+node.id+'.action');
        if(!node.action||!skills.includes(node.action.skill)||Object.keys(node.action).some(key=>!['skill','args'].includes(key))||!node.action.args||typeof node.action.args!=='object'||Array.isArray(node.action.args))throw new Error(`Block ${node.id}: select an available skill and an arguments object.`);
      }else if(['resources','navigate','scenario'].includes(node.type))validateScenario(scenarioFor(node));
      if(node.condition)validateCondition(node.condition,'program.'+node.id+'.condition');
      if(['if','until'].includes(node.type)&&!node.condition)throw new Error(`Block ${node.id} requires a condition.`);
      if(node.type==='repeat'&&(!Number.isInteger(node.count)||node.count<1||node.count>64))throw new Error('Repeat count: 1–64.');
      if(node.type==='until'&&(!Number.isInteger(node.maxIterations)||node.maxIterations<1||node.maxIterations>64))throw new Error('Until requires maxIterations from 1 to 64.');
      if(node.type==='if'){list(node.then,depth+1);list(node.else||[],depth+1);}
      else if(['sequence','parallel','repeat','until'].includes(node.type))list(node.children,depth+1);
    }
  };
  list(program.nodes,0);return program;
}

/** Cooperative control flow; the host still owns the single physical action executor. */
export function createAgentProgram({program,skills=[],scenarioFactory,resume}={}){
  const definition=validateAgentProgram(program,{skills}),states=new Map(),controllers=new Map();let issued=null,lastSelected=0,reason='Ready.',transitions=0;
  const definitionHash=createHash('sha256').update(JSON.stringify(definition)).digest('hex');
  if(resume?.definitionHash&&resume.definitionHash!==definitionHash)throw new Error('Program checkpoint belongs to another definition.');
  const safeReplay=node=>['wait','look','navigate','goto'].includes(node.action?.skill);
  const state=node=>{if(!states.has(node.id))states.set(node.id,{id:node.id,status:'pending',iteration:0,failures:0});return states.get(node.id);};
  const walk=(nodes,fn)=>{for(const node of nodes){fn(node);walk(node.children||node.then||[],fn);if(node.else)walk(node.else,fn);}};
  walk(definition.nodes,node=>{const old=resume?.nodes?.find(value=>value.id===node.id);if(old&&['pending','completed','failed','blocked'].includes(old.status)&&Number.isInteger(old.iteration)&&old.iteration>=0&&old.iteration<=64)states.set(node.id,{id:node.id,status:old.status,iteration:old.iteration,failures:Number.isInteger(old.failures)?Math.min(3,Math.max(0,old.failures)):0,uncertain:old.uncertain===true||old.inFlight===true,...(['then','else'].includes(old.branch)?{branch:old.branch}:{})});});
  const reset=nodes=>walk(nodes,node=>{states.delete(node.id);controllers.delete(node.id);});
  const sequence=(nodes,o)=>{for(const child of nodes){const result=tick(child,o);if(result||state(child).status!=='completed')return result;}return null;};
  const tick=(node,o)=>{
    if(++transitions>256){reason='Program transition budget reached; continuing on the next observation.';return null;}
    const s=state(node);if(s.status==='completed'||s.status==='failed')return null;
    if(node.type==='action'){
      if(s.uncertain&&!safeReplay(node)){s.status='blocked';s.reason='Interrupted action has an unknown outcome; explicitly retry the task after reconciliation.';reason=s.reason;return null;}
      s.uncertain=false;return {leaf:node,action:node.action,priority:20+(node.priority||0),reason:node.title||node.action.skill};
    }
    if(['resources','navigate','scenario'].includes(node.type)){
      if(!scenarioFactory)throw new Error('Program scenarios require scenarioFactory.');
      if(!controllers.has(node.id))controllers.set(node.id,scenarioFactory(scenarioFor(node),resume?.nodes?.find(value=>value.id===node.id)?.scenario));
      const controller=controllers.get(node.id),decision=controller.reactor.react(o),snapshot=controller.snapshot();
      if(snapshot.status==='completed'){s.status='completed';return null;}
      if(snapshot.status==='failed'){s.status='failed';s.reason=snapshot.reason||'Scenario failed.';reason=s.reason;return null;}
      s.status=decision.action?'pending':'blocked';s.reason=decision.reason||'';reason=s.reason;
      return decision.action?{...decision,leaf:node,priority:(decision.priority??20)+(node.priority||0)}:null;
    }
    let result;
    if(node.type==='parallel'){
      const choices=node.children.map(child=>tick(child,o)).filter(Boolean);
      choices.sort((a,b)=>b.priority-a.priority);
      if(choices.length){const best=choices.filter(value=>value.priority===choices[0].priority);result=best[lastSelected++%best.length];}
      else if(node.children.every(child=>state(child).status==='completed'))s.status='completed';
    }else if(node.type==='if'){
      s.branch??=matches(node.condition,o)?'then':'else';
      const branch=node[s.branch]||[];result=sequence(branch,o);
      if(branch.every(child=>state(child).status==='completed'))s.status='completed';
    }else if(node.type==='repeat'||node.type==='until'){
      const limit=node.type==='repeat'?node.count:node.maxIterations;
      if(node.type==='until'&&matches(node.condition,o)){s.status='completed';return null;}
      if(s.iteration>=limit){s.status=node.type==='repeat'?'completed':'failed';s.reason='Maximum iterations reached before the condition became true.';reason=s.reason;return null;}
      result=sequence(node.children,o);
      if(node.children.every(child=>state(child).status==='completed')){s.iteration++;if(node.type==='repeat'&&s.iteration>=limit)s.status='completed';else if(s.iteration<limit)reset(node.children);}
    }else{
      result=sequence(node.children,o);if(node.children.every(child=>state(child).status==='completed'))s.status='completed';
    }
    if(result)return {...result,priority:result.priority+(node.priority||0)};
    const children=[...(node.children||node.then||[]),...(node.else||[])];
    if(children.some(child=>state(child).status==='failed')){s.status='failed';s.reason=children.map(child=>state(child)).find(child=>child.status==='failed')?.reason||'A child block failed.';reason=s.reason;}
    return null;
  };
  return {
    definition:()=>jsonCopy(definition,'program',60000,48),
    beginAction(){if(issued)state(issued).inFlight=true;},
    reactor:{id:'overmind:program',apiVersion:1,react(o){transitions=0;issued=null;const result=sequence(definition.nodes,o);if(!result)return {action:null,reason};issued=result.leaf;return {action:result.action,priority:result.priority,reason:result.reason};}},
    recordResult(event,action){if(!issued)return;const node=issued,s=state(node);issued=null;controllers.get(node.id)?.recordResult?.(event,action);
      s.inFlight=false;s.uncertain=node.type==='action'&&event.outcome!=='success'&&!safeReplay(node);
      if(event.outcome==='success'){s.status=node.type==='action'?'completed':'pending';s.failures=0;s.reason='';}
      else if(event.outcome==='failure'){s.failures++;s.status=s.failures>=3?'failed':'blocked';s.reason=String(event.detail||'Action failed.');reason=s.reason;}
      else s.status='pending';
    },
    snapshot(){walk(definition.nodes,node=>state(node));const nodes=[...states.values()].map(value=>{const scenario=controllers.get(value.id)?.exportMemory?.()||resume?.nodes?.find(n=>n.id===value.id)?.scenario;return {...value,...(scenario?{scenario}:{})};});return {definitionHash,status:definition.nodes.every(node=>state(node).status==='completed')?'completed':nodes.some(node=>node.status==='failed')?'failed':'running',active:issued?.id||null,reason,nodes};}
  };
}
