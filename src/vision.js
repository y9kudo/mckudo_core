import {setImmediate as yieldLoop} from 'node:timers/promises';
const category=name=>{
  if(!name)return 'unknown';
  if(/(?:water|lava)$/.test(name))return 'liquid';
  if(/(?:leaves|log|stem|wood)$/.test(name))return 'tree';
  if(/(?:ore|ancient_debris)$/.test(name))return 'ore';
  if(/(?:chest|barrel|shulker_box)$/.test(name))return 'storage';
  if(/(?:grass|dirt|sand|gravel|snow)$/.test(name))return 'ground';
  return 'solid';
};

/** This is a map of received chunk data, not a rendered client image. */
export function createVisionSnapshot(client,{radius=12,down=8,up=6}={}){
  if(!Number.isInteger(radius)||radius<2||radius>24||!Number.isInteger(down)||down<1||down>32||!Number.isInteger(up)||up<1||up>16)throw new Error("Overview: radius 2–24, down 1–32, up 1–16.");
  const self=client.state.position;if(!self)return {status:'waiting',radius,cells:[],entities:[]};
  const cx=Math.floor(self.x),cy=Math.floor(self.y),cz=Math.floor(self.z),cells=[];
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
    const x=cx+dx,z=cz+dz;
    if(!client.world.columnAt({x,z})){cells.push({dx,dz,known:false,name:null,y:null,category:'unknown'});continue;}
    let found=null;
    for(let y=cy+up;y>=cy-down;y--){
      const b=client.world.blockAt({x,y,z});
      if(!b){found={known:false,name:null,y:null,category:'unknown'};break;}
      if(!['air','cave_air','void_air'].includes(b.name)){found={known:true,name:'minecraft:'+b.name,y,category:category(b.name)};break;}
    }
    cells.push({dx,dz,...(found||{known:true,name:'minecraft:air',y:null,category:'air'})});
  }
  const entities=[...client.entities.values()].filter(e=>e.position&&Math.abs(e.position.x-self.x)<=radius&&Math.abs(e.position.z-self.z)<=radius)
    .slice(0,128).map(e=>({name:e.name,kind:e.kind,dx:e.position.x-self.x,dz:e.position.z-self.z,dy:e.position.y-self.y}));
  return {status:'ready',dimension:client.state.dimension,center:{x:cx,y:cy,z:cz},yaw:client.state.yaw,pitch:client.state.pitch,radius,loadedChunks:client.world.columns.size,requestedViewDistance:client.options.viewDistance,cells,entities};
}

const volumeCache=new WeakMap(),air=name=>['air','cave_air','void_air'].includes(name),directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
/** Bounded, server-observed voxel volume. No terrain is synthesized for unknown chunks. */
export async function createVisionVolume(client,{radius=12,down=8,up=16,maxBlocks=12000,waypoints=[]}={}){
  if(!Number.isInteger(radius)||radius<2||radius>24||!Number.isInteger(down)||down<1||down>24||!Number.isInteger(up)||up<1||up>24||!Number.isInteger(maxBlocks)||maxBlocks<1||maxBlocks>16000)throw new Error('3D vision budget: radius 2–24, vertical extent 1–24, blocks 1–16000.');
  const self=client.state.position;if(!self)return {status:'waiting',blocks:[],palette:[],entities:[]};
  const center=Object.fromEntries(['x','y','z'].map(key=>[key,Math.floor(self[key])])),revision=client.world.revision,signature=[client.state.dimension,revision,center.x,center.y,center.z,radius,down,up,maxBlocks].join('/');
  let geometry=volumeCache.get(client);
  if(geometry?.signature!==signature){
    const palette=[],byState=new Map(),surfaces=[],width=radius*2+1,height=down+up+1,voxels=new Uint32Array(width*width*height),occludes=new Uint8Array(voxels.length);let unknown=0,reads=0;
    const index=(x,y,z)=>(y+down)*width*width+(z+radius)*width+x+radius;
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(!client.world.columnAt({x:center.x+dx,z:center.z+dz})){unknown+=(down+up+1);continue;}
      for(let dy=-down;dy<=up;dy++){
        const block=client.world.blockAt({x:center.x+dx,y:center.y+dy,z:center.z+dz});
        if(++reads%2048===0)await yieldLoop();
        if(!block){unknown++;continue;}if(air(block.name))continue;
        const id=block.stateId??block.type;
        if(!byState.has(id)){byState.set(id,palette.length);palette.push({name:'minecraft:'+block.name,stateId:id,properties:block.getProperties?.()||{},shapes:block.shapes?.slice(0,16)||[],category:category(block.name)});}
        const full=block.shapes?.length===1&&block.shapes[0].every((value,index)=>value===(index<3?0:1))&&!/glass|leaves|water|lava/.test(block.name);
        const at=index(dx,dy,dz);voxels[at]=byState.get(id)+1;occludes[at]=Number(full);
      }
    }
    for(let dy=-down;dy<=up;dy++)for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      const value=voxels[index(dx,dy,dz)];if(!value)continue;
      if(directions.some(([x,y,z])=>{const X=dx+x,Y=dy+y,Z=dz+z;return Math.abs(X)>radius||Math.abs(Z)>radius||Y< -down||Y>up||!occludes[index(X,Y,Z)];}))surfaces.push({dx,dy,dz,palette:value-1});
    }
    surfaces.sort((a,b)=>(a.dx*a.dx+a.dy*a.dy+a.dz*a.dz)-(b.dx*b.dx+b.dy*b.dy+b.dz*b.dz));
    geometry={signature,center,radius,down,up,revision,palette,blocks:surfaces.slice(0,maxBlocks).map(v=>[v.dx,v.dy,v.dz,v.palette]),truncated:surfaces.length>maxBlocks,unknownCells:unknown,readCells:reads,consistent:revision===client.world.revision};
    if(geometry.consistent)volumeCache.set(client,geometry);
  }
  const entities=[...client.entities.values()].filter(entity=>entity.position&&Math.hypot(entity.position.x-self.x,entity.position.y-self.y,entity.position.z-self.z)<radius*2).slice(0,128).map(entity=>({id:entity.id,name:entity.username||entity.name,kind:entity.kind,position:{...entity.position},yaw:entity.yaw||0}));
  const route=client.navigationDebug?.dimension===client.state.dimension?structuredClone(client.navigationDebug):null;
  const action=client.pending?.action,position=action?.args?.position||action?.args;
  const target=position&&['x','y','z'].every(key=>Number.isFinite(position[key]))?{x:position.x,y:position.y,z:position.z}:route?.goal||null;
  return {...structuredClone(geometry),status:'ready',at:Date.now(),dimension:client.state.dimension,self:{position:{...self},yaw:client.state.yaw,pitch:client.state.pitch,health:client.state.health},entities,route,target,waypoints:structuredClone(waypoints.slice(0,128)),protectedRegions:structuredClone((client.protection?.regions||[]).filter(region=>region.dimension===client.state.dimension).slice(0,32)),loadedChunks:client.world.columns.size};
}
