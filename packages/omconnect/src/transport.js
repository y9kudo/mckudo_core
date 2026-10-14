const supported=name=>/^(?:[a-z_]+_)?(?:boat|raft|minecart)$/.test(name||'')&&!/chest_minecart|hopper_minecart|tnt_minecart|furnace_minecart/.test(name);
export function observeVehicle(c){
  const id=c.state.vehicleId;if(id==null)return null;
  const e=c.entities.get(id);return {entityId:String(id),name:e?.name??null,position:e?{...e.position}:null,serverConfirmed:true};
}
export function synchronizeVehicle(c){
  const id=c.state.vehicleId;if(id==null)return false;
  const e=c.entities.get(id);c.stopMovement();
  if(e){c.state.position={...e.position,y:e.position.y+(/minecart/.test(e.name)?.35:.45)};c.state.velocity={...e.velocity};c.world.focus=c.state.position;}
  return true;
}
export async function mountVehicle(c,{entityId},signal){
  if(c.state.vehicleId!=null)throw new Error("Agent is already in transport.");
  const id=Number(entityId),e=c.entities.get(id);
  if(!Number.isSafeInteger(id)||!e||!supported(e.name)||Math.hypot(e.position.x-c.state.position.x,e.position.y-c.state.position.y,e.position.z-c.state.position.z)>3)throw new Error("An observed boat or passenger minecart is required within 3 blocks.");
  c.stopMovement();c.lookAt({...e.position,y:e.position.y+.4},{signal});await c.waitForLook({signal});signal.throwIfAborted();
  c.write('use_entity',{target:id,mouse:0,hand:0,sneaking:false});
  await c.waitFor(()=>c.state.vehicleId===id,{event:'vehicle',signal,timeoutMs:4000});
  return {ok:true,vehicle:observeVehicle(c)};
}
export async function dismountVehicle(c,signal){
  if(c.state.vehicleId==null)throw new Error("Agent is not in transport.");
  c.stopMovement();c.control.sneak=true;c.syncSneak();
  try{await c.waitFor(()=>c.state.vehicleId==null,{event:'vehicle',signal,timeoutMs:4000});return {ok:true,serverConfirmed:true};}
  finally{c.stopMovement();}
}
