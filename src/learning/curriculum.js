import {integer,finite} from './contracts.js';
import {createHash} from 'node:crypto';
import {headlessCurriculumStages} from './stages.js';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const semantic=stages=>stages.map(({title,description,...stage})=>stage);
// Proven legacy built-in stage definitions: labels changed, task semantics did not.
const legacySignatures=new Map([
  ['cb04b02f30418806a7aa91267160f435a6ec6868941d2ce3274640e5e13a4591','204415c02317419aa4239f609b6326137d3ce44a32a76959f1eb9463c49c85a6'],
  ['627c31cc589378093ec25d1a49c9d6a46013736155cb2a53febef6f25206e075','21218ec78ae4b3fdd0d6b22aa172bb4b0b37daddb6879025d7904dc0e0313b38'],
  ['8687999a2a502a03819ef641237d1a3c08cac51bdf169295c45f593334b21168','7bc3f2dc9efc84656de1182760813fbd5b4a23f4e16e56ff286f489a33c2d60a'],
  ['caeda9527bf8ba944bb1b1e485873a842dc69bb655387c7625d3847efc0e22c6','6dc2e03cbaef11c0584a63ae1e3b34f761994b4fb695069c36e23cd7787fdc8d']
]);

/** Progression uses a rolling success window, not training reward alone. */
export function createCurriculum({stages=headlessCurriculumStages(),window=50,promoteAt=.85,demoteBelow=.2,memory}={}) {
  if(!Array.isArray(stages)||!stages.length||stages.length>64)throw new Error('curriculum stages: 1..64');integer(window,5,1000,'window');finite(promoteAt,.1,1,'promoteAt');finite(demoteBelow,0,promoteAt,'demoteBelow');
  const definitions=structuredClone(stages),signature=hash(canonical({stages:semantic(definitions),window,promoteAt,demoteBelow})),fullSignature=hash({stages:definitions,window,promoteAt,demoteBelow});let index=0,results=[],episodes=0,history=[];
  if(memory!==undefined){const compatible=memory?.schemaVersion===2&&memory.signature===signature||memory?.schemaVersion===1&&(memory.signature===fullSignature||legacySignatures.get(memory.signature)===signature);if(!compatible||!Array.isArray(memory.results)||memory.results.length>window||memory.results.some(n=>n!==0&&n!==1)||!Array.isArray(memory.history)||memory.history.length>64)throw new Error('Curriculum memory differs or is malformed');integer(memory.index,0,definitions.length-1,'curriculum index');integer(memory.episodes,memory.results.length,Number.MAX_SAFE_INTEGER,'episodes');index=memory.index;episodes=memory.episodes;results=[...memory.results];history=structuredClone(memory.history);}
  return {record(success,{allowPromotion=true}={}){if(typeof allowPromotion!=='boolean')throw new TypeError('allowPromotion: boolean');if(typeof success!=='boolean')throw new TypeError('success: boolean');episodes++;results.push(+success);if(results.length>window)results.shift();if(results.length===window){const rate=results.reduce((a,b)=>a+b,0)/window,next=rate>=promoteAt&&allowPromotion?Math.min(index+1,stages.length-1):rate<demoteBelow?Math.max(0,index-1):index;if(next!==index){history.push({from:index,to:next,successRate:rate,episodes,reason:next>index?'promoted':'demoted'});history=history.slice(-64);index=next;results=[];}}return this.snapshot();},
    current:()=>structuredClone(definitions[index]),snapshot:()=>({index,totalStages:definitions.length,episodes,samples:results.length,successRate:results.length?results.reduce((a,b)=>a+b,0)/results.length:null,stage:structuredClone(definitions[index]),history:structuredClone(history)}),
    export:()=>({schemaVersion:2,signature,index,episodes,results:[...results],history:structuredClone(history)})};
}

/** Explicitly migrate custom v1 definitions while rejecting changes to task semantics. */
export function migrateCurriculumMemory({memory,previousStages,stages,window=50,promoteAt=.85,demoteBelow=.2}={}){
  if(!Array.isArray(previousStages)||!Array.isArray(stages)||JSON.stringify(canonical(semantic(previousStages)))!==JSON.stringify(canonical(semantic(stages))))throw new Error('Cannot migrate changed curriculum semantics');
  const restored=createCurriculum({memory,stages:previousStages,window,promoteAt,demoteBelow});return createCurriculum({memory:restored.export(),stages,window,promoteAt,demoteBelow}).export();
}
