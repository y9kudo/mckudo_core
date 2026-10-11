import {jsonCopy} from './config.js';

const INPUTS=12,HIDDEN=16,clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const point=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
const key=(dimension,p)=>`${dimension}/${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const features=e=>{
  if(!point(e.from)||!point(e.to))throw new Error('Обучению перехода нужны from/to.');
  if(typeof e.dimension!=='string'||e.dimension.length>80||['health','food','nearbyPlayers','healthAfter'].some(k=>e[k]!=null&&!Number.isFinite(e[k])))throw new Error('Некорректное наблюдение перехода.');
  const dx=e.to.x-e.from.x,dy=e.to.y-e.from.y,dz=e.to.z-e.from.z;
  return [clamp(dx/8,-1,1),clamp(dz/8,-1,1),clamp(dy/8,-1,1),clamp(Math.hypot(dx,dy,dz)/16,0,1),clamp((e.health??20)/20,0,1),clamp((e.food??20)/20,0,1),clamp((e.nearbyPlayers??0)/4,0,1),Number(e.dimension==='minecraft:the_nether'),Number(e.dimension==='minecraft:the_end'),Number(e.kind==='jump'),Number(e.kind==='drop'),Number(e.kind==='bridge')];
};

/** A local 12→16 tanh→1 sigmoid network trained by backpropagation with replay.
 * Predicts transition failure, not Minecraft mechanics. Hard safety is external.
 */
export function createNeuralNavigator({worldId,learningRate=.025,memory,clock=Date.now}={}) {
  if(typeof worldId!=='string'||!worldId.trim()||worldId.length>128||!Number.isFinite(learningRate)||learningRate<=0||learningRate>.1)throw new Error('Нейронавигации нужны worldId и learningRate (0,.1].');
  let seed=712367,updates=0,samples=0,loss=0,cursor=0;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
  let w=Array.from({length:HIDDEN},()=>Array.from({length:INPUTS},()=> (random()-.5)*.3)),b=Array(HIDDEN).fill(0),v=Array.from({length:HIDDEN},()=> (random()-.5)*.3),bias=-1;
  const replay=[],failed=new Map(),journal=[],seen=new Set(),predictions=new Map();
  const forward=x=>{const h=w.map((row,i)=>Math.tanh(row.reduce((s,a,j)=>s+a*x[j],b[i]))),z=clamp(h.reduce((s,a,i)=>s+a*v[i],bias),-20,20);return {h,p:1/(1+Math.exp(-z))};};
  const train=({x,y})=>{
    predictions.clear();
    const {h,p}=forward(x),dz=clamp(p-y,-1,1),old=[...v];
    for(let i=0;i<HIDDEN;i++){v[i]-=learningRate*dz*h[i];const d=dz*old[i]*(1-h[i]*h[i]);b[i]-=learningRate*d;for(let j=0;j<INPUTS;j++)w[i][j]-=learningRate*d*x[j];}
    bias-=learningRate*dz;updates++;loss=.95*loss+.05*(-y*Math.log(Math.max(1e-9,p))-(1-y)*Math.log(Math.max(1e-9,1-p)));
  };
  if(memory){
    const m=jsonCopy(memory,'neuralMemory',2*1024*1024);
    if(m.schemaVersion!==1||m.worldId!==worldId||m.architecture!=='12-16-1'||!Number.isSafeInteger(m.samples)||m.samples<0||!Number.isSafeInteger(m.updates)||m.updates<0)throw new Error('Память нейросети другого мира или неверного формата.');
    const finite=a=>a.every(n=>Number.isFinite(n)&&Math.abs(n)<=1000);
    if(!Array.isArray(m.weights?.w)||m.weights.w.length!==HIDDEN||m.weights.w.some(a=>!Array.isArray(a)||a.length!==INPUTS||!finite(a))||!Array.isArray(m.weights.b)||m.weights.b.length!==HIDDEN||!finite(m.weights.b)||!Array.isArray(m.weights.v)||m.weights.v.length!==HIDDEN||!finite(m.weights.v)||!Number.isFinite(m.weights.bias)||Math.abs(m.weights.bias)>1000)throw new Error('Повреждены веса нейросети.');
    ({w,b,v,bias}=m.weights);samples=m.samples;updates=m.updates;
    if(!Array.isArray(m.replay)||m.replay.length>512||m.replay.some(s=>!Array.isArray(s.x)||s.x.length!==INPUTS||!finite(s.x)||s.x.some(n=>Math.abs(n)>1)||![0,1].includes(s.y)))throw new Error('Повреждена память переходов.');
    replay.push(...m.replay);
    if(!Array.isArray(m.failed)||m.failed.length>256||m.failed.some(e=>typeof e.key!=='string'||e.key.length>150||!Number.isFinite(e.until)||!Number.isInteger(e.count)||e.count<1||e.count>32))throw new Error('Повреждена память неудач.');
    for(const f of m.failed)if(f.until>clock()&&f.until<=clock()+300000)failed.set(f.key,{until:f.until,count:f.count});
  }
  const prune=()=>{for(const [k,f]of failed)if(f.until<=clock())failed.delete(k);};
  return {
    worldId,
    record(event){
      if(!['success','failure','cancelled'].includes(event.outcome))throw new Error('Неизвестный результат перехода.');
      if(event.outcome==='cancelled')return false;
      if(event.id&&seen.has(event.id))return false;
      const x=features(event),y=Number(event.outcome==='failure'||event.healthAfter!=null&&event.healthAfter<(event.health??20));
      if(event.id){seen.add(event.id);if(seen.size>2048)seen.delete(seen.values().next().value);}
      const k=key(event.dimension,event.to);prune();
      if(y){const count=Math.min(32,(failed.get(k)?.count||0)+1);failed.set(k,{count,until:clock()+Math.min(300000,15000*count)});if(failed.size>256)failed.delete(failed.keys().next().value);}else failed.delete(k);
      const sample={x,y};replay.push(sample);if(replay.length>512)replay.shift();samples++;
      train(sample);for(let i=0;i<Math.min(16,replay.length);i++){train(replay[cursor%replay.length]);cursor++;}
      journal.push({at:clock(),from:{...event.from},to:{...event.to},dimension:event.dimension,outcome:event.outcome,damage:y===1&&event.outcome==='success',reason:String(event.reason||'').slice(0,200)});if(journal.length>32)journal.shift();return true;
    },
    assess(event){prune();const x=features(event),cacheKey=x.join(',');if(!predictions.has(cacheKey)){predictions.set(cacheKey,forward(x).p);if(predictions.size>256)predictions.delete(predictions.keys().next().value);}const probability=predictions.get(cacheKey),exact=failed.get(key(event.dimension,event.to));return {failureProbability:probability,samples,trained:samples>=8,rememberedFailures:exact?.count||0,cost:(exact?12+exact.count:0)+(samples>=8?probability*6:0)};},
    snapshot(){prune();return {kind:'local-neural-network',architecture:'12-16-1',samples,updates,loss,rememberedFailures:failed.size,journal:structuredClone(journal)};},
    export(){prune();return jsonCopy({schemaVersion:1,worldId,architecture:'12-16-1',samples,updates,weights:{w,b,v,bias},replay,failed:[...failed].map(([key,f])=>({key,...f}))},'neuralMemory',2*1024*1024);}
  };
}

export function attachNeuralNavigation(client,model){
  const describe=(from,to,kind)=>({from,to,kind,dimension:client.state.dimension,health:client.state.health,food:client.state.food,nearbyPlayers:[...client.entities.values()].filter(e=>e.kind==='player'&&Math.hypot(e.position.x-to.x,e.position.z-to.z)<3).length});
  const prior=client.navigationPolicy,policy={cost:(from,to,kind)=>model.assess(describe(from,to,kind)).cost};client.navigationPolicy=policy;
  const listen=e=>model.record({...describe(e.from,e.to,e.kind),...e});client.on('navigationStep',listen);
  return ()=>{client.off('navigationStep',listen);if(client.navigationPolicy===policy)client.navigationPolicy=prior;};
}
