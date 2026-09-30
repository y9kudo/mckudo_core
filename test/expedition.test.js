import test from 'node:test';
import assert from 'node:assert/strict';
import {createScenario,createCatalog,endExpeditionScenario,validateScenario,createEndExpedition} from '../mckudo_core.js';
import {createKudoConnect} from '../kudoconnect/index.js';

test('End expedition is a reusable native objective and only finishes on observed End travel',()=>{
  const definition=validateScenario(endExpeditionScenario());assert.equal(definition.steps.at(-1).dimension,'minecraft:the_end');
  const scenario={schemaVersion:1,name:'Gate',steps:[{id:'entry',type:'travel',dimension:'minecraft:the_end'}]};
  const c=createScenario({scenario,catalog:createCatalog({version:'test',items:[],blocks:[]})});
  const o={dimension:'minecraft:overworld',inventory:{},world:{sampledBlocks:[{name:'minecraft:end_portal',position:{x:0,y:0,z:0}}]}};
  assert.equal(c.reactor.react(o).action.skill,'enterPortal');assert.equal(c.snapshot().status,'running');
  c.reactor.react({...o,dimension:'minecraft:the_end'});assert.equal(c.snapshot().status,'completed');
});
test('scenario uses equipped inventory and forwards failures to its resource policy',()=>{
  let received;
  const c=createScenario({scenario:{schemaVersion:1,name:'Equipment',steps:[{id:'armor',type:'resources',targets:{'minecraft:iron_chestplate':1}}]},catalog:createCatalog({version:'test',items:[],blocks:[]}),resourceFactory:()=>({react:()=>({action:{skill:'craft',args:{item:'iron_chestplate'}}}),recordResult:e=>received=e})});
  c.reactor.react({inventory:{}});c.recordResult({outcome:'failure'},{skill:'craft'});assert.equal(received.outcome,'failure');
  c.reactor.react({inventory:{},equipment:{chest:{item:'minecraft:iron_chestplate',count:1}}});assert.equal(c.snapshot().status,'completed');
});
test('native expedition constructs with portal skills and hunting policy without a server',async()=>{
  const client=createKudoConnect();const expedition=createEndExpedition({client,worldId:'unit-expedition'});
  assert.equal(expedition.snapshot().scenario.current,'stone-tools');await expedition.brain.stop();await client.close();
});
