import {gunzipSync, inflateSync} from 'node:zlib';
import nbt from 'prismarine-nbt';
import {validateBlueprint,planConstruction,blockKey} from './construction.js';
import {isFullBlock} from './navigation.js';

const MAX_SOURCE=8*1024*1024,MAX_NBT=32*1024*1024,MAX_VOLUME=65536,MAX_CELLS=4096;
const int=n=>Number.isInteger(n)&&Math.abs(n)<=30000000;
const vector=(value,label)=>{if(!Array.isArray(value)||value.length!==3||!value.every(int))throw new Error(`${label}: нужны три целые координаты.`);return value;};
const block=state=>{
  if(!state||typeof state.Name!=='string'||!/^([a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(state.Name))throw new Error('Схема содержит неверный ID блока.');
  const properties=state.Properties||{};
  if(!properties||typeof properties!=='object'||Array.isArray(properties))throw new Error('Некорректные свойства блока.');
  return {block:state.Name.includes(':')?state.Name:'minecraft:'+state.Name,properties};
};
const air=id=>['minecraft:air','minecraft:cave_air','minecraft:void_air','minecraft:structure_void'].includes(id);
const dimension=(root,label)=>{
  const size=[root.Width,root.Height,root.Length];
  if(size.some(n=>!Number.isInteger(n)||n<-32768||n>32767))throw new Error(`${label}: неверные размеры.`);
  for(let i=0;i<size.length;i++)size[i]&=0xffff;
  if(size.some(n=>!n)||size.reduce((a,b)=>a*b,1)>MAX_VOLUME)throw new Error(`${label}: размер должен быть от 1 до ${MAX_VOLUME} позиций.`);
  return size;
};
const stateString=value=>{
  if(typeof value!=='string')throw new Error('Неверное имя блока в палитре.');
  const match=/^([^\[\]]+)(?:\[([^\[\]]+)\])?$/.exec(value);
  if(!match)throw new Error('Неверное состояние блока в палитре.');
  const properties={};
  if(match[2])for(const property of match[2].split(',')){
    const pair=/^([a-z0-9_]+)=([a-z0-9_]+)$/.exec(property);
    if(!pair||Object.hasOwn(properties,pair[1]))throw new Error('Неверное свойство блока в палитре.');
    properties[pair[1]]=pair[2];
  }
  return block({Name:match[1],Properties:properties});
};
const varints=(bytes,count)=>{
  if(!Array.isArray(bytes)||bytes.length>MAX_NBT)throw new Error('Sponge: нужен массив BlockData/Data.');
  const result=[];let pos=0;
  for(let i=0;i<count;i++){
    let value=0,complete=false;
    for(let shift=0;shift<35;shift+=7){
      if(pos>=bytes.length)throw new Error('Sponge: обрезанные данные блоков.');
      const part=bytes[pos++]&255;
      if(shift===28&&part>15)throw new Error('Sponge: неверный VarInt блока.');
      value+=(part&127)*2**shift;
      if(!(part&128)){complete=true;break;}
    }
    if(!complete)throw new Error('Sponge: VarInt блока длиннее 5 байт.');
    result.push(value);
  }
  if(pos!==bytes.length)throw new Error('Sponge: данные блоков длиннее объявленного объёма.');
  return result;
};
function sponge(root){
  if(![2,3].includes(root.Version))throw new Error('Поддерживаются Sponge .schem версий 2 и 3.');
  const [sx,sy,sz]=dimension(root,'Sponge'),container=root.Version===3?root.Blocks:root;
  if(!container||!container.Palette||typeof container.Palette!=='object')throw new Error('Sponge: отсутствует палитра блоков.');
  const palette=new Map();
  for(const [name,index] of Object.entries(container.Palette)){
    if(!Number.isInteger(index)||index<0||index>MAX_CELLS||palette.has(index))throw new Error('Sponge: неверный индекс палитры.');
    palette.set(index,stateString(name));
  }
  const [ox,oy,oz]=vector(root.Offset||[0,0,0],'Смещение Sponge'),offset={x:ox,y:oy,z:oz};
  const data=varints(root.Version===3?container.Data:root.BlockData,sx*sy*sz),cells=[];
  for(let i=0;i<data.length;i++){
    const state=palette.get(data[i]);if(!state)throw new Error('Sponge: индекс блока отсутствует в палитре.');
    if(!air(state.block))cells.push({x:i%sx,y:Math.floor(i/(sx*sz)),z:Math.floor(i/sx)%sz,...state});
  }
  return {format:'schem',size:{x:sx,y:sy,z:sz},offset,cells,dataVersion:root.DataVersion??null};
}

// Names that preserve the legacy ID when metadata is zero and need no explicit orientation.
const LEGACY_NAMES={1:'stone',2:'grass_block',3:'dirt',4:'cobblestone',5:'oak_planks',7:'bedrock',12:'sand',13:'gravel',14:'gold_ore',15:'iron_ore',16:'coal_ore',19:'sponge',20:'glass',21:'lapis_ore',22:'lapis_block',24:'sandstone',41:'gold_block',42:'iron_block',45:'bricks',47:'bookshelf',48:'mossy_cobblestone',49:'obsidian',56:'diamond_ore',57:'diamond_block',73:'redstone_ore',79:'ice',80:'snow_block',82:'clay',87:'netherrack',88:'soul_sand',89:'glowstone',98:'stone_bricks',103:'melon',110:'mycelium',112:'nether_bricks',121:'end_stone',129:'emerald_ore',133:'emerald_block',152:'redstone_block',155:'quartz_block',165:'slime_block',169:'sea_lantern',170:'hay_block',172:'terracotta',173:'coal_block',174:'packed_ice',201:'purpur_block',206:'end_stone_bricks',213:'magma_block',214:'nether_wart_block',215:'red_nether_bricks',216:'bone_block',251:'white_concrete',252:'white_concrete_powder'};
function legacy(root){
  if(root.Materials!=='Alpha')throw new Error('Legacy .schematic: поддерживается только формат Alpha.');
  const [sx,sy,sz]=dimension(root,'Legacy'),volume=sx*sy*sz;
  if(!Array.isArray(root.Blocks)||!Array.isArray(root.Data)||root.Blocks.length!==volume||root.Data.length!==volume)throw new Error('Legacy .schematic: неверная длина Blocks/Data.');
  if(root.AddBlocks&&(!Array.isArray(root.AddBlocks)||root.AddBlocks.length<Math.ceil(volume/2)))throw new Error('Legacy .schematic: неверная длина AddBlocks.');
  const cells=[];
  for(let i=0;i<volume;i++){
    const extra=root.AddBlocks?((root.AddBlocks[i>>1]&255)>>((i&1)*4)&15):0;
    const id=(root.Blocks[i]&255)|(extra<<8),meta=root.Data[i]&255;
    if(id===0)continue;
    // Legacy numeric IDs and metadata are not portable. Fail explicitly instead of silently placing the wrong block.
    if(meta||id>=256)throw new Error(`Legacy .schematic: блок ${id}:${meta} требует преобразования в современный формат .schem.`);
    const name=LEGACY_NAMES[id];
    if(!name)throw new Error(`Legacy .schematic: блок ${id}:${meta} требует преобразования в современный формат .schem.`);
    cells.push({x:i%sx,y:Math.floor(i/(sx*sz)),z:Math.floor(i/sx)%sz,block:'minecraft:'+name,properties:{}});
  }
  return {format:'schematic',size:{x:sx,y:sy,z:sz},cells,dataVersion:null};
}

function vanilla(root){
  const size=vector(root.size,'Размер структуры');
  if(size.some(n=>n<1)||size.reduce((a,b)=>a*b,1)>MAX_VOLUME)throw new Error(`Структура: максимум ${MAX_VOLUME} позиций.`);
  const palette=root.palette||root.palettes?.[0];
  if(!Array.isArray(palette)||!Array.isArray(root.blocks))throw new Error('Нужен vanilla Structure NBT с palette и blocks.');
  const cells=[];
  for(const entry of root.blocks){
    const [x,y,z]=vector(entry.pos,'Позиция блока');
    if(x<0||y<0||z<0||x>=size[0]||y>=size[1]||z>=size[2]||!Number.isInteger(entry.state)||!palette[entry.state])throw new Error('Блок находится вне структуры или палитры.');
    const state=block(palette[entry.state]);if(!air(state.block))cells.push({x,y,z,...state});
  }
  return {format:'nbt',size:{x:size[0],y:size[1],z:size[2]},cells,dataVersion:root.DataVersion??null};
}

function long(value){
  if(typeof value==='bigint')return BigInt.asUintN(64,value);
  if(Array.isArray(value)&&value.length===2)return BigInt.asUintN(64,(BigInt(value[0]>>>0)<<32n)|BigInt(value[1]>>>0));
  if(typeof value==='number'&&Number.isSafeInteger(value))return BigInt.asUintN(64,BigInt(value));
  throw new Error('Неверный packed long в BlockStates.');
}
function packedIndex(words,index,bits){
  const offset=index*bits,word=Math.floor(offset/64),shift=offset%64,mask=(1n<<BigInt(bits))-1n;
  if(word>=words.length)throw new Error('BlockStates короче объявленного объёма.');
  let value=words[word]>>BigInt(shift);
  if(shift+bits>64){if(word+1>=words.length)throw new Error('Обрезанный BlockStates.');value|=words[word+1]<<BigInt(64-shift);}
  return Number(value&mask);
}
function litematic(root){
  if(!root.Regions||typeof root.Regions!=='object')throw new Error('Нужен Litematica NBT с Regions.');
  const cells=[],positions=new Set();let volume=0;
  for(const region of Object.values(root.Regions)){
    const p=region.Position,s=region.Size;
    if(!p||!s||![p.x,p.y,p.z,s.x,s.y,s.z].every(int)||[s.x,s.y,s.z].some(n=>n===0))throw new Error('Регион: Position и Size должны быть целыми ненулевыми векторами.');
    const [sx,sy,sz]=[Math.abs(s.x),Math.abs(s.y),Math.abs(s.z)];volume+=sx*sy*sz;
    if(volume>MAX_VOLUME)throw new Error(`Litematic: максимум ${MAX_VOLUME} позиций.`);
    const palette=region.BlockStatePalette;if(!Array.isArray(palette)||!palette.length||!Array.isArray(region.BlockStates))throw new Error('Регион: нужны BlockStatePalette и BlockStates.');
    const words=region.BlockStates.map(long),bits=Math.max(2,Math.ceil(Math.log2(palette.length)));
    for(let y=0;y<sy;y++)for(let z=0;z<sz;z++)for(let x=0;x<sx;x++){
      const index=packedIndex(words,(y*sz+z)*sx+x,bits);
      if(!palette[index])throw new Error('Индекс палитры вне диапазона.');
      const state=block(palette[index]);
      if(air(state.block))continue;
      const cell={x:p.x+x*Math.sign(s.x),y:p.y+y*Math.sign(s.y),z:p.z+z*Math.sign(s.z),...state};
      const key=blockKey(cell);if(positions.has(key))throw new Error('Регионы перекрываются.');positions.add(key);cells.push(cell);
    }
  }
  if(!cells.length)throw new Error('В схеме нет устанавливаемых блоков.');
  const min={x:Math.min(...cells.map(c=>c.x)),y:Math.min(...cells.map(c=>c.y)),z:Math.min(...cells.map(c=>c.z))};
  for(const c of cells){c.x-=min.x;c.y-=min.y;c.z-=min.z;}
  return {format:'litematic',size:{x:Math.max(...cells.map(c=>c.x))+1,y:Math.max(...cells.map(c=>c.y))+1,z:Math.max(...cells.map(c=>c.z))+1},cells,dataVersion:root.MinecraftDataVersion??null};
}

/** Parse vanilla Structure NBT, Litematica, Sponge and a safe subset of legacy MCEdit schematics. */
export function parseSchematic(input,{filename='structure.nbt'}={}){
  const buffer=Buffer.from(input||[]);
  if(!buffer.length||buffer.length>MAX_SOURCE)throw new Error('Схема: размер 1 байт – 8 МиБ.');
  if(!/\.(?:nbt|litematic|litematica|schem|schematic)$/i.test(filename))throw new Error('Схема: расширение .nbt, .litematic, .litematica, .schem или .schematic.');
  const raw=buffer[0]===0x1f&&buffer[1]===0x8b?gunzipSync(buffer,{maxOutputLength:MAX_NBT}):buffer[0]===0x78?inflateSync(buffer,{maxOutputLength:MAX_NBT}):buffer;
  if(raw.length>MAX_NBT)throw new Error('NBT превышает 32 МиБ.');
  const root=nbt.simplify(nbt.parseUncompressed(raw));
  const ext=filename.toLowerCase().split('.').at(-1);
  const value=root.Schematic&&typeof root.Schematic==='object'?root.Schematic:root;
  const result=ext==='schem'?sponge(value):ext==='schematic'?legacy(value):root.Regions?litematic(root):vanilla(root);
  if(!result.cells.length)throw new Error('В схеме нет устанавливаемых блоков.');
  if(result.cells.length>MAX_CELLS)throw new Error(`Схема: максимум ${MAX_CELLS} устанавливаемых блоков.`);
  const unsupported=result.cells.filter(c=>Object.keys(c.properties).length).length;
  return {...result,blockCount:result.cells.length,unsupportedStates:unsupported};
}

export function schematicBlueprint(schematic,origin){
  if(!origin||!['x','y','z'].every(k=>int(origin[k])))throw new Error('Нужны целые координаты начала постройки.');
  if(schematic.unsupportedStates)throw new Error(`В схеме ${schematic.unsupportedStates} блоков со свойствами: поворот/состояние пока не поддержаны при установке.`);
  const shift=schematic.offset||{x:0,y:0,z:0};
  return validateBlueprint({schemaVersion:1,id:'imported-schematic',origin,cells:schematic.cells.map(c=>({x:origin.x+shift.x+c.x,y:origin.y+shift.y+c.y,z:origin.z+shift.z+c.z,block:c.block})),air:[],dependent:[]});
}

/** Builds from confirmed world state, one ordinary player action at a time. */
export async function buildSchematic(client,schematic,origin,{signal=AbortSignal.timeout(120000),maxActions=64}={}){
  if(!Number.isInteger(maxActions)||maxActions<1||maxActions>4096)throw new Error('maxActions: 1–4096.');
  const blueprint=schematicBlueprint(schematic,origin),getBlock=p=>client.world.blockAt(p);
  let actions=0;
  while(actions<maxActions){
    signal.throwIfAborted();
    const blocks=Object.fromEntries(blueprint.cells.map(c=>[blockKey(c),getBlock(c)?'minecraft:'+getBlock(c).name:null]));
    const inventory=client.state.gameMode==='creative'?Object.fromEntries([...new Set(blueprint.cells.map(c=>c.block))].map(id=>[id,MAX_CELLS])):client.inventory.snapshot();
    const plan=planConstruction(blueprint,{blocks,inventory});
    if(plan.status==='completed')return {status:'completed',actions,blockCount:schematic.blockCount};
    if(plan.status!=='ready')return {status:plan.status,actions,shortages:plan.shortages||{},reason:plan.reason||''};
    const available=plan.actions.find(a=>[[0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>{
      const b=getBlock({x:a.args.x+dx,y:a.args.y+dy,z:a.args.z+dz});return b?.boundingBox==='block';
    }));
    if(!available)return {status:'blocked',actions,reason:'У оставшихся блоков нет опоры. Добавь основание или начни с поверхности.'};
    if(client.state.gameMode==='creative'&&!client.inventory.count(available.args.block)){
      await client.execute({skill:'creativeTake',args:{item:available.args.block,count:64,replace:true}},{signal,priority:100});
    }
    await client.execute(available,{signal,priority:100});actions++;
  }
  return {status:'partial',actions,blockCount:schematic.blockCount};
}

/** Find a verified empty, flat footprint in already received chunks. Never clears existing builds. */
export function findSchematicSite(client,schematic,{near=client.state.position,minDistance=48,maxDistance=160}={}){
  if(!near||!Number.isInteger(minDistance)||!Number.isInteger(maxDistance)||minDistance<0||maxDistance<minDistance||maxDistance>512)throw new Error('Поиск участка: near и дистанция 0–512.');
  const get=p=>client.world.blockAt(p),base={x:Math.floor(near.x),y:Math.floor(near.y),z:Math.floor(near.z)};
  const candidates=[];
  for(let distance=minDistance;distance<=maxDistance;distance+=16)for(const [dx,dz] of [[distance,0],[0,distance],[-distance,0],[0,-distance],[distance,distance],[-distance,distance],[-distance,-distance],[distance,-distance]])candidates.push({x:base.x+dx,z:base.z+dz});
  for(const candidate of candidates){
    for(let y=base.y+2;y>=Math.max(client.world.minY+1,base.y-12);y--){
      const site={x:candidate.x,y,z:candidate.z};let clear=true;
      for(let x=0;x<schematic.size.x&&clear;x++)for(let z=0;z<schematic.size.z&&clear;z++){
        if(!isFullBlock(get({x:site.x+x,y:y-1,z:site.z+z}))){clear=false;break;}
        for(let h=0;h<schematic.size.y;h++)if(get({x:site.x+x,y:y+h,z:site.z+z})?.name!=='air'){clear=false;break;}
      }
      if(clear){const o=schematic.offset||{x:0,y:0,z:0};return {site,origin:{x:site.x-o.x,y:site.y-o.y,z:site.z-o.z}};}
    }
  }
  return null;
}

const sameState=(actual,cell)=>actual?.name===cell.block.replace(/^minecraft:/,'')&&Object.entries(cell.properties||{}).every(([key,value])=>String(actual.getProperties?.()[key])===value);
const hasSupport=(world,p)=>[[0,-1,0],[0,1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>{const block=world.blockAt({x:p.x+dx,y:p.y+dy,z:p.z+dz});return block&&block.name!=='air'&&block.boundingBox!=='empty';});
const itemProperties=item=>Object.fromEntries(item?.raw?.components?.find(c=>c.type==='block_state')?.data?.properties?.map(({property,value})=>[property,value])||[]);
const propertiesEqual=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.entries(a).every(([key,value])=>b[key]===value);

/** Creative player actions: take an item with block-state component, move, look, place, verify. No server commands. */
export async function buildSchematicPhysical(client,schematic,origin,{signal=AbortSignal.timeout(120000),maxActions=64,onProgress=()=>{},cellFilter=()=>true,strategy='layer',failureCounts=new Map()}={}){
  if(client.state.gameMode!=='creative')throw new Error('Поэтапная постановка из Creative-инвентаря требует Creative.');
  if(!origin||!['x','y','z'].every(k=>int(origin[k])))throw new Error('Нужны целые координаты начала постройки.');
  if(!Number.isInteger(maxActions)||maxActions<1||maxActions>4096)throw new Error('maxActions: 1–4096.');
  if(typeof cellFilter!=='function'||!['layer','nearest'].includes(strategy)||!(failureCounts instanceof Map))throw new Error('Неверная стратегия, фильтр или журнал ошибок строительных ячеек.');
  const offset=schematic.offset||{x:0,y:0,z:0};
  const cells=schematic.cells.filter(cellFilter).map(c=>({...c,position:{x:origin.x+offset.x+c.x,y:origin.y+offset.y+c.y,z:origin.z+offset.z+c.z}})).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);
  let actions=0;const failed=new Map();
  while(actions<maxActions){
    signal.throwIfAborted();
    const missing=cells.filter(c=>!sameState(client.world.blockAt(c.position),c));
    if(!missing.length)return {status:'completed',actions,blockCount:cells.length,remaining:0,failures:[]};
    const eligible=missing.filter(c=>!failed.has(blockKey(c.position))&&(failureCounts.get(blockKey(c.position))?.count||0)<2&&(client.world.blockAt(c.position)?.name==='air'||c.block==='minecraft:potted_pink_tulip'&&client.world.blockAt(c.position)?.name==='flower_pot')&&hasSupport(client.world,c.position));
    const bottom=eligible[0]?.y;
    const next=strategy==='nearest'?eligible.filter(c=>c.y===bottom).sort((a,b)=>Math.hypot(a.position.x-client.state.position.x,a.position.y-client.state.position.y,a.position.z-client.state.position.z)-Math.hypot(b.position.x-client.state.position.x,b.position.y-client.state.position.y,b.position.z-client.state.position.z))[0]:eligible[0];
    if(!next)return {status:'blocked',actions,blockCount:cells.length,remaining:missing.length,failures:[...new Map([...failed.values(),...[...failureCounts.values()].filter(f=>f.count>=2)].map(f=>[blockKey(f.position),f])).values()],reason:'Нет доступной опоры, безопасного подхода или некоторые состояния не удалось поставить.'};
    const id=next.block.replace(/^minecraft:/,'');
    if(!client.registry.itemsByName[id]&&id!=='potted_pink_tulip'){
      const failure={position:next.position,block:next.block,reason:'Нет предмета блока в Creative-инвентаре.'};failed.set(blockKey(next.position),failure);failureCounts.set(blockKey(next.position),{...failure,count:2});continue;
    }
    const held=client.inventory.held(),wanted=next.properties||{};
    try{
      if(id==='potted_pink_tulip'){
        if(client.world.blockAt(next.position)?.name==='air'){
          await client.execute({skill:'creativeTake',args:{item:'minecraft:flower_pot',count:1,replace:true}},{signal,priority:100});
          await client.execute({skill:'place',args:{...next.position,block:'minecraft:flower_pot',itemSlot:36+client.inventory.selected}},{signal,priority:100});
        }
        await client.execute({skill:'creativeTake',args:{item:'minecraft:pink_tulip',count:1,replace:true}},{signal,priority:100});
        await client.execute({skill:'potFlower',args:{...next.position,flower:'pink_tulip'}},{signal,priority:100});
        failureCounts.delete(blockKey(next.position));actions++;onProgress({actions,remaining:missing.length-1,position:next.position,layer:next.y});continue;
      }
      if(held?.name!==id||!propertiesEqual(itemProperties(held),wanted)){
        await client.execute({skill:'creativeTake',args:{item:next.block,count:Math.min(64,client.registry.itemsByName[id].stackSize||64),replace:true,properties:wanted}},{signal,priority:100});
      }
      await client.execute({skill:'place',args:{...next.position,block:next.block,properties:wanted,itemSlot:36+client.inventory.selected,preferFlight:true,fastPlacement:strategy==='nearest'}},{signal,priority:100});
      failureCounts.delete(blockKey(next.position));
      actions++;if(actions===1||actions%10===0)onProgress({actions,remaining:missing.length-1,position:next.position,layer:next.y});
    }catch(error){signal.throwIfAborted();const failure={position:next.position,block:next.block,reason:String(error.message)};failed.set(blockKey(next.position),failure);failureCounts.set(blockKey(next.position),{...failure,count:(failureCounts.get(blockKey(next.position))?.count||0)+1});}
  }
  const remaining=cells.filter(c=>!sameState(client.world.blockAt(c.position),c)).length;
  return {status:remaining?'partial':'completed',actions,blockCount:cells.length,remaining,failures:[...failed.values()]};
}
