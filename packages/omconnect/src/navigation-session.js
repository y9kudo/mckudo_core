import {planRouteAsync} from './navigation.js';
import {blockEvidenceValue,OMActionError} from './failures.js';
import {RegionalRouteGraph,IncrementalRegionPlanner} from './regional-navigation.js';

const axes=['x','y','z'],point=p=>p&&axes.every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000);
const key=p=>axes.map(k=>p[k]).join(','),distance=(a,b)=>Math.max(...axes.map(k=>Math.abs(a[k]-b[k])));
const scoped=s=>s&&['server','worldId','dimension','minecraftVersion'].every(k=>typeof s[k]==='string'&&s[k].length>0&&s[k].length<=256);
const scopeKey=s=>JSON.stringify(['server','worldId','dimension','minecraftVersion'].map(k=>s[k]));

/** Bounded route reuse and hierarchical local segments. Saved geometry is never authoritative. */
export function createNavigationSession({getBlock,getRevision,scope,maxRoutes=8,maxAgeMs=600000,segmentDistance=96,clock=Date.now,memory,planner=planRouteAsync}={}){
  if(typeof getBlock!=='function'||getRevision!==undefined&&typeof getRevision!=='function'||!scoped(scope)||!Number.isInteger(maxRoutes)||maxRoutes<1||maxRoutes>32||!Number.isInteger(maxAgeMs)||maxAgeMs<1000||maxAgeMs>86400000||!Number.isInteger(segmentDistance)||segmentDistance<8||segmentDistance>128||typeof clock!=='function'||typeof planner!=='function')throw new Error('Invalid navigation session configuration.');
  scope=structuredClone(scope);const graph=new RegionalRouteGraph(),regional=new IncrementalRegionPlanner(graph),routes=new Map();
  const stats={searches:0,cacheHits:0,invalidations:0,segments:0,regionalExpansions:0,cancelled:0};let current,closed=false;
  const region=p=>axes.map(k=>Math.floor(p[k]/16)).join(','),now=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0)throw new Error('Navigation clock must return Unix milliseconds.');return n;};
  if(memory!==undefined){
    if(!memory||JSON.stringify(memory).length>4*1024*1024||memory.schemaVersion!==2||!scoped(memory.scope)||scopeKey(memory.scope)!==scopeKey(scope)||!Array.isArray(memory.routes)||memory.routes.length>maxRoutes)throw new Error('Navigation memory has an incompatible schema or world scope.');
    graph.restore(memory.graph);
    for(const e of memory.routes){
      if(typeof e.key!=='string'||e.key.length>2048||!Number.isSafeInteger(e.at)||e.at<0||!Array.isArray(e.facts)||e.facts.length>8192||e.facts.some(f=>!Array.isArray(f)||f.length!==2||!point(f[0])||f[1]!==null&&(typeof f[1]!=='string'||f[1].length>8192))||e.route?.status!=='planned'||!Array.isArray(e.route.steps)||e.route.steps.length>4096||e.route.steps.some(s=>!point(s.position)||!['walk','jump','drop'].includes(s.kind)))throw new Error('Invalid saved navigation route.');
      if(routes.has(e.key))throw new Error('Duplicate saved navigation route.');
      if(e.at<=now()&&now()-e.at<=maxAgeMs)routes.set(e.key,{...structuredClone(e),untrusted:true,stamp:Symbol('imported')});
    }
  }
  const rememberRoute=(route,start)=>{
    let previous=region(start),cost=0;
    for(const step of route.steps){
      if(!['walk','jump','drop'].includes(step.kind))continue;
      const next=region(step.position);cost+=step.kind==='walk'?1:2;
      if(previous&&previous!==next){
        if(graph.nodes.size<graph.maxNodes-2&&graph.edges<graph.maxEdges)graph.setEdge(previous,next,cost,{gateway:step.position,observedAt:now()});
        cost=0;
      }
      previous=next;
    }
  };
  const api={
    async plan(options,scheduling={}){
      if(closed)throw new Error('Navigation session is closed.');
      if(!point(options?.start)||!point(options.goal))throw new Error('Navigation requires integer start and goal coordinates.');
      options.signal?.throwIfAborted();
      if(scheduling.getRevision?.()===false)throw new OMActionError('STALE_WORLD','The supplied terrain read view is already stale.');
      const previous=current;previous?.abort(new OMActionError('STALE_WORLD','A newer navigation request superseded this request.'));
      const job=new AbortController();let finished;job.finished=new Promise(resolve=>{finished=resolve;});current=job;const signal=options.signal?AbortSignal.any([options.signal,job.signal]):job.signal;
      try{
        if(previous?.finished)await previous.finished;
        signal.throwIfAborted();
        for(const [id,e] of routes)if(now()-e.at>maxAgeMs||e.at>now())routes.delete(id);
        // Expired regional hints do not remain an immortal shortcut across sessions.
        for(const node of graph.nodes.values())for(const e of [...node.out.values()])if(e.observedAt>now()||now()-e.observedAt>maxAgeMs)graph.removeEdge(e.from,e.to);
        const finalGoal=options.goal,limit=Math.min(segmentDistance,options.maxDistance??segmentDistance),far=distance(options.start,finalGoal)>limit;
        let goal=finalGoal;
        if(far){
          const path=graph.nodes.has(region(finalGoal))?await regional.plan(region(options.start),region(finalGoal),{signal,maxExpansions:4096}):{status:'blocked',expanded:0};stats.regionalExpansions+=path.expanded;
          const gate=path.status==='planned'?path.edges.filter(e=>e.gateway&&distance(options.start,e.gateway)<=limit).at(-1)?.gateway:null;
          if(gate)goal=gate;
          else {const scale=limit/distance(options.start,finalGoal);goal=Object.fromEntries(axes.map(k=>[k,Math.round(options.start[k]+(finalGoal[k]-options.start[k])*scale)]));}
        }
        const cacheable=!options.occupied&&!options.edgeCost&&!options.canDig&&!options.canPlace&&!(options.bridgeBudget>0)&&options.staticGeometry!==false;
        const token=JSON.stringify([options.start,goal,finalGoal,options.range??0,options.maxDrop??3,options.fallPolicy??{},far,limit,options.allowPartial===true]);
        const read=options.getBlock||getBlock,stamp=getRevision?.();let cached=cacheable?routes.get(token):null;
        // Serialized evidence cannot authenticate itself: run a fresh local search on first use.
        if(cached?.untrusted){routes.delete(token);cached=null;stats.invalidations++;}
        if(cached&&(stamp===undefined||stamp!==cached.stamp)){
          if(cached.facts.some(([p,value])=>blockEvidenceValue(read(p))!==value)){routes.delete(token);cached=null;stats.invalidations++;}
          else cached.stamp=stamp;
        }
        signal.throwIfAborted();
        if(cached){stats.cacheHits++;return {...structuredClone(cached.route),visited:0,cacheHit:true};}
        const facts=new Map();let overflow=false;
        const observed=p=>{const b=read(p);if(cacheable&&!overflow){if(facts.size>=8192){overflow=true;facts.clear();}else facts.set(key(p),[{...p},blockEvidenceValue(b)]);}return b;};
        stats.searches++;
        const route=await planner({...options,start:options.start,goal,getBlock:observed,maxDistance:limit,allowPartial:far||options.allowPartial===true,signal},{getRevision,...scheduling});
        signal.throwIfAborted();
        const result={...route,finalGoal:{...finalGoal},segmentGoal:{...goal},partial:route.partial===true||far,strategy:far?'hierarchical-segment':'local-astar',cacheHit:false};
        if(result.status==='planned'){
          stats.segments++;rememberRoute(result,options.start);
          if(cacheable&&!overflow){while(routes.size>=maxRoutes)routes.delete(routes.keys().next().value);routes.set(token,{key:token,at:now(),stamp:getRevision?.(),route:structuredClone(result),facts:[...facts.values()]});}
        }
        return result;
      }catch(error){if(signal.aborted)stats.cancelled++;throw error;}
      finally{finished();if(current===job)current=null;}
    },
    snapshot:()=>({...stats,routes:routes.size,regions:graph.nodes.size,connections:graph.edges,regional:regional.snapshot(),closed}),
    exportMemory:()=>({schemaVersion:2,scope:structuredClone(scope),graph:graph.export(),routes:[...routes.values()].map(({stamp,untrusted,...entry})=>structuredClone(entry))}),
    clear(){current?.abort(new OMActionError('STALE_WORLD','Navigation memory was cleared.'));routes.clear();},
    close(){closed=true;current?.abort(new Error('Navigation session closed.'));routes.clear();}
  };return api;
}
