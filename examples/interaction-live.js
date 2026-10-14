import { createFleet } from '../omconnect/index.js';
import { previewInteraction, runInteraction, createMinecraftBrain } from '../overmindmc.js';
import { writeFile, mkdir } from 'node:fs/promises';
const names = (process.env.MC_NAMES || 'Henry,Ivy').split(',');
const mode = process.argv[2] || 'meet';
if (!['meet','give','gather-give','retaliation'].includes(mode)) throw new Error("Mode: meet, give, gather-give, retaliation.");
const fleet = createFleet({ count: 2, names, connection: { host: process.env.MC_HOST || '127.0.0.1', port: Number(process.env.MC_PORT || 25565), viewDistance: 8, connectTimeoutMs: 10000 } });
const report = { startedAt: new Date().toISOString(), status: 'running', chatPackets: 0 };
let brain;
try {
  for (const c of fleet.agents.values()) c.on('warning', e => console.log(e.message));
  await fleet.connect(); const from = fleet.agents.get(names[0]), to = fleet.agents.get(names[1]);
  for (const [c,other] of [[from,to],[to,from]]) {
    await c.waitFor(() => Boolean(c.players.entity(other.options.username)), { event: 'entity', timeoutMs: 5000 });
    await c.waitFor(() => c.state.onGround, { timeoutMs: 5000 });
    const write = c.client.write.bind(c.client); c.client.write = (name, data) => { if (/chat|command/.test(name)) report.chatPackets++; return write(name,data); };
  }
  report.players = { [names[0]]: from.players.snapshot(), [names[1]]: to.players.snapshot() };
  report.initial = Object.fromEntries([...fleet.agents].map(([name,c]) => [name,{ state:c.snapshot(), cells:[-1,0,1].map(dy => { const p = {x:Math.floor(c.state.position.x),y:Math.floor(c.state.position.y)+dy,z:Math.floor(c.state.position.z)}; const b=c.world.blockAt(p);return {p,name:b?.name,shapes:b?.shapes}; }) }]));
  let item = process.env.MC_ITEM || 'oak_log'; const kind = ['give','gather-give'].includes(mode) ? 'give' : 'meet';
  if (mode === 'gather-give') {
    report.gather = await from.execute({skill:'gather',args:{block:'#logs',count:1}},{signal:AbortSignal.timeout(30000)});
    item = from.inventory.items().find(i => i.name.endsWith('_log'))?.name;
    if (!item) throw new Error("No log after extraction.");
  }
  report.preview = previewInteraction({ from, to, kind, item }); console.log(JSON.stringify(report.preview));
  report.interaction = await runInteraction({ from, to, peers: fleet.peers, kind, item, count: 1, timeoutMs: 30000 });
  report.status = report.interaction.status; console.log(JSON.stringify(report.interaction));
  if (mode === 'retaliation' && report.status === 'completed') {
    if (from.inventory.held() || to.inventory.items().some(i => /_(sword|axe)$/.test(i.name)) || Math.min(from.state.health,to.state.health) < 16) throw new Error("This test requires healthy agents without weapons.");
    // Let the vanilla post-login invulnerability expire before counting real damage.
    await from.execute({skill:'wait',args:{durationMs:2000}}); await from.execute({skill:'wait',args:{durationMs:2000}});
    const hits = []; to.on('damage',e=>{if(e.entityId===String(to.state.entityId)&&e.sourceId===String(from.state.entityId))hits.push({...e,at:Date.now()});});
    const strikes = [], write = to.client.write.bind(to.client); to.client.write = (name,p)=>{if(name==='use_entity'&&p.mouse===1)strikes.push({at:Date.now(),target:p.target});return write(name,p);};
    brain = createMinecraftBrain({client:to,worldId:'live-interaction',storage:false,survival:false,loot:false,needs:false,night:false,hunting:false}); brain.start();
    await from.execute({skill:'attack',args:{entityId:String(to.state.entityId),allowPlayer:true}});
    await to.waitFor(()=>hits.length>=1,{event:'damage',timeoutMs:2000});
    await from.execute({skill:'wait',args:{durationMs:700}});
    if (strikes.length) throw new Error("Reverse strike after first hit.");
    const target=to.state.position;
    await from.execute({skill:'navigate',args:{x:Math.floor(target.x),y:Math.floor(target.y),z:Math.floor(target.z),range:2,bridge:false}},{signal:AbortSignal.timeout(10000)});
    await from.execute({skill:'attack',args:{entityId:String(to.state.entityId),allowPlayer:true}});
    await to.waitFor(()=>hits.length>=2&&strikes.some(s=>s.target===from.state.entityId),{timeoutMs:3000});
    await to.waitFor(()=>from.state.health<20,{timeoutMs:2000});
    report.retaliation = {hitsReceived:hits.length,firstHitIgnored:true,strikes,reactionMs:strikes[0].at-hits[1].at,damageConfirmed:from.state.health<20,fromHealth:from.state.health,toHealth:to.state.health};
    await brain.stop(); report.status = 'completed'; console.log(JSON.stringify(report.retaliation));
  }
} catch (error) { report.status = 'failed'; report.reason = error.message; console.error(error.message); }
finally { await brain?.stop(); report.final = Object.fromEntries([...fleet.agents].map(([name,c])=>[name,c.snapshot()])); await fleet.close(); report.finishedAt = new Date().toISOString(); await mkdir('data',{recursive:true}); await writeFile(`data/kudoconnect-interaction-${mode}.json`,JSON.stringify(report,null,2)); process.exitCode = report.status === 'completed' ? 0 : 1; }
