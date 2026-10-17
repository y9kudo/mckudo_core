import {isStorageBlock,storageIdentity} from './containers.js';
const EMPTY={itemCount:0};
const id=n=>{if(typeof n!=='string'||!/^(minecraft:)?[a-z0-9_]+$/.test(n))throw new Error("Storage: requires ID item.");return n.replace(/^minecraft:/,'');};
const same=(a,b)=>a&&b&&a.name===b.name&&JSON.stringify(a.raw.components||[])===JSON.stringify(b.raw.components||[])&&JSON.stringify(a.raw.removeComponents||[])===JSON.stringify(b.raw.removeComponents||[]);
const total=(slots,item)=>slots.filter(s=>same(s,item)).reduce((n,s)=>n+s.count,0);
async function click(c,w,slot,button,mode,signal,predicate){
  signal?.throwIfAborted();if(c.containers.current!==w)throw new Error("Storage closed or replaced by server.");
  const rev=c.containers.revision;
  c.write('window_click',{windowId:w.id,stateId:-1,slot,mouseButton:button,mode,changedSlots:[],cursorItem:c.inventory.cursor?.raw||EMPTY});
  await c.waitFor(()=>c.containers.current===w&&c.containers.revision>rev&&predicate(),{signal,event:'container',timeoutMs:3500});
}
/** Every session closes, including cancellation; no optimistic slot mutations. */
export async function withStorage(c,args,signal,{approach},operation){
  const p=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(args[k])]));
  if(!Object.values(p).every(n=>Number.isFinite(n)&&Math.abs(n)<=30000000))throw new Error("Storage: x/y/z storage.");
  if(c.containers.current||c.inventory.cursor)throw new Error("Close the window and clear the cursor first.");
  await approach(c,p,signal);
  if(!isStorageBlock(c.world.blockAt(p)?.name))throw new Error("No observed storage.");
  const identity=storageIdentity(c.world,p);
  c.lookAt({x:p.x+.5,y:p.y+.5,z:p.z+.5});await c.waitForLook?.({signal});c.containerRequest=true;
  try{
    c.write('block_place',{hand:0,location:p,direction:1,cursorX:.5,cursorY:.5,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
    await c.waitFor(()=>Boolean(c.containers.current?.ready),{signal,event:'container',timeoutMs:4000});const w=c.containers.current;
    if(w.kind!=='storage')throw new Error("The server opened the menu instead of the vault.");
    return await operation(w,p,identity);
  }finally{
    const w=c.containers.current;
    try{if(w){if(w.ready)c.containers.remember(c.state.dimension,p,identity);if(c.client?.state==='play')c.write('close_window',{windowId:w.id});}}
    finally{if(w)c.containers.close(w.id);c.containerRequest=false;}
    if(c.inventory.cursor&&c.client?.state==='play')c.write('window_click',{windowId:0,stateId:-1,slot:-999,mouseButton:0,mode:0,changedSlots:[],cursorItem:EMPTY});
  }
}
export const inspectStorage=(c,args,signal,runtime)=>withStorage(c,args,signal,runtime,async(w,p,identity)=>({ok:true,serverConfirmed:true,position:p,identity,slots:w.storageSlots,contents:c.containers.contents()}));
/** Exact quantities, component-aware capacity, confirmation on BOTH sides. */
export async function transferStorage(c,args,signal,runtime,direction){
  const maxStacks=args.maxStacks??54;
  if(!['take','deposit'].includes(direction)||!Number.isInteger(maxStacks)||maxStacks<1||maxStacks>54)throw new Error('Storage: direction take/deposit; maxStacks 1–54.');
  if(args.items!==undefined&&(!Array.isArray(args.items)||!args.items.length||args.items.length>128))throw new Error('Storage items: 1–128 ID.');
  const allowed=args.items?.map(id),amounts=new Map(),allocation=args.allocation;
  const policy=allocation===undefined?null:c.storagePolicy;
  if(allocation!==undefined&&(direction!=='take'||typeof allocation!=='string'||!/^[a-z0-9-]{1,64}$/.test(allocation)||args.all===true||policy?.id!==allocation||typeof policy.allocate!=='function'))throw new Error('Storage allocation requires an installed matching withdrawal policy.');
  if(args.amounts!==undefined){
    if(!args.amounts||Array.isArray(args.amounts)||typeof args.amounts!=='object'||Object.keys(args.amounts).length>128)throw new Error("Storage amounts: object ID:Number.");
    for(const [key,n] of Object.entries(args.amounts)){if(!Number.isInteger(n)||n<1||n>4096)throw new Error('Storage amounts: 1–4096.');amounts.set(id(key),n);}
  }
  if(!policy&&!allowed&&!amounts.size&&args.all!==true)throw new Error("Specify items, amounts or, clearly, all:true.");
  return withStorage(c,args,signal,runtime,async(w,position,identity)=>{
    if(policy){
      if(c.storagePolicy!==policy)throw new Error('Storage allocation policy changed before dispatch.');
      const caps=new Map(amounts);
      const contents=c.containers.contents().filter(s=>(!allowed||allowed.includes(s.name))&&(args.amounts===undefined||caps.has(s.name))).map(s=>({item:s.item,name:s.name,count:s.count}));
      const planned=policy.allocate({dimension:c.state.dimension,position:{...position},identity:structuredClone(identity),contents,serverConfirmed:true});
      if(!planned||typeof planned!=='object'||Array.isArray(planned)||typeof planned.then==='function'||Object.keys(planned).length>128)throw new Error('Storage allocation must synchronously return at most 128 quantities.');
      amounts.clear();
      for(const [key,n]of Object.entries(planned)){
        const name=id(key);if(!Number.isInteger(n)||n<1||n>4096||amounts.has(name))throw new Error('Invalid storage allocation quantity or duplicate aliases.');
        const amount=args.amounts===undefined?n:Math.min(n,caps.get(name)||0);if(amount)amounts.set(name,amount);
      }
      signal.throwIfAborted();
    }
    const quantified=policy!==null||args.amounts!==undefined;
    const sourceSlots=()=>direction==='take'?w.slots.slice(0,w.storageSlots):w.slots.slice(w.storageSlots);
    const targetSlots=()=>direction==='take'?w.slots.slice(w.storageSlots):w.slots.slice(0,w.storageSlots);
    const capacity=item=>targetSlots().reduce((n,s)=>n+(!s?(c.registry.itemsByName[item.name]?.stackSize||64):same(s,item)?Math.max(0,(c.registry.itemsByName[item.name]?.stackSize||64)-s.count):0),0);
    const transferred=[];let reason=policy&&!amounts.size?'allocation-satisfied':'empty-or-filtered';
    for(let i=0;i<maxStacks;i++){
      signal.throwIfAborted();
      const permitted=s=>s&&(!allowed||allowed.includes(s.name))&&(!quantified||amounts.has(s.name)&&amounts.get(s.name)>0);
      const source=sourceSlots().find(s=>permitted(s)&&capacity(s)>0);
      if(!source){if(sourceSlots().some(permitted))reason='destination-full';break;}
      const amount=Math.min(source.count,amounts.get(source.name)??source.count,capacity(source)),before=total(targetSlots(),source),beforeSource=total(sourceSlots(),source);
      if(amount===source.count){
        await click(c,w,source.slot,0,1,signal,()=>beforeSource-total(sourceSlots(),source)===amount&&total(targetSlots(),source)-before===amount&&!c.inventory.cursor);
      }else{
        await click(c,w,source.slot,0,0,signal,()=>same(c.inventory.cursor,source)&&c.inventory.cursor.count===source.count&&!w.slots[source.slot]);
        try{
          for(let n=0;n<amount;n++){
            const target=targetSlots().find(s=>same(s,source)&&s.count<(c.registry.itemsByName[source.name]?.stackSize||64)),empty=targetSlots().findIndex(s=>!s);
            if(!target&&empty<0)throw new Error("Target slot changed.");
            const slot=target?.slot??(direction==='take'?w.storageSlots:0)+empty,beforeCount=w.slots[slot]?.count||0,left=source.count-n-1;
            await click(c,w,slot,1,0,signal,()=>w.slots[slot]?.count===beforeCount+1&&(c.inventory.cursor?.count||0)===left);
          }
        }finally{
          if(c.inventory.cursor&&c.containers.current===w&&c.client?.state==='play')await click(c,w,source.slot,0,0,AbortSignal.timeout(3500),()=>!c.inventory.cursor);
        }
        if(beforeSource-total(sourceSlots(),source)!==amount||total(targetSlots(),source)-before!==amount)throw new Error("The server did not confirm the exact number of transfers.");
      }
      transferred.push({item:source.item,count:amount});if(amounts.has(source.name))amounts.set(source.name,amounts.get(source.name)-amount);reason='stack-budget';
    }
    return {ok:true,serverConfirmed:true,direction,position,identity,transferred,reason,...(policy?{allocation}:{}),contents:c.containers.contents()};
  });
}
