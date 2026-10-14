import { resourceId } from './catalog.js';
import {jsonCopy} from './config.js';

const MAX=1000000;
const integer=(n,min,max,label)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${label}: ${min}–${max}.`);return n;};
const resource=(r)=>{
  if(r?.chance!==undefined&&r.chance!==1)throw new Error("Probable resource cannot be given as guaranteed.");
  if(!r||!['item','fluid'].includes(r.kind??'item'))throw new Error("Machine resource.kind: item or fluid.");
  return {kind:r.kind??'item',id:resourceId(r.id),amount:integer(r.amount??1,1,MAX,'amount')};
};
export const machineResourceKey=r=>`${r.kind??'item'}:${resourceId(r.id)}`;
const group=(list,limit=128)=>{
  if(!Array.isArray(list)||list.length>limit)throw new Error(`Machine resources: mass before ${limit} Records.`);
  const all=new Map();for(const raw of list){const r=resource(raw),k=machineResourceKey(r),old=all.get(k);if(old)old.amount=integer(old.amount+r.amount,1,MAX,'total amount');else all.set(k,r);}return [...all.values()];
};
const copy=v=>structuredClone(v);

/** Normalized interchange format, not a claim that vanilla packets export mod recipes. */
export function createMachineGraph(document){
  document=jsonCopy(document,'machineGraph',32*1024*1024);
  if(!document||document.schemaVersion!==1||typeof document.minecraftVersion!=='string'||!document.minecraftVersion||!Array.isArray(document.recipes)||document.recipes.length>50000)throw new Error("Machine graph: schemaVersion 1, minecraftVersion and recipes to 50000.");
  const ids=new Set(),recipes=document.recipes.map(raw=>{
    const id=resourceId(raw.id),machine=resourceId(raw.machine);if(ids.has(id))throw new Error(`Duplicate recipe ${id}.`);ids.add(id);
    const inputs=group(raw.inputs??[]),outputs=group(raw.outputs??[]),catalysts=group(raw.catalysts??[]);
    if(!outputs.length)throw new Error("The recipe needs a guarantee outputs.");
    if(raw.chance!==undefined&&raw.chance!==1)throw new Error("Probable result cannot be given as a guaranteed result.");
    const energy=raw.energy?{unit:resourceId(raw.energy.unit),amount:integer(raw.energy.amount,0,MAX,'energy.amount')}:null;
    return {id,machine,inputs,outputs,catalysts,energy,durationTicks:integer(raw.durationTicks??1,1,MAX,'durationTicks')};
  });
  const byOutput=new Map();for(const recipe of recipes)for(const output of recipe.outputs){const k=machineResourceKey(output);if(!byOutput.has(k))byOutput.set(k,[]);byOutput.get(k).push(recipe);}
  return Object.freeze({schemaVersion:1,minecraftVersion:document.minecraftVersion,source:String(document.source??'manual').slice(0,256),recipesFor:r=>(byOutput.get(machineResourceKey(r))??[]).map(copy),snapshot:()=>({schemaVersion:1,minecraftVersion:document.minecraftVersion,recipes:copy(recipes)})});
}

function stockOf(inventory){
  if(!Array.isArray(inventory))throw new Error("inventory/resources: array.");
  const stock=new Map();for(const r of group(inventory.filter(r=>r?.amount!==0),50000)){stock.set(machineResourceKey(r),r.amount);}return stock;
}

export function planMachineResources({graph,targets,inventory=[],executors=[],maxDepth=32,maxNodes=4000,maxSteps=256}={}){
  if(!graph?.recipesFor||!Array.isArray(executors))throw new Error("Requires machine graph and a list executors.");
  integer(maxDepth,1,128,'maxDepth');integer(maxNodes,1,100000,'maxNodes');integer(maxSteps,1,4096,'maxSteps');
  const desired=group(targets),knownExecutors=new Set(executors.map(resourceId));let nodes=0,lastError="No prescription chain.";
  const ensure=(state,r,required,path)=>{
    const k=machineResourceKey(r);if((state.stock.get(k)??0)>=required)return state;
    if(++nodes>maxNodes)throw new Error("Over-budget machine graph knots.");
    if(path.includes(k)||path.length>=maxDepth)throw new Error(`Cycle/Pricing depth ${k}.`);
    const alternatives=graph.recipesFor(r).sort((a,b)=>Number(!knownExecutors.has(a.machine))-Number(!knownExecutors.has(b.machine))||a.durationTicks-b.durationTicks||a.id.localeCompare(b.id));
    for(const recipe of alternatives){
      let branch={stock:new Map(state.stock),steps:copy(state.steps),reserved:new Map(state.reserved)};
      try{
        const output=recipe.outputs.find(v=>machineResourceKey(v)===k),net=output.amount-(recipe.inputs.find(v=>machineResourceKey(v)===k)?.amount??0);
        if(net<=0)throw new Error(`Recipe ${recipe.id} does not increase ${k}.`);
        const batches=Math.ceil((required-(branch.stock.get(k)??0))/net);
        integer(batches,1,MAX,'batches');
        // Inputs and nonconsumed catalysts must exist at the same time.
        const needed=new Map();for(const v of recipe.inputs)needed.set(machineResourceKey(v),{...v,amount:v.amount*batches});
        for(const v of recipe.catalysts){const id=machineResourceKey(v),old=needed.get(id);needed.set(id,{...v,amount:(old?.amount??0)+v.amount});}
        for(const v of needed.values()){integer(v.amount,1,MAX,'required amount');branch=ensure(branch,v,v.amount+(branch.reserved.get(machineResourceKey(v))??0),[...path,k]);}
        if(branch.steps.length>=maxSteps)throw new Error("Over-budget machine box.");
        for(const v of recipe.inputs){const id=machineResourceKey(v);branch.stock.set(id,branch.stock.get(id)-v.amount*batches);}
        for(const v of recipe.outputs){const id=machineResourceKey(v);branch.stock.set(id,integer((branch.stock.get(id)??0)+v.amount*batches,1,MAX,'output total'));}
        branch.steps.push({...recipe,batches,executorAvailable:knownExecutors.has(recipe.machine)});
        return branch;
      }catch(error){lastError=error.message;if(nodes>maxNodes)throw error;}
    }
    throw new Error(alternatives.length?lastError:`No source ${k}; We need to get some more, import or additional prescription.`);
  };
  let state={stock:stockOf(inventory),steps:[],reserved:new Map()};
  try{
    for(const r of desired){state=ensure(state,r,r.amount,[]);state.reserved.set(machineResourceKey(r),r.amount);}
    const missingExecutors=[...new Set(state.steps.filter(s=>!s.executorAvailable).map(s=>s.machine))];
    return {status:'planned',executable:missingExecutors.length===0,steps:state.steps,missingExecutors,remaining:Object.fromEntries(state.stock),energy:state.steps.reduce((sum,s)=>{if(s.energy){const k=s.energy.unit;sum[k]=(sum[k]??0)+s.energy.amount*s.batches;}return sum;},{}),durationTicks:state.steps.reduce((n,s)=>n+s.durationTicks*s.batches,0),nodes};
  }catch(error){return {status:'blocked',executable:false,reason:error.message,steps:[],missingExecutors:[],nodes};}
}

/** Executors own the machine protocol; completion is checked against authoritative balances. */
export async function executeMachinePlan({plan,executors,observe,signal,timeoutMs=30000}={}){
  if(plan?.status!=='planned'||!plan.executable||typeof observe!=='function')throw new Error("We need a plan to be implemented and observe.");
  integer(timeoutMs,1000,600000,'timeoutMs');
  const read=async()=>{const o=await observe();if(!Number.isSafeInteger(o?.revision)||o.revision<0)throw new Error("observe: I need a server revision.");return {...o,stock:stockOf(o.resources)};};
  const receipts=[];
  for(const step of plan.steps){
    signal?.throwIfAborted();const execute=executors?.[step.machine];if(typeof execute!=='function')throw new Error(`No performer ${step.machine}.`);
    const before=await read(),need=new Map();for(const r of step.inputs)need.set(machineResourceKey(r),r.amount*step.batches);for(const r of step.catalysts){const k=machineResourceKey(r);need.set(k,(need.get(k)??0)+r.amount);}
    for(const [k,n] of need)if((before.stock.get(k)??0)<n)throw new Error(`Resource has disappeared before action ${k}.`);
    const combined=AbortSignal.any([AbortSignal.timeout(timeoutMs),...(signal?[signal]:[])]);
    combined.throwIfAborted();
    // A noncooperative executor may settle late, but cannot validate a late result.
    await new Promise((resolve,reject)=>{
      const abort=()=>reject(combined.reason);combined.addEventListener('abort',abort,{once:true});
      Promise.resolve().then(()=>execute(copy(step),{signal:combined})).then(resolve,reject).finally(()=>combined.removeEventListener('abort',abort));
    });combined.throwIfAborted();
    const after=await read(),delta=new Map();
    for(const r of step.inputs){const k=machineResourceKey(r);delta.set(k,(delta.get(k)??0)-r.amount*step.batches);}
    for(const r of step.outputs){const k=machineResourceKey(r);delta.set(k,(delta.get(k)??0)+r.amount*step.batches);}
    if(after.revision<=before.revision)throw new Error("No new server confirmation of the machine.");
    for(const [k,n] of delta)if((after.stock.get(k)??0)-(before.stock.get(k)??0)!==n)throw new Error(`The machine didn't confirm the balance ${k}.`);
    for(const r of step.catalysts)if((after.stock.get(machineResourceKey(r))??0)<r.amount)throw new Error("The car lost its catalyst.");
    receipts.push({recipe:step.id,machine:step.machine,batches:step.batches,revision:after.revision,confirmed:true});
  }
  return {ok:true,receipts};
}
