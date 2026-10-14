// examples/pvp-monster.js
// PvP-monster v2: Armoured, Arms, Shield, Tactical.

import { createOMConnect } from '../packages/omconnect/index.js';
import { createOMAdapter } from '../adapters/omconnect.js';
import {
  createCore,
  createEquipmentReactor,
  chooseWeapon,
  weaponProfile,
} from '../overmindmc.js';
import { mkdir, writeFile } from 'node:fs/promises';

// ==================== RUNS ====================
const HOST = process.env.MC_HOST || '127.0.0.1';
const PORT = Number(process.env.MC_PORT || 25565);
const USERNAME = process.env.MC_USERNAME || 'Monster';
const VERSION = '1.21.1';

const KILL_RADIUS = 32;
const RETREAT_HEALTH = 10;         // derogation from 10
const CRITICAL_HEALTH = 6;         // panic 6
const ATTACK_RANGE = 3.5;          // Impact radius
const DANGER_GROUP = 3;            // derogation 3+ Mobs

// White lists (Like before)
const FRIENDLY = new Set([
  'cow', 'mooshroom', 'pig', 'sheep', 'chicken', 'rabbit',
  'horse', 'donkey', 'mule', 'llama', 'trader_llama',
  'cat', 'ocelot', 'parrot', 'wolf', 'fox', 'bee',
  'villager', 'wandering_trader', 'iron_golem', 'snow_golem',
  'axolotl', 'bat', 'squid', 'glow_squid', 'dolphin',
  'turtle', 'panda', 'polar_bear', 'goat', 'frog', 'tadpole',
  'allay', 'camel', 'sniffer',
]);

const IGNORED = new Set([
  'ender_dragon', 'item', 'Item', 'item_stack', 'experience_orb',
  'armor_stand', 'area_effect_cloud', 'arrow', 'spectral_arrow',
  'trident', 'small_fireball', 'fireball', 'eye_of_ender',
  'ender_pearl', 'snowball', 'egg', 'potion', 'fishing_bobber',
  'boat', 'minecart', 'tnt', 'falling_block', 'painting',
  'item_frame', 'glow_item_frame', 'leash_knot', 'lightning_bolt',
  'marker', 'interaction', 'display',
]);

// ==================== LAGUE ====================
const t0 = Date.now();
const log = (msg) => {
  const dt = String(Date.now() - t0).padStart(6, ' ');
  console.log(`[+${dt}ms] [Monster] ${msg}`);
};

// ==================== STATE ====================
const report = {
  startedAt: new Date().toISOString(),
  username: USERNAME,
  kills: {},
  attacks: 0,
  retreats: 0,
  errors: [],
  status: 'connecting',
};

// ==================== PVP REACTOR v2 ====================
function createPvpReactor() {
  let lastAttackAt = 0;
  let retreatUntil = 0;
  let currentTargetId = null;

  return {
    id: 'custom:pvp-monster',
    apiVersion: 1,
    preempt: true,

    react(observation) {
      const now = Date.now();
      const self = observation.self?.position;
      const health = observation.self?.health;

      if (!self) return { action: null, reason: "No position." };

      // --- Collect threats ---
      const threats = (observation.entities || [])
        .filter((e) => e.position && e.id !== observation.self.entityId)
        .filter((e) => !IGNORED.has(e.name))
        .filter((e) => !FRIENDLY.has(e.name))
        .filter((e) => !e.named)
        .filter((e) => !e.isBaby)
        .map((e) => ({
          ...e,
          distance: Math.hypot(
            e.position.x - self.x,
            e.position.y - self.y,
            e.position.z - self.z
          ),
        }))
        .filter((e) => e.distance <= KILL_RADIUS)
        .sort((a, b) => a.distance - b.distance);

      const nearbyCreepers = threats.filter((t) => t.name === 'creeper' && t.distance <= 5).length;
      const nearbyCount = threats.filter((t) => t.distance <= 8).length;

      // --- Retreat ---
      const needRetreat =
        (health != null && health <= CRITICAL_HEALTH) ||
        (health != null && health <= RETREAT_HEALTH && nearbyCreepers > 0) ||
        (health != null && health <= RETREAT_HEALTH + 4 && nearbyCount >= DANGER_GROUP);

      if (needRetreat && threats.length) {
        retreatUntil = now + 3000;
        report.retreats++;
        return {
          priority: 1000,
          action: {
            skill: 'flee',
            args: { entityId: threats[0].id, maxDistance: KILL_RADIUS },
          },
          reason: `Retreat: hp=${health}, Threat threats=${nearbyCount}, Kryper=${nearbyCreepers}.`,
        };
      }

      if (now < retreatUntil) {
        return { action: null, reason: "Retreat." };
      }

      // --- No targets ---
      if (!threats.length) {
        currentTargetId = null;
        return { action: null, reason: "No Purpose." };
      }

      const target = threats[0];
      currentTargetId = target.id;

      // --- Melee combat: combat ---
      if (target.distance <= ATTACK_RANGE + 1) {
        lastAttackAt = now;
        return {
          priority: 900,
          action: {
            skill: 'combat',
            args: {
              entityId: target.id,
              allowPlayer: true,
              durationMs: 400,
              maxDistance: 12,
              retreatHealth: RETREAT_HEALTH,
            },
          },
          reason: `Fight with ${target.name} (${target.distance.toFixed(1)}m).`,
        };
      }

      // --- Approach ---
      return {
        priority: 900,
        action: {
          skill: 'navigate',
          args: {
            x: Math.floor(target.position.x),
            y: Math.floor(target.position.y),
            z: Math.floor(target.position.z),
            range: 1,
            bridge: false,
            sprintJump: false,
          },
        },
        reason: `Approach ${target.name} (${target.distance.toFixed(1)}m).`,
      };
    },
  };
}

// ==================== STARTUP ====================
log('════════════════════════════════════════');
log(`  PVP-MONSTER v2: ${USERNAME}`);
log(`  Armour, Arms, shield, Tactical`);
log('════════════════════════════════════════');

log(`I'm getting involved...`);

const client = createOMConnect({
  host: HOST, port: PORT,
  username: USERNAME,
  version: VERSION, auth: 'offline',
  viewDistance: 16,
});

client.on('warning', (e) => {
  report.errors.push(String(e.message).slice(0, 200));
  log(`⚠ ${String(e.message).slice(0, 100)}`);
});

client.on('death', () => {
  log(`💀 died`);
  report.errors.push('death');
});

try {
  await client.connect();
  const p = client.state.position;
  log(`connected: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);

  report.status = 'running';

  const adapter = createOMAdapter(client, {
    searchRadius: 32,
    entityRadius: KILL_RADIUS,
    trackedBlocks: ['#logs', '#ores'],
  });

  const core = createCore({
    config: {
      schemaVersion: 4,
      name: USERNAME,
      worldId: 'pvp-monster-v2',
      actionTimeoutMs: 30000,
    },
    adapter,
    reactors: [
      createEquipmentReactor(),  // ← armor
      createPvpReactor(),
    ],
  });

  core.on('action:start', (d) => {
    log(`▶ ${d.action.skill} → ${JSON.stringify(d.action.args)}`);
  });

  core.on('action:finish', (r) => {
    if (r.outcome === 'failure') {
      report.errors.push(String(r.detail).slice(0, 200));
      log(`❌ ${r.skill}: ${String(r.detail).slice(0, 80)}`);
    } else {
      log(`✅ ${r.skill}`);
    }
    if (r.skill === 'combat' || r.skill === 'attack') report.attacks++;
  });

  client.on('entityDead', (e) => {
    if (!e) return;
    const name = e.name || 'unknown';
    report.kills[name] = (report.kills[name] || 0) + 1;
    log(`☠ Killed: ${name} (Total ${report.kills[name]})`);
  });

  core.start();

  const close = async () => {
    report.status = 'stopped';
    report.finishedAt = new Date().toISOString();
    await core.stop();
    await client.close();
    const path = 'data/pvp-monster.json';
    await mkdir('data', { recursive: true });
    await writeFile(path, JSON.stringify(report, null, 2));
    log(`Report: ${path}`);
    log(`attacks: ${report.attacks}, of the Convention: ${report.retreats}`);
    log(`Murders: ${JSON.stringify(report.kills)}`);
    process.exit(0);
  };

  process.once('SIGINT', close);
  process.once('SIGTERM', close);

  setInterval(() => {
    const health = client.state.health;
    const pos = client.state.position;
    const equipment = client.inventory.equipment();
    const eqStr = Object.entries(equipment)
      .map(([slot, item]) => item ? `${slot}:${item.name.replace(/^minecraft:/, '').slice(0, 4)}` : `${slot}:—`)
      .join(' ');
    const held = client.inventory.held()?.name || '—';
    log(`❤ ${health}/20 | ${eqStr} | ✋ ${held.replace(/^minecraft:/, '')} | ⚔ ${report.attacks} | 🏃 ${report.retreats}`);
  }, 5000);

} catch (error) {
  report.status = 'failed';
  report.reason = error.message;
  log(`❌ ${error.message}`);
  await client.close().catch(() => {});
  process.exit(1);
}