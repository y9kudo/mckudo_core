import { EventEmitter } from 'node:events';
import protocol from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import { performance } from 'node:perf_hooks';
import { OMWorld } from './world.js';
import { OMInventory, readSlot } from './inventory.js';
import { stepPhysics } from './physics.js';
import { runAction, OM_SKILLS } from './actions.js';
import { observeAgent } from './observation.js';
import { OMPlayers, OMAttention } from './players.js';
import { OMContainers, findStorages } from './containers.js';
import { SmoothLook, waitForLook } from './movement.js';
import { recipeProtocol } from './protocol-compat.js';
import { installEndEvidence } from './end-evidence.js';
import {WorldRecipeBook} from './recipes.js';
import {NATIVE_VERSIONS} from './versions.js';
import {resolveVersionProfile} from './version-api.js';
import { TickTiming, createTickLoop } from './timing.js';
import { navigationScheduler } from './scheduler.js';
import { OMProtection } from './protection.js';
import { authenticationOptions, authenticatedProfile } from './auth.js';
import { observeMenu } from './menus.js';
import { OMVectorize } from './vectorize.js';
import { synchronizeVehicle, observeVehicle } from './transport.js';
import {findSigns,readSign} from './signs.js';
import {safeEndermanAngles,safeLookTarget} from './enderman-gaze.js';
import {decideFallRescue} from './fall-safety.js';
import {OMHumanize} from './humanize.js';

export const OMCONNECT = Object.freeze({ name: 'OMConnect', version: '1.0.0-Arthas-dev.2', versionName: 'Version Arthas', displayVersion: 'v1.0.0Arthas-dev.2', author: 'y9kudo', apiVersion: 1, minecraftVersions: NATIVE_VERSIONS, authentication: ['offline', 'microsoft'] });
export class OMConnect extends EventEmitter {
  constructor(options = {}, { createProtocolClient, physics = stepPhysics, versionProfile = null,navigationBackend=null } = {}) {
    super();
    if (createProtocolClient!==undefined&&typeof createProtocolClient !== 'function' || typeof physics !== 'function') throw new Error("Components: createProtocolClient and physics must be functions.");
    this.createProtocolClient = createProtocolClient; this.physics = physics; this.skills = new Map(); this.trace = [];
    this.options = { host: '127.0.0.1', port: 25565, username: 'Alice', version: '1.21.1', auth: 'offline', viewDistance: 24, connectTimeoutMs: 20000, fallSafety:true, humanizeMode:false, ...options };
    versionProfile??=resolveVersionProfile(this.options.version);
    this.fallSafety={highestY:null,active:null,cooldownUntil:0};
    this.protection = new OMProtection(this.options.protection);
    const o = this.options;
    if(typeof o.fallSafety!=='boolean')throw new Error('fallSafety: boolean.');
    if(typeof o.humanizeMode!=='boolean')throw new Error('humanizeMode: boolean.');
    if (o.maxDrop !== undefined && (!Number.isInteger(o.maxDrop) || o.maxDrop < 1 || o.maxDrop > 32)) throw new Error('maxDrop: 1–32.');
    for (const key of ['fallHealthReserve', 'maxFallDamage']) if (o[key] !== undefined && (!Number.isFinite(o[key]) || o[key] < 0 || o[key] > 20)) throw new Error(`${key}: 0–20.`);
    if(versionProfile&&(versionProfile.version!==o.version||typeof versionProfile.loadRegistry!=='function'||typeof versionProfile.createProtocolClient!=='function'))throw new Error("The protocol profile must match version and provide loadRegistry/createProtocolClient.");
    if (!NATIVE_VERSIONS.includes(o.version)&&!versionProfile) throw new Error(`OMConnect: no action profile for Java ${o.version}. Native profiles: ${NATIVE_VERSIONS.join(', ')}. Call versionSupport(); transport availability does not imply native gameplay support.`);
    this.versionProfile=versionProfile;
    this.createProtocolClient=createProtocolClient||versionProfile?.createProtocolClient||(options=>protocol.createClient(options));
    authenticationOptions(o);
    this.authentication = { mode: o.auth, status: o.auth === 'microsoft' ? 'pending' : 'offline', profile: null };
    if (typeof o.host !== 'string' || !o.host || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535 || !Number.isInteger(o.viewDistance) || o.viewDistance < 2 || o.viewDistance > 32 || !Number.isInteger(o.connectTimeoutMs) || o.connectTimeoutMs < 1000 || o.connectTimeoutMs > 60000) throw new Error("OMConnect: Uncorrect connectivity parameters.");
    // No world catalog or recipe index for disconnected, unused clients.
    this.dataLoaded=false;
    const initialize=()=>{if(this.dataLoaded)return;const registry=(versionProfile?.loadRegistry||minecraftData)(o.version);if(!registry?.protocol||!registry.itemsArray||!registry.blocksArray)throw new Error(`No complete data for Java ${o.version}.`);const inventory=new OMInventory(registry);this._data={registry,inventory,world:new OMWorld(registry,{maxChunks:o.viewDistance>16?2048:1024,...versionProfile?.worldOptions}),recipeBook:new WorldRecipeBook(registry),containers:new OMContainers(inventory,registry)};this.dataLoaded=true;};
    for(const key of ['registry','world','inventory','recipeBook','containers'])Object.defineProperty(this,key,{get:()=>{initialize();return this._data[key];},set:value=>{initialize();this._data[key]=value;},configurable:true});
    this.containerRequest=false;this.flightRockets=new Set();this.flightEvidence={takeoffs:0,rockets:0};
    this.vectorize = new OMVectorize({getBlock:p=>this.world.blockAt(p),getRevision:()=>this.world.revision,groundBackend:navigationBackend});
    this.entities = new Map(); this.state = { status: 'disconnected', entityId: null, position: null, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, onGround: false, health: null, food: null, dimension: null, gameMode: null, allowFlying:false, creativeFlying:false, flyingSpeed:.05 };
    this.time={timeOfDay:null,isDay:null,age:null};this.selfMetadata={};this.endgame={eyes:[]};this.dimensionRequested=null;
    installEndEvidence(this);
    this.players = new OMPlayers(this); this.attention = new OMAttention(this); this.humanize=new OMHumanize(this); this.managedNames = new Set();
    this.control = { x: 0, z: 0, jump: false, sprint: false }; this.look = new SmoothLook(); this.sprintSent = false; this.sequence = 0; this.pending = null; this.connectionAbort = new AbortController(); this.attackers = new Map();
    this.metrics = { packetsSent: 0, corrections: 0, actions: 0, failures: 0, maxTickMs: 0, decoderWarnings: [], reactions: [] };
    this.tickTiming = new TickTiming();
    this.client = null; this.timer = null; this.lastTick = 0; this.connectedOnce = false; this.guarding = false;
  }
  async connect() {
    if (this.connectedOnce) throw new Error("Create a new instance OMConnect for next connection.");
    this.connectedOnce = true; this.state.status = 'connecting';
    void this.registry;
    const protocolOptions = authenticationOptions(this.options, { isClosed: () => this.connectionAbort.signal.aborted, onCode: code => { this.authentication.status = 'device-code'; this.emit('authCode', code); } });
    Object.assign(protocolOptions, { clientSettings: { locale: 'en_us', viewDistance: this.options.viewDistance, chatFlags: 0, chatColors: true, skinParts: 127, mainHand: 1 }, hideErrors: true });
    let c;
    try { c = this.client = this.createProtocolClient(protocolOptions); }
    catch (error) { this.state.status = 'disconnected'; this.connectionAbort.abort(error); throw error; }
    this.versionProfile?.install?.(this,c);
    if(this.versionProfile?.normalizeIncoming)c.prependListener('packet',(packet,meta)=>this.versionProfile.normalizeIncoming(meta.name,packet,this));
    if (this.options.auth === 'microsoft') {
      // Auth may complete after close()/timeout. Prevent a delayed TCP connection.
      const connect = protocolOptions.connect;
      if (connect) protocolOptions.connect = client => { if (!this.connectionAbort.signal.aborted) connect(client); };
      const setSocket = c.setSocket?.bind(c);
      if (setSocket) c.setSocket = socket => { if (this.connectionAbort.signal.aborted) socket.destroy(); else setSocket(socket); };
      c.on('session', session => {
        if (this.connectionAbort.signal.aborted) return;
        try { this.authentication = { mode: 'microsoft', status: 'authenticated', profile: authenticatedProfile(session) }; this.emit('authenticated', { ...this.authentication.profile }); }
        catch (error) { this.connectionAbort.abort(error); }
      });
    }
    const warn = error => { this.metrics.decoderWarnings.push({ message: String(error.message).slice(0, 200), at: Date.now() }); this.metrics.decoderWarnings = this.metrics.decoderWarnings.slice(-20); this.emit('warning', error); };
    c.on('state', () => {
      const parser = c.deserializer; if (!parser || parser.kudoObserved) return;
      parser.kudoObserved = true; const parse = parser.parsePacketBuffer.bind(parser);
      parser.parsePacketBuffer = buffer => {
        let id = 0, shift = 0;
          for (let i = 0; i < Math.min(buffer.length, 5); i++) { id |= (buffer[i] & 127) << shift; if (!(buffer[i] & 128)) break; shift += 7; }
          const mappings = this.registry.protocol[c.state]?.toClient?.types?.packet?.[1]?.[0]?.type?.[1]?.mappings || {};
          const packetName = mappings['0x' + id.toString(16).padStart(2, '0')] || String(id);
        try { return c.state === 'play' && packetName === 'declare_recipes'&&!this.versionProfile ? recipeProtocol(this.registry).parser.parsePacketBuffer(buffer) : parse(buffer); }
        catch (error) {
          this.emit('decodeFailure',{state:c.state,packetName,message:String(error.message),stack:String(error.stack),bytes:Buffer.from(buffer.subarray(0,262144))});
          warn(new Error(`Packet ${c.state}/${packetName}: ${error.message}`));
          // A dropped recipe-list packet does not change blocks or inventory. Any other decode loss stops actions.
          if (packetName !== 'declare_recipes') this.connectionAbort.abort(new Error(`Unable to read ${packetName}.`));
          throw error;
        }
      };
    });
    const worldState = packet => {
      const w = packet.worldState, dimension = w?.name;
      if (!['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].includes(dimension)) { this.connectionAbort.abort(new Error("Unknown dimension.")); return; }
      const changed = this.state.dimension !== dimension;
      this.state.dimension = dimension; this.state.gameMode = typeof w.gamemode === 'object' ? w.gamemode.gameMode ?? w.gamemode.gamemode : w.gamemode;
      if (changed) { this.world.reset(dimension); this.entities.clear(); this.state.vehicleId=null; this.stopMovement(); }
    };
    c.on('login', p => { this.state.entityId = p.entityId; worldState(p); this.emit('login', this.snapshot()); });
    c.on('abilities',p=>{this.state.allowFlying=Boolean(p.flags&4);this.state.creativeFlying=Boolean(p.flags&2);this.state.flyingSpeed=Number.isFinite(p.flyingSpeed)?p.flyingSpeed:.05;this.emit('abilities',{allowFlying:this.state.allowFlying,flying:this.state.creativeFlying});});
    c.on('respawn', p => {
      const changedDimension = this.state.dimension !== p.worldState?.name && this.state.health > 0;
      const expected = changedDimension && this.dimensionRequested === p.worldState?.name;
      this.stopClock(); this.stopMovement(); this.attention.clear(); this.entities.clear(); this.attackers.clear();
      if (!this.respawnRequested && !expected) this.pending?.abort.abort(new Error("The server moved the agent; We need a new surveillance."));
      this.state.status = 'connecting'; this.state.position = null; if (!changedDimension) this.state.health = null; this.state.onGround = false;
      this.state.sleeping = false; this.state.vehicleId=null; this.selfMetadata = {}; this.state.velocity = {x:0,y:0,z:0};
      if (!changedDimension) this.inventory = new OMInventory(this.registry);
      this.containers = new OMContainers(this.inventory,this.registry);
      this.containerRequest = false; worldState(p); this.world.reset(this.state.dimension); this.emit('respawnPacket');
    });
    c.on('position', p => {
      const old = this.state.position || { x: 0, y: 0, z: 0 }, flags = p.flags;
      const relative = (key, bit) => typeof flags === 'number' ? Boolean(flags & bit) : Boolean(flags?.[key]);
      const next = { x: p.x + (relative('x', 1) ? old.x : 0), y: p.y + (relative('y', 2) ? old.y : 0), z: p.z + (relative('z', 4) ? old.z : 0) };
      if (this.state.position && Math.hypot(next.x - old.x, next.y - old.y, next.z - old.z) > 0.05) { this.metrics.corrections++; this.emit('correction', { from: old, to: next }); }
      this.state.position = next; this.world.focus = next; this.state.yaw = p.yaw + (relative('yaw', 8) ? this.state.yaw : 0); this.state.pitch = p.pitch + (relative('pitch', 16) ? this.state.pitch : 0); this.state.velocity = { x: 0, y: 0, z: 0 };
      this.write('teleport_confirm', { teleportId: p.teleportId }); this.sendPosition(); this.checkReady();
    });
    c.on('map_chunk', p => { try { this.world.load(p); this.checkReady(); } catch (e) { warn(e); this.connectionAbort.abort(e); } });
    c.on('unload_chunk', p => this.world.unload(p.chunkX, p.chunkZ));
    c.on('tile_entity_data',p=>{this.world.setBlockEntity(p.location,p.nbtData);this.emit('blockEntity',p.location);});
    c.on('open_sign_entity',p=>{this.signEditor=structuredClone(p);this.emit('signEditor',this.signEditor);});
    c.on('block_change', p => { const old = this.world.blockAt(p.location); this.world.update(p.location, p.type); this.protection.observeBlockChange(this.state.dimension,p.location,old,this.world.blockAt(p.location)); this.emit('block', { position: p.location, old: old?.stateId, stateId: p.type }); });
    c.on('multi_block_change', p => {
      for (const record of p.records) {
        const position = { x: p.chunkCoordinates.x * 16 + (record >> 8 & 15), y: p.chunkCoordinates.y * 16 + (record & 15), z: p.chunkCoordinates.z * 16 + (record >> 4 & 15) }, stateId = Math.floor(record / 4096);
        const old = this.world.blockAt(position); this.world.update(position, stateId); this.protection.observeBlockChange(this.state.dimension,position,old,this.world.blockAt(position)); this.emit('block', { position, old:old?.stateId, stateId });
      }
    });
    c.on('chunk_batch_finished', () => this.write('chunk_batch_received', { chunksPerTick: 10 }));
    c.on('declare_recipes',p=>{try{if(this.versionProfile?.readRecipes)this.versionProfile.readRecipes(this,p);else this.recipeBook.ingest(p);this.emit('recipes',this.recipeBook.snapshot());}catch(error){warn(error);this.connectionAbort.abort(error);}});
    c.on('update_health', p => {
      Object.assign(this.state, { health: p.health, food: p.food });
      if (p.health <= 0) { const wasDead=this.state.status==='dead';this.state.status='dead';this.connectionAbort.abort(new Error("Agent died."));this.stopMovement();this.stopClock();if(!wasDead)this.emit('death');this.emit('session'); }
      else this.checkReady();
      this.emit('health', {health:p.health,food:p.food});
    });
    c.on('open_window', p => { this.containers.open(p); this.stopMovement(); this.emit('container'); });
    c.on('close_window', p => { this.containers.close(p.windowId); this.emit('container'); });
    c.on('window_items', p => { if (this.inventory.updateWindow(p) || this.containers.updateWindow(p)) { this.emit('inventory', this.inventory.snapshot()); this.emit('container'); } });
    c.on('set_slot', p => { if (this.inventory.updateSlot(p) || this.containers.updateSlot(p)) { this.emit('inventory', this.inventory.snapshot()); this.emit('container'); } });
    c.on('held_item_slot', p => { this.inventory.selected = p.slot; });
    c.on('set_cooldown', p => { if(this.registry.items[p.itemID]?.name==='shield')this.shieldDisabledUntil=performance.now()+Math.max(0,p.cooldownTicks)*50; });
    c.on('update_time',p=>{const long=n=>typeof n==='bigint'?n:Array.isArray(n)?BigInt.asIntN(64,(BigInt(n[0])<<32n)|BigInt(n[1]>>>0)):BigInt(n);const raw=long(p.time),ticks=Number((raw<0n?-raw:raw)%24000n);this.time={timeOfDay:ticks,isDay:ticks<13000,age:Number(long(p.age))};this.emit('time',this.time);});
    c.on('animation',p=>{if(p.entityId===this.state.entityId&&p.animation===2){this.state.sleeping=false;this.selfMetadata={};this.emit('wake');}});
    c.on('player_info', p => this.players.update(p));
    c.on('player_remove', p => this.players.remove(p));
    c.on('spawn_entity', p => { const type = this.registry.entities[p.type]; const e = { id: String(p.entityId), uuid: p.objectUUID, name: type?.name || 'unknown', kind: type?.name === 'player' ? 'player' : 'entity', yaw: p.yaw * 360 / 256, pitch: p.pitch * 360 / 256, headYaw: p.headPitch * 360 / 256, ownerId: ['arrow', 'spectral_arrow', 'trident'].includes(type?.name) ? p.objectData - 1 : null, position: { x: p.x, y: p.y, z: p.z }, velocity: this.packetVelocity(p.velocity), metadata: {} }; this.players.enrich(e); this.entities.set(p.entityId, e); this.emit('entity', e); });
    c.on('entity_metadata', p => {
      if(p.entityId===this.state.entityId){const keys=this.registry.entitiesByName.player.metadataKeys||[];for(const m of p.metadata)this.selfMetadata[keys[m.key]||m.key]=m.value;
        if(p.metadata.some(m=>keys[m.key]==='shared_flags')){const flying=Boolean(this.selfMetadata.shared_flags&128);if(flying&&!this.state.gliding)this.flightEvidence.takeoffs++;this.state.gliding=flying;if(!flying)this.flightRockets.clear();}
        const sleeping=this.selfMetadata.pose===2||Boolean(this.selfMetadata.sleeping_pos);if(sleeping!==Boolean(this.state.sleeping)){this.state.sleeping=sleeping;this.stopMovement();this.emit(sleeping?'sleep':'wake');}this.emit('selfMetadata');return;}
      const e = this.entities.get(p.entityId); if (!e) return; const keys = this.registry.entitiesByName[e.name]?.metadataKeys || []; for (const m of p.metadata) e.metadata[keys[m.key] || m.key] = m.value;
      if(e.name==='firework_rocket'&&e.metadata.attached_to_target===this.state.entityId+1&&!this.flightRockets.has(p.entityId)){this.flightRockets.add(p.entityId);this.flightEvidence.rockets++;this.emit('rocket',e);}
      if (e.kind === 'player') e.eyeHeight = ({ 1: .4, 2: .2, 3: .4, 4: .4, 5: 1.27, fall_flying: .4, sleeping: .2, swimming: .4, crouching: 1.27 })[e.metadata.pose] ?? 1.62;
      if (e.name === 'item' && e.metadata.item) { try { const item = readSlot(e.metadata.item, this.registry); e.item = item ? { name: item.name, item: item.item, count: item.count } : null; this.emit('drop', e); } catch (err) { warn(err); } }
      this.emit('entity', e);
    });
    const rotate = p => { const e = this.entities.get(p.entityId); if (e) { if (p.yaw !== undefined) e.yaw = p.yaw * 360 / 256; if (p.pitch !== undefined) e.pitch = p.pitch * 360 / 256; } };
    const move = p => { const e = this.entities.get(p.entityId); if (e) { e.position = { x: e.position.x + p.dX / 4096, y: e.position.y + p.dY / 4096, z: e.position.z + p.dZ / 4096 }; rotate(p); this.emit('entity', e); } };
    c.on('rel_entity_move', move); c.on('entity_move_look', move);
    c.on('entity_look', rotate);
    c.on('entity_head_rotation', p => { const e = this.entities.get(p.entityId); if (e) e.headYaw = p.headYaw * 360 / 256; });
    c.on('entity_teleport', p => { const e = this.entities.get(p.entityId); if (e) { e.position = { x: p.x, y: p.y, z: p.z }; rotate(p); } });
    c.on('entity_velocity', p => { if (p.entityId === this.state.entityId) this.state.velocity = this.packetVelocity(p.velocity); const e = this.entities.get(p.entityId); if (e) e.velocity = this.packetVelocity(p.velocity); });
    c.on('entity_equipment', p => { const e = this.entities.get(p.entityId); if (e) { e.equipment ||= {}; for (const slot of p.equipments) e.equipment[slot.slot] = readSlot(slot.item, this.registry); } });
    c.on('entity_destroy', p => { for (const id of p.entityIds) { const e = this.entities.get(id); this.entities.delete(id); this.flightRockets.delete(id); this.attackers.delete(String(id)); if(this.state.vehicleId===id){this.state.vehicleId=null;this.emit('vehicle',null);} this.emit('entityGone', e); } });
    c.on('set_passengers',p=>{if(p.passengers.includes(this.state.entityId)){this.state.vehicleId=p.entityId;synchronizeVehicle(this);this.emit('vehicle',observeVehicle(this));}else if(this.state.vehicleId===p.entityId){this.state.vehicleId=null;this.state.velocity={x:0,y:0,z:0};this.emit('vehicle',null);}});
    c.on('collect', p => this.emit('collect', { id: String(p.collectedEntityId), own: p.collectorEntityId === this.state.entityId, count: p.pickupItemCount }));
    c.on('damage_event', p => {
      const e = this.entities.get(p.sourceCauseId - 1), at = performance.now();
      if (p.entityId === this.state.entityId && e) {
        const now = Date.now();
        for (const [id, value] of this.attackers) if (now - value.lastHitAt > 10000) this.attackers.delete(id);
        const previous = this.attackers.get(e.id), hitTimes = [...(previous?.hitTimes || []).filter(t => now - t >= 0 && now - t <= 10000), now].slice(-32);
        this.attackers.set(e.id, { entityId: e.id, hits: hitTimes.length, hitTimes, lastHitAt: now });
        if (this.attackers.size > 128) this.attackers.delete(this.attackers.keys().next().value);
      }
      this.emit('damage', { entityId: String(p.entityId), sourceId: p.sourceCauseId-1===this.state.entityId ? String(this.state.entityId) : e?.id || null, receivedAt: at });
    });
    c.on('explosion',p=>{
      for(const [axis,field] of [['x','playerMotionX'],['y','playerMotionY'],['z','playerMotionZ']]) if(Number.isFinite(p[field]))this.state.velocity[axis]+=p[field];
      this.emit('explosion',{position:{x:p.x,y:p.y,z:p.z},radius:p.radius});
    });
    c.on('entity_status', p => { if (p.entityStatus === 3) this.emit('entityDead', this.entities.get(p.entityId)); });
    c.on('error', e => { warn(e); this.connectionAbort.abort(e); this.emit('fault', e); });
    const disconnected=p=>{this.emit('kicked',p.reason);this.connectionAbort.abort(new Error(`Server disconnected the client: ${JSON.stringify(p.reason).slice(0,500)}`));};
    c.on('disconnect',disconnected);c.on('kick_disconnect',disconnected);
    c.on('end', reason => { this.stopClock(); this.state.status = 'disconnected'; this.connectionAbort.abort(new Error("Connector closed.")); this.emit('end', reason); });
    try {
      if (this.options.auth === 'microsoft') await this.waitFor(() => this.authentication.status === 'authenticated', { signal: this.connectionAbort.signal, event: 'authenticated', timeoutMs: protocolOptions.authTimeoutMs });
      await this.waitFor(() => ['ready','dead'].includes(this.state.status), { signal: this.connectionAbort.signal, event: 'session', timeoutMs: this.options.connectTimeoutMs });
    }
    catch (error) { if(this.state.status!=='dead'){await this.close();throw error;} }
    return this;
  }
  observe() { return observeAgent(this); }
  watchPlayer(username, options) { return this.attention.watch(username, options); }
  findStorages(options) { return findStorages(this, options); }
  findSigns(options) { return findSigns(this.world,{position:this.state.position,...options}); }
  signAt(position) { return readSign(this.world,position); }
  menu() { return this.dataLoaded ? observeMenu(this.containers) : null; }
  vehicle() { return observeVehicle(this); }
  async respawn({signal,timeoutMs=15000}={}) {
    if(this.state.status!=='dead'||this.client?.state!=='play')throw new Error("Respawn requires a dead connected agent.");
    if(this.respawnRequested)throw new Error("Rebirth already requested.");
    if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>60000)throw new Error('respawn.timeoutMs: 1000–60000.');
    this.respawnRequested=true;
    try {
      await this.pending?.promise.catch(()=>{});signal?.throwIfAborted();this.connectionAbort=new AbortController();
      this.write('client_command',{actionId:0});
      await this.waitFor(()=>this.state.status==='ready'&&this.state.health>0,{event:'ready',signal:AbortSignal.any([this.connectionAbort.signal,...(signal?[signal]:[])]),timeoutMs});
      return this.snapshot();
    } catch(error){this.connectionAbort.abort(error);throw error;
    } finally {this.respawnRequested=false;}
  }
  describe() { return { contract: 'omconnect.agent', version: 1, minecraftVersion: this.options.version, skills: [...OM_SKILLS, ...this.skills.keys()] }; }
  registerSkill(name, handler) {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_:.]{0,63}$/.test(name) || OM_SKILLS.includes(name) || this.skills.has(name) || typeof handler !== 'function' || this.pending) throw new Error("Skill: unique name, handler and free performer.");
    this.skills.set(name, handler); return this;
  }
  subscribeUrgent(listener) {
    const damage = e => { if (e.entityId === String(this.state.entityId)) listener({ type: 'damage', entityId: e.entityId }); };
    this.on('damage', damage); return () => this.removeListener('damage', damage);
  }
  checkReady() {
    if (this.connectionAbort.signal.aborted || this.state.status === 'ready' || !this.state.position || !(this.state.health > 0) || !this.world.columnAt(this.state.position)) return;
    this.state.status = 'ready'; this.lastTick = performance.now();
    this.tickTiming.reset();
    this.timer = createTickLoop(() => {
      this.tickTiming.mark(performance.now());
      if (this.client?.state !== 'play' || this.state.health <= 0 || this.connectionAbort.signal.aborted || this.state.sleeping) return;
      const before = performance.now();
      try { this.state.elytraEquipped=this.inventory.slots[6]?.name==='elytra';this.state.rocketBoost=this.flightRockets.size>0;
        if(!synchronizeVehicle(this))this.state = this.physics(this.state, { ...this.control, usingItem: this.guarding }, p => this.world.blockAt(p)); this.world.focus = this.state.position; this.attention.tick(); this.humanize.tick(); this.tickLook(); this.sendPosition(); this.versionProfile?.afterTick?.(this); this.tickFallSafety(); }
      catch (error) { this.connectionAbort.abort(error); this.stopClock(); this.emit('warning', error); return; }
      this.metrics.maxTickMs = Math.max(this.metrics.maxTickMs, performance.now() - before); this.emit('physics', this.state.position);
    });
    this.emit('ready'); this.emit('session');
  }
  packetVelocity(v) { return { x: (v?.x || 0) / 8000, y: (v?.y || 0) / 8000, z: (v?.z || 0) / 8000 }; }
  stopClock() { if(this.timer?.stop)this.timer.stop();else clearInterval(this.timer);this.timer=null; }
  write(name, packet) { if (this.client?.state !== 'play') throw new Error("OMConnect Not in play."); const encoded=this.versionProfile?.encodePacket?.(name,packet,this);if(encoded?.skip)return;this.client.write(encoded?.name||name,encoded?.packet||packet);this.metrics.packetsSent++; }
  setCreativeFlying(enabled){
    if(this.state.gameMode!=='creative'||!this.state.allowFlying)throw new Error("The server won't allow a flight to Creative.");
    this.write('abilities',{flags:enabled?2:0});this.state.creativeFlying=Boolean(enabled);
    if(!enabled)this.control.up=this.control.down=false;
  }
  syncSprint() {
    const sprinting = Boolean(this.state.sprinting && this.control.sprint && !this.guarding && this.state.health > 0 && !this.state.frozen);
    if (sprinting !== this.sprintSent && this.state.entityId !== null && this.client?.state === 'play') {
      this.write('entity_action', { entityId: this.state.entityId, actionId: sprinting ? 'start_sprinting' : 'stop_sprinting', jumpBoost: 0 }); this.sprintSent = sprinting;
    }
  }
  syncSneak() {
    const sneaking = Boolean(this.control.sneak && this.state.health > 0 && !this.state.frozen);
    if (sneaking !== Boolean(this.sneakSent) && this.state.entityId !== null && this.client?.state === 'play') {
      this.write('entity_action', { entityId: this.state.entityId, actionId: sneaking ? 'start_sneaking' : 'stop_sneaking', jumpBoost: 0 }); this.sneakSent = sneaking;
    }
  }
  sendPosition() { if (this.state.position) { this.syncSprint(); this.syncSneak(); this.write('position_look', { ...this.state.position, yaw: this.state.yaw, pitch: this.state.pitch, onGround: this.state.onGround }); } }
  lookAt(p, options = {}) {
    const endermen=[...this.entities.values()].filter(e=>e.name==='enderman');
    const target=options.allowEndermanGaze?p:safeLookTarget(this.state,p,endermen);
    if(target!==p&&this.pending?.skill==='shoot')throw new Error("Gunshot off: The trajectory of the eye triggers the enderman. Need another position.");
    this.look.set(this.state,target,{signal:this.pending?.signal,...options});
    if(options.immediate)this.sendPosition();
  }
  tickLook(dt = .05) { this.look.tick(this.state,dt,(state,angles)=>safeEndermanAngles(state,angles,this.entities.values())); }
  tickFallSafety(){
    const safety=this.fallSafety,s=this.state;
    if(!s.position)return;
    safety.highestY=s.onGround?s.position.y:Math.max(safety.highestY??s.position.y,s.position.y);
    if(this.options.fallSafety===false||safety.active||Date.now()<safety.cooldownUntil||!this.dataLoaded)return;
    const inventory={water_bucket:this.inventory.count('water_bucket'),ender_pearl:this.inventory.count('ender_pearl')};
    if(!inventory.water_bucket&&!inventory.ender_pearl)return;
    const decision=decideFallRescue(s,p=>this.world.blockAt(p),inventory,{highestY:safety.highestY,endermen:this.entities.values()});
    if(!decision)return;
    this.emit('fallRescue',{phase:'planned',skill:decision.skill,reason:decision.reason,position:{...s.position},landing:decision.landing??decision.plan?.landing??null});
    safety.cooldownUntil=Date.now()+1200;
    safety.active=this.execute({skill:decision.skill,args:decision.args},{priority:1500})
      .then(result=>this.emit('fallRescue',{phase:'dispatched',skill:decision.skill,result}))
      .catch(error=>this.emit('fallRescue',{phase:'failed',skill:decision.skill,error:error.message}))
      .finally(()=>{safety.active=null;});
  }
  waitForLook(options = {}) { return waitForLook(this, options); }
  cancelLook() { this.look.clear(); }
  stopMovement({ sneak = false } = {}) { this.control = { x: 0, z: 0, jump: false, sprint: false, sneak }; this.state.sprinting = false; this.state.sneaking = sneak; this.syncSprint(); this.syncSneak(); }
  async waitFor(predicate, { signal, event = 'physics', timeoutMs = 10000 } = {}) {
    if (predicate()) return;
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.removeListener(event, check); signal?.removeEventListener('abort', abort); };
      const check = () => { try { if (predicate()) { cleanup(); resolve(); } } catch (e) { cleanup(); reject(e); } };
      const abort = () => { cleanup(); reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`No confirmation of event ${event} for ${timeoutMs} ms.`)); }, timeoutMs);
      this.on(event, check); signal?.addEventListener('abort', abort, { once: true }); check();
    });
  }
  async execute(action, { signal, priority = 0 } = {}) {
    if (this.state.status !== 'ready') throw new Error("Wait first connect().");
    if(this.state.vehicleId!=null&&!['look','lookAtPlayer','dismount','wait'].includes(action?.skill))throw new Error("First, get out of transport through dismount.");
    this.connectionAbort.signal.throwIfAborted(); signal?.throwIfAborted();
    if (!Number.isFinite(priority)) throw new Error("priority must be the number.");
    const encoded = JSON.stringify(action);
    if (!encoded || Buffer.byteLength(encoded) > 16384 || typeof action?.skill !== 'string') throw new Error("Action: skill and before 16 KiB JSON.");
    action = JSON.parse(encoded);
    while (this.pending) {
      if (priority <= this.pending.priority) throw new Error("The perpetrator is occupied; You need more to interrupt priority.");
      const old = this.pending; old.abort.abort(new Error("Interrupted by priority action.")); await old.promise.catch(() => {});
    }
    const abort = new AbortController(), started = performance.now();
    const combined = AbortSignal.any([abort.signal, this.connectionAbort.signal, ...(signal ? [signal] : [])]);
    const job = { abort, priority, skill: action.skill, signal:combined, promise: null };
    this.pending = job;
    let outcome = 'success', detail = '';
    job.promise = Promise.resolve().then(() => this.skills.has(action.skill) ? this.skills.get(action.skill)(action.args || {}, { client: this, signal: combined }) : runAction(this, action, combined))
      .then(result => { combined.throwIfAborted(); return result; })
      .catch(error => { outcome = combined.aborted ? 'cancelled' : 'failure'; detail = String((combined.aborted ? combined.reason : error)?.message || error).slice(0, 300); if (!combined.aborted) this.metrics.failures++; throw combined.aborted ? combined.reason : error; })
      .finally(() => {
        this.stopMovement(); if (this.pending === job) this.pending = null; this.metrics.actions++;
        const entry = { at: Date.now(), skill: action.skill, priority, outcome, detail, durationMs: performance.now() - started };
        this.trace.push(entry); if (this.trace.length > 128) this.trace.shift(); this.emit('action', { ...entry });
      });
    return job.promise;
  }
  snapshot() { return { identity: OMCONNECT, ...structuredClone(this.state), authentication: structuredClone(this.authentication), time:structuredClone(this.time), inventory: this.dataLoaded?this.inventory.snapshot():{}, equipment:this.dataLoaded?this.inventory.equipment():{}, loadedChunks: this.dataLoaded?this.world.columns.size:0, metrics: { ...structuredClone(this.metrics), timing: this.tickTiming.snapshot(), navigation: navigationScheduler.snapshot() } }; }
  async close() {
    this.connectionAbort.abort(new Error("Client stopped.")); this.stopMovement(); this.attention.clear(); this.stopClock(); await this.pending?.promise.catch(() => {});
    if (!this.client?.socket?.destroyed) this.client?.end('OMConnect stopped');
    const socket = this.client?.socket;
    if (socket && !socket.destroyed) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); socket.removeListener('close', done); resolve(); };
      const timer = setTimeout(() => { socket.destroy(); done(); }, 500); socket.once('close', done);
    });
    this.state.status = 'disconnected';
    clearTimeout(this.client?.closeTimer);
  }
}
export const createOMConnect = (options,components) => new OMConnect(options,components);
