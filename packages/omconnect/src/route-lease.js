const leases=new WeakMap();let serial=0;
const same=(a,b)=>a&&b&&['x','y','z'].every(k=>a[k]===b[k]);
const identity=(c,start,args)=>({start:{...start},goal:{x:Math.floor(args.x),y:Math.floor(args.y),z:Math.floor(args.z)},range:args.range??1,bridge:args.bridge!==false,excavate:args.excavate===true,maxDrop:args.maxDrop??null,health:c.state.health,fallReserve:c.options?.fallHealthReserve,maxDamage:c.options?.maxFallDamage,dimension:c.state.dimension,inventory:c.inventory.revision,protection:c.protection?.revision,policy:c.navigationPolicy,corrections:c.metrics.corrections});

/** Internal, one-use handoff from a core planner to its own client. No serialized routes are trusted. */
export function leaseNavigationRoute(c,route,start,args,isCurrent) {
  if(route.status!=='planned'||!Array.isArray(route.steps)||route.steps.length>4096||typeof isCurrent!=='function'||!isCurrent())return null;
  let cache=leases.get(c);if(!cache){cache=new Map();leases.set(c,cache);}
  const now=performance.now();for(const [id,r] of cache)if(r.until<=now)cache.delete(id);
  while(cache.size>=4)cache.delete(cache.keys().next().value);
  const id=`route-${++serial}`;
  cache.set(id,{...identity(c,start,args),route:structuredClone(route),isCurrent,until:now+2000});return id;
}

export function consumeNavigationRoute(c,start,args) {
  const cache=leases.get(c),lease=cache?.get(args.routeLease);if(!lease)return null;
  cache.delete(args.routeLease);
  const actual=identity(c,start,args);
  if(performance.now()>=lease.until||!lease.isCurrent()||!same(lease.start,actual.start)||!same(lease.goal,actual.goal)||['range','bridge','excavate','maxDrop','health','fallReserve','maxDamage','dimension','inventory','protection','policy','corrections'].some(k=>lease[k]!==actual[k]))return null;
  return lease.route;
}
