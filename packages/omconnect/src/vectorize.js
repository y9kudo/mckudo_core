import { setImmediate as yieldTask } from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import { fluidAt } from './environment.js';
import {planRoute,planRouteAsync} from './navigation.js';

export const OMVECTORIZE = Object.freeze({ name: 'OMVectorize', author: 'y9kudo', version: '1.0.0-Arthas-dev.3', versionName: 'Version Arthas', displayVersion: 'v1.0.0Arthas-dev.3', modes: ['ground','swim','elytra'], predictions: ['elytra'] });
const axes = ['x', 'y', 'z'];
const valid = p => p && axes.every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const distance = (a,b) => Math.hypot(...axes.map(k=>a[k]-b[k]));
const key = p => axes.map(k=>p[k]).join(',');
const cell = p => Object.fromEntries(axes.map(k=>[k, Math.floor(p[k])]));
const center = p => ({x:p.x+.5,y:p.y+.05,z:p.z+.5});
const name = b => (b?.name || b?.id || '').replace(/^minecraft:/,'');
const dangerous = new Set(['lava','fire','soul_fire','cactus','magma_block','powder_snow','sweet_berry_bush','wither_rose','cobweb']);

/** Checks the whole player body, including partial block collision shapes. */
export function volumeClearance({position,getBlock,height=1.8,radius=.3}) {
  if(!valid(position)||typeof getBlock!=='function'||!Number.isFinite(height)||height<=0||height>3||!Number.isFinite(radius)||radius<=0||radius>1)throw new Error("OMVectorize: Wrong body volume.");
  const box=[position.x-radius,position.y,position.z-radius,position.x+radius,position.y+height,position.z+radius];
  let water=false;
  for(let y=Math.floor(box[1]+1e-7);y<=Math.floor(box[4]-1e-7);y++)for(let z=Math.floor(box[2]+1e-7);z<=Math.floor(box[5]-1e-7);z++)for(let x=Math.floor(box[0]+1e-7);x<=Math.floor(box[3]-1e-7);x++){
    const p={x,y,z},b=getBlock(p);
    if(!b)return {clear:false,reason:'unloaded',position:p};
    if(dangerous.has(name(b)))return {clear:false,reason:'hazard',position:p};
    const fluid=fluidAt(b);if(fluid?.kind==='lava')return {clear:false,reason:'hazard',position:p};
    if(fluid?.kind==='water'&&box[1]<y+fluid.height)water=true;
    for(const s of b.shapes || (b.boundingBox==='block'?[[0,0,0,1,1,1]]:[])){
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

class Queue {
  values=[];
  push(v){const a=this.values;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p].score<=v.score)break;a[i]=a[p];i=p;}a[i]=v;}
  pop(){const a=this.values,first=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].score<a[c].score)c++;if(a[c].score>=last.score)break;a[i]=a[c];i=c;}a[i]=last;}return first;}
}
const directions=[];for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)if(x||y||z)directions.push({x,y,z});

function* search(options) {
  const {start,goal,getBlock,signal,maxNodes=8000,maxDistance=96,airTicks=300,airReserveTicks=60,ticksPerBlock=24,waterBreathing=false}=options;
  if(!valid(start)||!valid(goal)||typeof getBlock!=='function')throw new Error("OMVectorize: start, goal, getBlock required.");
  for(const [v,min,max,label] of [[maxNodes,1,100000,'maxNodes'],[maxDistance,1,512,'maxDistance'],[airTicks,0,12000,'airTicks'],[airReserveTicks,0,12000,'airReserveTicks'],[ticksPerBlock,12,100,'ticksPerBlock']])if(!Number.isInteger(v)||v<min||v>max)throw new Error(`OMVectorize ${label}: ${min}–${max}.`);
  if(!waterBreathing&&airTicks<airReserveTicks)return {status:'blocked',reason:'air-budget',waypoints:[],visited:0};
  if(distance(start,goal)>maxDistance)return {status:'blocked',reason:'distance-budget',waypoints:[],visited:0};
  const origin=cell(start),target=cell(goal),queue=new Queue(),labels=new Map(),cache=new Map();let visited=0,airBlocked=false,unknown=false;
  const read=p=>{const id=key(cell(p));if(!cache.has(id))cache.set(id,getBlock(cell(p)));return cache.get(id);};
  const body=p=>volumeClearance({position:center(p),getBlock:read});
  const usable=p=>{
    const v=body(p);if(!v.clear){if(v.reason==='unloaded')unknown=true;return null;}
    const below=read({...p,y:p.y-1});
    // No unsupported free flight. Air cells are only shore/surface transitions.
    if(!v.water&&!(below&&(below.shapes?.some(s=>s[4]>=.99)||below.boundingBox==='block')))return null;
    return v;
  };
  if(!usable(origin))return {status:'blocked',reason:'invalid-start',waypoints:[],visited};
  const first={p:origin,g:0,air:waterBreathing?12000:airTicks,parent:null,score:distance(origin,target),active:true};queue.push(first);labels.set(key(origin),[first]);
  while(queue.values.length&&visited<maxNodes){
    signal?.throwIfAborted();const node=queue.pop();if(!node.active)continue;visited++;yield visited;
    if(key(node.p)===key(target)){
      const waypoints=[];let n=node;while(n){waypoints.push(center(n.p));n=n.parent;}waypoints.reverse();
      return {status:'planned',reason:'goal',mode:'swim',waypoints,visited,cost:node.g,airRemainingTicks:node.air};
    }
    for(const d of directions){
      const next=Object.fromEntries(axes.map(k=>[k,node.p[k]+d[k]]));if(distance(origin,next)>maxDistance)continue;
      const volume=usable(next);if(!volume)continue;
      const swept=traceVolume({from:center(node.p),to:center(next),getBlock:read});if(!swept.clear){if(swept.reason==='unloaded')unknown=true;continue;}
      const length=distance(node.p,next),ticks=Math.ceil(length*ticksPerBlock)+(d.y?8:0);
      // Conservatively charge the entire edge if any portion was underwater.
      let air=waterBreathing?12000:node.air-(swept.submergedSamples?ticks:0);
      if(!waterBreathing&&air<airReserveTicks){airBlocked=true;continue;}
      // Crossing a dry head cell is not an instant refill: Java restores 4 air/tick.
      if(!waterBreathing&&!volume.submerged&&!swept.submergedSamples)air=Math.min(300,air+4*ticks);
      const g=node.g+length+(d.y?.15:0),id=key(next),known=labels.get(id)||[];
      if(known.some(n=>n.active&&n.g<=g&&n.air>=air))continue;
      for(const n of known)if(n.g>=g&&n.air<=air)n.active=false;
      const child={p:next,g,air,parent:node,score:g+distance(next,target),active:true};
      labels.set(id,[...known.filter(n=>n.active),child]);queue.push(child);
    }
  }
  return {status:'blocked',reason:visited>=maxNodes?'search-budget':airBlocked?'air-budget':unknown?'unloaded':'no-route',waypoints:[],visited};
}
export function planSwimRoute(options){const job=search(options);let next;do{next=job.next();}while(!next.done);return next.value;}
export async function planSwimRouteAsync(options,{nodesPerSlice=64,sliceMs=4,getRevision}={}){
  if(!Number.isInteger(nodesPerSlice)||nodesPerSlice<1||nodesPerSlice>1000)throw new Error('nodesPerSlice: 1–1000.');
  if(!Number.isFinite(sliceMs)||sliceMs<1||sliceMs>20)throw new Error('sliceMs: 1–20.');
  const revision=getRevision?.(),job=search(options);let n=0,since=performance.now();
  for(;;){options.signal?.throwIfAborted();if(getRevision&&getRevision()!==revision)return {status:'blocked',reason:'world-changed',waypoints:[],visited:n};const next=job.next();if(next.done)return next.value;n=next.value;if(n%nodesPerSlice===0||performance.now()-since>=sliceMs){await yieldTask();since=performance.now();}}
}

/** One Java-style elytra prediction tick, in blocks/tick, pitch in degrees. Not a packet sender. */
export function predictElytraTick({position,velocity,yaw,pitch,rocket=false}){
  if(!valid(position)||!valid(velocity)||!Number.isFinite(yaw)||!Number.isFinite(pitch)||Math.abs(pitch)>90||Math.hypot(velocity.x,velocity.y,velocity.z)>16)throw new Error("Elytra: invalid state.");
  const y=yaw*Math.PI/180,p=pitch*Math.PI/180,cos=Math.cos(p),sin=Math.sin(p),look={x:-Math.sin(y)*cos,y:-sin,z:Math.cos(y)*cos},v={...velocity};
  if(rocket)for(const k of axes)v[k]+=look[k]*.1+(look[k]*1.5-v[k])*.5;
  const horizontal=Math.hypot(v.x,v.z);
  v.y+=-.08+cos*cos*.06;
  if(v.y<0&&cos>1e-7){const lift=v.y*-.1*cos*cos;v.y+=lift;v.x+=look.x*lift/cos;v.z+=look.z*lift/cos;}
  if(p<0&&cos>1e-7){const lift=horizontal*-sin*.04;v.y+=lift*3.2;v.x-=look.x*lift/cos;v.z-=look.z*lift/cos;}
  if(cos>1e-7){v.x+=(look.x/cos*horizontal-v.x)*.1;v.z+=(look.z/cos*horizontal-v.z)*.1;}
  v.x*=.99;v.y*=.98;v.z*=.99;
  return {position:Object.fromEntries(axes.map(k=>[k,position[k]+v[k]])),velocity:v,yaw,pitch};
}

export class OMVectorize {
  constructor({getBlock,getRevision,groundBackend=null}={}){if(typeof getBlock!=='function')throw new Error("OMVectorize: requires getBlock.");if(groundBackend&&typeof groundBackend.planGroundAsync!=='function')throw new Error('A ground backend must implement planGroundAsync.');this.getBlock=getBlock;this.getRevision=getRevision;this.groundBackend=groundBackend;}
  planGround(options){return planRoute({...options,getBlock:options.getBlock||this.getBlock});}
  planGroundAsync(options,scheduling={}){const plan=this.groundBackend?this.groundBackend.planGroundAsync.bind(this.groundBackend):planRouteAsync;return plan({...options,getBlock:options.getBlock||this.getBlock},{getRevision:this.getRevision,...scheduling});}
  planSwim(options){return planSwimRoute({...options,getBlock:this.getBlock});}
  planSwimAsync(options){return planSwimRouteAsync({...options,getBlock:this.getBlock},{getRevision:this.getRevision});}
  plan(options){return planSwimRoute({...options,getBlock:this.getBlock});}
  planAsync(options){return planSwimRouteAsync({...options,getBlock:this.getBlock},{getRevision:this.getRevision});}
  clearance(position){return volumeClearance({position,getBlock:this.getBlock});}
  planFlight(options){return planElytraFlight({...options,getBlock:this.getBlock});}
}

/** A bounded flight corridor over observed blocks, with a checked landing patch. */
export function planElytraFlight({start,goal,getBlock,cruiseHeight=16,maxDistance=192}){
  if(!valid(start)||!valid(goal)||typeof getBlock!=='function'||!Number.isInteger(cruiseHeight)||cruiseHeight<8||cruiseHeight>64||!Number.isInteger(maxDistance)||maxDistance<8||maxDistance>512)throw new Error('Flight: start/goal, cruiseHeight 8–64, maxDistance 8–512.');
  if(distance(start,goal)>maxDistance)return {status:'blocked',reason:'distance-budget'};
  const landing={x:Math.floor(goal.x)+.5,y:Math.floor(goal.y),z:Math.floor(goal.z)+.5};
  for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++){
    const p={x:landing.x+x,y:landing.y,z:landing.z+z},b=getBlock({...p,y:p.y-1});
    if(!b||!(b.shapes?.some(s=>s[4]===1)||b.boundingBox==='block')||dangerous.has(name(b))||fluidAt(b)||!volumeClearance({position:p,getBlock}).clear)return {status:'blocked',reason:'landing-patch'};
  }
  const altitude=Math.max(start.y,landing.y)+cruiseHeight;
  const waypoints=[{...start,y:start.y+.1},{...start,y:altitude},{...landing,y:altitude},landing];
  for(let i=1;i<waypoints.length;i++){
    const check=traceVolume({from:waypoints[i-1],to:waypoints[i],getBlock,height:1.8,radius:.5});
    if(!check.clear)return {status:'blocked',reason:check.reason,position:check.position};
  }
  return {status:'planned',mode:'elytra',landing,altitude,waypoints};
}

/** Flight angles, not positions: vanilla physics remains the only motion source. */
export function elytraControl({position,velocity,landing,altitude,boosting=false}){
  if(![position,velocity,landing].every(valid)||!Number.isFinite(altitude))throw new Error("Flight control: invalid state.");
  const dx=landing.x-position.x,dz=landing.z-position.z,remaining=Math.hypot(dx,dz),height=position.y-landing.y;
  let phase,pitch;
  if(remaining<Math.max(5,Math.hypot(velocity.x,velocity.z)*5)){phase='flare';pitch=-78;}
  else if(remaining<Math.max(20,height*2.5)){phase='approach';pitch=Math.max(5,Math.min(35,Math.atan2(Math.max(0,height-1),remaining)*180/Math.PI));}
  else if(position.y<altitude-2&&boosting){phase='climb';pitch=-45;}
  else{phase='cruise';pitch=Math.max(-25,Math.min(18,(position.y-altitude)*2));}
  return {yaw:Math.atan2(-dx,dz)*180/Math.PI,pitch,phase,remaining};
}
