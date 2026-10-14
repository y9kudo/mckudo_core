import {integer,finite,vector,actionMask,argmax,randomSource} from './contracts.js';
import {denseNetwork,probabilities,categorical} from './dense.js';

/** On-policy categorical PPO with clipped likelihood ratios, GAE, value and entropy losses. */
export function createPPO({inputs,actions,hidden=32,capacity=8192,batchSize=32,gamma=.99,lambda=.95,clip=.2,entropy=.01,valueWeight=.5,learningRate=.001,seed=1}={}){
  integer(actions,2,128,'actions');integer(capacity,32,100000,'capacity');integer(batchSize,1,256,'batchSize');finite(gamma,0,1,'gamma');finite(lambda,0,1,'lambda');finite(clip,.01,.5,'clip');finite(entropy,0,1,'entropy');finite(valueWeight,0,10,'valueWeight');finite(learningRate,1e-6,.1,'learningRate');
  if(batchSize>capacity)throw new Error('batchSize exceeds capacity');
  const network=denseNetwork({inputs,outputs:actions+1,hidden,seed}),rng=randomSource(seed),rollout=[];let updates=0;
  const api={sample(observation,{mask,deterministic=false}={}){const allowed=actionMask(mask,actions),cache=network.forward(observation),p=probabilities(cache.out.subarray(0,actions),allowed),action=deterministic?argmax(p):categorical(p,rng);return {action,logProbability:Math.log(p[action]),value:cache.out[actions],actionMask:allowed,revision:updates};},
    act(observation,{mask}={}){return api.sample(observation,{mask,deterministic:true}).action;},
    value(observation){return network.forward(observation).out[actions];},
    remember(t){if(rollout.length>=capacity)throw new Error('PPO rollout is full; optimize before collecting more');if(typeof t?.terminated!=='boolean'||typeof t.truncated!=='boolean'||t.revision!==updates)throw new Error('PPO needs terminal/truncation and current behavior policy revision');if(String(t.envId??'0').length>128)throw new Error('envId exceeds 128 characters');const mask=actionMask(t.actionMask,actions),action=integer(t.action,0,actions-1,'action');if(!mask[action])throw new Error('Recorded action was masked');rollout.push({observation:vector(t.observation,inputs),action,mask,reward:finite(t.reward,-1e6,1e6,'reward'),value:finite(t.value,-1e6,1e6,'value'),nextValue:t.terminated?0:finite(t.nextValue,-1e6,1e6,'nextValue'),logProbability:finite(t.logProbability,-1e6,0,'logProbability'),terminated:t.terminated,truncated:t.truncated,envId:String(t.envId??'0')});},
    train({epochs=4}={}){integer(epochs,1,32,'epochs');if(rollout.length<batchSize)return {loss:null,updates:0,replaySize:rollout.length};const data=rollout.splice(0),traces=new Map();
      for(let i=data.length-1;i>=0;i--){const t=data[i],delta=t.reward+gamma*t.nextValue-t.value,following=t.terminated||t.truncated?0:traces.get(t.envId)||0;t.advantage=delta+gamma*lambda*following;t.return=t.value+t.advantage;traces.set(t.envId,t.advantage);}
      const mean=data.reduce((s,t)=>s+t.advantage,0)/data.length,std=Math.sqrt(data.reduce((s,t)=>s+(t.advantage-mean)**2,0)/data.length+1e-8);for(const t of data)t.advantage=(t.advantage-mean)/std;
      let loss=0,batches=0;for(let epoch=0;epoch<epochs;epoch++){for(let i=data.length-1;i>0;i--){const j=Math.floor(rng.next()*(i+1));[data[i],data[j]]=[data[j],data[i]];}
        for(let start=0;start<data.length;start+=batchSize){const batch=data.slice(start,start+batchSize),gradient=new Float32Array(network.size);
          for(const t of batch){const cache=network.forward(t.observation),p=probabilities(cache.out.subarray(0,actions),t.mask),logp=Math.log(Math.max(p[t.action],1e-30)),ratio=Math.exp(Math.max(-30,Math.min(30,logp-t.logProbability))),clipped=Math.max(1-clip,Math.min(1+clip,ratio)),H=-p.reduce((s,v)=>s+(v>0?v*Math.log(v):0),0),dout=new Float32Array(actions+1),active=!(t.advantage>=0&&ratio>1+clip||t.advantage<0&&ratio<1-clip),policyGradient=active?-ratio*t.advantage:0;
            for(let a=0;a<actions;a++)dout[a]=(policyGradient*((a===t.action?1:0)-p[a])+entropy*p[a]*(Math.log(Math.max(p[a],1e-30))+H))/batch.length;
            const valueError=cache.out[actions]-t.return;dout[actions]=valueWeight*valueError/batch.length;loss+=-Math.min(ratio*t.advantage,clipped*t.advantage)+valueWeight*.5*valueError**2-entropy*H;network.gradient(cache,dout,gradient);
          }network.apply(gradient,learningRate);batches++;
        }
      }updates++;return {loss:loss/(data.length*epochs),updates:batches,replaySize:0};
    },snapshot:()=>({algorithm:'PPO',inputs,actions,hidden,parameters:network.size,replaySize:rollout.length,capacity,updates}),
    export:()=>({schemaVersion:1,algorithm:'PPO',config:{inputs,actions,hidden,capacity,batchSize,gamma,lambda,clip,entropy,valueWeight,learningRate},updates,randomState:rng.state,network:network.export()}),
    load(saved){if(saved?.schemaVersion!==1||saved.algorithm!=='PPO'||Object.entries(api.export().config).some(([k,v])=>saved.config?.[k]!==v))throw new Error('PPO configuration mismatch');integer(saved.updates,0,1e9,'updates');integer(saved.randomState,0,0xffffffff,'random state');network.load(saved.network);rng.state=saved.randomState;updates=saved.updates;rollout.length=0;}
  };return api;
}
