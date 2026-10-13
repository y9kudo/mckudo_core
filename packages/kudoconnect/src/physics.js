import { environmentAt } from './environment.js';
import {predictElytraTick} from './vectorize.js';
const bounds = (p,height=1.8) => ({ minX: p.x - 0.3, maxX: p.x + 0.3, minY: p.y, maxY: p.y + height, minZ: p.z - 0.3, maxZ: p.z + 0.3 });
const shift = (b, axis, v) => { b['min' + axis] += v; b['max' + axis] += v; };
const intersects = (a, b, k) => ['X', 'Y', 'Z'].filter(n => n !== k).every(n => a['max' + n] > b['min' + n] + 1e-7 && a['min' + n] < b['max' + n] - 1e-7);
// Grounded sneaking clips horizontal motion to observed collision support. An
// unloaded cell is not evidence of a ledge on which the player can stand.
function holdEdge(box, velocity, getBlock) {
  const supported = (dx, dz) => {
    const b = { ...box }; shift(b, 'X', dx); shift(b, 'Z', dz); shift(b, 'Y', -.5);
    for (let y = Math.floor(b.minY); y <= Math.floor(box.minY); y++)
      for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ - 1e-7); z++)
        for (let x = Math.floor(b.minX); x <= Math.floor(b.maxX - 1e-7); x++) {
          const block = getBlock({ x, y, z });
          if (!block) continue;
          for (const s of block.shapes || (block.boundingBox === 'block' ? [[0,0,0,1,1,1]] : [])) {
            const shape = { minX:x+s[0],minY:y+s[1],minZ:z+s[2],maxX:x+s[3],maxY:y+s[4],maxZ:z+s[5] };
            if (intersects(b, shape, 'Y') && b.minY < shape.maxY - 1e-7 && box.minY >= shape.maxY - 1e-7) return true;
          }
        }
    return false;
  };
  const reduce = v => Math.abs(v) <= .05 ? 0 : v - Math.sign(v) * .05;
  let x = velocity.x, z = velocity.z;
  while (x && !supported(x, 0)) x = reduce(x);
  while (z && !supported(0, z)) z = reduce(z);
  while ((x || z) && !supported(x, z)) { x = reduce(x); z = reduce(z); }
  velocity.x = x; velocity.z = z;
}
/** Standing-player baseline for Java 1.21.1; one call = one 50 ms tick. Health is server-owned. */
export function stepPhysics(state, control, getBlock) {
  if (!state?.position || !state.velocity || [...Object.values(state.position), ...Object.values(state.velocity)].some(v => !Number.isFinite(v)) || Object.values(state.velocity).some(v => Math.abs(v) > 16)) throw new Error('Physics: неверное состояние или скорость вне бюджета.');
  const gliding=Boolean(state.gliding&&state.elytraEquipped&&!state.onGround);
  const creativeFlying=Boolean(state.creativeFlying&&state.allowFlying&&state.gameMode==='creative');
  const p = { ...state.position }, velocity = { ...state.velocity }, box = bounds(p,gliding?.6:1.8);
  const environment = environmentAt(p, getBlock), liquid = environment.medium !== 'air', web = environment.contacts.includes('cobweb');
  if (environment.unknown) return { ...state, environment, velocity: { x: 0, y: 0, z: 0 }, frozen: true };
  const length = Math.hypot(control.x || 0, control.z || 0);
  const sprinting = Boolean(control.sprint && length > .1 && state.food > 6 && !control.sneak && !control.usingItem && !liquid && !web && !environment.hazardous);
  const acceleration = liquid ? .02 : (state.onGround ? .1 * (.6 / environment.slipperiness) ** 3 : .02) * (sprinting ? 1.3 : 1);
  // Analog input brakes near goals; 0.98 is vanilla's normal movement-input factor.
  const input = Math.min(1, length) * .98 * (control.sneak ? .3 : control.usingItem ? .2 : 1);
  if (length&&!gliding&&!creativeFlying) { velocity.x += (control.x || 0) / length * acceleration * input; velocity.z += (control.z || 0) / length * acceleration * input; }
  if(creativeFlying){
    const speed=Math.min(.45,Math.max(.08,(state.flyingSpeed||.05)*6));
    const targetX=length?(control.x||0)/length*speed*input:0,targetZ=length?(control.z||0)/length*speed*input:0;
    velocity.x+=(targetX-velocity.x)*.4;velocity.z+=(targetZ-velocity.z)*.4;
    const targetY=((control.up?1:0)-(control.down?1:0))*speed;
    velocity.y+=(targetY-velocity.y)*.5;
    if(Math.abs(velocity.y)<.003)velocity.y=0;
  }
  if(gliding)Object.assign(velocity,predictElytraTick({position:p,velocity,yaw:state.yaw,pitch:state.pitch,rocket:Boolean(state.rocketBoost)}).velocity);
  if (liquid&&!creativeFlying) { for (const k of ['x', 'y', 'z']) velocity[k] += environment.flow[k] * (environment.medium === 'water' ? .014 : .002333333); if (control.jump) velocity.y += .04; if (control.sneak) velocity.y -= .04; }
  else if (!creativeFlying&&control.jump && state.onGround && !gliding) {
    velocity.y = Math.fround(.42) * (environment.support === 'honey_block' ? .4 : 1);
    if (sprinting) {
      // The vanilla sprint-jump impulse follows facing, not the requested waypoint.
      const yaw = (state.yaw || 0) * Math.PI / 180;
      velocity.x -= Math.sin(yaw) * .2; velocity.z += Math.cos(yaw) * .2;
    }
  }
  const climbing = environment.contacts.some(n => ['ladder', 'vine', 'scaffolding'].includes(n));
  if (climbing) { velocity.x = Math.max(-.15, Math.min(.15, velocity.x)); velocity.z = Math.max(-.15, Math.min(.15, velocity.z)); velocity.y = control.jump || state.horizontalCollision ? .2 : Math.max(control.sneak ? 0 : -.15, velocity.y); }
  if (web) { velocity.x *= .25; velocity.z *= .25; velocity.y *= .05; }
  if (control.sneak && state.onGround && !control.jump && !liquid && !climbing) holdEdge(box, velocity, getBlock);
  const obstacles = [];
  for (let y = Math.floor(box.minY + Math.min(0, velocity.y)) - 1; y <= Math.floor(box.maxY + Math.max(0, velocity.y)); y++)
    for (let z = Math.floor(box.minZ + Math.min(0, velocity.z)); z <= Math.floor(box.maxZ + Math.max(0, velocity.z)); z++)
      for (let x = Math.floor(box.minX + Math.min(0, velocity.x)); x <= Math.floor(box.maxX + Math.max(0, velocity.x)); x++) {
        const b = getBlock({ x, y, z }), shapes = b ? b.shapes || (b.boundingBox === 'block' ? [[0, 0, 0, 1, 1, 1]] : []) : [[0, 0, 0, 1, 1, 1]];
        for (const s of shapes) obstacles.push({ minX: x + s[0], minY: y + s[1], minZ: z + s[2], maxX: x + s[3], maxY: y + s[4], maxZ: z + s[5] });
      }
  let onGround = false, horizontalCollision = false;
  for (const axis of ['Y', 'X', 'Z']) {
    const k = axis.toLowerCase(), before = velocity[k]; let move = before;
    for (const b of obstacles) if (intersects(box, b, axis)) {
      if (move > 0 && box['max' + axis] <= b['min' + axis] + 1e-7) move = Math.min(move, b['min' + axis] - box['max' + axis]);
      if (move < 0 && box['min' + axis] >= b['max' + axis] - 1e-7) move = Math.max(move, b['max' + axis] - box['min' + axis]);
    }
    shift(box, axis, move); p[k] += move;
    if (Math.abs(move - before) > 1e-7) {
      velocity[k] = 0;
      if (axis === 'Y' && before < 0) {
        onGround = true;
        const support = getBlock({ x: Math.floor(p.x), y: Math.floor(p.y - .05), z: Math.floor(p.z) });
        if ((support?.name || support?.id)?.replace(/^minecraft:/, '') === 'slime_block' && !control.sneak) velocity.y = -before;
      } else if (axis !== 'Y') horizontalCollision = true;
    }
  }
  const after = environmentAt(p, getBlock);
  if(gliding)return {...state,position:p,velocity,onGround,horizontalCollision,sprinting:false,sneaking:false,gliding:!onGround&&!liquid,frozen:false,environment:after};
  if(creativeFlying)return {...state,position:p,velocity,onGround,horizontalCollision,sprinting:false,sneaking:false,frozen:false,environment:after};
  if (web) velocity.x = velocity.y = velocity.z = 0;
  if (liquid) velocity.y = velocity.y * (environment.medium === 'water' ? .8 : .5) - (environment.medium === 'water' ? .005 : .02);
  else velocity.y = (velocity.y - .08) * .98;
  if (horizontalCollision && after.contacts.includes('honey_block') && !onGround && velocity.y < -.08) { const scale = -.05 / velocity.y; velocity.x *= scale; velocity.z *= scale; velocity.y = -.05; }
  const friction = liquid ? environment.medium === 'water' ? .8 : .5 : onGround ? after.slipperiness * .91 : .91;
  velocity.x *= friction; velocity.z *= friction;
  if (['honey_block', 'soul_sand'].includes(after.support)) { velocity.x *= .4; velocity.z *= .4; }
  if (Math.abs(velocity.x) < 0.003) velocity.x = 0; if (Math.abs(velocity.z) < 0.003) velocity.z = 0;
  return { ...state, position: p, velocity, onGround, horizontalCollision, sprinting, sneaking: Boolean(control.sneak), frozen: false, environment: after };
}
