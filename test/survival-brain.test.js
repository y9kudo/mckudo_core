import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { catalogFromMinecraftData } from '../src/catalog.js';
import { createCore } from '../src/core.js';
import { resourceSources } from '../src/taxonomy.js';
import { createLootReactor, createSurvivalReactor, diamondSetTargets, diamondSetCondition } from '../src/survival-brain.js';
import { itemValue, proposeTrade, survivalReserves } from '../src/item-value.js';
import { matches } from '../src/conditions.js';
import {OMProtection} from '../packages/omconnect/index.js';
import {createBlockTaxonomy} from '../src/taxonomy.js';

const registry = minecraftData('1.21.1'), catalog = catalogFromMinecraftData(registry);

test('tree classes cover legacy log metadata families as well as modern named species',()=>{
  for(const version of ['1.8.8','1.16.5','1.18.2','1.19.4','1.20.4','1.21.1','26.1']){
    const c=catalogFromMinecraftData(minecraftData(version)),taxonomy=createBlockTaxonomy(c),log=version==='1.8.8'?'minecraft:log':'minecraft:birch_log';
    assert.equal(taxonomy.has(log,'logs'),true,version);assert.equal(taxonomy.has(log,'tree'),true,version);assert.ok(taxonomy.members('leaves').length>0,version);
  }
});
const rid = n => n.startsWith('minecraft:') ? n : 'minecraft:' + n;
const key = p => `${p.x},${p.y},${p.z}`;
const p = { x: 0, y: 64, z: 0 };
const observation = (inventory = {}, sampledBlocks = []) => ({ dimension: 'minecraft:overworld', self: { position: p, health: 20, food: 20, freeInventorySlots: 36 }, inventory, world: { sampledBlocks }, drops: [] });
const block = (name, position) => ({ ...registry.blocksByName[name], position });

test('cave reconnaissance yields to its worker before excavating a new shaft',()=>{
  let forks=0,polls=0;
  const world={minY:-64,blockAt:q=>({...block(q.y<64?'stone':'air',q),boundingBox:q.y<64?'block':'empty',shapes:q.y<64?[[0,0,0,1,1,1]]:[]})};
  const planner={fork(){forks++;return {poll(options){polls++;assert.equal(options.context,'cave-before-shaft');return {status:'pending',reason:'Worker is checking the cave route.'};}};}};
  const reactor=createSurvivalReactor({catalog,client:{registry,world},targets:{raw_iron:1},explorationPlanner:planner});
  const o=observation({'minecraft:stone_pickaxe':1});
  assert.equal(reactor.react(o).action,null);assert.equal(reactor.react(o).action,null);
  assert.equal(forks,1);assert.equal(polls,2);
});

test('starter stone reconnaissance keeps a small radius and reversible drops',()=>{
  const world={minY:-64,blockAt:q=>({...block(q.y<60?'stone':q.y<64?'dirt':'air',q),boundingBox:q.y<64?'block':'empty'})};
  let options;
  const planner={fork:()=>({poll:o=>{options=o;return {status:'planned',target:{x:4,y:60,z:0}};}})};
  const r=createSurvivalReactor({catalog,client:{world},targets:{cobblestone:3},explorationPlanner:planner});
  const result=r.react(observation({'minecraft:wooden_pickaxe':1}));
  assert.equal(options.radius,8);assert.equal(options.maxDrop,1);
  assert.equal(result.action.skill,'navigate');assert.equal(result.action.args.maxDrop,1);
});

test('underground wood acquisition opens an ascending staircase and preserves its support',()=>{
  const cells=new Map(),trunk={x:6,y:72,z:0};
  const world={blockAt:q=>({...block(cells.get(key(q))??(key(q)===key(trunk)?'birch_log':q.x===0&&q.z===0&&[64,65].includes(q.y)?'air':q.y<72?'stone':'air'),q),boundingBox:cells.get(key(q))==='air'||q.x===0&&q.z===0&&[64,65].includes(q.y)||q.y>=72&&key(q)!==key(trunk)?'empty':'block'})};
  const r=createSurvivalReactor({catalog,client:{world},targets:{birch_log:1}});
  const o=observation({'minecraft:wooden_pickaxe':1},[{name:rid('birch_log'),position:trunk}]);
  const overhead=r.react(o);assert.equal(overhead.action.skill,'dig');assert.deepEqual([overhead.action.args.x,overhead.action.args.y,overhead.action.args.z],[0,66,0]);
  cells.set('0,66,0','air');
  const head=r.react(o);assert.equal(head.action.skill,'dig');assert.equal(head.action.args.y,66);assert.notEqual(head.action.args.x,0);
  const support=world.blockAt({x:head.action.args.x,y:64,z:head.action.args.z});assert.equal(support.name,'stone');
  cells.delete('0,66,0');
  const protectedReactor=createSurvivalReactor({catalog,client:{world,protection:new OMProtection({regions:[{id:'roof',dimension:o.dimension,min:{x:0,y:66,z:0},max:{x:0,y:66,z:0}}]})},targets:{birch_log:1}});
  const protectedResult=protectedReactor.react(o).action;
  assert.ok(!protectedResult||protectedResult.skill!=='dig'||protectedResult.args.x!==0||protectedResult.args.y!==66||protectedResult.args.z!==0);
});

test('a workstation high above the cave does not bypass local crafting prerequisites',()=>{
  const world={blockAt:q=>({...block(q.y<64?'stone':'air',q),boundingBox:q.y<64?'block':'empty'})};
  const r=createSurvivalReactor({catalog,client:{world},targets:{stone_pickaxe:1},exploration:false});
  const result=r.react(observation({'minecraft:cobblestone':3,'minecraft:stick':2},[{name:rid('crafting_table'),position:{x:2,y:85,z:0}}]));
  assert.notEqual(result.action?.args.item,rid('stone_pickaxe'));
  assert.ok(r.snapshot().plan.some(step=>step.item===rid('crafting_table')));
});

test('a leaf-covered birch trunk opens a reachable leaf face before mining the log',()=>{
  const trunk={x:3,y:65,z:0},leaf={x:2,y:65,z:0};let cleared=false;
  const world={blockAt:q=>({...block(q.x===3&&q.y===65&&q.z===0?'birch_log':!cleared&&q.x===2&&q.y===65&&q.z===0?'birch_leaves':q.y<64?'stone':'air',q),boundingBox:q.y<64||q.x===3&&q.y===65||!cleared&&q.x===2&&q.y===65?'block':'empty'})};
  const r=createSurvivalReactor({catalog,client:{world},targets:{'#logs':1},exploration:false});
  const o=observation({},[{name:rid('birch_log'),position:trunk}]);o.self.position={x:.5,y:64,z:.5};
  const first=r.react(o);assert.equal(first.action.skill,'dig');assert.equal(first.action.args.block,rid('birch_leaves'));assert.equal(first.action.args.x,leaf.x);
  cleared=true;assert.equal(r.react(o).action.args.block,rid('birch_log'));
});

test('tree-class planning skips protected house beams and selects a nearby natural species',()=>{
  const beam={x:2,y:64,z:0},tree={x:8,y:64,z:0};
  const world={blockAt:q=>block(q.x===2&&q.y===64&&q.z===0?'oak_log':q.x===3&&q.y===64&&q.z===0?'oak_planks':q.x===8&&q.y===64&&q.z===0?'birch_log':q.y<64?'stone':'air',q)};
  const client={world,protection:new OMProtection()};
  const r=createSurvivalReactor({catalog,client,targets:{'#logs':1},exploration:false});
  const next=r.react(observation({},[{name:rid('oak_log'),position:beam},{name:rid('birch_log'),position:tree}]));
  assert.equal(next.action.skill,'dig');assert.equal(next.action.args.block,rid('birch_log'));assert.equal(next.action.args.x,8);
});

test('core-owned survival starts by mining the nearest usable tree class and replans crafting from inventory', () => {
  const r = createSurvivalReactor({ catalog, target: 'wood', exploration: false });
  const o = observation({}, [{ name: rid('birch_log'), position: { x: 4, y: 64, z: 0 } }, { name: rid('oak_log'), position: { x: 20, y: 64, z: 0 } }]);
  assert.equal(r.react(o).action.args.block, rid('birch_log'));
  o.inventory[rid('birch_log')] = 1;
  const next = r.react(o); assert.equal(next.action.skill, 'craft'); assert.equal(next.action.args.item, rid('birch_planks'));
  o.inventory = { [rid('birch_planks')]: 4 }; assert.equal(r.react(o).action.args.item, rid('crafting_table'));
  assert.notEqual(r.snapshot().status, 'completed');
  o.inventory = { [rid('crafting_table')]: 1 }; assert.equal(r.react(o).action, null); assert.equal(r.snapshot().status, 'completed');
  o.inventory = {}; r.react(o); assert.notEqual(r.snapshot().status, 'completed');
});

test('explicit class goals combine species and select the nearest remaining resource',()=>{
  const r=createSurvivalReactor({catalog,targets:{'#logs':4},exploration:false}),o=observation({'minecraft:oak_log':2},[{name:'minecraft:birch_log',position:{x:2,y:64,z:0}},{name:'minecraft:oak_log',position:{x:15,y:64,z:0}}]);
  assert.equal(r.react(o).action.args.block,'minecraft:birch_log');o.inventory['minecraft:birch_log']=2;assert.equal(r.react(o).action,null);assert.equal(r.snapshot().status,'completed');
});
test('an explicit crafting goal does not progress to unrelated stone or iron tools',()=>{
  const r=createSurvivalReactor({catalog,targets:{'minecraft:crafting_table':1},exploration:false});
  const next=r.react(observation({'minecraft:birch_planks':4},[{name:'minecraft:crafting_table',position:{x:20,y:64,z:0}}]));
  assert.ok(next.action.skill==='craft'&&next.action.args.item==='minecraft:crafting_table'||next.action.skill==='dig'&&next.action.args.block==='minecraft:crafting_table');
});

test('deepslate diamonds require an iron-tier pickaxe; missing source is explicitly blocked', () => {
  const r = createSurvivalReactor({ catalog, exploration: false });
  const o = observation({ 'minecraft:crafting_table': 1, 'minecraft:wooden_pickaxe': 1, 'minecraft:stone_pickaxe': 1, 'minecraft:furnace': 1 }, [{ name: rid('deepslate_diamond_ore'), position: { x: 4, y: -54, z: 0 } }]);
  const result = r.react(o); assert.notEqual(result.action?.args.block, rid('deepslate_diamond_ore')); assert.equal(r.snapshot().stage, 'iron_pickaxe');
  const unknown = createSurvivalReactor({ catalog, target: 'wood', exploration: false });
  assert.equal(unknown.react(observation()).action, null); assert.equal(unknown.snapshot().status, 'blocked');
});

test('failed mining changes candidate and never retries the same coordinate during backoff', () => {
  const r = createSurvivalReactor({ catalog, target: 'wood', exploration: false, clock: () => 1000 });
  const o = observation({}, [1, 2].map(x => ({ name: rid('oak_log'), position: { x, y: 64, z: 0 } })));
  const first = r.react(o); r.recordResult({ outcome: 'failure', detail: 'No reachable face' }, first.action);
  const second = r.react(o); assert.equal(second.action.args.x, 2); assert.equal(r.snapshot().lastFailure.attempts, 1);
});

test('an unreachable source stays excluded after timer expiry until the agent changes position',()=>{
  let now=1000;const world={blockAt:q=>block(q.x===2&&q.y===64&&q.z===0?'oak_log':q.x===4&&q.y===64&&q.z===0?'birch_log':q.y<64?'stone':'air',q)};
  const r=createSurvivalReactor({catalog,client:{world},target:'wood',exploration:false,clock:()=>now});
  const o=observation({},[{name:rid('oak_log'),position:{x:2,y:64,z:0}},{name:rid('birch_log'),position:{x:4,y:64,z:0}}]);
  const first=r.react(o);assert.equal(first.action.args.x,2);r.recordResult({outcome:'failure',detail:"No reachable position with line of sight to the target block."},first.action);
  now+=300000;assert.notEqual(r.react(o).action?.args.x,2);
  o.self.position={x:0,y:64,z:3};assert.equal(r.react(o).action.args.x,2);
});

test('missing recipe ingredients are collected before returning to a distant table',()=>{
  const r=createSurvivalReactor({catalog,targets:{stone_pickaxe:1},exploration:false});
  const o=observation({'minecraft:crafting_table':1,'minecraft:wooden_pickaxe':1,'minecraft:stick':2},[{name:rid('stone'),position:{x:2,y:63,z:0}}]);
  assert.equal(r.react(o).action.skill,'dig');
});

test('resource planning prepares cooked food, gold and netherite scrap through the furnace executor',()=>{
  for(const [output,input]of [['cooked_beef','beef'],['gold_ingot','raw_gold'],['netherite_scrap','ancient_debris']]){
    const r=createSurvivalReactor({client:{registry},catalog,targets:{[output]:2},exploration:false});
    const o=observation({[rid(input)]:2,'minecraft:coal':1},[{name:'minecraft:furnace',position:{x:2,y:64,z:0}}]);
    const next=r.react(o);assert.equal(next.action.skill,'smelt');assert.equal(next.action.args.item,rid(output));assert.equal(next.action.args.input,rid(input));
    assert.notEqual(r.snapshot().status,'completed');o.inventory[rid(output)]=2;assert.equal(r.react(o).action,null);
  }
});

test('CPU exploration pending does not block the synchronous reactor and is invalidated after failed navigation',()=>{
  let invalidated=0;
  const planner={poll:()=>({status:'pending',reason:'worker running'}),invalidate:()=>invalidated++};
  const r=createSurvivalReactor({client:{world:{minY:-64,blockAt:()=>null}},catalog,targets:{'#logs':1},explorationPlanner:planner});
  const next=r.react(observation());assert.equal(next.action,null);assert.match(next.reason,/worker running/);
  r.recordResult({outcome:'failure',detail:'unreachable'},{skill:'navigate',args:p});assert.equal(invalidated,1);
});

test('ore exploration backtracks up a known stair when every deeper support becomes unknown',()=>{
  let deadEnd=false,feet={x:0,y:64,z:0};
  const air={name:'air',boundingBox:'empty',shapes:[],diggable:false},stone={...registry.blocksByName.stone,name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const client={options:{username:'A'},world:{minY:-64,blockAt:q=>deadEnd&&q.y<=62&&!(q.x===feet.x&&q.z===feet.z&&q.y===62)?null:deadEnd&&q.x===feet.x&&q.z===feet.z&&q.y>=feet.y?air:q.y<64?stone:air}};
  const r=createSurvivalReactor({client,catalog,targets:{raw_iron:1}}),o=observation({'minecraft:stone_pickaxe':1});
  const first=r.react(o);assert.equal(first.action.skill,'dig');
  feet=o.self.position={x:first.action.args.x,y:63,z:first.action.args.z};deadEnd=true;
  const recovery=r.react(o);assert.equal(recovery.action.skill,'navigate');assert.equal(recovery.action.args.y,64);assert.equal(recovery.action.args.excavate,true);assert.equal(recovery.action.args.bridge,false);
});

test('ore exploration opens a supported horizontal branch before abandoning a blocked descent',()=>{
  let blockedDescent=false;
  const air={name:'air',boundingBox:'empty',shapes:[],diggable:false},stone={...registry.blocksByName.stone,name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const client={options:{username:'A'},world:{minY:-64,blockAt:q=>blockedDescent&&q.y<62?null:q.y<64?stone:air}};
  const r=createSurvivalReactor({client,catalog,targets:{raw_iron:1}}),o=observation({'minecraft:stone_pickaxe':1}),first=r.react(o);
  o.self.position={x:first.action.args.x,y:63,z:first.action.args.z};blockedDescent=true;
  const branch=r.react(o);assert.equal(branch.action.skill,'dig');assert.ok(branch.action.args.y>=o.self.position.y);
});

test('loot outranks crafting, tracks current drop origin, and backs off failed drops', () => {
  const r = createLootReactor({ clock: () => 1000 }), o = observation();
  o.drops = [{ id: '1', name: 'diamond', count: 1, position: { x: 2, y: 65, z: 0 } }];
  const first = r.react(o); assert.equal(first.action.skill, 'collect'); assert.ok(first.priority > 5);
  o.drops[0].position.x = 3; assert.equal(r.react(o).action.args.origin.x, 3);
  r.recordResult({ outcome: 'failure' }); assert.equal(r.react(o).action, null);
});
test('loot policy can stop detours for surplus soil while keeping useful drops',()=>{
  const r=createLootReactor({stockLimits:{'minecraft:dirt':16}}),o=observation({'minecraft:dirt':16});
  o.drops=[{id:'1',name:'dirt',count:1,position:{x:1,y:64,z:0}},{id:'2',name:'cobblestone',count:1,position:{x:2,y:64,z:0}}];
  assert.equal(r.react(o).action.args.item,'minecraft:cobblestone');
});

test('loot failure is attributed to the executed entity even after a new observation', () => {
  const r = createLootReactor({ clock: () => 1000 }), o = observation();
  o.drops = [{ id: '1', name: 'diamond', count: 1, position: { x: 2, y: 65, z: 0 } }];
  const action = r.react(o).action;
  o.drops = [{ id: '2', name: 'diamond', count: 1, position: { x: 2, y: 65, z: 0 } }];
  r.react(o); r.recordResult({ outcome: 'failure' }, action);
  assert.equal(r.react(o).action.args.entityId, '2');
  o.drops[0].id = '1'; assert.equal(r.react(o).action, null);
});

test('repeated loot failures back off progressively, while a moved drop is reconsidered immediately',()=>{
  let now=1000;const r=createLootReactor({clock:()=>now}),o=observation();
  o.drops=[{id:'stuck',item:'minecraft:stick',count:1,position:{x:2,y:64,z:0}}];
  const first=r.react(o).action;r.recordResult({outcome:'failure'},first);
  now+=5001;const second=r.react(o).action;assert.ok(second);r.recordResult({outcome:'failure'},second);
  now+=5001;assert.equal(r.react(o).action,null,'second failure must wait longer than the first');
  o.drops[0].position={x:4,y:64,z:0};assert.equal(r.react(o).action.args.entityId,'stuck');
});

test('unreachable backtracking is not retried merely because its timer expired',()=>{
  let now=1000;
  const air={name:'air',boundingBox:'empty',shapes:[]},stone={...registry.blocksByName.stone,name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const world={minY:-64,blockAt:q=>q.x===0&&q.z===0&&q.y>=64||q.x===3&&q.z===0&&q.y>=65?air:q.y<65?stone:null};
  const r=createSurvivalReactor({catalog,client:{world},targets:{diamond:1},clock:()=>now});
  const o=observation({'minecraft:iron_pickaxe':1});
  const first=r.react(o);assert.equal(first.action.skill,'navigate');
  r.recordResult({outcome:'failure',detail:"No route through observed terrain under the current rules."},first.action);
  now+=300000;assert.notDeepEqual(r.react(o).action,first.action);
});

test('a changed local passage clears remembered navigation failure',()=>{
  let now=1000,changed=false;
  const air={name:'air',boundingBox:'empty',shapes:[]},stone={...registry.blocksByName.stone,name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]]};
  const world={minY:-64,blockAt:q=>q.x===0&&q.z===0&&q.y>=64||q.x===3&&q.z===0&&q.y>=65||changed&&q.x===2&&q.z===0&&q.y===65?air:q.y<65?stone:null};
  const r=createSurvivalReactor({catalog,client:{world},targets:{diamond:1},clock:()=>now}),o=observation({'minecraft:iron_pickaxe':1});
  const first=r.react(o);r.recordResult({outcome:'failure',detail:"No route."},first.action);
  changed=true;assert.deepEqual(r.react(o).action,first.action,'a real block change permits an immediate new attempt');
});

test('safe staircase mines adjacent cells and rejects unknown support or liquids', () => {
  const world = { blockAt: q => block(q.y <= 63 ? 'stone' : 'air', q) };
  const client = { world, options: { username: 'Miner' } }, r = createSurvivalReactor({ client, catalog });
  const o = observation(Object.fromEntries(['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'furnace', 'iron_pickaxe'].map(n => [rid(n), 1])));
  o.world.sampledBlocks=[{name:rid('crafting_table'),position:{x:3,y:64,z:0}},{name:rid('furnace'),position:{x:4,y:64,z:0}}];
  const step = r.react(o); assert.equal(step.action.skill, 'dig'); assert.equal(step.action.args.y, 63); assert.notEqual(`${step.action.args.x},${step.action.args.z}`, '0,0');
  assert.ok(step.priority>80,'excavation must finish before opportunistic loot moves onto its support');
  const unknown = createSurvivalReactor({ catalog, client: { ...client, world: { blockAt: () => null } } });
  assert.equal(unknown.react(o).action, null);
  const flooded = createSurvivalReactor({ catalog, client: { ...client, world: { blockAt: q => block(q.y < 64 ? 'lava' : 'air', q) } } });
  assert.equal(flooded.react(o).action, null);
});

test('survival requests iron-tier tool reservation for excavation and can explicitly disable it',()=>{
  const world={blockAt:q=>block(q.y<=63?'stone':'air',q)},o=observation({'minecraft:iron_pickaxe':1,'minecraft:stone_pickaxe':1});
  const r=createSurvivalReactor({client:{world},catalog,targets:{diamond:1}});
  assert.equal(r.react(o).action.args.preservePickaxeTier,2);
  const fastest=createSurvivalReactor({client:{world},catalog,targets:{diamond:1},preservePickaxeTier:false});
  assert.equal(fastest.react(o).action.args.preservePickaxeTier,undefined);
});

test('bounded library loop reaches a full diamond set from zero in a deterministic executor, including drops and furnace', async () => {
  const voxels = new Map(), inventory = {}, drops = [], actions = [], stations = [];
  let index = 0;
  for (const [name, quantity] of [['spruce_log', 40], ['stone', 40], ['deepslate_iron_ore', 8], ['deepslate_diamond_ore', 40]]) for (let i = 0; i < quantity; i++) {
    const q = { x: 3 + index++ * 2, y: 64, z: 0 }; voxels.set(key(q), block(name, q));
  }
  const world = { blockAt: q => voxels.get(key(q)) || block(q.y < 64 ? 'stone' : 'air', q) };
  const client = { world, options: { username: 'SurvivalTest' } };
  const survival = createSurvivalReactor({ catalog, client, exploration: false }), loot = createLootReactor({ radius: 64 });
  const observe = () => ({ ...observation({ ...inventory }, [...voxels.values()].filter(b => b.name !== 'air').map(b => ({ name: rid(b.name), position: b.position })).concat(stations)), drops: structuredClone(drops) });
  const gain = (item, n) => { item = rid(item); inventory[item] = (inventory[item] || 0) + n; assert.ok(inventory[item] >= 0); };
  const adapter = { describe: () => ({ protocolVersion: 1, skills: ['dig', 'collect', 'craft', 'ensureStation', 'smelt'] }), observe: async () => observe(),
    async execute(action) {
      actions.push(action); const a = action.args;
      if (action.skill === 'dig') {
        const actual = world.blockAt(a); assert.equal(rid(actual.name), a.block);
        const source = resourceSources(catalog, { availableBlocks: [a.block] })[0]; assert.ok(source);
        assert.ok(!source.tools.length || source.tools.some(t => inventory[t] > 0), `No tool for ${a.block}`);
        voxels.set(key(a), block('air', a));
        // Server simulation puts drops near the bot after an approach, without directly awarding inventory.
        drops.push({ id: String(actions.length), name: source.item.slice(10), count: 1, position: { ...p, x: 1 } });
      } else if (action.skill === 'collect') {
        const i = drops.findIndex(d => rid(d.name) === a.item); assert.ok(i >= 0); gain(a.item, drops[i].count); drops.splice(i, 1);
      } else if (action.skill === 'craft') {
        const recipes = catalog.recipesFor(a.item).filter(r => r.executable && r.type.startsWith('minecraft:crafting_'));
        const recipe = recipes.find(r => (!r.station || stations.some(s => s.name === r.station)) && r.ingredients.every(g => g.choices.some(choice => (inventory[choice] || 0) >= g.count * Math.ceil(a.count / r.output.count))));
        assert.ok(recipe, `No executable recipe for ${a.item}`); const batches = Math.ceil(a.count / recipe.output.count);
        for (const g of recipe.ingredients) gain(g.choices.find(choice => inventory[choice] >= g.count * batches), -g.count * batches);
        gain(a.item, recipe.output.count * batches);
      } else if (action.skill === 'ensureStation') {
        assert.ok(inventory[rid(a.station)]); gain(a.station, -1); stations.push({ name: rid(a.station), position: { x: 0, y: 64, z: 2 + stations.length } });
      } else if (action.skill === 'smelt') {
        assert.ok(stations.some(s => s.name === rid('furnace'))); assert.ok(inventory[a.input] >= a.count); assert.ok(inventory[a.fuel] > 0);
        gain(a.input, -a.count); gain(a.fuel, -1); gain(a.item, a.count);
      } else assert.fail('Unexpected skill');
      return { ok: true };
    }
  };
  const core = createCore({ config: { schemaVersion: 4, name: 'LibraryLoop', worldId: 'deterministic-executor' }, adapter, reactors: [loot, survival] });
  survival.attach(core); loot.attach(core);
  for (let tick = 0; tick < 320 && !matches(diamondSetCondition(), observe()); tick++) {
    await core.tick(); assert.notEqual(core.snapshot().status, 'fault', core.snapshot().reason);
    assert.notEqual(survival.snapshot().status, 'blocked', survival.snapshot().reason);
  }
  assert.ok(matches(diamondSetCondition(), observe()), JSON.stringify(survival.snapshot()));
  assert.deepEqual(Object.keys(diamondSetTargets()).filter(n => !inventory[n]), []);
  assert.ok(actions.some(a => a.skill === 'smelt')); assert.ok(actions.some(a => a.skill === 'collect')); assert.ok(actions.some(a => a.args.item === rid('wooden_pickaxe')));
  const firstIron = actions.findIndex(a => a.skill === 'dig' && a.args.block === rid('deepslate_iron_ore'));
  assert.ok(actions.findIndex(a => a.args.item === rid('stone_pickaxe')) < firstIron);
  await core.stop();
});

test('item utility protects reserves and offers only mutually beneficial trades or surplus gifts', () => {
  const from = { [rid('diamond')]: 4, [rid('iron_pickaxe')]: 1 }, to = { [rid('iron_ingot')]: 24 };
  assert.equal(survivalReserves(from)[rid('iron_pickaxe')], 1);
  assert.ok(itemValue('diamond', { targets: { [rid('diamond')]: 1 } }) > itemValue('diamond'));
  const trade = proposeTrade({ from, to, fromTargets: { [rid('iron_ingot')]: 3 }, toTargets: { [rid('diamond')]: 3 } });
  assert.equal(trade.kind, 'trade'); assert.ok(trade.fromGain > 0 && trade.toGain > 0); assert.ok(trade.give.every(s => s.item !== rid('iron_pickaxe')));
  assert.equal(proposeTrade({ from: { [rid('iron_pickaxe')]: 1 }, to: {}, toTargets: { [rid('iron_pickaxe')]: 1 } }), null);
  assert.equal(proposeTrade({ from: { [rid('diamond')]: 2 }, to: {}, toTargets: { [rid('diamond')]: 1 } }).kind, 'gift');
});
