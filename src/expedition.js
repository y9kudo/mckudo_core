import {createScenario} from './scenario.js';
import {catalogFromMinecraftData} from './catalog.js';
import {createMinecraftBrain} from './minecraft-brain.js';
import {createSurvivalReactor} from './survival-brain.js';
import {isAir,isFullBlock,isHazard} from './navigation.js';
import {createDragonPolicy} from './dragon-brain.js';
import {createExplorationPlanner} from './exploration-planner.js';
import {createCampaignJournal} from './campaign-journal.js';

/** A reusable objective; the launcher only connects, records evidence and enforces a deadline. */
export function endExpeditionScenario(){
  return {schemaVersion:1,name:'From an empty inventory to the End',steps:[
    {id:'stone-tools',type:'resources',targets:{'minecraft:stone_pickaxe':1,'minecraft:furnace':1}},
    {id:'iron-equipment',type:'resources',targets:{'minecraft:iron_pickaxe':1,'minecraft:iron_sword':1,'minecraft:iron_chestplate':1}},
    {id:'portal-materials',type:'resources',targets:{'minecraft:diamond_pickaxe':1,'minecraft:obsidian':14,'minecraft:flint_and_steel':1}},
    {id:'build-nether-portal',type:'netherPortal'},
    {id:'enter-nether',type:'travel',dimension:'minecraft:the_nether'},
    {id:'blaze-rods',type:'blazeRods',count:10},
    {id:'return-overworld',type:'travel',dimension:'minecraft:overworld'},
    {id:'ender-pearls',type:'enderPearls',count:20},
    {id:'craft-eyes',type:'eyes',count:20},
    {id:'find-stronghold',type:'stronghold'},
    {id:'activate-end-portal',type:'endPortal'},
    {id:'enter-end',type:'travel',dimension:'minecraft:the_end'}
  ]};
}

export function dragonExpeditionScenario(){
  const scenario=endExpeditionScenario();scenario.name='From an empty inventory to the Ender Dragon';
  const prepare=scenario.steps.findIndex(s=>s.id==='build-nether-portal');
  scenario.steps.splice(prepare,0,{id:'dragon-supplies',type:'resources',targets:{'minecraft:iron_helmet':1,'minecraft:iron_leggings':1,'minecraft:iron_boots':1,'minecraft:shield':1,'minecraft:bow':1,'minecraft:arrow':128,'minecraft:cobblestone':128}});
  scenario.steps.push({id:'defeat-dragon',type:'dragon'});return scenario;
}

/** Bounded excavation near a measured stronghold area, with no hidden coordinates. */
function strongholdSearch(client){
  const visited=new Set();let pending=null;
  const block=p=>client.world.blockAt(p),key=p=>`${p.x},${p.y},${p.z}`;
  const safe=p=>{
    const b=block(p);if(!b?.diggable||b.hardness<0||isHazard(b))return false;
    return [[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].every(([x,y,z])=>{const n=block({x:p.x+x,y:p.y+y,z:p.z+z});return n&&!isHazard(n)&&!(y&&/sand|gravel|anvil|dripstone/.test(n.name));});
  };
  return (o,estimate)=>{
    const here=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(o.self.position[k])]));visited.add(key(here));
    if(visited.size>2048)visited.delete(visited.values().next().value);
    if(pending&&key(pending)===key(here))pending=null;
    const nexts=pending?[pending]:[[1,0],[-1,0],[0,1],[0,-1]].map(([x,z])=>({x:here.x+x,y:Math.max(client.world.minY+2,here.y-1),z:here.z+z})).sort((a,b)=>Math.hypot(a.x-estimate.x,a.z-estimate.z)-Math.hypot(b.x-estimate.x,b.z-estimate.z));
    for(const next of nexts){
      if(visited.has(key(next))||!isFullBlock(block({...next,y:next.y-1})))continue;
      const cells=[{...next,y:here.y+1},{...next,y:here.y},next];
      if(cells.some(p=>!isAir(block(p))&&!safe(p)))continue;
      const dig=cells.find(p=>!isAir(block(p)));pending=next;
      return {priority:10,action:dig?{skill:'dig',args:{...dig,block:'minecraft:'+block(dig).name}}:{skill:'navigate',args:{...next,range:0,bridge:false}},reason:'Исследовать безопасную лестницу в измеренной области крепости.'};
    }
    pending=null;return null;
  };
}

export function createEndExpedition({client,worldId,scenario=endExpeditionScenario(),config={},clock=Date.now}={}){
  if(!client?.registry)throw new Error('Экспедиции нужен клиент KudoConnect.');
  const catalog=catalogFromMinecraftData(client.registry,{recipeBook:client.recipeBook}),failures=new Map(),dragonCombat=createDragonPolicy({client});
  const explorer=createExplorationPlanner({world:client.world,onReady:()=>client.emit('planningReady')});
  let brain;
  const journal=createCampaignJournal({clock,objective:scenario.steps.some(s=>s.type==='dragon')?'defeat-dragon':'enter-end'});
  const controller=createScenario({scenario,catalog,getBlock:p=>client.world.blockAt(p),strongholdSearch:strongholdSearch(client),explorationPlanner:explorer,
    resourceFactory:targets=>createSurvivalReactor({client,catalog,targets,priority:10,spatial:brain?.spatial,explorationPlanner:explorer}),dragonCombat});
  const react=controller.reactor.react;
  controller.reactor.react=o=>{
    const decision=react(o);journal.observe({scenario:controller.snapshot(),self:{...o.self,dimension:o.dimension},inventory:o.inventory,endgame:o.endgame});if(!decision.action)return decision;
    const failed=failures.get(JSON.stringify(decision.action));
    return failed&&failed.until>clock()?{action:null,reason:'Пауза после ошибки: '+failed.reason}:decision;
  };
  brain=createMinecraftBrain({client,worldId,computation:{planner:explorer},config:{actionTimeoutMs:60000,...config},survival:false,storage:false,night:false,
    defense:{attackPlayers:false},hunting:{foodReserve:6,radius:16,targets:{},prepareWool:false},reactors:[controller.reactor],
    adapterOptions:{trackedBlocks:['#logs','#ores','#workstations','#crops','stone','cobblestone','deepslate','cobbled_deepslate','blackstone','obsidian','gravel','nether_portal','end_portal','end_portal_frame','nether_bricks','nether_brick_fence']}});
  let current=null;
  brain.on('action:start',e=>{current=e.id===controller.reactor.id?e.action:null;});
  brain.on('action:finish',e=>{
    if(e.rule!==controller.reactor.id||!current)return;
    controller.recordResult(e,current);const key=JSON.stringify(current);
    if(e.outcome==='failure'){const attempts=(failures.get(key)?.attempts||0)+1;failures.set(key,{attempts,until:clock()+Math.min(60000,2000*2**Math.min(5,attempts)),reason:e.detail});}
    else if(e.outcome==='success')failures.delete(key);
    if(failures.size>256)failures.delete(failures.keys().next().value);current=null;
  });
  return {brain,controller,snapshot:()=>({scenario:controller.snapshot(),progress:journal.observe({scenario:controller.snapshot(),self:client.state,inventory:client.inventory.snapshot(),endgame:client.endgame}),dragon:dragonCombat.snapshot(),failures:[...failures].map(([action,result])=>({action:JSON.parse(action),...result}))})};
}
