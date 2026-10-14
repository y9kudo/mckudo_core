import {integer, finite, vector, actionMask, argmax, randomSource} from './contracts.js';

/** CPU Double DQN: dense ReLU network, Adam, Huber loss, replay and target network. */
export function createDQN({ inputs, actions, hidden = 32, capacity = 20000, batchSize = 32, gamma = .99, learningRate = .001, targetEvery = 100, seed = 1, conservativeWeight = 0 } = {}) {
  integer(inputs,1,256,'inputs'); integer(actions,2,128,'actions'); integer(hidden,4,256,'hidden'); integer(capacity,32,100000,'capacity'); integer(batchSize,1,256,'batchSize'); if(batchSize>capacity)throw new Error('batchSize > capacity');
  finite(gamma,0,1,'gamma'); finite(learningRate,1e-6,.1,'learningRate'); integer(targetEvery,1,10000,'targetEvery'); finite(conservativeWeight,0,10,'conservativeWeight');
  const rng=randomSource(seed), hOffset=inputs*hidden, qOffset=hOffset+hidden, bOffset=qOffset+hidden*actions, size=bOffset+actions;
  const weights=new Float32Array(size), target=new Float32Array(size), first=new Float32Array(size), second=new Float32Array(size);
  for(let i=0;i<hOffset;i++)weights[i]=(rng.next()*2-1)*Math.sqrt(6/inputs);
  for(let i=qOffset;i<bOffset;i++)weights[i]=(rng.next()*2-1)*Math.sqrt(6/hidden);
  target.set(weights); const replay=new Array(capacity); let length=0,cursor=0,updates=0;
  const forward=(x,w=weights)=>{const h=new Float32Array(hidden),q=new Float32Array(actions);
    for(let j=0;j<hidden;j++){let v=w[hOffset+j];for(let i=0;i<inputs;i++)v+=x[i]*w[j*inputs+i];h[j]=Math.max(0,v);}
    for(let a=0;a<actions;a++){let v=w[bOffset+a];for(let j=0;j<hidden;j++)v+=h[j]*w[qOffset+a*hidden+j];q[a]=v;}
    return {h,q};};
  const backprop=(x,h,dq,gradient)=>{const dh=new Float32Array(hidden);
    for(let a=0;a<actions;a++){gradient[bOffset+a]+=dq[a];for(let j=0;j<hidden;j++){gradient[qOffset+a*hidden+j]+=dq[a]*h[j];dh[j]+=dq[a]*weights[qOffset+a*hidden+j];}}
    for(let j=0;j<hidden;j++)if(h[j]>0){gradient[hOffset+j]+=dh[j];for(let i=0;i<inputs;i++)gradient[j*inputs+i]+=dh[j]*x[i];}};
  const apply=gradient=>{updates++;const c1=1-Math.pow(.9,updates),c2=1-Math.pow(.999,updates);
    for(let i=0;i<size;i++){const g=Math.max(-10,Math.min(10,gradient[i]));first[i]=.9*first[i]+.1*g;second[i]=.999*second[i]+.001*g*g;weights[i]-=learningRate*(first[i]/c1)/(Math.sqrt(second[i]/c2)+1e-8);}
    if(updates%targetEvery===0)target.set(weights);};
  const transition=t=>{
    if(!t||typeof t.terminated!=='boolean'||typeof t.truncated!=='boolean')throw new TypeError('Separate terminated and truncated flags are required');
    return { observation:vector(t.observation,inputs),action:integer(t.action,0,actions-1,'action'),reward:finite(t.reward,-1e6,1e6,'reward'),nextObservation:vector(t.nextObservation,inputs),terminated:t.terminated,truncated:t.truncated,nextActionMask:actionMask(t.nextActionMask,actions) };
  };
  const api={
    predict(observation){return Array.from(forward(vector(observation,inputs)).q);},
    act(observation,{epsilon=0,mask}={}){finite(epsilon,0,1,'epsilon');const x=vector(observation,inputs),allowed=actionMask(mask,actions);if(rng.next()<epsilon){const choices=allowed.flatMap((v,i)=>v?[i]:[]);return choices[Math.floor(rng.next()*choices.length)];}return argmax(forward(x).q,allowed);},
    remember(t){replay[cursor]=transition(t);cursor=(cursor+1)%capacity;length=Math.min(capacity,length+1);},
    train({steps=1}={}){integer(steps,1,10000,'steps');let loss=0,trained=0;
      for(let s=0;s<steps&&length>=batchSize;s++){const gradient=new Float32Array(size);
        for(let b=0;b<batchSize;b++){const t=replay[Math.floor(rng.next()*length)],{h,q}=forward(t.observation),best=argmax(forward(t.nextObservation).q,t.nextActionMask);
          // Truncation keeps bootstrapping from the final observation; death/success does not.
          const y=t.reward+(t.terminated?0:gamma*forward(t.nextObservation,target).q[best]),error=q[t.action]-y,dq=new Float32Array(actions);
          loss+=Math.abs(error)<=1?.5*error*error:Math.abs(error)-.5;dq[t.action]=Math.max(-1,Math.min(1,error))/batchSize;
          if(conservativeWeight){const max=Math.max(...q),exp=Array.from(q,v=>Math.exp(v-max)),sum=exp.reduce((a,b)=>a+b,0);loss+=conservativeWeight*(max+Math.log(sum)-q[t.action]);for(let a=0;a<actions;a++)dq[a]+=conservativeWeight*(exp[a]/sum-(a===t.action?1:0))/batchSize;}
          backprop(t.observation,h,dq,gradient);
        }apply(gradient);trained++;
      }return {loss:trained?loss/(trained*batchSize):null,updates:trained,replaySize:length};},
    /** Offline BC from explicit encoded demonstrations, without pretending a raw chat log is a dataset. */
    imitate(samples,{epochs=1}={}){if(!Array.isArray(samples)||!samples.length||samples.length>100000)throw new Error('BC: 1..100000 samples');integer(epochs,1,1000,'epochs');const data=samples.map(s=>({observation:vector(s.observation,inputs),action:integer(s.action,0,actions-1,'action')}));let loss=0;
      for(let e=0;e<epochs;e++){const gradient=new Float32Array(size);for(const t of data){const {h,q}=forward(t.observation),max=Math.max(...q),exp=Array.from(q,v=>Math.exp(v-max)),sum=exp.reduce((a,b)=>a+b,0);loss+=max+Math.log(sum)-q[t.action];backprop(t.observation,h,Float32Array.from(exp,(v,a)=>(v/sum-(a===t.action?1:0))/data.length),gradient);}apply(gradient);}return {loss:loss/(epochs*data.length),samples:data.length,epochs};},
    snapshot:()=>({algorithm:'DoubleDQN',inputs,actions,hidden,parameters:size,replaySize:length,capacity,updates,conservativeWeight}),
    export(){return {schemaVersion:1,algorithm:'DoubleDQN',config:{inputs,actions,hidden,capacity,batchSize,gamma,learningRate,targetEvery,conservativeWeight},updates,randomState:rng.state,weights:Array.from(weights),target:Array.from(target),first:Array.from(first),second:Array.from(second)};},
    load(model){const expected=api.export().config;if(model?.schemaVersion!==1||model.algorithm!=='DoubleDQN'||!model.config||Object.entries(expected).some(([k,v])=>model.config[k]!==v))throw new Error('Incompatible DQN architecture/training config');
      const parsed=['weights','target','first','second'].map(k=>vector(model[k],size,k));integer(model.updates,0,1e9,'updates');integer(model.randomState,0,0xffffffff,'randomState');if(parsed[3].some(v=>v<0))throw new Error('Invalid Adam second moment');[weights,target,first,second].forEach((w,i)=>w.set(parsed[i]));updates=model.updates;rng.state=model.randomState;length=0;cursor=0;replay.fill(undefined);},
    /** Transfer shares weights only; optimizer, replay and world-specific experience reset. */
    transfer(model){if(model?.config?.inputs!==inputs||model.config.actions!==actions||model.config.hidden!==hidden||model.algorithm!=='DoubleDQN')throw new Error('Incompatible transfer feature/action schema');const w=vector(model.weights,size,'weights');weights.set(w);target.set(w);first.fill(0);second.fill(0);updates=0;length=0;cursor=0;replay.fill(undefined);}
  };return api;
}
