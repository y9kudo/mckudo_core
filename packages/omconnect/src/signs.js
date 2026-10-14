import nbt from 'prismarine-nbt';
import {menuText} from './menus.js';
import {assertEdit,rememberPlacement} from './protection.js';

export const isSign = b => /_(?:wall_)?sign$/.test(b?.name || '');
export function readSign(world, position) {
  if (!isSign(world.blockAt(position))) return null;
  const entry=world.blockEntities.get(`${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`);
  if (!entry?.nbt) return null;
  let value;try{value=nbt.simplify(entry.nbt);}catch{return null;}
  const lines=side=>(value[side]?.messages || []).slice(0,4).map(s=>{try{return menuText(JSON.parse(s));}catch{return menuText(s);}});
  return {position:{...entry.position},front:lines('front_text'),back:lines('back_text'),waxed:Boolean(value.is_waxed),revision:entry.revision};
}
export function findSigns(world,{text,radius=96,position=world.focus}={}) {
  if(!position || !Number.isFinite(radius)||radius<1||radius>512||text!==undefined&&typeof text!=='string')throw new Error('findSigns: position, radius 1–512, text string.');
  return [...world.blockEntities.values()].map(e=>readSign(world,e.position)).filter(Boolean)
    .filter(s=>Math.hypot(s.position.x-position.x,s.position.y-(position.y??s.position.y),s.position.z-position.z)<=radius)
    .filter(s=>text===undefined||[...s.front,...s.back].join('\n').toLowerCase().includes(text.toLowerCase()));
}

/** Place or edit a storage label, then verify the text in server block-entity data. */
export async function labelStorage(c,args,signal,{approach,select}) {
  const position=Object.fromEntries(['x','y','z'].map(k=>[k,Math.floor(args[k])]));
  if(!Object.values(position).every(Number.isFinite))throw new Error("labelStorage: x/y/z storage.");
  const lines=Array.isArray(args.lines)?args.lines:typeof args.text==='string'?args.text.split('\n'):null;
  if(!lines||lines.length<1||lines.length>4||lines.some(s=>typeof s!=='string'||s.length>45||/[\r\n\u0000-\u001f]/.test(s)))throw new Error("Sign: 1–4 Line, to 45 character in row.");
  const wanted=Array.from({length:4},(_,i)=>lines[i]||'');
  const storage=c.world.blockAt(position);
  if(!/^(chest|trapped_chest|barrel|(?:[a-z_]+_)?shulker_box)$/.test(storage?.name||''))throw new Error("labelStorage: The vault is not observed.");
  const facing=storage.getProperties?.().facing;
  const faces=[{dx:0,dz:-1,face:2,name:'north'},{dx:0,dz:1,face:3,name:'south'},{dx:-1,dz:0,face:4,name:'west'},{dx:1,dz:0,face:5,name:'east'}].sort((a,b)=>Number(b.name===facing)-Number(a.name===facing));
  faces.push({dx:0,dz:0,dy:1,face:1,name:'up'});
  const matching=p=>JSON.stringify(readSign(c.world,p)?.front)===JSON.stringify(wanted);
  for(const f of faces){const p={x:position.x+f.dx,y:position.y+(f.dy||0),z:position.z+f.dz};if(matching(p))return {ok:true,serverConfirmed:true,position:p,lines:wanted,alreadyLabelled:true};}
  if(args.replace!==true&&faces.some(f=>{const p={x:position.x+f.dx,y:position.y+(f.dy||0),z:position.z+f.dz};const s=readSign(c.world,p);return s?.front.some(Boolean)||s?.back.some(Boolean);}))throw new Error("The Warehouse is already signed; - Tell me replace:true for replacement.");
  // Only a wall sign actually attached to this storage can be reused.
  const candidates=faces.map(f=>({...f,p:{x:position.x+f.dx,y:position.y+(f.dy||0),z:position.z+f.dz}}));
  const existing=candidates.find(f=>f.dy?isSign(c.world.blockAt(f.p))&&!c.world.blockAt(f.p).name.includes('wall'):c.world.blockAt(f.p)?.name?.endsWith('_wall_sign')&&c.world.blockAt(f.p)?.getProperties?.().facing===f.name);
  const chosen=existing||candidates.find(f=>c.world.blockAt(f.p)?.name==='air');
  if(!chosen)throw new Error("No free side edge for the plate.");
  const p=chosen.p,old=readSign(c.world,p);
  if(existing&&(!old||old.waxed||old.front.some(Boolean)&&args.replace!==true))throw new Error("Existing plate occupied, unknown or covered in wax.");
  assertEdit(c,'place',p);await approach(c,p,signal);c.signEditor=null;
  try {
    if(!existing){
      const item=c.inventory.items().find(i=>/^(?:[a-z_]+)_sign$/.test(i.name)&&!i.name.includes('hanging')&&i.slot<=44);
      if(!item)throw new Error("I need a regular wooden sign in the inventory.");
      await select(c,item,signal);c.stopMovement({sneak:true});
      c.lookAt({x:position.x+.5+chosen.dx*.5,y:position.y+.5+(chosen.dy||0)*.5,z:position.z+.5+chosen.dz*.5});await c.waitForLook?.({signal});
      assertEdit(c,'place',p);
      if(c.world.blockAt(p)?.name!=='air')throw new Error("The place of the plate changed.");
      c.write('block_place',{hand:0,location:position,direction:chosen.face,cursorX:.5+chosen.dx*.5,cursorY:.5+(chosen.dy||0)*.5,cursorZ:.5+chosen.dz*.5,insideBlock:false,sequence:++c.sequence});
    }else{
      // Empty hand avoids dye, wax, glow ink and other item interactions.
      const empty=c.inventory.slots.findIndex((s,i)=>i>=36&&i<=44&&!s);
      if(empty<0)throw new Error("You need an empty panel slot to edit the plate.");
      c.inventory.selected=empty-36;c.write('held_item_slot',{slotId:empty-36});c.stopMovement();
      c.lookAt({x:p.x+.5,y:p.y+.5,z:p.z+.5});await c.waitForLook?.({signal});
      c.write('block_place',{hand:0,location:p,direction:chosen.face,cursorX:.5,cursorY:.5,cursorZ:.5,insideBlock:false,sequence:++c.sequence});
    }
    await c.waitFor(()=>c.signEditor&&['x','y','z'].every(k=>c.signEditor.location[k]===p[k])&&c.signEditor.isFrontText,{signal,event:'signEditor',timeoutMs:4000});
    c.write('update_sign',{location:p,isFrontText:true,...Object.fromEntries(wanted.map((s,i)=>['text'+(i+1),s]))});
    await c.waitFor(()=>matching(p),{signal,event:'blockEntity',timeoutMs:4000});
    if(!existing)rememberPlacement(c,p);
    return {ok:true,serverConfirmed:true,position:p,lines:wanted};
  }finally{c.signEditor=null;c.stopMovement();}
}
