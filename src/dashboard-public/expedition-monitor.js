const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const label=id=>String(id).replace('minecraft:','').replaceAll('_',' ').replaceAll('-',' ');
let busy=false,last;
function render(r){
  if(!r.available){$('reason').textContent=r.error||'Waiting for the expedition.';return;}
  last=r;$('name').textContent=r.player;$('version').textContent=r.version;$('reason').textContent=r.error||r.reason;$('status').textContent=r.status+(r.stale?' · stale':'');
  $('vitals').textContent=`${Number.isFinite(r.state.health)?Number(r.state.health.toFixed(1)):'—'} / ${r.state.food??'—'}`;
  const seconds=Math.max(0,Math.floor((Date.now()-new Date(r.startedAt))/1000));$('elapsed').textContent=`${Math.floor(seconds/3600)}h ${Math.floor(seconds/60)%60}m ${seconds%60}s`;
  const done=r.steps.filter(s=>s.status==='completed').length;$('progress').textContent=`${done} / ${r.steps.length}`;$('bar').max=r.steps.length||1;$('bar').value=done;
  $('actions').textContent=`${r.totalActions} / ${r.deaths}`;$('freshness').textContent=`Report ${Math.max(0,Math.round((Date.now()-new Date(r.updatedAt))/1000))}s ago · ${r.goalAchieved?'Victory observed':r.status==='running'?'Campaign in progress':'Campaign '+r.status}`;
  $('steps').replaceChildren(...r.steps.map(s=>node('li',(s.status==='completed'?'✓ ':s.status==='active'?'→ ':'')+label(s.id),s.status)));
  $('action').textContent=r.activeAction?JSON.stringify(r.activeAction,null,2):r.status==='running'?'Planning the next action…':'No active action';
  const p=r.state.position;$('position').textContent=(r.state.dimension||'')+(p?' · '+['x','y','z'].map(k=>k.toUpperCase()+' '+p[k].toFixed(1)).join(' · '):'');
  const items=Object.entries(r.inventory).filter(([,n])=>n>0);$('inventory').replaceChildren(...(items.length?items.map(([id,n])=>node('span',label(id)+' × '+n,'item')):[node('span','Empty','muted')]));
  $('runtime').textContent=`CPU ${r.runtime?.cpuPercentOfOneCore?.toFixed(1)??'—'}% of one core · RAM ${r.runtime?.rssMiB?.toFixed(0)??'—'} MiB · planning updates ${r.learning.planner} · movement updates ${r.learning.navigation}`;
  $('events').replaceChildren(...[...r.actions].reverse().map(e=>{const n=node('div','','event'+(e.outcome==='failure'?' failure':''));n.append(node('time',new Date(e.at).toLocaleTimeString()),node('b',e.skill+' · '+e.outcome),node('span',e.detail||JSON.stringify(e.action?.args||{})));return n;}));
  $('failures').replaceChildren(...r.failures.map(e=>node('p',e.count+' × '+e.reason,'failure')));
}
async function refresh(){if(busy||document.hidden)return;busy=true;try{const res=await fetch('/api/progress',{signal:AbortSignal.timeout(3000)});if(!res.ok)throw new Error();render(await res.json());}catch{$('status').textContent='Monitor disconnected';}finally{busy=false;}}
void refresh();setInterval(refresh,2000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refresh();});
