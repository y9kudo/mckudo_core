import test from 'node:test';
import assert from 'node:assert/strict';
import {leaseNavigationRoute,consumeNavigationRoute} from '../src/route-lease.js';
import {OMConnect} from '../index.js';
const point={x:0,y:64,z:0},goal={x:4,y:64,z:0,range:0,maxDrop:3};
const plan={status:'planned',steps:[{kind:'walk',position:goal}],visited:10};
test('core-to-client route handoff is immutable, one-use and scoped to the observed execution conditions',()=>{
  const c=new OMConnect();Object.assign(c.state,{position:point,dimension:'minecraft:overworld'});
  const issue=()=>({...goal,routeLease:leaseNavigationRoute(c,plan,point,goal,()=>true)});
  const args=issue(),copy=consumeNavigationRoute(c,point,args);assert.deepEqual(copy,plan);copy.steps.length=0;assert.equal(plan.steps.length,1);
  assert.equal(consumeNavigationRoute(c,point,args),null);
  assert.equal(consumeNavigationRoute(c,point,{...issue(),x:9}),null);
  assert.equal(consumeNavigationRoute(c,{...point,x:1},issue()),null);
  for(const change of [()=>c.inventory.revision++,()=>c.metrics.corrections++,()=>c.state.dimension='minecraft:the_end',()=>c.navigationPolicy={cost:()=>1}]){
    const a=issue();change();assert.equal(consumeNavigationRoute(c,point,a),null);
  }
  let current=true;const token=leaseNavigationRoute(c,plan,point,goal,()=>current);current=false;
  assert.equal(consumeNavigationRoute(c,point,{...goal,routeLease:token}),null);
});
test('arbitrary route identifiers and more than four retained plans cannot be consumed',()=>{
  const c=new OMConnect();const tokens=Array.from({length:5},()=>leaseNavigationRoute(c,plan,point,goal,()=>true));
  assert.equal(consumeNavigationRoute(c,point,{...goal,routeLease:'unknown'}),null);
  assert.equal(consumeNavigationRoute(c,point,{...goal,routeLease:tokens[0]}),null);
  assert.ok(consumeNavigationRoute(c,point,{...goal,routeLease:tokens[4]}));
});
