const valid = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= 30000000);
const axes = ['x','y','z'], epsilon = 1e-8;

/** Exact segment/voxel-shape occlusion, bounded DDA. Unknown geometry is not visible. */
export function traceVisibility({ origin, target, getBlock, maxDistance = 32 }) {
  if (!valid(origin) || !valid(target) || typeof getBlock !== 'function' || !Number.isFinite(maxDistance) || maxDistance < 1 || maxDistance > 128) throw new Error("Visibility: origin, target, getBlock and maxDistance 1–128.");
  const delta = Object.fromEntries(axes.map(k => [k,target[k]-origin[k]])), length = Math.hypot(...axes.map(k=>delta[k]));
  if (length > maxDistance) return {visible:false,reason:'too-far',position:null};
  const cell=Object.fromEntries(axes.map(k=>[k,Math.floor(origin[k])])),end=Object.fromEntries(axes.map(k=>[k,Math.floor(target[k])]));
  const step=Object.fromEntries(axes.map(k=>[k,Math.sign(delta[k])])),tDelta=Object.fromEntries(axes.map(k=>[k,delta[k]?Math.abs(1/delta[k]):Infinity]));
  const tMax=Object.fromEntries(axes.map(k=>[k,delta[k]?((step[k]>0?cell[k]+1:cell[k])-origin[k])/delta[k]:Infinity]));
  const intersects = shape => {
    let lo=0,hi=1;
    for(let i=0;i<3;i++){
      const k=axes[i],min=cell[k]+shape[i],max=cell[k]+shape[i+3];
      if(Math.abs(delta[k])<epsilon){if(origin[k]<=min+epsilon||origin[k]>=max-epsilon)return false;continue;}
      const a=(min-origin[k])/delta[k],b=(max-origin[k])/delta[k];lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));if(hi-lo<=epsilon)return false;
    }
    return hi>epsilon && lo<1-epsilon;
  };
  const limit=axes.reduce((n,k)=>n+Math.abs(end[k]-cell[k]),1)+3;
  for(let n=0;n<limit;n++){
    const b=getBlock({...cell});
    if(!b)return {visible:false,reason:'unloaded',position:{...cell}};
    const shapes=b.shapes ?? (b.boundingBox==='block'?[[0,0,0,1,1,1]]:b.boundingBox==='empty'?[]:null);
    if(!shapes)return {visible:false,reason:'unloaded',position:{...cell}};
    if(shapes.some(intersects))return {visible:false,reason:'blocked',position:{...cell}};
    if(axes.every(k=>cell[k]===end[k]))return {visible:true,reason:'clear',position:null};
    const t=Math.min(...axes.map(k=>tMax[k]));if(t>1)return {visible:true,reason:'clear',position:null};
    for(const k of axes)if(Math.abs(tMax[k]-t)<epsilon){cell[k]+=step[k];tMax[k]+=tDelta[k];}
  }
  return {visible:false,reason:'blocked',position:{...cell}};
}
