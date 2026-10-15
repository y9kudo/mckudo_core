/** Bounded LRU of authoritative voxel states; selectors share a section read. */
import {createHash} from 'node:crypto';
import vec3 from 'vec3';
const {Vec3}=vec3;
export function sectionSelectorSignature(ids){return createHash('sha256').update(Buffer.from(Uint32Array.from([...ids].sort((a,b)=>a-b)).buffer)).digest('hex');}
export class OMSectionIndex {
  constructor({maxSections=256,maxSelectors=8}={}){
    if(!Number.isInteger(maxSections)||maxSections<1||maxSections>2048||!Number.isInteger(maxSelectors)||maxSelectors<1||maxSelectors>32)throw new Error('Invalid section index budget');
    this.maxSections=maxSections;this.maxSelectors=maxSelectors;this.entries=new Map();this.columns=new WeakMap();this.sequence=0;this.hits=0;this.misses=0;this.cellsRead=0;
  }
  query(column,base,revision,ids,signature=sectionSelectorSignature(ids)){
    if(!column||typeof column.getBlockStateId!=='function'||!base||!['x','y','z'].every(k=>Number.isInteger(base[k]))||!(ids instanceof Set))throw new Error('Section query requires a column, integer origin and state IDs');
    if(!this.columns.has(column))this.columns.set(column,++this.sequence);
    const key=`${this.columns.get(column)}/${base.y}`,old=this.entries.get(key);let entry=old,stateReads=0;
    if(!entry||entry.revision!==revision){
      const states=new Uint32Array(4096);for(let i=0;i<4096;i++)states[i]=column.getBlockStateId(new Vec3(i&15,base.y+(i>>8),(i>>4)&15));
      entry={column,revision,states,selectors:new Map()};this.misses++;this.cellsRead+=4096;stateReads=4096;
    }else this.hits++;
    this.entries.delete(key);this.entries.set(key,entry);if(this.entries.size>this.maxSections)this.entries.delete(this.entries.keys().next().value);
    let indexes=entry.selectors.get(signature);
    if(!indexes){const found=[];for(let i=0;i<4096;i++)if(ids.has(entry.states[i]))found.push(i);indexes=Uint16Array.from(found);if(entry.selectors.size>=this.maxSelectors)entry.selectors.delete(entry.selectors.keys().next().value);entry.selectors.set(signature,indexes);}
    const matches=Object.freeze(Array.from(indexes,i=>Object.freeze({stateId:entry.states[i],x:base.x+(i&15),y:base.y+(i>>8),z:base.z+((i>>4)&15)})));
    return {matches,stateReads};
  }
  clear(){this.entries.clear();}
  snapshot(){return {sections:this.entries.size,maxSections:this.maxSections,hits:this.hits,misses:this.misses,cellsRead:this.cellsRead,stateBytes:this.entries.size*4096*4,selectorBytes:[...this.entries.values()].reduce((n,e)=>n+[...e.selectors.values()].reduce((s,a)=>s+a.byteLength,0),0)};}
}
