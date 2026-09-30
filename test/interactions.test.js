import test from 'node:test';
import assert from 'node:assert/strict';
import { previewInteraction, runInteraction } from '../mckudo_core.js';
import { KudoConnect } from '../kudoconnect/index.js';
const full = { name:'stone',boundingBox:'block',shapes:[[0,0,0,1,1,1]] }, air={name:'air',boundingBox:'empty',shapes:[]};
function pair() {
  const a=new KudoConnect({username:'Alice'}),b=new KudoConnect({username:'Blake'});
  for(const [c,other,id,x,yaw] of [[a,b,1,.5,-90],[b,a,2,2.5,90]]) {
    c.state={...c.state,status:'ready',entityId:id,position:{x,y:1,z:.5},yaw,pitch:0,health:20,dimension:'minecraft:overworld'};
    c.world.blockAt=p=>p.y<1?full:air;
    c.execute=async()=>({ok:true});
  }
  for(const [c,other] of [[a,b],[b,a]]) {
    const uuid=other.options.username+'-uuid';c.players.update({action:{add_player:true},data:[{uuid,player:{name:other.options.username}}]});
    const e={id:String(other.state.entityId),uuid,kind:'player',name:'player',position:{...other.state.position},yaw:other.state.yaw,headYaw:other.state.yaw,pitch:0};c.entities.set(other.state.entityId,e);c.players.enrich(e);
  }
  let ca=1,cb=0;
  a.inventory.count=()=>ca; b.inventory.count=()=>cb;a.inventory.snapshot=()=>({log:ca});b.inventory.snapshot=()=>({log:cb});
  return {a,b,drop:()=>ca--,take:()=>{cb++;b.emit('collect',{id:'90',own:true,count:1});}};
}
test('meeting preview cannot act and rejects missing reciprocal identity',()=>{
  const {a,b}=pair();const plan=previewInteraction({from:a,to:b});assert.equal(plan.kind,'meet');assert.ok(plan.meeting);
  b.players.directory.clear();b.entities.clear();assert.throws(()=>previewInteraction({from:a,to:b}),/Личности/);
});

test('exchange chooses a place away from a third player who could collect the gift',()=>{
  const {a,b}=pair(),third={id:'3',kind:'player',position:{x:1.5,y:1,z:.5}};
  a.entities.set(3,third);b.entities.set(3,third);
  const plan=previewInteraction({from:a,to:b,kind:'give',item:'oak_log'});
  for(const p of Object.values(plan.meeting))assert.ok(Math.hypot(p.x+.5-third.position.x,p.z+.5-third.position.z)>=3);
});
test('interaction completes only after reciprocal received gaze and inventory evidence',async()=>{
  const {a,b,drop,take}=pair();a.execute=async action=>{if(action.skill==='drop'){drop();take();}return{ok:true};};
  const report=await runInteraction({from:a,to:b,kind:'give',item:'oak_log',timeoutMs:1000});
  assert.equal(report.status,'completed');assert.deepEqual(report.journal.map(e=>e.phase),['prepared','arrived','mutual-gaze','released','received','mutual-gaze-after-transfer','completed']);
  assert.equal(a.attention.leases.size,0);assert.equal(b.listenerCount('collect'),0);
});
test('partial delivery is retained after a failed pickup and never automatically repeated',async()=>{
  const {a,b,drop}=pair();let dropped=0;a.execute=async action=>{if(action.skill==='drop'){dropped++;drop();}return{ok:true};};b.execute=async action=>{if(action.skill==='collect')throw new Error('lost item');return{ok:true};};
  const report=await runInteraction({from:a,to:b,kind:'give',item:'oak_log',timeoutMs:1000});
  assert.equal(report.status,'partial');assert.equal(dropped,1);assert.equal(report.after.from.log,0);assert.equal(report.after.to.log,0);
});
test('cancellation cleans attention and releases participant locks',async()=>{
  const {a,b}=pair();const signal=AbortSignal.abort(new Error('stop'));
  assert.equal((await runInteraction({from:a,to:b,signal,timeoutMs:1000})).status,'cancelled');
  assert.equal((await runInteraction({from:a,to:b,timeoutMs:1000})).status,'completed');
});
