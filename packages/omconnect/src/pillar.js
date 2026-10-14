import {isAir, isFullBlock, isHazard} from './navigation.js';
import {chooseMiningTool, miningTime} from './equipment.js';
import {setTimeout as delay} from 'node:timers/promises';
import {bridgeMaterials} from './movement.js';
import {assertEdit, rememberPlacement} from './protection.js';

const cell = p => ({x: Math.floor(p.x), y: Math.round(p.y), z: Math.floor(p.z)});
const distance = (a,b) => Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z);

/** Jump-place using the normal physics loop. Never writes a synthetic position. */
export async function pillar(c, args, signal, {select}) {
  const count = args.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 8) throw new Error("pillar.count: 1–8 for operation.");
  if (args.block !== undefined && typeof args.block !== 'string') throw new Error("pillar.block: ID Construction block.");
  const start = cell(c.state.position), placed = [], corrections = c.metrics.corrections;
  for (let i=0;i<count;i++) assertEdit(c,'place',{...start,y:start.y+i});
  const materials = () => bridgeMaterials(c.registry, c.inventory.items(), {blockAtState: id => c.world.Block.fromStateId(id, 0),dimension:c.state.dimension})
    .filter(m => args.block === undefined || m.name === args.block.replace(/^minecraft:/, ''));
  const check = () => {
    signal.throwIfAborted();
    if (c.state.status !== 'ready' || c.state.health <= 8 || c.state.dimension !== dimension) throw new Error("The rise is interrupted: Health, Measurement or connection changed.");
    if (c.metrics.corrections !== corrections) throw new Error("The server adjusted the rise; Need a new position assessment.");
    if ([...c.entities.values()].some(e => e.name === 'end_crystal' && distance(e.position,c.state.position) < 2.5)) throw new Error("Too close to the crystal for a safe rise.");
  };
  const dimension = c.state.dimension;
  if (materials().reduce((n,m) => n + m.count,0) < count) throw new Error("Not enough regular full pole blocks.");
  try {
    check();
    if (!c.state.onGround || Math.abs(c.state.position.y - start.y) > .05) throw new Error("Start up with a fixed full support.");
    // A zero-length A* route does not align the feet. Use braking input inside
    // the occupied support cell, with no sprint or coordinate correction.
    await c.waitFor(() => {
      check();
      const dx=start.x+.5-c.state.position.x,dz=start.z+.5-c.state.position.z,d=Math.hypot(dx,dz);
      if (d>.7 || !c.state.onGround) throw new Error("The base changed when leveling.");
      c.control={x:dx*Math.min(1.2,.35/(d||1)),z:dz*Math.min(1.2,.35/(d||1)),jump:false,sprint:false};
      return d<.06;
    },{signal,timeoutMs:3000});
    c.stopMovement();
    await c.waitFor(() => Math.hypot(c.state.velocity.x,c.state.velocity.z) < .02, {signal,timeoutMs:1500});
    for (let i=0; i<count; i++) {
      check();
      const p = cell(c.state.position), support = {...p,y:p.y-1}, b = c.world.blockAt(support);
      if (!c.state.onGround || Math.abs(c.state.position.y-p.y) > .05 || Math.abs(c.state.position.x-p.x-.5) > .19 || Math.abs(c.state.position.z-p.z-.5) > .19) throw new Error("No steady position at the centre of the pole.");
      if (!isFullBlock(b) || isHazard(b) || ![0,1,2,3].every(dy => isAir(c.world.blockAt({...p,y:p.y+dy})))) throw new Error("No known free jump space above the pillar.");
      if ([...c.entities.values()].some(e => e.kind==='player' && Math.abs(e.position.x-p.x-.5)<.8 && Math.abs(e.position.z-p.z-.5)<.8 && Math.abs(e.position.y-p.y)<3)) throw new Error("Another player takes up the climbing position.");
      const material=materials()[0];if(!material)throw new Error("The building blocks are over.");
      await select(c,material.name,signal);
      c.lookAt({x:p.x+.5,y:p.y,z:p.z+.5},{signal});await c.waitForLook({signal});
      const before=c.inventory.count(material.name);
      c.control={x:0,z:0,jump:true,sprint:false};
      await c.waitFor(() => c.state.position.y >= p.y+1.01 || c.metrics.corrections !== corrections,{signal,timeoutMs:1800});
      c.stopMovement();check();
      if (Math.abs(c.state.position.x-p.x-.5)>.19 || Math.abs(c.state.position.z-p.z-.5)>.19 || c.state.velocity.y <= 0) throw new Error("Couldn't catch a safe jump phase.");
      assertEdit(c,'place',p);
      c.write('block_place',{hand:0,location:support,direction:1,cursorX:.5,cursorY:1,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
      await c.waitFor(() => c.world.blockAt(p)?.name===material.name && c.inventory.count(material.name)<before,{signal,timeoutMs:2000});
      rememberPlacement(c,p);
      await c.waitFor(() => c.state.onGround,{signal,timeoutMs:2000});check();
      if (Math.abs(c.state.position.y-p.y-1)>.05) throw new Error("The server did not confirm the landing on the assigned block.");
      placed.push({...p,block:material.block});
      c.pillarBlocks ??= new Map();
      c.pillarBlocks.set(`${dimension}/${p.x},${p.y},${p.z}`, {name:material.name,baseY:start.y});
      while(c.pillarBlocks.size>4096)c.pillarBlocks.delete(c.pillarBlocks.keys().next().value);
      c.emit('pillarStep',{position:{...c.state.position},placed:placed.at(-1),serverConfirmed:true});
    }
    return {ok:true,serverConfirmed:true,placed,position:{...c.state.position}};
  } finally { c.stopMovement(); }
}

/** Dismantle only this client's verified pillar, with a known one-block landing. */
export async function descendPillar(c,args,signal,{select}) {
  const count=args.count??1;if(!Number.isInteger(count)||count<1||count>8)throw new Error('descendPillar.count: 1–8.');
  const removed=[];
  try {
    c.stopMovement();await c.waitFor(()=>c.state.onGround&&Math.hypot(c.state.velocity.x,c.state.velocity.z)<.02,{signal,timeoutMs:2000});
    for(let i=0;i<count;i++){
      signal.throwIfAborted();const foot=cell(c.state.position),p={...foot,y:foot.y-1},id=`${c.state.dimension}/${p.x},${p.y},${p.z}`,record=c.pillarBlocks?.get(id),b=c.world.blockAt(p);
      if(!record||b?.name!==record.name)throw new Error("No confirmed own pillar below the agent.");
      assertEdit(c,'dig',p);
      if(c.state.health<=8||!c.state.onGround||Math.abs(c.state.position.x-p.x-.5)>.19||Math.abs(c.state.position.z-p.z-.5)>.19)throw new Error("Cannot safely remove the support from the current position.");
      if(!isFullBlock(c.world.blockAt({...p,y:p.y-1}))||[[1,0],[-1,0],[0,1],[0,-1]].some(([x,z])=>{const n=c.world.blockAt({x:p.x+x,y:p.y,z:p.z+z});return !n||isHazard(n);}))throw new Error("Under a pole or adjacent area unknown or dangerous.");
      const tool=chooseMiningTool(c.registry,b,c.inventory.items(),{held:c.inventory.held(),onGround:true});
      if(tool?.item)await select(c,tool.item,signal);
      const timing=miningTime(c.registry,b,c.inventory.held(),{onGround:true});if(timing.milliseconds>10000)throw new Error("You need a suitable tool to dissect the pole.");
      c.lookAt({x:p.x+.5,y:p.y+.5,z:p.z+.5},{signal});await c.waitForLook({signal});
      let done=false;
      try{
        assertEdit(c,'dig',p);
        c.write('block_dig',{status:0,location:p,face:1,sequence:++c.sequence});
        await delay(timing.milliseconds,undefined,{signal});
        assertEdit(c,'dig',p);
        if(c.world.blockAt(p)?.stateId!==b.stateId||c.world.blockAt(p)?.name!==b.name)throw new Error("The pole block changed during the mining.");
        c.write('block_dig',{status:2,location:p,face:1,sequence:++c.sequence});
        await c.waitFor(()=>isAir(c.world.blockAt(p)),{event:'block',signal,timeoutMs:3000});done=true;
        await c.waitFor(()=>c.state.onGround&&Math.abs(c.state.position.y-p.y)<.05,{signal,timeoutMs:2000});
        if(Math.abs(c.state.position.x-p.x-.5)>.19||Math.abs(c.state.position.z-p.z-.5)>.19||Math.hypot(c.state.velocity.x,c.state.velocity.z)>.12)
          throw new Error("The descent removed the agent from the center of the support; The further examination of the pole has been stopped.");
        c.pillarBlocks.delete(id);c.protection?.forget(c.state.dimension,p);removed.push(p);
      }finally{if(!done&&c.client?.state==='play')c.write('block_dig',{status:1,location:p,face:1,sequence:++c.sequence});}
    }
    return {ok:true,serverConfirmed:true,removed,position:{...c.state.position}};
  }finally{c.stopMovement();}
}
