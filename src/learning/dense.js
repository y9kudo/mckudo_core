import {integer,vector,randomSource} from './contracts.js';

export function probabilities(logits,mask){
  const valid=mask||Array(logits.length).fill(true);if(valid.length!==logits.length||!valid.some(Boolean))throw new Error('No legal action');
  const max=Math.max(...Array.from(logits,(x,i)=>valid[i]?x:-Infinity)),p=Array.from(logits,(x,i)=>valid[i]?Math.exp(x-max):0),sum=p.reduce((a,b)=>a+b,0);return p.map(x=>x/sum);
}
export function categorical(p,rng){const n=rng.next();let sum=0;for(let i=0;i<p.length;i++){sum+=p[i];if(n<sum)return i;}return p.findLastIndex(v=>v>0);}

/** Small CPU network with exact reverse-mode gradients and Adam. */
export function denseNetwork({inputs,outputs,hidden=32,seed=1}){
  integer(inputs,1,256,'inputs');integer(outputs,1,129,'outputs');integer(hidden,4,256,'hidden');const rng=randomSource(seed),bh=inputs*hidden,wo=bh+hidden,bo=wo+outputs*hidden,size=bo+outputs;
  const w=new Float32Array(size),m=new Float32Array(size),v=new Float32Array(size);let updates=0;
  for(let i=0;i<bh;i++)w[i]=(rng.next()*2-1)*Math.sqrt(3/inputs);for(let i=wo;i<bo;i++)w[i]=(rng.next()*2-1)*Math.sqrt(3/hidden);
  return {inputs,outputs,hidden,size,weights:w,
    forward(input){const x=vector(input,inputs),h=new Float32Array(hidden),out=new Float32Array(outputs);for(let j=0;j<hidden;j++){let a=w[bh+j];for(let i=0;i<inputs;i++)a+=x[i]*w[j*inputs+i];h[j]=Math.tanh(a);}for(let a=0;a<outputs;a++){let z=w[bo+a];for(let j=0;j<hidden;j++)z+=h[j]*w[wo+a*hidden+j];out[a]=z;}return {x,h,out};},
    gradient(cache,dout,gradient){const dh=new Float32Array(hidden);for(let a=0;a<outputs;a++){gradient[bo+a]+=dout[a];for(let j=0;j<hidden;j++){gradient[wo+a*hidden+j]+=dout[a]*cache.h[j];dh[j]+=dout[a]*w[wo+a*hidden+j];}}for(let j=0;j<hidden;j++){const d=dh[j]*(1-cache.h[j]**2);gradient[bh+j]+=d;for(let i=0;i<inputs;i++)gradient[j*inputs+i]+=d*cache.x[i];}},
    apply(gradient,rate){updates++;const c1=1-.9**updates,c2=1-.999**updates,norm=Math.sqrt(gradient.reduce((s,g)=>s+g*g,0)),scale=Math.min(1,10/Math.max(norm,1e-12));for(let i=0;i<size;i++){const g=gradient[i]*scale;m[i]=.9*m[i]+.1*g;v[i]=.999*v[i]+.001*g*g;w[i]-=rate*(m[i]/c1)/(Math.sqrt(v[i]/c2)+1e-8);}},
    export:()=>({inputs,outputs,hidden,updates,weights:Array.from(w),first:Array.from(m),second:Array.from(v)}),
    load(saved){if(saved?.inputs!==inputs||saved.outputs!==outputs||saved.hidden!==hidden)throw new Error('Network schema mismatch');const values=['weights','first','second'].map(k=>vector(saved[k],size,k));integer(saved.updates,0,1e9,'updates');if(values[2].some(x=>x<0))throw new Error('Invalid optimizer variance');[w,m,v].forEach((a,i)=>a.set(values[i]));updates=saved.updates;}
  };
}
