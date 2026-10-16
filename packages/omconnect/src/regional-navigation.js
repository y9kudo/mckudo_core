import {setImmediate as yieldTask} from 'node:timers/promises';

const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;
const point=p=>p&&['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000);

/** Directed observed connections. A regional edge is a hint, never a movement permission. */
export class RegionalRouteGraph {
  constructor({maxNodes=4096,maxEdges=16384}={}){
    if(!Number.isInteger(maxNodes)||maxNodes<2||maxNodes>16384||!Number.isInteger(maxEdges)||maxEdges<1||maxEdges>65536)throw new Error('Invalid regional graph limits.');
    this.maxNodes=maxNodes;this.maxEdges=maxEdges;this.nodes=new Map();this.revision=0;this.edges=0;this.changes=[];
  }
  setEdge(from,to,cost,{gateway,observedAt=Date.now()}={}){
    if(!validId(from)||!validId(to)||from===to||!Number.isFinite(cost)||cost<=0||cost>1000000||gateway!==undefined&&!point(gateway)||!Number.isSafeInteger(observedAt)||observedAt<0)throw new Error('Invalid regional connection.');
    const needed=Number(!this.nodes.has(from))+Number(!this.nodes.has(to));
    const previous=this.nodes.get(from)?.out.get(to);
    if(this.nodes.size+needed>this.maxNodes||!previous&&this.edges>=this.maxEdges)throw new Error('Regional graph budget exceeded.');
    for(const id of [from,to])if(!this.nodes.has(id))this.nodes.set(id,{out:new Map(),in:new Map()});
    const edge={from,to,cost,...gateway?{gateway:{...gateway}}:{},observedAt};
    this.nodes.get(from).out.set(to,edge);this.nodes.get(to).in.set(from,edge);
    if(!previous)this.edges++;
    if(!previous||previous.cost!==cost||JSON.stringify(previous.gateway)!==JSON.stringify(gateway))this.changed(to);
    return edge;
  }
  removeEdge(from,to){if(!this.nodes.get(from)?.out.delete(to))return false;this.nodes.get(to).in.delete(from);this.edges--;this.changed(to);return true;}
  changed(id){this.changes.push({revision:++this.revision,id});if(this.changes.length>4096)this.changes.shift();}
  changedSince(revision){if(revision===this.revision)return [];if(revision<0||revision<(this.changes[0]?.revision??this.revision)-1)return null;return [...new Set(this.changes.filter(c=>c.revision>revision).map(c=>c.id))];}
  export(){return {schemaVersion:1,edges:[...this.nodes.values()].flatMap(n=>[...n.out.values()].map(e=>structuredClone(e)))};}
  restore(memory){
    if(this.nodes.size)throw new Error('Restore requires an empty regional graph.');
    if(memory?.schemaVersion!==1||!Array.isArray(memory.edges)||memory.edges.length>this.maxEdges)throw new Error('Invalid regional graph memory.');
    const checked=new RegionalRouteGraph({maxNodes:this.maxNodes,maxEdges:this.maxEdges});
    for(const e of memory.edges){if(checked.nodes.get(e.from)?.out.has(e.to))throw new Error('Duplicate regional connection.');checked.setEdge(e.from,e.to,e.cost,e);}
    this.nodes=checked.nodes;this.edges=checked.edges;this.revision=checked.revision;this.changes=checked.changes;
  }
}

/** Indexed min heap: updates replace entries instead of retaining stale queue labels. */
class Frontier {
  values=[];positions=new Map();
  less(a,b){return a.key<b.key||a.key===b.key&&a.id<b.id;}
  swap(a,b){[this.values[a],this.values[b]]=[this.values[b],this.values[a]];this.positions.set(this.values[a].id,a);this.positions.set(this.values[b].id,b);}
  up(i){while(i){const p=(i-1)>>1;if(!this.less(this.values[i],this.values[p]))break;this.swap(i,p);i=p;}return i;}
  down(i){for(;;){let n=i;for(const c of [i*2+1,i*2+2])if(c<this.values.length&&this.less(this.values[c],this.values[n]))n=c;if(n===i)break;this.swap(i,n);i=n;}}
  remove(id){const i=this.positions.get(id);if(i===undefined)return;const last=this.values.pop();this.positions.delete(id);if(i<this.values.length){this.values[i]=last;this.positions.set(last.id,i);this.down(this.up(i));}}
  set(id,key){this.remove(id);if(!Number.isFinite(key))return;this.positions.set(id,this.values.length);this.values.push({id,key});this.up(this.values.length-1);}
  pop(){const first=this.values[0];if(first)this.remove(first.id);return first;}
  get key(){return this.values[0]?.key??Infinity;}
}

/** Lifelong Planning A* with a zero heuristic on the small regional graph.
 * Costs remain exact; changed connections repair rhs/g labels instead of resetting all work. */
export class IncrementalRegionPlanner {
  constructor(graph){if(!(graph instanceof RegionalRouteGraph))throw new Error('A RegionalRouteGraph is required.');this.graph=graph;this.origin=null;this.g=new Map();this.rhs=new Map();this.open=new Frontier();this.revision=-1;this.totalExpanded=0;this.resets=0;}
  value(map,id){return map.get(id)??Infinity;}
  touch(id){
    if(id!==this.origin){let best=Infinity;for(const e of this.graph.nodes.get(id)?.in.values()??[])best=Math.min(best,this.value(this.g,e.from)+e.cost);this.rhs.set(id,best);}
    this.open.set(id,this.value(this.g,id)===this.value(this.rhs,id)?Infinity:Math.min(this.value(this.g,id),this.value(this.rhs,id)));
  }
  sync(start){
    const changed=this.graph.changedSince(this.revision);
    if(this.origin!==start||changed===null){this.origin=start;this.g.clear();this.rhs.clear();this.rhs.set(start,0);this.open=new Frontier();this.touch(start);this.resets++;}
    else for(const id of changed)this.touch(id);
    this.revision=this.graph.revision;
  }
  async plan(start,goal,options={}){
    if(this.running)throw new Error('A regional search is already running; cancel or await it first.');
    this.running=true;try{return await this.compute(start,goal,options);}finally{this.running=false;}
  }
  async compute(start,goal,{maxExpansions=16384,nodesPerSlice=32,signal}={}){
    if(!validId(start)||!validId(goal)||!Number.isInteger(maxExpansions)||maxExpansions<1||maxExpansions>65536||!Number.isInteger(nodesPerSlice)||nodesPerSlice<1||nodesPerSlice>256)throw new Error('Invalid incremental planning request.');
    signal?.throwIfAborted();this.sync(start);const revision=this.graph.revision;let expanded=0;
    while(this.open.key<Math.min(this.value(this.g,goal),this.value(this.rhs,goal))||this.value(this.g,goal)!==this.value(this.rhs,goal)){
      signal?.throwIfAborted();if(revision!==this.graph.revision)return {status:'blocked',reason:'world-changed',nodes:[],expanded};
      if(!this.open.values.length||expanded>=maxExpansions)return {status:'blocked',reason:'search-budget',nodes:[],expanded};
      const {id}=this.open.pop();expanded++;this.totalExpanded++;
      if(this.value(this.g,id)>this.value(this.rhs,id))this.g.set(id,this.value(this.rhs,id));
      else {this.g.set(id,Infinity);this.touch(id);}
      for(const e of this.graph.nodes.get(id)?.out.values()??[])this.touch(e.to);
      if(expanded%nodesPerSlice===0)await yieldTask();
    }
    signal?.throwIfAborted();
    if(revision!==this.graph.revision)return {status:'blocked',reason:'world-changed',nodes:[],expanded};
    if(!Number.isFinite(this.value(this.g,goal)))return {status:'blocked',reason:'no-route',nodes:[],expanded};
    const nodes=[goal],edges=[];let cursor=goal;
    while(cursor!==start){
      const edge=[...(this.graph.nodes.get(cursor)?.in.values()??[])].filter(e=>Number.isFinite(this.value(this.g,e.from))).sort((a,b)=>this.value(this.g,a.from)+a.cost-this.value(this.g,b.from)-b.cost||a.from.localeCompare(b.from))[0];
      if(!edge||nodes.includes(edge.from)||nodes.length>this.graph.maxNodes)return {status:'blocked',reason:'inconsistent-graph',nodes:[],expanded};
      edges.push(structuredClone(edge));nodes.push(edge.from);cursor=edge.from;
    }
    return {status:'planned',nodes:nodes.reverse(),edges:edges.reverse(),cost:this.value(this.g,goal),expanded};
  }
  snapshot(){return {nodes:this.g.size,queued:this.open.values.length,totalExpanded:this.totalExpanded,resets:this.resets,revision:this.revision};}
}
