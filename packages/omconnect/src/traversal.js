import {fluidAt} from './environment.js';
const axes=['x','y','z'],valid=p=>p&&axes.every(k=>Number.isFinite(p[k])&&Math.abs(p[k])<=30000000);
const distance=(a,b)=>Math.hypot(...axes.map(k=>a[k]-b[k])),cell=p=>Object.fromEntries(axes.map(k=>[k,Math.floor(p[k])]));
const name=b=>(b?.name||b?.id||'').replace(/^minecraft:/,'');
const dangerous=new Set(['lava','fire','soul_fire','cactus','magma_block','powder_snow','sweet_berry_bush','wither_rose','cobweb']);
export const FULL_CUBE=Object.freeze([Object.freeze([0,0,0,1,1,1])]);
export const BODY_POSES=Object.freeze({standing:1.8,crouching:1.5,swimming:.6,gliding:.6});
/** Missing geometry is solid; an explicit empty shape array is passable. */
export function collisionShapes(block){
  if(!block)return null;
  if(Array.isArray(block.shapes))return block.shapes;
  return block.boundingBox==='empty'||['air','cave_air','void_air'].includes(name(block))?[]:FULL_CUBE;
}
export function bodyBounds(position,height=1.8,radius=.3){return {minX:position.x-radius,maxX:position.x+radius,minY:position.y,maxY:position.y+height,minZ:position.z-radius,maxZ:position.z+radius};}
export function supportAt({position,getBlock,radius=.3,tolerance=.08}){
  if(!valid(position)||typeof getBlock!=='function'||!Number.isFinite(radius)||radius<=0||radius>1||!Number.isFinite(tolerance)||tolerance<0||tolerance>.5)throw new Error('Support requires a body position and bounded dimensions.');
  let height=-Infinity,unknown=false;
  for(let x=Math.floor(position.x-radius+1e-7);x<=Math.floor(position.x+radius-1e-7);x++)for(let z=Math.floor(position.z-radius+1e-7);z<=Math.floor(position.z+radius-1e-7);z++)for(let y=Math.floor(position.y)-2;y<=Math.floor(position.y);y++){
    const block=getBlock({x,y,z});if(!block){unknown=true;continue;}if(dangerous.has(name(block))||fluidAt(block))continue;
    for(const s of collisionShapes(block))if(Math.abs(y+s[4]-position.y)<=tolerance&&position.x+radius>x+s[0]+1e-7&&position.x-radius<x+s[3]-1e-7&&position.z+radius>z+s[2]+1e-7&&position.z-radius<z+s[5]-1e-7)height=Math.max(height,y+s[4]);
  }
  return {supported:Number.isFinite(height)&&!unknown,height:Number.isFinite(height)?height:null,unknown};
}
/** Checks the whole player body, including partial block collision shapes. */
export function volumeClearance({position,getBlock,height=1.8,radius=.3}) {
  if(!valid(position)||typeof getBlock!=='function'||!Number.isFinite(height)||height<=0||height>3||!Number.isFinite(radius)||radius<=0||radius>1)throw new Error("OMVectorize: Wrong body volume.");
  const box=[position.x-radius,position.y,position.z-radius,position.x+radius,position.y+height,position.z+radius];
  let water=false;
  for(let y=Math.floor(box[1]+1e-7)-1;y<=Math.floor(box[4]-1e-7);y++)for(let z=Math.floor(box[2]+1e-7);z<=Math.floor(box[5]-1e-7);z++)for(let x=Math.floor(box[0]+1e-7);x<=Math.floor(box[3]-1e-7);x++){
    const p={x,y,z},b=getBlock(p);
    if(!b)return {clear:false,reason:'unloaded',position:p};
    if(dangerous.has(name(b)))return {clear:false,reason:'hazard',position:p};
    const fluid=fluidAt(b);if(fluid?.kind==='lava')return {clear:false,reason:'hazard',position:p};
    if(fluid?.kind==='water'&&box[1]<y+fluid.height)water=true;
    for(const s of collisionShapes(b) || FULL_CUBE){
      if(box[3]>x+s[0]+1e-7&&box[0]<x+s[3]-1e-7&&box[4]>y+s[1]+1e-7&&box[1]<y+s[4]-1e-7&&box[5]>z+s[2]+1e-7&&box[2]<z+s[5]-1e-7)return {clear:false,reason:'collision',position:p};
    }
  }
  const eye={x:position.x,y:position.y+Math.min(1.62,height*.9),z:position.z},f=fluidAt(getBlock(cell(eye)));
  const above=fluidAt(getBlock({...cell(eye),y:Math.floor(eye.y)+1}));
  const submerged=f?.kind==='water'&&eye.y<Math.floor(eye.y)+(above?.kind==='water'?1:f.height);
  return {clear:true,reason:'clear',water,submerged:Boolean(submerged)};
}

export function traceVolume({from,to,getBlock,height=1.8,radius=.3}) {
  if(!valid(from)||!valid(to))throw new Error("OMVectorize: from/to shall be the coordinates.");
  const length=distance(from,to);if(length>512)throw new Error("traceVolume: maximum 512 blocks.");
  const samples=Math.max(1,Math.ceil(length/.15));let submergedSamples=0;
  for(let i=0;i<=samples;i++){
    const p=Object.fromEntries(axes.map(k=>[k,from[k]+(to[k]-from[k])*i/samples]));
    const result=volumeClearance({position:p,getBlock,height,radius});
    if(!result.clear)return {...result,fraction:i/samples};
    if(result.submerged)submergedSamples++;
  }
  return {clear:true,reason:'clear',submergedSamples,samples:samples+1};
}
