import test from 'node:test';
import assert from 'node:assert/strict';
import {workstationAlcoves} from '../src/station-site.js';

const air={name:'air',boundingBox:'empty',shapes:[]};
const solid=name=>({name,boundingBox:'block',shapes:[[0,0,0,1,1,1]],diggable:true});
const setup=()=>{
  const changes=new Map([['0,64,0',air],['0,65,0',air]]);
  const key=p=>`${p.x},${p.y},${p.z}`;
  const getBlock=p=>changes.has(key(p))?changes.get(key(p)):solid('stone');
  return {changes,key,getBlock,options:{position:{x:.5,y:64,z:.5},getBlock,canDig:b=>b.name==='stone'}};
};

test('an underground station alcove clears headroom before its foot cell and preserves support',()=>{
  const {options}=setup();const sites=workstationAlcoves(options);
  assert.equal(sites.length,4);
  assert.deepEqual(sites[0].dig.map(p=>p.y),[65,64]);
  assert.ok(sites.every(s=>s.dig.every(p=>p.x!==0||p.z!==0)));
  assert.ok(sites.every(s=>s.dig.every(p=>p.y>=64)));
});

test('station alcoves reject liquids, unknown neighbors, falling ceilings and protected cells',()=>{
  for(const neighbor of [null,{name:'lava'},solid('gravel')]){
    const {options,changes}=setup();changes.set('1,66,0',neighbor);
    assert.equal(workstationAlcoves(options).some(s=>s.position.x===1),false);
  }
  const {options}=setup();options.canDig=(b,p)=>p.x!==1;
  assert.equal(workstationAlcoves(options).some(s=>s.position.x===1),false);
  options.occupied=p=>p.z===1;
  assert.equal(workstationAlcoves(options).some(s=>s.position.z===1),false);
});
