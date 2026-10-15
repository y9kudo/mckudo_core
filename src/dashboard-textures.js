import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {inflateRawSync} from 'node:zlib';

const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
const resource=value=>String(value||'').replace(/^minecraft:/,'').replace(/^blocks\//,'block/');
const archiveLimit=128*1024*1024;
/** Selective in-memory ZIP reader. Game assets never become distributable source files. */
function entries(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>archiveLimit)throw new Error('Texture archive must be a ZIP/JAR from 22 bytes to 128 MiB.');
  let end=-1;for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){end=at;break;}
  if(end<0)throw new Error('Texture archive has no valid ZIP directory.');
  const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),offset=bytes.readUInt32LE(end+16);
  if(count===65535||count>30000||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6)||offset+size>end)throw new Error('Unsupported ZIP64, multi-volume or damaged archive.');
  const result=new Map();let cursor=offset,total=0;
  for(let index=0;index<count;index++){
    if(cursor+46>offset+size||bytes.readUInt32LE(cursor)!==0x02014b50)throw new Error('Invalid texture archive directory.');
    const nameLength=bytes.readUInt16LE(cursor+28),extra=bytes.readUInt16LE(cursor+30),comment=bytes.readUInt16LE(cursor+32),next=cursor+46+nameLength+extra+comment;
    if(next>offset+size)throw new Error('Invalid archive entry name.');
    const name=bytes.toString('utf8',cursor+46,cursor+46+nameLength);
    if(/^assets\/minecraft\/(textures\/(?:block|blocks)\/[a-z0-9_./-]+\.png|models\/(?:block|blocks)\/[a-z0-9_./-]+\.json|blockstates\/[a-z0-9_./-]+\.json)$/.test(name)&&!name.split('/').includes('..')){
      const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),packed=bytes.readUInt32LE(cursor+20),unpacked=bytes.readUInt32LE(cursor+24),local=bytes.readUInt32LE(cursor+42);
      if(flags&1||![0,8].includes(method)||unpacked>2*1024*1024||local+30>offset||bytes.readUInt32LE(local)!==0x04034b50)throw new Error('Unsupported or oversized texture entry.');
      total+=unpacked;if(total>64*1024*1024)throw new Error('Texture archive expands beyond 64 MiB.');
      const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
      if(start+packed>offset)throw new Error('Texture entry leaves the archive data area.');
      const compressed=bytes.subarray(start,start+packed),raw=method===8?inflateRawSync(compressed,{maxOutputLength:2*1024*1024}):compressed;
      if(raw.length!==unpacked||result.has(name))throw new Error('Damaged or duplicate texture entry.');
      result.set(name,raw);
    }
    cursor=next;
  }
  return result;
}
const condition=(test,props)=>!test||Object.entries(test).every(([key,value])=>key==='OR'?value.some(child=>condition(child,props)):key==='AND'?value.every(child=>condition(child,props)):String(value).split('|').includes(String(props[key])));

export function createDashboardTextures(){
  let revision=0,label='',pngs=new Map(),models=new Map(),states=new Map(),cache=new Map();
  const resolveModel=(name,depth=0)=>{
    if(depth>16)return null;
    const model=models.get(resource(name));if(!model)return null;
    const parent=model.parent?resolveModel(model.parent,depth+1):null;
    return {textures:{...parent?.textures,...model.textures},elements:model.elements??parent?.elements??[]};
  };
  const describe=(name,properties={})=>{
    name=String(name).replace(/^minecraft:/,'');const key=name+'/'+JSON.stringify(properties);
    if(cache.has(key))return cache.get(key);
    const state=states.get(name),parts=[];
    if(state?.variants){const match=Object.entries(state.variants).find(([selector])=>!selector||selector.split(',').every(pair=>{const [key,value]=pair.split('=');return String(properties[key])===value;}));if(match)parts.push(Array.isArray(match[1])?match[1][0]:match[1]);}
    if(Array.isArray(state?.multipart))for(const part of state.multipart)if(condition(part.when,properties))parts.push(Array.isArray(part.apply)?part.apply[0]:part.apply);
    if(!parts.length)parts.push({model:'block/'+name});
    const resolved=[];
    for(const part of parts.slice(0,16)){
      const model=resolveModel(part?.model);if(!model)continue;
      const texture=value=>{let current=value;for(let i=0;i<16&&current?.startsWith('#');i++)current=model.textures[current.slice(1)];const id=resource(current);return pngs.has(id)?id:null;};
      const elements=[];
      for(const element of model.elements.slice(0,64)){
        if(![element.from,element.to].every(point=>Array.isArray(point)&&point.length===3&&point.every(value=>Number.isFinite(value)&&value>=-32&&value<=48)))continue;
        const faces={};for(const [side,face]of Object.entries(element.faces||{})){if(!['east','west','up','down','north','south'].includes(side))continue;faces[side]={texture:texture(face.texture),uv:Array.isArray(face.uv)&&face.uv.length===4&&face.uv.every(Number.isFinite)?face.uv:null,rotation:face.rotation||0,tint:face.tintindex!==undefined};}
        elements.push({from:element.from,to:element.to,faces,...(element.rotation?{rotation:element.rotation}:{})});
      }
      if(elements.length)resolved.push({elements,x:Number(part.x)||0,y:Number(part.y)||0});
    }
    const fallback=['water','lava'].includes(name)?'block/'+name+'_still':'block/'+name;
    const value={models:resolved,fallback:pngs.has(fallback)?fallback:null};if(cache.size>4096)cache.clear();cache.set(key,value);return value;
  };
  return {
    import(bytes,filename='Minecraft assets'){
      const files=entries(bytes),nextPngs=new Map(),nextModels=new Map(),nextStates=new Map();
      for(const [path,raw]of files){
        if(path.endsWith('.png')){
          if(raw.length<24||!raw.subarray(0,8).equals(PNG))throw new Error('Invalid PNG texture.');
          const width=raw.readUInt32BE(16),height=raw.readUInt32BE(20);
          if(!width||!height||width>2048||height>16384)throw new Error('Texture dimensions exceed the preview budget.');
          const id=resource(path.replace('assets/minecraft/textures/','').slice(0,-4));nextPngs.set(id,{bytes:raw,width,height});
        }else{
          const data=JSON.parse(raw.toString('utf8'));
          if(path.includes('/models/'))nextModels.set(resource(path.replace('assets/minecraft/models/','').slice(0,-5)),data);
          else nextStates.set(path.replace('assets/minecraft/blockstates/','').slice(0,-5),data);
        }
      }
      if(!nextPngs.size)throw new Error('Archive contains no assets/minecraft/textures/block/*.png.');
      pngs=nextPngs;models=nextModels;states=nextStates;cache=new Map();label=String(filename).split(/[\\/]/).at(-1).slice(0,100);revision++;
      return this.snapshot();
    },
    async load(path){const info=await stat(path);if(info.size>archiveLimit)throw new Error('Minecraft asset archive exceeds 128 MiB.');return this.import(await readFile(path),path);},
    texture:id=>pngs.get(resource(id))||null,describe,
    snapshot:()=>({revision,label,textures:pngs.size,models:models.size,blockstates:states.size,localOnly:true})
  };
}
export async function findInstalledTextureArchive(version='1.21.1'){
  if(!/^[A-Za-z0-9._-]{1,64}$/.test(version)||!process.env.APPDATA)return null;
  const path=join(process.env.APPDATA,'.minecraft','versions',version,version+'.jar');
  return (await stat(path).catch(()=>null))?.isFile()?path:null;
}
