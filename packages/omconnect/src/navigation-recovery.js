export const NAVIGATION_FAILURE_CODES=Object.freeze(['NO_PATH','STUCK','BLOCKED','UNLOADED','SERVER_CORRECTION','INVALID_SUPPORT','INSUFFICIENT_RESOURCES','UNSAFE_ROUTE','DYNAMIC_OBSTACLE','ACTION_TIMEOUT']);
const aliases={START_UNSUPPORTED:'INVALID_SUPPORT',SUPPORT_CHANGED:'INVALID_SUPPORT',STEP_STALLED:'STUCK',OCCUPIED:'DYNAMIC_OBSTACLE',STALE_WORLD:'BLOCKED',SEARCH_BUDGET:'NO_PATH'};
/** A decision policy only: callers must verify support, resources and every executed action. */
export function createNavigationRecovery({maxAttempts=3,clock=Date.now}={}){
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>16||typeof clock!=='function')throw new Error('Navigation recovery requires 1–16 attempts.');
  const failures=new Map();let safe=null;
  return {
    confirmSafe(position){if(!position||!['x','y','z'].every(k=>Number.isFinite(position[k])))throw new Error('A confirmed safe position is required.');safe={...position};},
    decide({code,goalId='default',contextRevision=0}){
      code=aliases[code]||code;if(!NAVIGATION_FAILURE_CODES.includes(code))code='BLOCKED';
      if(typeof goalId!=='string'||goalId.length>256||!['string','number'].includes(typeof contextRevision))throw new Error('Invalid navigation recovery context.');
      const id=JSON.stringify([goalId,code,contextRevision]),attempt=(failures.get(id)||0)+1;failures.set(id,attempt);
      while(failures.size>128)failures.delete(failures.keys().next().value);
      if(attempt>maxAttempts)return {status:'blocked',code,attempt,strategy:'explain',reason:'The retry budget is exhausted for this goal and observed context.'};
      const strategy=({NO_PATH:'change-approach',STUCK:'replan',BLOCKED:'replan',UNLOADED:'await-observation',SERVER_CORRECTION:'reobserve',INVALID_SUPPORT:safe?'return-safe':'reobserve',INSUFFICIENT_RESOURCES:'request-resources',UNSAFE_ROUTE:'change-approach',DYNAMIC_OBSTACLE:'yield',ACTION_TIMEOUT:'cancel-and-reobserve'})[code];
      return {status:'retry',code,attempt,strategy,delayMs:code==='DYNAMIC_OBSTACLE'?Math.min(1000,attempt*150):0,...strategy==='return-safe'?{safePosition:{...safe}}:{},at:clock()};
    },
    reset(){failures.clear();},
    snapshot:()=>({contexts:failures.size,safePosition:safe?{...safe}:null,maxAttempts})
  };
}
