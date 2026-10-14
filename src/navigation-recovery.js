import {isAir,isFullBlock,planRoute} from '../packages/omconnect/src/navigation.js';
import {bridgeMaterials} from '../packages/omconnect/src/movement.js';

const floor=p=>({x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z)});
const key=(dimension,p)=>`${dimension}/${p.x},${p.y},${p.z}`;

/** Recover a mined-out stair with one jump-place; never excavate a protected building. */
export function createNavigationRecoveryReactor({client,failuresRequired=3,clock=Date.now}={}){
  if(!client?.world||!Number.isInteger(failuresRequired)||failuresRequired<2||failuresRequired>20)throw new Error('Navigation recovery requires a client and failuresRequired 2–20.');
  let failures=0,origin=null,lastFailure=0,plan=null,selected=null,cooldownUntil=0;
  const clear=()=>{failures=0;plan=null;selected=null;};
  const validBase=base=>isFullBlock(client.world.blockAt({...base,y:base.y-1}))&&[0,1,2,3].every(dy=>isAir(client.world.blockAt({...base,y:base.y+dy})))&&
    (!client.protection||client.protection.check({operation:'place',dimension:client.state.dimension,position:base}).allowed)&&
    ![...client.entities.values()].some(e=>e.kind==='player'&&String(e.id)!==String(client.state.entityId)&&Math.hypot(e.position.x-base.x-.5,e.position.z-base.z-.5)<.8&&Math.abs(e.position.y-base.y)<3);
  const hasBlocks=()=>bridgeMaterials(client.registry,client.inventory.items(),{blockAtState:id=>client.world.Block?.fromStateId(id,0),dimension:client.state.dimension}).length>0;
  const reactor={id:'overmind:navigation-recovery',apiVersion:1,failureScope:'action',managesRetries:true,
    react(o){
      selected=null;
      if(!o.self?.position||o.self.health<=8||clock()<cooldownUntil)return {action:null,reason:'Navigation recovery is not currently safe.'};
      const feet=floor(o.self.position),here=key(o.dimension,feet);
      if(plan&&(plan.dimension!==o.dimension||!validBase(plan.base))){clear();return {action:null,reason:'The observed recovery site changed.'};}
      if(!plan){
        if(here!==origin||clock()-lastFailure>60000){clear();return {action:null,reason:'No repeated route failure at this position.'};}
        if(failures<failuresRequired||!hasBlocks())return {action:null,reason:'No verified building recovery is required.'};
        const candidates=[];
        for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
          const base={x:feet.x+dx,y:feet.y,z:feet.z+dz};if(!validBase(base))continue;
          const exit=[[1,0],[-1,0],[0,1],[0,-1]].map(([x,z])=>({x:base.x+x,y:base.y+2,z:base.z+z})).find(p=>isAir(client.world.blockAt(p))&&isAir(client.world.blockAt({...p,y:p.y+1}))&&isFullBlock(client.world.blockAt({...p,y:p.y-1})));
          if(!exit)continue;
          const route=planRoute({start:feet,goal:base,getBlock:p=>client.world.blockAt(p),maxNodes:96,maxDistance:3,maxDrop:1});
          if(route.status==='planned')candidates.push({base,exit,cost:route.cost,dimension:o.dimension});
        }
        plan=candidates.sort((a,b)=>a.cost-b.cost)[0];
        if(!plan)return {action:null,reason:'No observed short pillar can restore an exit.'};
      }
      if(!hasBlocks()){clear();return {action:null,reason:'No expendable full blocks remain.'};}
      selected=key(o.dimension,plan.base)===here?{skill:'pillar',args:{count:1}}:{skill:'navigate',args:{...plan.base,range:0,bridge:false,sprintJump:false,maxDrop:1}};
      return {priority:30,action:selected,reason:'Restore a mined-out stair using an observed support, jump space and reachable upper ledge.'};
    },
    recordResult(result,action){
      if(action?.skill==='pillar'&&result.outcome==='success'){clear();return;}
      if(result.outcome==='failure'){clear();cooldownUntil=clock()+15000;}
    },
    attach(core){
      let active=null;
      const start=e=>{active=e.id===reactor.id?e.action:null;};
      const finish=e=>{
        if(e.rule===reactor.id){reactor.recordResult(e,active);active=null;return;}
        if(e.skill!=='navigate'||e.outcome!=='failure'||!['NO_PATH','SEARCH_BUDGET','STEP_STALLED'].includes(e.failure?.code))return;
        const here=key(client.state.dimension,floor(client.state.position));
        failures=here===origin&&clock()-lastFailure<60000?failures+1:1;origin=here;lastFailure=clock();
      };
      core.on('action:start',start);core.on('action:finish',finish);
      return()=>{core.off('action:start',start);core.off('action:finish',finish);};
    }
  };return reactor;
}
