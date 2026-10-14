import {performance} from 'node:perf_hooks';
import {integer,finite,randomSource} from '../learning/contracts.js';

export function createGoalStack({capacity=256,clock=Date.now}={}) {
  integer(capacity,1,4096,'capacity');const goals=new Map();let serial=0;
  const api={
    push({id,priority=0,payload={},dependsOn=[]}){if(typeof id!=='string'||!id.length||id.length>128||goals.has(id)||goals.size>=capacity)throw new Error('Unique goal ID and free capacity required');finite(priority,-1e6,1e6,'priority');if(!Array.isArray(dependsOn)||dependsOn.some(d=>!goals.has(d)))throw new Error('Dependencies must reference existing goals');goals.set(id,{id,priority,payload:structuredClone(payload),dependsOn:[...dependsOn],status:'pending',order:serial++,createdAt:clock(),attempts:0});return id;},
    next(){const g=[...goals.values()].filter(g=>['pending','active'].includes(g.status)&&g.dependsOn.every(id=>goals.get(id)?.status==='completed')).sort((a,b)=>b.priority-a.priority||a.order-b.order)[0];if(!g)return null;if(g.status!=='active'){g.status='active';g.attempts++;}return structuredClone(g);},
    finish(id,{success=true,retry=false}={}){const g=goals.get(id);if(!g||g.status!=='active')throw new Error('Goal is not active');g.status=success?'completed':retry?'pending':'failed';g.finishedAt=clock();},
    recover(){for(const g of goals.values())if(g.status==='active')g.status='pending';},
    setPriority(id,priority){finite(priority,-1e6,1e6,'priority');const g=goals.get(id);if(!g)throw new Error('Unknown goal');g.priority=priority;},
    snapshot:()=>structuredClone([...goals.values()])
  };return api;
}

/** HTN decomposition with alternative methods, state simulation and bounded backtracking. */
export function createHTNPlanner({primitives={},methods={},maxNodes=2048,maxDepth=32,maxPlan=256}={}) {
  integer(maxNodes,1,100000,'maxNodes');integer(maxDepth,1,128,'maxDepth');integer(maxPlan,1,4096,'maxPlan');
  for(const p of Object.values(primitives))if(typeof p?.applicable!=='function'||typeof p.apply!=='function'||typeof p.action!=='function')throw new TypeError('HTN primitives require applicable, apply and action');
  for(const list of Object.values(methods))if(!Array.isArray(list)||list.some(m=>typeof m?.applicable!=='function'||typeof m.tasks!=='function'))throw new TypeError('HTN methods require applicable and tasks');
  return {plan(tasks,initial,{signal}={}){
    if(!Array.isArray(tasks)||tasks.length>maxPlan)throw new Error('HTN task list');let visited=0,budget=false;
    const search=(todo,state,plan,depth)=>{signal?.throwIfAborted();if(++visited>maxNodes||depth>maxDepth||plan.length>maxPlan){budget=true;return null;}if(!todo.length)return {actions:plan,state};const [task,...rest]=todo;if(typeof task?.name!=='string')throw new Error('HTN task requires name');const primitive=Object.hasOwn(primitives,task.name)?primitives[task.name]:null;
      if(primitive){if(!primitive.applicable(structuredClone(state),task.args))return null;const next=primitive.apply(structuredClone(state),task.args),action=primitive.action(structuredClone(state),task.args);if(!action||typeof action.skill!=='string')throw new Error('HTN primitive action requires skill');return search(rest,next,[...plan,structuredClone(action)],depth);}
      for(const m of Object.hasOwn(methods,task.name)?methods[task.name]:[]){if(!m.applicable(structuredClone(state),task.args))continue;const children=m.tasks(structuredClone(state),task.args);if(!Array.isArray(children)||children.length>maxPlan)throw new Error('HTN method expansion exceeds budget');const result=search([...children,...rest],structuredClone(state),plan,depth+1);if(result)return result;if(visited>=maxNodes)break;}return null;};
    const result=search(structuredClone(tasks),structuredClone(initial),[],0);return result?{status:'planned',...result,visited}:{status:budget?'budget':'blocked',actions:[],visited};
  }};
}

/** UCT search over a caller-provided model; predicted outcomes are not world observations. */
export function createMCTSPlanner({model,iterations=256,horizon=16,budgetMs=8,gamma=.99,exploration=Math.SQRT2,seed=1,clock=()=>performance.now()}={}) {
  if(!model||['actions','step','terminal'].some(k=>typeof model[k]!=='function'))throw new TypeError('MCTS model requires actions, step, terminal');integer(iterations,1,100000,'iterations');integer(horizon,1,256,'horizon');finite(budgetMs,.1,10000,'budgetMs');finite(gamma,0,1,'gamma');finite(exploration,0,100,'exploration');const rng=randomSource(seed);
  const node=state=>{const actions=model.terminal(state)?[]:model.actions(structuredClone(state));if(!Array.isArray(actions)||actions.length>128)throw new Error('MCTS: at most 128 model actions');return {state,untried:structuredClone(actions),children:[],visits:0,value:0};};
  return {plan(initial,{signal}={}){const start=clock(),root=node(structuredClone(initial));let completed=0;
    for(let i=0;i<iterations;i++){signal?.throwIfAborted();if(i>0&&clock()-start>=budgetMs)break;let n=root;const path=[n],rewards=[];let depth=0;
      while(!model.terminal(n.state)&&depth<horizon){let child;
        if(n.untried.length){const index=Math.floor(rng.next()*n.untried.length),action=n.untried.splice(index,1)[0],result=model.step(structuredClone(n.state),structuredClone(action));finite(result.reward,-1e6,1e6,'model reward');child={...node(structuredClone(result.state)),action,reward:result.reward};n.children.push(child);path.push(child);rewards.push(child.reward);n=child;depth++;break;}
        if(!n.children.length)break;child=n.children.reduce((best,c)=>{const score=v=>v.reward+gamma*(v.value/Math.max(1,v.visits))+exploration*Math.sqrt(Math.log(n.visits+1)/Math.max(1,v.visits));return !best||score(c)>score(best)?c:best;},null);n=child;path.push(n);rewards.push(n.reward);depth++;
      }
      let rolloutState=structuredClone(n.state),tail=0,discount=1;
      for(;depth<horizon&&!model.terminal(rolloutState);depth++){signal?.throwIfAborted();const choices=model.actions(structuredClone(rolloutState));if(!Array.isArray(choices)||choices.length>128)throw new Error('MCTS action budget');if(!choices.length)break;const result=model.step(structuredClone(rolloutState),structuredClone(choices[Math.floor(rng.next()*choices.length)]));finite(result.reward,-1e6,1e6,'model reward');tail+=discount*result.reward;discount*=gamma;rolloutState=result.state;}
      for(let j=path.length-1;j>=0;j--){path[j].visits++;path[j].value+=tail;if(j>0)tail=rewards[j-1]+gamma*tail;}completed++;
    }
    const best=root.children.reduce((a,b)=>!a||b.visits>a.visits?b:a,null);return {status:best?'planned':'blocked',action:best?structuredClone(best.action):null,iterations:completed,elapsedMs:clock()-start,choices:root.children.map(c=>({action:structuredClone(c.action),visits:c.visits,value:c.reward+gamma*c.value/Math.max(1,c.visits)}))};
  }};
}
