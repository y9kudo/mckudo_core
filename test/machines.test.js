import test from 'node:test';
import assert from 'node:assert/strict';
import {createMachineGraph,planMachineResources,executeMachinePlan} from '../overmindmc.js';
const item=(id,amount=1)=>({id,amount,kind:'item'}),fluid=(id,amount)=>({id,amount,kind:'fluid'});
const document={schemaVersion:1,minecraftVersion:'1.21.1',source:'fixture',recipes:[
  {id:'demo:crush',machine:'demo:crusher',inputs:[item('demo:ore')],outputs:[item('demo:dust',2),item('demo:grit')],energy:{unit:'demo:fe',amount:100},durationTicks:20},
  {id:'demo:wash',machine:'demo:washer',inputs:[item('demo:dust',2),fluid('minecraft:water',250)],outputs:[item('demo:ingot')],catalysts:[item('demo:filter')],energy:{unit:'demo:fe',amount:40},durationTicks:10}
]};
const graph=createMachineGraph(document),inventory=[item('demo:ore',2),fluid('minecraft:water',500),item('demo:filter')],executors=['demo:crusher','demo:washer'];
test('machine planner chains items, fluids, energy, byproducts and nonconsumed catalysts',()=>{
  const p=planMachineResources({graph,inventory,executors,targets:[item('demo:ingot',2)]});
  assert.equal(p.status,'planned');assert.equal(p.executable,true);assert.deepEqual(p.steps.map(s=>s.id),['demo:crush','demo:wash']);assert.equal(p.energy['demo:fe'],280);
  assert.equal(p.remaining['item:demo:grit'],2);assert.equal(p.remaining['item:demo:filter'],1);assert.equal(p.remaining['fluid:minecraft:water'],0);
});
test('indexed machines without executors produce a plan that cannot claim execution',()=>{
  const p=planMachineResources({graph,inventory,targets:[item('demo:ingot')]});assert.equal(p.status,'planned');assert.equal(p.executable,false);assert.deepEqual(p.missingExecutors,executors);
});
test('planner reserves earlier final targets instead of consuming them in another chain',()=>{
  const p=planMachineResources({graph,inventory,executors,targets:[item('demo:dust',2),item('demo:ingot')]});
  assert.equal(p.status,'planned');assert.ok(p.remaining['item:demo:dust']>=2);assert.equal(p.remaining['item:demo:ingot'],1);
});
test('catalyst shortages, cyclic recipes and bounded searches stop without partial plans',()=>{
  const p=planMachineResources({graph,inventory:inventory.slice(0,2),executors,targets:[item('demo:ingot')]});assert.equal(p.status,'blocked');assert.deepEqual(p.steps,[]);
  const cycle=createMachineGraph({schemaVersion:1,minecraftVersion:'1.21.1',recipes:[{id:'x:a',machine:'x:m',inputs:[item('x:b')],outputs:[item('x:a')]},{id:'x:b',machine:'x:m',inputs:[item('x:a')],outputs:[item('x:b')]}]});
  assert.match(planMachineResources({graph:cycle,targets:[item('x:a')]}).reason,/Cycle/);
  assert.equal(planMachineResources({graph,inventory,targets:[item('demo:ingot')],maxNodes:1}).status,'blocked');
});
test('malformed and probabilistic machine exports are rejected',()=>{
  assert.throws(()=>createMachineGraph({...document,recipes:[{...document.recipes[0],chance:.5}]}),/Probable/);
  assert.throws(()=>createMachineGraph({...document,recipes:[{...document.recipes[0],outputs:[{...item('demo:dust'),chance:.5}]}]}),/Probable/);
  assert.throws(()=>createMachineGraph({...document,recipes:[document.recipes[0],document.recipes[0]]}),/duplicate recipe/i);
  assert.throws(()=>createMachineGraph({...document,recipes:[{...document.recipes[0],inputs:[item('demo:ore',Infinity)]}]}),/amount/);
});
test('failed recipe branches do not consume stock needed by a valid alternative',()=>{
  const g=createMachineGraph({schemaVersion:1,minecraftVersion:'1.21.1',recipes:[
    {id:'x:failed',machine:'x:m',durationTicks:1,inputs:[item('x:a'),item('x:missing')],outputs:[item('x:b')]},
    {id:'x:valid',machine:'x:m',durationTicks:2,inputs:[item('x:a')],outputs:[item('x:b')]}
  ]});const p=planMachineResources({graph:g,inventory:[item('x:a')],targets:[item('x:b')],executors:['x:m']});
  assert.equal(p.status,'planned');assert.equal(p.steps.length,1);assert.equal(p.steps[0].id,'x:valid');
});
test('machine execution verifies revisions and balances rather than trusting a returned ok',async()=>{
  const plan=planMachineResources({graph,inventory,executors,targets:[item('demo:ingot',2)]});let resources=structuredClone(inventory),revision=0;
  const observe=()=>({revision,resources:resources.filter(r=>r.amount>0)});
  const run=async step=>{for(const r of step.inputs)resources.find(x=>x.kind===r.kind&&x.id===r.id).amount-=r.amount*step.batches;for(const r of step.outputs){const x=resources.find(x=>x.kind===r.kind&&x.id===r.id);if(x)x.amount+=r.amount*step.batches;else resources.push({...r,amount:r.amount*step.batches});}revision++;};
  const result=await executeMachinePlan({plan,executors:Object.fromEntries(executors.map(id=>[id,run])),observe});assert.equal(result.receipts.length,2);
  await assert.rejects(executeMachinePlan({plan,executors:Object.fromEntries(executors.map(id=>[id,async()=>({ok:true})])),observe:()=>({revision:1,resources:inventory})}),/server confirmation/i);
});
test('already cancelled machine plans do not invoke an executor',async()=>{
  const plan=planMachineResources({graph,inventory,executors,targets:[item('demo:ingot')]});let calls=0;
  await assert.rejects(executeMachinePlan({plan,executors:{'demo:crusher':()=>calls++},observe:()=>({revision:1,resources:inventory}),signal:AbortSignal.abort(new Error('stop'))}),/stop/);assert.equal(calls,0);
});
test('cancellation while observing the machine prevents the subsequent physical action',async()=>{
  const plan=planMachineResources({graph,inventory,executors,targets:[item('demo:ingot')]}),stop=new AbortController();let calls=0;
  await assert.rejects(executeMachinePlan({plan,executors:{'demo:crusher':()=>calls++},observe:()=>{stop.abort(new Error('cancel during observation'));return {revision:1,resources:inventory};},signal:stop.signal}),/cancel during observation/);assert.equal(calls,0);
});
