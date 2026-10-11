import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function sourceDigest(root){
 const hash=crypto.createHash('sha256');
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(['node_modules','.git','data','.cache'].includes(entry.name))continue;
  const full=path.join(dir,entry.name);
  if(entry.isSymbolicLink())throw new Error('Source snapshots must not contain symlinks.');
  if(entry.isDirectory())walk(full);
  else{hash.update(path.relative(root,full).replaceAll('\\','/')+'\0');hash.update(fs.readFileSync(full));hash.update('\0');}
 }};walk(root);return hash.digest('hex');
}
export const cleanInventory=inventory=>Object.fromEntries(Object.entries(inventory||{}).filter(([,n])=>Number.isFinite(n)&&n>0).map(([id,n])=>[id.replace(/^minecraft:/,''),n]));
export function diamondEvidence({startedAt,now,inventory,mined=[],pickups=[]}){
 if(!Number.isFinite(startedAt)||now<startedAt||!(cleanInventory(inventory).diamond>0))return null;
 const ore=mined.filter(m=>m.at>=startedAt&&now-m.at<=15000&&/^(?:deepslate_)?diamond_ore$/.test(m.block));
 for(const m of ore){
  const pickup=pickups.find(p=>p.at>=m.at-1500&&now-p.at<=15000&&p.own&&p.item==='diamond'&&p.position&&Math.hypot(p.position.x-m.position.x,p.position.y-m.position.y,p.position.z-m.position.z)<5);
  if(pickup)return {at:now,elapsedMs:now-startedAt,ore:m,pickup,kind:'own-ore-and-observed-pickup'};
 }
 return null;
}
export function rankRace(agents){
 return Object.values(agents).filter(a=>a.diamondEvidence).sort((a,b)=>a.diamondEvidence.at-b.diamondEvidence.at).map((a,index)=>({rank:index+1,name:a.name,version:a.version,elapsedMs:a.diamondEvidence.elapsedMs}));
}
export function sharingCandidate(agents,now,cooldowns=new Map()){
 const live=Object.values(agents).filter(a=>a.status==='running'&&a.state?.health>0&&a.state.position&&now-(a.sampledAt||0)<10000);
 const quantity=(a,rx)=>Object.entries(a.state.inventory).filter(([id])=>rx.test(id)).reduce((n,[,v])=>n+v,0);
 const candidates=[];
 for(const from of live)for(const to of live){
  if(from.name===to.name||cooldowns.get(from.name)>now)continue;
  const d=Math.hypot(...['x','y','z'].map(k=>from.state.position[k]-to.state.position[k]));if(d>20)continue;
  for(const [item,n]of Object.entries(from.state.inventory)){
   if(item==='diamond'||/diamond_|netherite_/.test(item))continue;
   let reserve=Infinity,need=0;
   const supporter=['0.2.0','0.3.0'].includes(from.version);
   if(/_log$|_stem$/.test(item)){reserve=supporter?2:8;need=quantity(to,/_log$|_stem$|_planks$/)<2?10:0;}
   else if(/_planks$/.test(item)){reserve=from.version==='0.3.0'?8:16;need=quantity(to,/_log$|_stem$|_planks$/)<4?8:0;}
   else if(item==='stick'){reserve=4;need=(to.state.inventory.stick||0)<2?4:0;}
   else if(item==='crafting_table'){reserve=supporter?0:1;need=!to.state.inventory.crafting_table?5:0;}
   else if(/^(wooden|stone|iron)_pickaxe$/.test(item)){reserve=1;need=quantity(to,/_pickaxe$/)===0?15:0;}
   else if(item==='cobblestone'){reserve=12;need=(to.state.inventory.cobblestone||0)<3?7:0;}
   else if(item==='iron_ingot'){reserve=3;need=!to.state.inventory.iron_pickaxe&&(to.state.inventory.iron_ingot||0)<3?9:0;}
   if(n>reserve&&need)candidates.push({from:from.name,to:to.name,position:to.state.position,item,count:Math.min(4,n-reserve),score:need-d/20+(['0.5.0','0.6.0','0.7.0-dev.0'].includes(to.version)?2:0)});
  }
 }
 return candidates.sort((a,b)=>b.score-a.score)[0]||null;
}
