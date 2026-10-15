import protocol from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import {versionSupport,NATIVE_VERSIONS} from './versions.js';
import {authenticationOptions} from './auth.js';

const profiles=new Map();
const dimensionNames={0:'minecraft:overworld','-1':'minecraft:the_nether',1:'minecraft:the_end'};
/** Protocol capabilities come from installed schemas, not an optimistic version range. */
export function createVersionAPI(version){
  const profile=profiles.get(version),base=versionSupport(version),support=profile?{...base,transport:true}:base;if(!support.transport)throw new Error(`No installed Java transport for ${version}`);
  let registry;const data=()=>{registry??=profile?profile.loadRegistry(version):minecraftData(version);if(!registry?.protocol?.play)throw new Error(`Missing Java wire schema for ${version}`);return registry;};
  const hasPacket=(name,direction='toServer')=>Boolean(data().protocol.play?.[direction]?.types?.['packet_'+name]);
  return {version,support,loadRegistry:data,hasPacket,
    capabilities(){return {transport:true,worldCatalog:Boolean(data().itemsArray&&data().blocksArray&&data().recipes),nativeActions:support.native,profile:Boolean(profile),teleportConfirmation:hasPacket('teleport_confirm'),modernInventory:hasPacket('window_click')&&data().version.version>=755,configuration:!!data().protocol.configuration,signedChat:hasPacket('chat_message'),movement:hasPacket('position_look'),blockDigging:hasPacket('block_dig')};},
    normalize(name,packet){
      const p=structuredClone(packet);
      if(name==='login'||name==='respawn'){
        const w=p.worldState||p,dimension=w.name||p.worldName||dimensionNames[String(p.dimension)]||((p.dimension?.value?.effects||{}).value);
        if(dimension)p.worldState={...w,name:dimension,gamemode:w.gamemode??p.gameMode};
      }
      if(name==='window_items')p.items=p.items.map(s=>normalizeSlot(s));
      if(name==='set_slot')p.item=normalizeSlot(p.item);
      return p;
    },
    movement(state){
      if(!state?.position||!['x','y','z'].every(k=>Number.isFinite(state.position[k]))||![state.yaw,state.pitch].every(Number.isFinite))throw new Error('Movement requires a finite position and angles');
      const fields=data().protocol.play.toServer.types.packet_position_look?.[1]||[];
      const p={...state.position,yaw:state.yaw,pitch:state.pitch,onGround:Boolean(state.onGround)};
      if(fields.some(f=>f.name==='stance')){const eyeHeight=state.eyeHeight??1.62;if(!Number.isFinite(eyeHeight)||eyeHeight<=0||eyeHeight>3)throw new Error('eyeHeight: 0..3');p.stance=state.position.y+eyeHeight;}
      if(fields.some(f=>f.name==='flags'))p.flags={onGround:Boolean(state.onGround),hasHorizontalCollision:Boolean(state.horizontalCollision)};
      return {name:'position_look',params:p};
    },
    digging({position,phase,face=1,sequence=0}){
      const phases={start:0,cancel:1,finish:2};
      if(!hasPacket('block_dig'))throw new Error(`No block digging packet for Java ${version}`);
      if(!position||!['x','y','z'].every(key=>Number.isInteger(position[key])&&Math.abs(position[key])<=30000000))throw new Error('Digging requires integer block coordinates.');
      if(!Object.hasOwn(phases,phase)||!Number.isInteger(face)||face<0||face>5||!Number.isInteger(sequence)||sequence<0||sequence>2147483647)throw new Error('Invalid digging phase, face or sequence.');
      const fields=data().protocol.play.toServer.types.packet_block_dig[1];
      const params={status:phases[phase],location:{...position},face};
      if(fields.some(field=>field.name==='sequence'))params.sequence=sequence;
      return {name:'block_dig',params};
    },
    createTransport(options={}){const factory=profile?.createProtocolClient||protocol.createClient;return factory({...options,...authenticationOptions({auth:'offline',...options}),version});}
  };
}
export function normalizeSlot(raw){
  if(!raw||raw.present===false||raw.blockId===-1||raw.itemCount===0)return null;
  if(raw.itemId!==undefined)return structuredClone(raw);
  return {...structuredClone(raw),itemId:raw.blockId??raw.itemId,itemCount:raw.itemCount??raw.count??0};
}
export function registerVersionProfile(profile){
  if(!profile||typeof profile.version!=='string'||typeof profile.loadRegistry!=='function'||typeof profile.createProtocolClient!=='function')throw new Error('Version profile needs a version, registry loader and transport factory');
  if(NATIVE_VERSIONS.includes(profile.version)||profiles.has(profile.version))throw new Error('Cannot replace an installed version profile');
  profiles.set(profile.version,Object.freeze({...profile}));return ()=>profiles.delete(profile.version);
}
export function resolveVersionProfile(version){return profiles.get(version)||null;}
/** Probe a server without authentication. Unknown versions remain explicit errors. */
export async function detectServerVersion({host='127.0.0.1',port=25565,timeoutMs=5000}={}){
  if(typeof host!=='string'||!host||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)throw new Error('Invalid server probe options');
  const result=await protocol.ping({host,port,closeTimeout:timeoutMs});
  const candidates=minecraftData.versions.pc.filter(v=>v.version===result.version.protocol),name=String(result.version.name||''),exact=candidates.find(v=>v.minecraftVersion===name);
  const version=exact?.minecraftVersion||candidates.find(v=>protocol.supportedVersions.includes(v.minecraftVersion))?.minecraftVersion;
  if(!version||!versionSupport(version).transport)throw new Error(`No installed transport for server protocol ${result.version.protocol}`);
  return {version,protocol:result.version.protocol,serverName:name,support:versionSupport(version)};
}
