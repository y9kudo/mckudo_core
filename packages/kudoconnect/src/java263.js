/** Experimental wire adapter. Callers supply separately pinned 26.3 codecs and catalogs. */
export function createJava263Profile({loadRegistry,createProtocolClient,chunkFactory,blockFactory}={}){
  if([loadRegistry,createProtocolClient,chunkFactory].some(f=>typeof f!=='function'))throw new Error('Профиль 26.3 требует загрузчик каталога, транспорт и декодер чанков.');
  return {
    version:'26.3',experimental:true,loadRegistry,createProtocolClient,worldOptions:{chunkFactory,...(blockFactory?{blockFactory}:{})},
    normalizeIncoming(name,p){
      if(['spawn_entity','entity_velocity'].includes(name)&&p.velocity)p.velocity={x:p.velocity.x*8000,y:p.velocity.y*8000,z:p.velocity.z*8000};
      if(['rel_entity_move','entity_move_look'].includes(name)&&p.delta){p.dX=p.delta.dX*4096;p.dY=p.delta.dY*4096;p.dZ=p.delta.dZ*4096;}
      if(name==='update_time'){p.age=p.gameTime;p.time=p.clockUpdates?.[0]?.totalTicks??p.gameTime;}
      if(name==='explosion'){Object.assign(p,p.center);p.playerMotionX=p.playerKnockback?.x??0;p.playerMotionY=p.playerKnockback?.y??0;p.playerMotionZ=p.playerKnockback?.z??0;}
    },
    encodePacket(name,packet,c){
      let p={...packet};
      if(['position','position_look','look','flying'].includes(name))p.flags={onGround:Boolean(packet.onGround),hasHorizontalCollision:Boolean(c.state.horizontalCollision)};
      if(name==='teleport_confirm')Object.assign(p,c.state.position,{yaw:c.state.yaw,pitch:c.state.pitch});
      if(name==='block_place')p={hand:packet.hand,sequence:packet.sequence,hitResult:{location:packet.location,direction:packet.direction,cursorX:packet.cursorX,cursorY:packet.cursorY,cursorZ:packet.cursorZ,insideBlock:Boolean(packet.insideBlock),worldBorderHit:false}};
      if(name==='window_click')p={...p,changedSlots:[],cursorItem:null}; // Server reconciliation confirms the actual cursor and slots.
      if(name==='entity_action'){
        if(['start_sneaking','stop_sneaking'].includes(packet.actionId))return {skip:true};
        if(packet.actionId==='start_fall_flying')p.actionId='start_elytra_flying';
      }
      if(name==='settings')p.particleStatus='all';
      return {name,packet:p};
    },
    install(c,transport){
      transport.on('set_player_inventory',p=>{if(c.inventory.updateSlot({windowId:-2,slot:p.slotId,item:p.contents})){c.emit('inventory',c.inventory.snapshot());}});
      transport.on('set_cursor_item',p=>{c.inventory.updateSlot({windowId:-1,slot:-1,item:p.contents});c.emit('inventory',c.inventory.snapshot());});
      transport.on('sync_entity_position',p=>{const e=c.entities.get(p.entityId),position=p.position?.path?.endPosition??p.position?.path?.steps?.at(-1)?.position;if(e&&position){e.position={...position};e.yaw=p.yaw;e.pitch=p.pitch;c.emit('entity',e);}});
    },
    readRecipes(c,p){c.recipeBook.useVersionCatalog(p.recipes?.length??0);},
    afterTick(c){
      c.write('player_input',{inputs:{forward:Math.hypot(c.control.x||0,c.control.z||0)>.01,backward:false,left:false,right:false,jump:Boolean(c.control.jump),shift:Boolean(c.control.sneak),sprint:Boolean(c.control.sprint)}});
      c.write('tick_end',{});
    }
  };
}
