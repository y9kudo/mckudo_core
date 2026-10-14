import {stepPhysics} from '../../packages/omconnect/src/physics.js';
import {traceVisibility} from '../../packages/omconnect/src/visibility.js';
import {integer,randomSource} from './contracts.js';

export const PHYSICAL_ACTIONS=Object.freeze(['idle','north','south','west','east','jump_north','sprint_north','attack','guard']);
export const PHYSICAL_FEATURES=Object.freeze(['goal_dx','goal_dy','goal_dz','velocity_x','velocity_y','velocity_z','on_ground','health','food','north_blocked','south_blocked','west_blocked','east_blocked','mob_dx','mob_dz','mob_distance','water','lava']);
const air=Object.freeze({name:'air',boundingBox:'empty',shapes:[]}),solid=name=>({name,boundingBox:'block',shapes:[[0,0,0,1,1,1]],diggable:true,hardness:1});
const key=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function physicalControls(action){return [{}, {x:0,z:-1},{x:0,z:1},{x:-1,z:0},{x:1,z:0},{x:0,z:-1,jump:true},{x:0,z:-1,sprint:true},{},{usingItem:true}][action];}
export function encodePhysicalObservation({state,goal,getBlock,mobs=[]}){
  const near=mobs.filter(m=>m.health>0).sort((a,b)=>distance(a.position,state.position)-distance(b.position,state.position))[0],cell={x:Math.floor(state.position.x),y:Math.floor(state.position.y),z:Math.floor(state.position.z)},blocked=(dx,dz)=>{const b=getBlock({...cell,x:cell.x+dx,z:cell.z+dz});return !b||b.boundingBox==='block'?1:0;};
  return [(goal.x-state.position.x)/16,(goal.y-state.position.y)/16,(goal.z-state.position.z)/16,state.velocity.x,state.velocity.y,state.velocity.z,+state.onGround,state.health/20,(state.food??20)/20,blocked(0,-1),blocked(0,1),blocked(-1,0),blocked(1,0),near?(near.position.x-state.position.x)/16:0,near?(near.position.z-state.position.z)/16:0,near?Math.min(1,distance(near.position,state.position)/16):1,+(state.environment?.medium==='water'),+(state.environment?.medium==='lava')];
}

/** Uses OMConnect's voxel collision/medium physics. Mob AI is a bounded local model, not a vanilla server. */
export function createPhysicalEnvironment({seed=1,radius=8,maxSteps=200,ticksPerStep=2,mobs=1,shield=false,layout='flat',spawnJitter=.2,spawn={x:.5,y:1,z:.5},goal={x:.5,y:1,z:-4.5}}={}){
  if(typeof shield!=='boolean')throw new Error('shield: boolean');
  if(!Number.isFinite(spawnJitter)||spawnJitter<0||spawnJitter>.3)throw new Error('spawnJitter: 0..0.3');integer(radius,6,32,'radius');integer(maxSteps,1,10000,'maxSteps');integer(ticksPerStep,1,20,'ticksPerStep');integer(mobs,0,16,'mobs');if(!['flat','stairs','water','lava','wall'].includes(layout))throw new Error('Unknown physical layout');
  if(!goal||Object.values(goal).length!==3||!['x','y','z'].every(k=>Number.isFinite(goal[k]))||Math.abs(goal.x)>radius-1||Math.abs(goal.z)>radius-1||goal.y<1||goal.y>8)throw new Error('Goal outside physical fixture');
  if(!spawn||!['x','y','z'].every(k=>Number.isFinite(spawn[k]))||Math.abs(spawn.x)>radius-1||Math.abs(spawn.z)>radius-1||spawn.y<1||spawn.y>8)throw new Error('Spawn outside physical fixture');
  const rng=randomSource(seed);let state,entities,steps=0,ticks=0,done=false,fallDistance=0,airTicks=300,damageCooldown=0,attackCooldown=0;const blocks=new Map();
  const getBlock=p=>{if(Math.abs(Math.floor(p.x))>radius||Math.abs(Math.floor(p.z))>radius||p.y<-4||p.y>12)return null;return blocks.get(key(p))||(p.y<1?solid('stone'):air);};
  const visible=(a,b)=>traceVisibility({origin:{...a,y:a.y+1.3},target:{...b,y:b.y+1.3},getBlock,maxDistance:64}).visible;
  const features=()=>encodePhysicalObservation({state,goal,getBlock,mobs:entities});
  const mask=()=>[true,true,true,true,true,state.onGround,state.food>6,entities.some(e=>e.health>0&&distance(e.position,state.position)<3&&visible(state.position,e.position)),shield];
  return {getBlock,setBlock(p,name){if(!p||!['x','y','z'].every(k=>Number.isInteger(p[k]))||!getBlock(p)||!['air','stone','water','lava','cobweb','slime_block','honey_block','ice','soul_sand','ladder'].includes(name))throw new Error('Invalid fixture edit');const empty=['air','water','lava','cobweb','ladder'].includes(name);blocks.set(key(p),empty?{name,boundingBox:'empty',shapes:[],getProperties:()=>({level:0})}:solid(name));},reset(){blocks.clear();steps=ticks=fallDistance=damageCooldown=attackCooldown=0;airTicks=300;done=false;state={position:{x:spawn.x+(rng.next()*2-1)*spawnJitter,y:spawn.y,z:spawn.z+(rng.next()*2-1)*spawnJitter},velocity:{x:0,y:0,z:0},yaw:180,pitch:0,onGround:spawn.y===1,health:20,food:20,gameMode:'survival'};
      if(layout==='stairs')for(let z=-4;z<=-2;z++)for(let y=1;y<=Math.max(1,-z-1);y++)blocks.set(`1,${y},${z}`,solid('stone'));
      if(layout==='wall')for(let x=-2;x<=2;x++)for(let y=1;y<=3;y++)blocks.set(`${x},${y},-2`,solid('stone'));
      if(layout==='water'||layout==='lava')for(let x=-1;x<=1;x++)for(let z=-3;z<=-1;z++)blocks.set(`${x},1,${z}`,{name:layout,boundingBox:'empty',shapes:[],getProperties:()=>({level:0})});
      entities=Array.from({length:mobs},(_,id)=>({id,name:'zombie',health:20,position:{x:3+rng.next()*2,y:1,z:2+rng.next()*2},velocity:{x:0,y:0,z:0},onGround:true,food:20,yaw:0,cooldown:0}));return {observation:features(),actionMask:mask(),info:{ticks,position:{...state.position}}};},
    step(action){if(!state||done)throw new Error('Physical environment requires reset');integer(action,0,PHYSICAL_ACTIONS.length-1,'action');const before=distance(state.position,goal),health=state.health,allowed=mask();steps++;
      for(let i=0;i<ticksPerStep;i++){ticks++;const control=allowed[action]?physicalControls(action):{};const oldY=state.position.y;state=stepPhysics(state,control,getBlock);if(damageCooldown>0)damageCooldown--;if(attackCooldown>0)attackCooldown--;
        if(state.environment?.medium==='water'){fallDistance=0;const head=getBlock({...state.position,y:state.position.y+1.62});airTicks=head?.name==='water'?airTicks-1:300;if(airTicks<=-20){state.health-=2;airTicks=0;}}else{airTicks=300;fallDistance+=Math.max(0,oldY-state.position.y);if(state.onGround){state.health-=Math.max(0,Math.ceil(fallDistance-3));fallDistance=0;}}if(state.environment?.hazardous&&damageCooldown===0){state.health-=state.environment.medium==='lava'?4:1;damageCooldown=10;}
        for(const entity of entities){if(entity.health<=0)continue;const dx=state.position.x-entity.position.x,dz=state.position.z-entity.position.z,d=Math.hypot(dx,dz)||1;Object.assign(entity,stepPhysics(entity,{x:dx/d,z:dz/d,jump:entity.horizontalCollision},getBlock));
          if(entity.cooldown>0)entity.cooldown--;if(distance(entity.position,state.position)<1.8&&visible(entity.position,state.position)&&entity.cooldown===0){state.health-=action===8&&allowed[8]?0:3;entity.cooldown=20;}
          if(action===7&&attackCooldown===0&&distance(entity.position,state.position)<3&&visible(state.position,entity.position)){entity.health-=4;attackCooldown=12;}
        }
      }
      state.health=Math.max(0,state.health);const success=state.health>0&&distance(state.position,goal)<.8,terminated=success||state.health<=0,truncated=!terminated&&steps>=maxSteps;done=terminated||truncated;
      return {observation:features(),reward:before-distance(state.position,goal)-.01+Math.min(0,state.health-health)*.1+(success?5:0)-(state.health<=0?5:0),terminated,truncated,info:{success,ticks,position:{...state.position},health:state.health,actionMask:mask(),mobs:entities.map(e=>({id:e.id,name:e.name,health:e.health,position:{...e.position}}))}};
    },snapshot(){return structuredClone({state,goal,entities,steps,ticks,done});}
  };
}
