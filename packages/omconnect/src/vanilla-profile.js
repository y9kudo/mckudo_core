import protocol from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import { createVersionAPI } from './version-api.js';
import {createLegacyClickBridge} from './legacy-clicks.js';

const dimensions={0:'minecraft:overworld','-1':'minecraft:the_nether',1:'minecraft:the_end'};
/** A narrow opt-in bridge for validating older vanilla wire families in real worlds. */
export function createVanillaCompatibilityProfile(version){
  const api=createVersionAPI(version);
  let clickBridge=null;
  return {
    version,experimental:true,
    loadRegistry:minecraftData,
    createProtocolClient:options=>protocol.createClient(options),
    install(client,transport){
      if(!api.loadRegistry().protocol.play.toServer.types.packet_window_click[1].some(field=>field.name==='stateId'))clickBridge=createLegacyClickBridge(client);
      transport.on('transaction',packet=>{client.emit('legacyTransaction',packet);clickBridge?.confirm(packet);});
      if(!api.hasPacket('declare_recipes','toClient'))transport.on('login',()=>{
        client.recipeBook.useVersionCatalog(0);
        client.emit('recipes',client.recipeBook.snapshot());
      });
      transport.on('map_chunk_bulk',packet=>{
        if(!Buffer.isBuffer(packet.data)||!Array.isArray(packet.meta)||packet.meta.length>1024)throw new Error('Invalid legacy chunk batch.');
        const bytesPerSection=8192+2048+(packet.skyLightSent?2048:0);
        let offset=0;
        for(const meta of packet.meta){
          const sections=(meta.bitMap>>>0).toString(2).replaceAll('0','').length;
          const length=sections*bytesPerSection+256;
          if(offset+length>packet.data.length)throw new Error('Truncated legacy chunk batch.');
          client.world.load({x:meta.x,z:meta.z,groundUp:true,bitMap:meta.bitMap,skyLightSent:packet.skyLightSent,chunkData:packet.data.subarray(offset,offset+length)});
          offset+=length;
        }
        if(offset!==packet.data.length)throw new Error('Unexpected bytes in legacy chunk batch.');
        client.checkReady();
      });
    },
    normalizeIncoming(name,packet){
      if(name==='open_window'){
        const type=packet.inventoryType,protocolVersion=api.loadRegistry().version.version;
        if(typeof type==='string')packet.inventoryType={'minecraft:crafting_table':12,'minecraft:furnace':14,'minecraft:brewing_stand':11,'minecraft:chest':0}[type]??type;
        else if(protocolVersion<755)packet.inventoryType=({11:12,13:14,10:11})[type]??type;
        return;
      }
      if(name!=='login'&&name!=='respawn')return;
      const dimension=packet.worldState?.name||packet.worldName||packet.worldType||dimensions[packet.dimension];
      if(!dimension)throw new Error(`Unknown dimension in Java ${version} ${name} packet.`);
      const rawMode=packet.worldState?.gamemode??packet.gameMode;
      const gamemode=typeof rawMode==='number'?['survival','creative','adventure','spectator'][rawMode&3]:rawMode;
      packet.worldState={...packet.worldState,name:dimension,gamemode:gamemode??'survival'};
    },
    encodePacket(name,packet,client){
      if(name==='teleport_confirm'&&!api.hasPacket(name))return {skip:true};
      if(name==='chunk_batch_received'&&!api.hasPacket(name))return {skip:true};
      if(name==='position_look'){
        const outgoing=api.movement({position:packet,yaw:packet.yaw,pitch:packet.pitch,onGround:packet.onGround,eyeHeight:1.62});
        return {name:outgoing.name,packet:outgoing.params};
      }
      if(name==='block_dig'){
        const outgoing=api.digging({position:packet.location,phase:({0:'start',1:'cancel',2:'finish'})[packet.status],face:packet.face,sequence:packet.sequence??0});
        return {name:outgoing.name,packet:outgoing.params};
      }
      if(name==='window_click'&&!api.loadRegistry().protocol.play.toServer.types.packet_window_click[1].some(field=>field.name==='stateId')){
        return {name,packet:clickBridge.encode(packet)};
      }
      if(name==='arm_animation'){
        const fields=api.loadRegistry().protocol.play.toServer.types.packet_arm_animation?.[1]||[];
        if(fields.some(field=>field.name==='entityId'))return {name,packet:{entityId:client.state.entityId,animation:1}};
        if(!fields.length)return {name,packet:{}};
      }
      return null;
    },
    readRecipes(client,packet){
      if(Array.isArray(packet.recipes))client.recipeBook.ingest(packet);
    }
  };
}
