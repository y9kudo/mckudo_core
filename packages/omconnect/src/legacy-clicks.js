/** The old protocol confirms clicks with a transaction, but does not echo every slot. */
export function createLegacyClickBridge(client){
  const pending=new Map();let nextAction=0;
  const empty=()=>((client.registry.version?.version??999)<393?{blockId:-1}:{present:false});
  const current=windowId=>windowId===0?null:client.containers.current?.id===windowId?client.containers.current:null;
  const slots=windowId=>current(windowId)?.slots||client.inventory.slots;
  const copy=(entry,count,slot)=>entry&&count>0?{...entry,count,slot,raw:{...entry.raw,itemCount:count}}:null;
  const output=(item,count,slot)=>{
    const id=client.registry.itemsByName[item]?.id;
    if(!Number.isInteger(id))throw new Error(`Unknown legacy craft result ${item}.`);
    return {name:item,item:'minecraft:'+item,type:id,count,slot,raw:{present:true,itemId:id,blockId:id,itemCount:count,itemDamage:0}};
  };
  const sync=(windowId)=>{
    const window=current(windowId);
    if(window){for(let i=0;i<36;i++){const entry=window.slots[window.storageSlots+i];client.inventory.slots[9+i]=entry?{...entry,slot:9+i}:null;}client.containers.revision++;client.emit('container');}
    client.inventory.revision++;client.emit('inventory',client.inventory.snapshot());
  };
  const refreshCraftResult=(windowId)=>{
    const expected=client.legacyCraftExpectation,window=current(windowId);
    if(!expected||expected.windowId!==windowId)return;
    const grid=slots(windowId),width=window?3:2,capacity=window?9:4;
    const needed=new Map(expected.recipe.cells.map(cell=>[1+cell.y*width+cell.x,cell.item]));
    if([...needed].every(([index,item])=>grid[index]?.name===item)&&Array.from({length:capacity},(_,i)=>i+1).every(index=>!grid[index]||needed.has(index)))grid[0]=output(expected.item,expected.recipe.count,0);
    else grid[0]=null;
  };
  const accepted=({windowId,slot,mouseButton,mode,source})=>{
    const grid=slots(windowId),window=current(windowId),held=client.inventory.cursor,entry=slot>=0?(mode===1?source:grid[slot]):null;
    if(mode===0){
      if(slot===-999){client.inventory.cursor=null;sync(windowId);return;}
      if(mouseButton===0){
        if(!held){grid[slot]=null;client.inventory.cursor=copy(entry,entry?.count,-1);}
        else if(!entry){grid[slot]=copy(held,held.count,slot);client.inventory.cursor=null;}
        else if(entry.name===held.name){const limit=client.registry.itemsByName[entry.name]?.stackSize||64,amount=Math.min(limit-entry.count,held.count);grid[slot]=copy(entry,entry.count+amount,slot);client.inventory.cursor=copy(held,held.count-amount,-1);}
        else{grid[slot]=copy(held,held.count,slot);client.inventory.cursor=copy(entry,entry.count,-1);}
      }else if(mouseButton===1){
        if(!held&&entry){const amount=Math.ceil(entry.count/2);grid[slot]=copy(entry,entry.count-amount,slot);client.inventory.cursor=copy(entry,amount,-1);}
        else if(held&&(!entry||entry.name===held.name)){grid[slot]=copy(entry||held,(entry?.count||0)+1,slot);client.inventory.cursor=copy(held,held.count-1,-1);}
      }
      refreshCraftResult(windowId);
    }else if(mode===1&&slot===0&&entry&&client.legacyCraftExpectation?.windowId===windowId){
      let remaining=entry.count;
      for(let index=9;index<=44&&remaining>0;index++){
        const target=client.inventory.slots[index];if(target&&target.name!==entry.name)continue;
        const limit=client.registry.itemsByName[entry.name]?.stackSize||64,amount=Math.min(limit-(target?.count||0),remaining);
        if(amount<=0)continue;
        const next=copy(target||entry,(target?.count||0)+amount,index);client.inventory.slots[index]=next;
        if(window)window.slots[window.storageSlots+index-9]={...next,slot:window.storageSlots+index-9};
        remaining-=amount;
      }
      if(remaining)throw new Error('Legacy craft result has no inventory space.');
      const width=window?9:4;for(let index=0;index<=width;index++)grid[index]=null;
      client.inventory.cursor=null;
    }
    sync(windowId);
  };
  return {
    encode(packet){
      if(packet.windowId!==0&&!current(packet.windowId))throw new Error('Legacy click requires the currently open window.');
      if(packet.mode!==0&&!(packet.mode===1&&packet.slot===0&&client.legacyCraftExpectation?.windowId===packet.windowId))throw new Error('Experimental legacy clicks currently support ordinary clicks and confirmed craft results only.');
      if(![0,1].includes(packet.mouseButton)||!Number.isInteger(packet.slot)||packet.slot!==-999&&(packet.slot<0||packet.slot>=slots(packet.windowId).length))throw new Error('Invalid legacy inventory click.');
      if(pending.size>=64)throw new Error('Too many unconfirmed legacy inventory clicks.');
      const action=++nextAction&32767,source=packet.slot>=0?slots(packet.windowId)[packet.slot]:null;
      pending.set(action,{...packet,source:source?structuredClone(source):null});
      return {windowId:packet.windowId,slot:packet.slot,mouseButton:packet.mouseButton,action,mode:packet.mode,item:packet.mode===1||packet.mode===4?empty():source?.raw??empty()};
    },
    confirm(packet){
      const click=pending.get(packet.action);if(!click)return;
      pending.delete(packet.action);
      if(!packet.accepted||click.windowId!==packet.windowId){client.pending?.abort.abort(new Error('Legacy inventory transaction rejected by server.'));return;}
      accepted(click);
    }
  };
}
