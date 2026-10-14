import {integer, randomSource} from './contracts.js';
import {createRewardAPI,createNoveltyBonus} from './reward.js';

export const HEADLESS_TASKS=Object.freeze(['wood','table','wood_pickaxe','cobblestone','stone','furnace','raw_iron','iron_ingot','iron_pickaxe','diamond']);
export const HEADLESS_ACTIONS=Object.freeze(['north','south','west','east','gather','craft_table','craft_wood_pick','craft_stone_pick','smelt_iron','craft_iron_pick','wait','craft_furnace']);
export const HEADLESS_FEATURES=Object.freeze(['target_dx','target_dz','target_near','log','table','wood_pick','cobble','stone_pick','raw_iron','iron','iron_pick','diamond','health','goal_wood','goal_stone','goal_diamond','furnace','goal_stage','danger_north','danger_south','danger_west','danger_east']);
export const HEADLESS_FEATURE_SCHEMA='headless-skills-v2';
export const HEADLESS_ACTION_SCHEMA='headless-actions-v2';

/** Deterministic skill-level sandbox, NOT a vanilla server or its complete physics. */
export function createHeadlessEnvironment({seed=1,size=12,maxSteps=160,task='wood',hazards=0,novelty=0,resources={}}={}) {
  integer(size,6,64,'size');integer(maxSteps,4,10000,'maxSteps');integer(hazards,0,Math.floor(size*size/8),'hazards');
  const goalIndex=HEADLESS_TASKS.indexOf(task);if(goalIndex<0)throw new Error('Unknown headless task');
  if(!resources||typeof resources!=='object'||Array.isArray(resources)||Object.keys(resources).some(k=>!['tree','stone','iron','diamond'].includes(k)))throw new Error('resources: tree/stone/iron/diamond');
  const amounts={tree:24,stone:32,iron:12,diamond:6,...resources};for(const [name,n]of Object.entries(amounts))integer(n,1,4096,`resources.${name}`);
  let rng=randomSource(seed),state,finished=false,episode=0;const bonus=createNoveltyBonus({scale:novelty}),needsFurnace=goalIndex>=5&&task!=='raw_iron';
  const goal=()=>({wood:state.log>=1,table:!!state.table,wood_pickaxe:!!state.woodPick,cobblestone:state.cobble>=3,stone:!!state.stonePick,furnace:!!state.furnace,raw_iron:state.rawIron>=3,iron_ingot:state.iron>=3,iron_pickaxe:!!state.ironPick,diamond:state.diamond>=1})[task];
  const desired=()=>{if(task==='wood'||!state.table||!state.woodPick)return 'tree';if(!state.stonePick||task==='cobblestone'&&state.cobble<3||needsFurnace&&!state.furnace)return 'stone';if(needsFurnace&&!state.ironPick&&state.iron<3&&state.log<1)return 'tree';return !state.ironPick?'iron':'diamond';};
  const nearest=()=>{const name=desired();let best,score=Infinity;for(const b of state.blocks)if(b.name===name){const d=Math.abs(b.x-state.x)+Math.abs(b.z-state.z);if(d<score){best=b;score=d;}}return best;};
  const danger=(dx,dz)=>state.hazards.some(p=>p.x===state.x+dx&&p.z===state.z+dz)?1:0;
  const observe=()=>{const t=nearest(),dx=t?t.x-state.x:0,dz=t?t.z-state.z:0;return [dx/size,dz/size,t&&Math.abs(dx)+Math.abs(dz)<=1?1:0,Math.min(1,state.log/4),state.table,state.woodPick,Math.min(1,state.cobble/8),state.stonePick,Math.min(1,state.rawIron/3),Math.min(1,state.iron/3),state.ironPick,Math.min(1,state.diamond),state.health/20,+(goalIndex<=2),+(goalIndex>2&&goalIndex<=5),+(goalIndex>5),state.furnace,goalIndex/(HEADLESS_TASKS.length-1),danger(0,-1),danger(0,1),danger(-1,0),danger(1,0)];};
  const mask=()=>[state.z>0,state.z<size-1,state.x>0,state.x<size-1,true,!state.table&&state.log>=1,!!state.table&&!state.woodPick&&state.log>=2,!!state.table&&!!state.woodPick&&!state.stonePick&&state.cobble>=3,!!state.furnace&&state.rawIron>=3&&state.log>=1,!!state.table&&!state.ironPick&&state.iron>=3,true,!!state.table&&!state.furnace&&state.cobble>=8];
  const score=()=>Math.min(4,state.log)+state.table*4+state.woodPick*8+Math.min(11,state.cobble)+state.stonePick*16+state.furnace*32+Math.min(3,state.rawIron)+Math.min(3,state.iron)*4+state.ironPick*64+state.diamond*128;
  const reward=createRewardAPI({terms:{step:()=>-.01,goal:t=>t.info.success?5:0,death:t=>t.info.dead?-5:0,progress:t=>t.info.progress?.15:0},potential:o=>-Math.abs(o[0])-Math.abs(o[1]),gamma:.99});
  const api={
    reset({seed:nextSeed}={}){if(nextSeed!==undefined)rng=randomSource(nextSeed);episode++;finished=false;bonus.reset();state={x:Math.floor(rng.next()*size),z:Math.floor(rng.next()*size),steps:0,log:0,table:0,woodPick:0,cobble:0,stonePick:0,furnace:0,rawIron:0,iron:0,ironPick:0,diamond:0,health:20,blocks:[],hazards:[]};
      // Multiple reachable resources and varied spawn coordinates; positions are never privileged in the policy.
      for(const [name,count] of Object.entries(amounts))for(let i=0;i<count;i++)state.blocks.push({name,x:Math.floor(rng.next()*size),z:Math.floor(rng.next()*size)});
      for(let i=0;i<hazards;i++){const p={x:Math.floor(rng.next()*size),z:Math.floor(rng.next()*size)};if(p.x!==state.x||p.z!==state.z)state.hazards.push(p);}
      state.highScore=0;return {observation:observe(),actionMask:mask(),info:{episode,task}};
    },
    step(action){if(!state||finished)throw new Error('reset() required before step()');integer(action,0,HEADLESS_ACTIONS.length-1,'action');const observation=observe(),allowed=mask();state.steps++;
      if(allowed[action]){
        if(action<4){const delta=[[0,-1],[0,1],[-1,0],[1,0]][action];state.x+=delta[0];state.z+=delta[1];}
        if(action===4){const block=nearest();if(block&&Math.abs(block.x-state.x)+Math.abs(block.z-state.z)<=1&&(block.name==='tree'||block.name==='stone'&&state.woodPick||block.name==='iron'&&state.stonePick||block.name==='diamond'&&state.ironPick)){state[{tree:'log',stone:'cobble',iron:'rawIron',diamond:'diamond'}[block.name]]++;state.blocks.splice(state.blocks.indexOf(block),1);}}
        if(action===5){state.log--;state.table=1;}if(action===6){state.log-=2;state.woodPick=1;}if(action===7){state.cobble-=3;state.stonePick=1;}if(action===8){state.rawIron-=3;state.log--;state.iron+=3;}if(action===9){state.iron-=3;state.ironPick=1;}if(action===11){state.cobble-=8;state.furnace=1;}
      }
      if(state.hazards.some(p=>p.x===state.x&&p.z===state.z))state.health-=4;
      const dead=state.health<=0,success=!dead&&goal(),terminated=dead||success,truncated=!terminated&&state.steps>=maxSteps;finished=terminated||truncated;
      const nextObservation=observe(),info={episode,task,success,dead,steps:state.steps,progress:score()>state.highScore,actionMask:mask()};state.highScore=Math.max(state.highScore,score());
      const result=reward.evaluate({observation,action,nextObservation,terminated,truncated,info}),intrinsic=bonus.visit(`${state.x},${state.z},${state.table},${state.stonePick},${state.ironPick}`);
      return {observation:nextObservation,reward:result.reward+intrinsic,terminated,truncated,info:{...info,rewardParts:{...result.parts,novelty:intrinsic}}};
    },
    snapshot(){return structuredClone({episode,task,finished,state});}
  };return api;
}
