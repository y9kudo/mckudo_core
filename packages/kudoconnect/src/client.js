import { EventEmitter } from 'node:events';
import protocol from 'minecraft-protocol';
import minecraftData from 'minecraft-data';
import { performance } from 'node:perf_hooks';
import { KudoWorld } from './world.js';
import { KudoInventory, readSlot } from './inventory.js';
import { stepPhysics } from './physics.js';
import { runAction, KUDO_SKILLS } from './actions.js';
import { observeAgent } from './observation.js';
import { KudoPlayers, KudoAttention } from './players.js';
import { KudoContainers, findStorages } from './containers.js';
import { SmoothLook, waitForLook } from './movement.js';
import { recipeProtocol } from './protocol-compat.js';

export const KUDOCONNECT = Object.freeze({ name: 'KudoConnect', version: '0.5.0', author: 'y9kudo', apiVersion: 1, minecraftVersions: ['1.21.1'], authentication: ['offline'] });
export class KudoConnect extends EventEmitter {
  constructor(options = {}, { createProtocolClient = options => protocol.createClient(options), physics = stepPhysics } = {}) {
    super();
    if (typeof createProtocolClient !== 'function' || typeof physics !== 'function') throw new Error('Компоненты: createProtocolClient и physics должны быть функциями.');
    this.createProtocolClient = createProtocolClient; this.physics = physics; this.skills = new Map(); this.trace = [];
    this.options = { host: '127.0.0.1', port: 25565, username: 'Alice', version: '1.21.1', auth: 'offline', viewDistance: 16, connectTimeoutMs: 20000, ...options };
    const o = this.options;
    if (o.maxDrop !== undefined && (!Number.isInteger(o.maxDrop) || o.maxDrop < 1 || o.maxDrop > 32)) throw new Error('maxDrop: 1–32.');
    for (const key of ['fallHealthReserve', 'maxFallDamage']) if (o[key] !== undefined && (!Number.isFinite(o[key]) || o[key] < 0 || o[key] > 20)) throw new Error(`${key}: 0–20.`);
    if (o.version !== '1.21.1' || o.auth !== 'offline') throw new Error('KudoConnect: сейчас поддерживаются Java 1.21.1 и auth offline.');
    if (typeof o.host !== 'string' || !o.host || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535 || !/^[A-Za-z0-9_]{1,16}$/.test(o.username) || !Number.isInteger(o.viewDistance) || o.viewDistance < 2 || o.viewDistance > 32 || !Number.isInteger(o.connectTimeoutMs) || o.connectTimeoutMs < 1000 || o.connectTimeoutMs > 60000) throw new Error('KudoConnect: неверные параметры подключения.');
    this.registry = minecraftData(o.version); this.world = new KudoWorld(this.registry); this.inventory = new KudoInventory(this.registry);
    this.containers = new KudoContainers(this.inventory, this.registry); this.containerRequest=false;
    this.entities = new Map(); this.state = { status: 'disconnected', entityId: null, position: null, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, onGround: false, health: null, food: null, dimension: null, gameMode: null };
    this.time={timeOfDay:null,isDay:null,age:null};this.selfMetadata={};this.endgame={eyes:[]};this.dimensionRequested=null;
    this.players = new KudoPlayers(this); this.attention = new KudoAttention(this); this.managedNames = new Set();
    this.control = { x: 0, z: 0, jump: false, sprint: false }; this.look = new SmoothLook(); this.sprintSent = false; this.sequence = 0; this.pending = null; this.connectionAbort = new AbortController(); this.attackers = new Map();
    this.metrics = { packetsSent: 0, corrections: 0, actions: 0, failures: 0, maxTickMs: 0, decoderWarnings: [], reactions: [] };
    this.client = null; this.timer = null; this.lastTick = 0; this.connectedOnce = false; this.guarding = false;
  }
  async connect() {
    if (this.connectedOnce) throw new Error('Создай новый экземпляр KudoConnect для следующего подключения.');
    this.connectedOnce = true; this.state.status = 'connecting';
    const c = this.client = this.createProtocolClient({ ...this.options, clientSettings: { locale: 'ru_ru', viewDistance: this.options.viewDistance, chatFlags: 0, chatColors: true, skinParts: 127, mainHand: 1 }, hideErrors: true });
    const warn = error => { this.metrics.decoderWarnings.push({ message: String(error.message).slice(0, 200), at: Date.now() }); this.metrics.decoderWarnings = this.metrics.decoderWarnings.slice(-20); this.emit('warning', error); };
    c.on('state', () => {
      const parser = c.deserializer; if (!parser || parser.kudoObserved) return;
      parser.kudoObserved = true; const parse = parser.parsePacketBuffer.bind(parser);
      parser.parsePacketBuffer = buffer => {
        let id = 0, shift = 0;
          for (let i = 0; i < Math.min(buffer.length, 5); i++) { id |= (buffer[i] & 127) << shift; if (!(buffer[i] & 128)) break; shift += 7; }
          const mappings = this.registry.protocol[c.state]?.toClient?.types?.packet?.[1]?.[0]?.type?.[1]?.mappings || {};
          const packetName = mappings['0x' + id.toString(16).padStart(2, '0')] || String(id);
        try { return c.state === 'play' && packetName === 'declare_recipes' ? recipeProtocol(this.registry).parser.parsePacketBuffer(buffer) : parse(buffer); }
        catch (error) {
          this.emit('decodeFailure',{state:c.state,packetName,message:String(error.message),stack:String(error.stack),bytes:Buffer.from(buffer.subarray(0,262144))});
          warn(new Error(`Пакет ${c.state}/${packetName}: ${error.message}`));
          // A dropped recipe-list packet does not change blocks or inventory. Any other decode loss stops actions.
          if (packetName !== 'declare_recipes') this.connectionAbort.abort(new Error(`Не удалось прочитать ${packetName}.`));
          throw error;
        }
      };
    });
    const worldState = packet => {
      const w = packet.worldState, dimension = w?.name;
      if (!['minecraft:overworld', 'minecraft:the_nether', 'minecraft:the_end'].includes(dimension)) { this.connectionAbort.abort(new Error('Неизвестное измерение.')); return; }
      const changed = this.state.dimension !== dimension;
      this.state.dimension = dimension; this.state.gameMode = typeof w.gamemode === 'object' ? w.gamemode.gameMode ?? w.gamemode.gamemode : w.gamemode;
      if (changed) { this.world.reset(dimension); this.entities.clear(); this.stopMovement(); }
    };
    c.on('login', p => { this.state.entityId = p.entityId; worldState(p); this.emit('login', this.snapshot()); });
    c.on('respawn', p => {
      const changedDimension = this.state.dimension !== p.worldState?.name && this.state.health > 0;
      const expected = changedDimension && this.dimensionRequested === p.worldState?.name;
      clearInterval(this.timer); this.timer = null; this.stopMovement(); this.attention.clear(); this.entities.clear(); this.attackers.clear();
      if (!this.respawnRequested && !expected) this.pending?.abort.abort(new Error('Сервер переместил агента; нужно новое наблюдение.'));
      this.state.status = 'connecting'; this.state.position = null; if (!changedDimension) this.state.health = null; this.state.onGround = false;
      this.state.sleeping = false; this.selfMetadata = {}; this.state.velocity = {x:0,y:0,z:0};
      if (!changedDimension) this.inventory = new KudoInventory(this.registry);
      this.containers = new KudoContainers(this.inventory,this.registry);
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
    c.on('block_change', p => { const old = this.world.blockAt(p.location); this.world.update(p.location, p.type); this.emit('block', { position: p.location, old: old?.stateId, stateId: p.type }); });
    c.on('multi_block_change', p => {
      for (const record of p.records) {
        const position = { x: p.chunkCoordinates.x * 16 + (record >> 8 & 15), y: p.chunkCoordinates.y * 16 + (record & 15), z: p.chunkCoordinates.z * 16 + (record >> 4 & 15) }, stateId = Math.floor(record / 4096);
        const old = this.world.stateAt(position); this.world.update(position, stateId); this.emit('block', { position, old, stateId });
      }
    });
    c.on('chunk_batch_finished', () => this.write('chunk_batch_received', { chunksPerTick: 10 }));
    c.on('update_health', p => {
      Object.assign(this.state, { health: p.health, food: p.food });
      if (p.health <= 0) { const wasDead=this.state.status==='dead';this.state.status='dead';this.connectionAbort.abort(new Error('Агент погиб.'));this.stopMovement();clearInterval(this.timer);this.timer=null;if(!wasDead)this.emit('death');this.emit('session'); }
      else this.checkReady();
      this.emit('health', {health:p.health,food:p.food});
    });
    c.on('open_window', p => { if (!this.containerRequest) { this.write('close_window', { windowId: p.windowId }); return; } this.containers.open(p); this.emit('container'); });
    c.on('close_window', p => { this.containers.close(p.windowId); this.emit('container'); });
    c.on('window_items', p => { if (this.inventory.updateWindow(p) || this.containers.updateWindow(p)) { this.emit('inventory', this.inventory.snapshot()); this.emit('container'); } });
    c.on('set_slot', p => { if (this.inventory.updateSlot(p) || this.containers.updateSlot(p)) { this.emit('inventory', this.inventory.snapshot()); this.emit('container'); } });
    c.on('held_item_slot', p => { this.inventory.selected = p.slot; });
    c.on('update_time',p=>{const long=n=>typeof n==='bigint'?n:Array.isArray(n)?BigInt.asIntN(64,(BigInt(n[0])<<32n)|BigInt(n[1]>>>0)):BigInt(n);const raw=long(p.time),ticks=Number((raw<0n?-raw:raw)%24000n);this.time={timeOfDay:ticks,isDay:ticks<13000,age:Number(long(p.age))};this.emit('time',this.time);});
    c.on('animation',p=>{if(p.entityId===this.state.entityId&&p.animation===2){this.state.sleeping=false;this.selfMetadata={};this.emit('wake');}});
    c.on('player_info', p => this.players.update(p));
    c.on('player_remove', p => this.players.remove(p));
    c.on('spawn_entity', p => { const type = this.registry.entities[p.type]; const e = { id: String(p.entityId), uuid: p.objectUUID, name: type?.name || 'unknown', kind: type?.name === 'player' ? 'player' : 'entity', yaw: p.yaw * 360 / 256, pitch: p.pitch * 360 / 256, headYaw: p.headPitch * 360 / 256, ownerId: ['arrow', 'spectral_arrow', 'trident'].includes(type?.name) ? p.objectData - 1 : null, position: { x: p.x, y: p.y, z: p.z }, velocity: this.packetVelocity(p.velocity), metadata: {} }; this.players.enrich(e); this.entities.set(p.entityId, e); this.emit('entity', e); });
    c.on('entity_metadata', p => {
      if(p.entityId===this.state.entityId){const keys=this.registry.entitiesByName.player.metadataKeys;for(const m of p.metadata)this.selfMetadata[keys[m.key]||m.key]=m.value;const sleeping=this.selfMetadata.pose===2||Boolean(this.selfMetadata.sleeping_pos);if(sleeping!==Boolean(this.state.sleeping)){this.state.sleeping=sleeping;this.stopMovement();this.emit(sleeping?'sleep':'wake');}return;}
      const e = this.entities.get(p.entityId); if (!e) return; const keys = this.registry.entitiesByName[e.name]?.metadataKeys || []; for (const m of p.metadata) e.metadata[keys[m.key] || m.key] = m.value;
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
    c.on('entity_destroy', p => { for (const id of p.entityIds) { const e = this.entities.get(id); this.entities.delete(id); this.attackers.delete(String(id)); this.emit('entityGone', e); } });
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
      this.emit('damage', { entityId: String(p.entityId), sourceId: e?.id || null, receivedAt: at });
    });
    c.on('entity_status', p => { if (p.entityStatus === 3) this.emit('entityDead', this.entities.get(p.entityId)); });
    c.on('error', e => { warn(e); this.connectionAbort.abort(e); this.emit('fault', e); });
    c.on('disconnect', p => { this.emit('kicked', p.reason); this.connectionAbort.abort(new Error(`Сервер отключил клиента: ${JSON.stringify(p.reason).slice(0, 500)}`)); });
    c.on('end', reason => { clearInterval(this.timer); this.state.status = 'disconnected'; this.connectionAbort.abort(new Error('Соединение закрыто.')); this.emit('end', reason); });
    const timeout = AbortSignal.timeout(this.options.connectTimeoutMs);
    try { await this.waitFor(() => ['ready','dead'].includes(this.state.status), { signal: AbortSignal.any([timeout,this.connectionAbort.signal]), event: 'session', timeoutMs: this.options.connectTimeoutMs }); }
    catch (error) { if(this.state.status!=='dead'){await this.close();throw error;} }
    return this;
  }
  observe() { return observeAgent(this); }
  watchPlayer(username, options) { return this.attention.watch(username, options); }
  findStorages(options) { return findStorages(this, options); }
  async respawn({signal,timeoutMs=15000}={}) {
    if(this.state.status!=='dead'||this.client?.state!=='play')throw new Error('Возрождение доступно только погибшему подключённому агенту.');
    if(this.respawnRequested)throw new Error('Возрождение уже запрошено.');
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
  describe() { return { contract: 'kudoconnect.agent', version: 1, minecraftVersion: this.options.version, skills: [...KUDO_SKILLS, ...this.skills.keys()] }; }
  registerSkill(name, handler) {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_:.]{0,63}$/.test(name) || KUDO_SKILLS.includes(name) || this.skills.has(name) || typeof handler !== 'function' || this.pending) throw new Error('Навык: уникальное имя, handler и свободный исполнитель.');
    this.skills.set(name, handler); return this;
  }
  subscribeUrgent(listener) {
    const damage = e => { if (e.entityId === String(this.state.entityId)) listener({ type: 'damage', entityId: e.entityId }); };
    this.on('damage', damage); return () => this.removeListener('damage', damage);
  }
  checkReady() {
    if (this.connectionAbort.signal.aborted || this.state.status === 'ready' || !this.state.position || !(this.state.health > 0) || !this.world.columnAt(this.state.position)) return;
    this.state.status = 'ready'; this.lastTick = performance.now();
    this.timer = setInterval(() => {
      if (this.client?.state !== 'play' || this.state.health <= 0 || this.connectionAbort.signal.aborted || this.state.sleeping) return;
      const before = performance.now();
      try { this.state = this.physics(this.state, { ...this.control, usingItem: this.guarding }, p => this.world.blockAt(p)); this.world.focus = this.state.position; this.attention.tick(); this.tickLook(); this.sendPosition(); }
      catch (error) { this.connectionAbort.abort(error); clearInterval(this.timer); this.emit('warning', error); return; }
      this.metrics.maxTickMs = Math.max(this.metrics.maxTickMs, performance.now() - before); this.emit('physics', this.state.position);
    }, 50);
    this.emit('ready'); this.emit('session');
  }
  packetVelocity(v) { return { x: (v?.x || 0) / 8000, y: (v?.y || 0) / 8000, z: (v?.z || 0) / 8000 }; }
  write(name, packet) { if (this.client?.state !== 'play') throw new Error('KudoConnect не находится в игровом состоянии.'); this.client.write(name, packet); this.metrics.packetsSent++; }
  syncSprint() {
    const sprinting = Boolean(this.state.sprinting && this.control.sprint && !this.guarding && this.state.health > 0 && !this.state.frozen);
    if (sprinting !== this.sprintSent && this.state.entityId !== null && this.client?.state === 'play') {
      this.write('entity_action', { entityId: this.state.entityId, actionId: sprinting ? 'start_sprinting' : 'stop_sprinting', jumpBoost: 0 }); this.sprintSent = sprinting;
    }
  }
  sendPosition() { if (this.state.position) { this.syncSprint(); this.write('position_look', { ...this.state.position, yaw: this.state.yaw, pitch: this.state.pitch, onGround: this.state.onGround }); } }
  lookAt(p, options = {}) { this.look.set(this.state, p, { signal: this.pending?.signal, ...options }); if (options.immediate) this.sendPosition(); }
  tickLook(dt = .05) { this.look.tick(this.state, dt); }
  waitForLook(options = {}) { return waitForLook(this, options); }
  cancelLook() { this.look.clear(); }
  stopMovement() { this.control = { x: 0, z: 0, jump: false, sprint: false }; this.state.sprinting = false; this.syncSprint(); }
  async waitFor(predicate, { signal, event = 'physics', timeoutMs = 10000 } = {}) {
    if (predicate()) return;
    signal?.throwIfAborted();
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); this.removeListener(event, check); signal?.removeEventListener('abort', abort); };
      const check = () => { try { if (predicate()) { cleanup(); resolve(); } } catch (e) { cleanup(); reject(e); } };
      const abort = () => { cleanup(); reject(signal.reason); };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Нет подтверждения события ${event} за ${timeoutMs} мс.`)); }, timeoutMs);
      this.on(event, check); signal?.addEventListener('abort', abort, { once: true }); check();
    });
  }
  async execute(action, { signal, priority = 0 } = {}) {
    if (this.state.status !== 'ready') throw new Error('Сначала дождись connect().');
    this.connectionAbort.signal.throwIfAborted(); signal?.throwIfAborted();
    if (!Number.isFinite(priority)) throw new Error('priority должен быть числом.');
    const encoded = JSON.stringify(action);
    if (!encoded || Buffer.byteLength(encoded) > 16384 || typeof action?.skill !== 'string') throw new Error('Action: skill и до 16 KiB JSON.');
    action = JSON.parse(encoded);
    while (this.pending) {
      if (priority <= this.pending.priority) throw new Error('Исполнитель занят; для прерывания нужен больший priority.');
      const old = this.pending; old.abort.abort(new Error('Прервано приоритетным действием.')); await old.promise.catch(() => {});
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
  snapshot() { return { identity: KUDOCONNECT, ...structuredClone(this.state), time:structuredClone(this.time), inventory: this.inventory.snapshot(), equipment:this.inventory.equipment(), loadedChunks: this.world.columns.size, metrics: structuredClone(this.metrics) }; }
  async close() {
    this.connectionAbort.abort(new Error('Клиент остановлен.')); this.stopMovement(); this.attention.clear(); clearInterval(this.timer); await this.pending?.promise.catch(() => {});
    if (!this.client?.socket?.destroyed) this.client?.end('KudoConnect stopped');
    const socket = this.client?.socket;
    if (socket && !socket.destroyed) await new Promise(resolve => {
      const done = () => { clearTimeout(timer); socket.removeListener('close', done); resolve(); };
      const timer = setTimeout(() => { socket.destroy(); done(); }, 500); socket.once('close', done);
    });
    this.state.status = 'disconnected';
    clearTimeout(this.client?.closeTimer);
  }
}
export const createKudoConnect = options => new KudoConnect(options);
