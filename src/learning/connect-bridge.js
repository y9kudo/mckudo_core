import {setTimeout as delay} from 'node:timers/promises';
import {integer} from './contracts.js';
import {stepPhysics} from '../../packages/omconnect/src/physics.js';
import {traceVisibility} from '../../packages/omconnect/src/visibility.js';
import {physicalControls,encodePhysicalObservation,PHYSICAL_ACTIONS,PHYSICAL_FEATURES} from './physical.js';

/** Opt-in low-level bridge using the same feature/control schema as the physical simulator. */
export function createOMRLBridge({client,policy,goal,stepMs=100,retreatHealth=8,train=false,axis='north'}={}){
  integer(stepMs,50,1000,'stepMs');if(!client||!policy||policy.snapshot().inputs!==PHYSICAL_FEATURES.length||policy.snapshot().actions!==PHYSICAL_ACTIONS.length||!goal||!['x','y','z'].every(k=>Number.isFinite(goal[k])))throw new Error('OM RL bridge needs a compatible physical policy, live client and goal');
  if(!['north','south','west','east'].includes(axis)||!Number.isFinite(retreatHealth)||retreatHealth<0||retreatHealth>20)throw new Error('Invalid bridge axis or health reserve');
  const radians={north:0,south:Math.PI,west:-Math.PI/2,east:Math.PI/2}[axis],cos=Math.round(Math.cos(radians)),sin=Math.round(Math.sin(radians));
  const controls=a=>{const c=physicalControls(a);return {...c,x:(c.x||0)*cos-(c.z||0)*sin,z:(c.x||0)*sin+(c.z||0)*cos};};
  let busy=false,steps=0;
  const getBlock=p=>client.world.blockAt(p),distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const hostileNames=new Set(['zombie','husk','drowned','skeleton','stray','bogged','wither_skeleton','creeper','spider','cave_spider','silverfish','endermite','blaze','ghast','phantom','slime','magma_cube','witch','pillager','vindicator','evoker','ravager','wither','ender_dragon']);
  const mobs=()=>[...client.entities.values()].filter(e=>e.kind!=='player'&&e.position&&(e.hostile===true||hostileNames.has(e.name))).map(e=>({...e,health:e.metadata?.health??20}));
  const encode=()=>{const f=encodePhysicalObservation({state:client.state,goal,getBlock,mobs:mobs()});for(const [x,z]of [[0,2],[3,5],[13,14]]){const a=f[x],b=f[z];f[x]=a*cos+b*sin;f[z]=-a*sin+b*cos;}const old=f.slice(9,13),directions=[[0,-1],[0,1],[-1,0],[1,0]];directions.forEach(([x,z],i)=>{const wx=x*cos-z*sin,wz=x*sin+z*cos;f[9+i]=old[directions.findIndex(([a,b])=>a===wx&&b===wz)];});return f;};
  const reachable=()=>mobs().filter(e=>e.health>0&&distance(e.position,client.state.position)<3&&traceVisibility({origin:{...client.state.position,y:client.state.position.y+1.62},target:{...e.position,y:e.position.y+1},getBlock,maxDistance:4}).visible).sort((a,b)=>distance(a.position,client.state.position)-distance(b.position,client.state.position));
  const mask=()=>{
    const allowed=Array(PHYSICAL_ACTIONS.length).fill(false);allowed[0]=true;
    for(let a=1;a<=6;a++){
      if(a===5&&!client.state.onGround||a===6&&!(client.state.food>6))continue;
      const input=controls(a),p={x:Math.floor(client.state.position.x)+(input.x||0),y:Math.floor(client.state.position.y),z:Math.floor(client.state.position.z)+(input.z||0)};
      const cell=getBlock(p),head=getBlock({...p,y:p.y+1}),support=getBlock({...p,y:p.y-1});
      if(!cell||!head||!support||/lava|fire|cactus|magma/.test(cell.name)||!(support.shapes?.length||support.boundingBox==='block'))continue;
      if(a!==5&&(cell.boundingBox==='block'||head.boundingBox==='block'))continue;
      let predicted=structuredClone(client.state),safe=true;
      // Include braking distance beyond the command's duration.
      for(let tick=0;tick<Math.ceil(stepMs/50)+8;tick++){
        predicted=stepPhysics(predicted,tick<Math.ceil(stepMs/50)?controls(a):{},getBlock);
        if(predicted.frozen||predicted.environment?.hazardous||client.state.position.y-predicted.position.y>1.1){safe=false;break;}
        const p=predicted.position,b=getBlock({x:Math.floor(p.x),y:Math.floor(p.y)-1,z:Math.floor(p.z)});
        if(!b||predicted.onGround&&!(b.shapes?.length||b.boundingBox==='block')){safe=false;break;}
      }allowed[a]=safe;
    }
    allowed[7]=reachable().length>0;allowed[8]=client.inventory.items().some(i=>(i.name||i.item)?.replace(/^minecraft:/,'')==='shield');return allowed;
  };
  return {async step({signal,deterministic=!train}={}){if(busy)throw new Error('RL step already running');signal?.throwIfAborted();if(client.state.status!=='ready'||!client.state.position||!(client.state.health>retreatHealth)||!getBlock(client.state.position))return {status:'blocked',reason:'Live safety policy requires a healthy agent and loaded terrain'};if(client.pending)throw new Error('Pause the native controller before using the RL bridge');busy=true;
      try{const observation=encode(),allowed=mask(),sample=policy.sample?policy.sample(observation,{mask:allowed,deterministic}):null,action=sample?.action??policy.act(observation,{mask:allowed,deterministic}),before={position:{...client.state.position},health:client.state.health};
        if(!Number.isInteger(action)||!allowed[action])throw new Error('Policy selected an illegal live action');
        if(action===7){const target=reachable()[0];if(!target)throw new Error('Attack target is no longer reachable');await client.execute({skill:'attack',args:{entityId:String(target.id),allowPlayer:false}},{signal});}
        else if(action===8)await client.execute({skill:'guard',args:{durationMs:stepMs}},{signal});
        else{client.control=controls(action);if(client.control.x||client.control.z)client.lookAt?.({x:client.state.position.x+client.control.x*8,y:client.state.position.y+1.62,z:client.state.position.z+client.control.z*8},{signal});await delay(stepMs,undefined,{signal});}
        signal?.throwIfAborted();const nextObservation=encode(),d=p=>Math.hypot(goal.x-p.x,goal.y-p.y,goal.z-p.z),success=d(client.state.position)<.8,terminated=success||client.state.health<=0,reward=d(before.position)-d(client.state.position)+Math.min(0,client.state.health-before.health)*.1-.01+(success?5:0),transition={observation,action,reward,nextObservation,terminated,truncated:false,actionMask:allowed,nextActionMask:mask(),...(sample?{...sample,nextValue:policy.value(nextObservation)}:{})};
        if(train){policy.remember(transition);if(policy.snapshot().replaySize>=32)policy.train();}steps++;return {status:terminated?'terminated':'running',success,action,transition,position:{...client.state.position}};
      }finally{client.stopMovement();busy=false;}
    },snapshot:()=>({steps,busy,axis,featureSchema:'om-physical-v1',actionSchema:'om-controls-v1',policy:policy.snapshot()})};
}
