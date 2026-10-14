import nbt from 'prismarine-nbt';

/** Text is data. Never evaluate commands, URLs or code from a server menu. */
export function menuText(input) {
  let value=input;try{if(input?.type)value=nbt.simplify(input);}catch{return '';}
  let budget=256;
  const read=(v,depth=0)=>{
    if(--budget<0||depth>12||v==null)return '';
    if(typeof v==='string'){try{if(/^[\[{]/.test(v))return read(JSON.parse(v),depth+1);}catch{}return v;}
    if(Array.isArray(v))return v.slice(0,64).map(x=>read(x,depth+1)).join('');
    if(typeof v==='object')return read(v.text??v.translate??'',depth+1)+read(v.with??[],depth+1)+read(v.extra??[],depth+1);
    return '';
  };
  return read(value).replace(/§[0-9a-fk-or]/gi,'').slice(0,4096);
}

export function observeMenu(containers) {
  const w=containers.current;if(!w)return null;
  return {windowId:w.id,type:w.type,kind:w.kind,title:menuText(w.title),revision:containers.revision,stateId:w.stateId,ready:w.ready,slots:w.ready?w.slots.slice(0,w.storageSlots).map((item,slot)=>{
    if(!item)return {slot,item:null,count:0,name:'',lore:[]};
    const components=item.raw.components||[],find=t=>components.find(c=>c.type===t)?.data;
    return {slot,item:item.item,count:item.count,name:menuText(find('custom_name')??find('item_name'))||item.name,lore:(find('lore')||[]).slice(0,64).map(menuText)};
  }):[]};
}

export function findMenuSlot(menu,{item,name,contains,slot}={}){
  if(!menu?.ready)throw new Error("The menu has not yet been received.");
  if(item===undefined&&name===undefined&&contains===undefined&&slot===undefined)throw new Error("Specify item/name/contains/slot.");
  if(contains!==undefined&&(typeof contains!=='string'||!contains))throw new Error("contains: text.");
  const found=menu.slots.filter(s=>s.item&&(item===undefined||s.item===(item.includes(':')?item:'minecraft:'+item))&&(name===undefined||s.name===name)&&(contains===undefined||(s.name+' '+s.lore.join(' ')).toLocaleLowerCase().includes(contains.toLocaleLowerCase()))&&(slot===undefined||s.slot===slot));
  if(found.length!==1)throw new Error(`The menu selection is not uniform: found ${found.length} Slots.`);
  return {...found[0],windowId:menu.windowId,revision:menu.revision};
}

export async function clickMenu(c,{windowId,revision,slot,button=0},signal){
  const w=c.containers.current;
  if(!w?.ready||w.id!==windowId||c.containers.revision!==revision)throw new Error("The menu changed: Read it again.");
  if(!Number.isInteger(slot)||slot<0||slot>=w.storageSlots||![0,1].includes(button))throw new Error("menuClick: wrong slot or button.");
  if(c.inventory.cursor)throw new Error("menuClick: First, release the router.");
  signal.throwIfAborted();const before=JSON.stringify(observeMenu(c.containers)?.slots);
  c.write('window_click',{windowId:w.id,stateId:-1,slot,mouseButton:button,mode:0,changedSlots:[],cursorItem:{itemCount:0}});
  await c.waitFor(()=>c.containers.current!==w||c.containers.revision>revision,{event:'container',signal,timeoutMs:4000});
  return {ok:true,responseObserved:true,menuChanged:c.containers.current!==w||JSON.stringify(observeMenu(c.containers)?.slots)!==before,menu:observeMenu(c.containers)};
}
