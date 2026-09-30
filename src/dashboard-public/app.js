const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
let state,token='',updating=false;
const labels={ready:'В мире',dead:'Погиб · доступно возрождение',disconnected:'Отключён',connecting:'Подключается…'};
async function command(name,command,args){$('feedback').textContent='Выполняется…';try{const response=await fetch('/api/command',{method:'POST',headers:{'Content-Type':'application/json','X-MCKudo-Token':token},body:JSON.stringify({name,command,args})});const result=await response.json();if(!response.ok)throw new Error(result.error);$('feedback').textContent='Готово. Состояние обновлено.';await refresh();return result;}catch(e){$('feedback').textContent=e.message;}}
function button(text,name,cmd,cls){const b=node('button',text,cls);b.onclick=()=>command(name,cmd);return b;}
function inventory(){const agent=state?.agents.find(a=>a.name===$('selected').value);$('inventory').replaceChildren();if(!agent)return;$('inventoryName').textContent=agent.name;$('slotCount').textContent=`${agent.inventory.length} занятых слотов`;
  const equipment=Object.entries(agent.state.equipment||{}).filter(([,item])=>item);
  for(const [slot,item]of equipment){const e=node('div',undefined,'slot');e.append(node('strong',item.name.replaceAll('_',' ')),node('small','Надето · '+({head:'голова',chest:'тело',legs:'ноги',feet:'ступни'}[slot])),node('b','✓'));$('inventory').append(e);}
  if(!agent.inventory.length&&!equipment.length)$('inventory').append(node('p','Пока пусто. Предметы появятся после подбора.','empty'));
  for(const item of agent.inventory){const e=node('div',undefined,'slot');e.append(node('strong',item.name.replaceAll('_',' ')),node('small','Слот '+item.slot),node('b',item.count));$('inventory').append(e);}
}
function render(){const selected=$('selected').value;for(const id of ['selected','recipient']){const select=$(id),old=select.value;if([...select.options].map(o=>o.value).join()!==state.agents.map(a=>a.name).join()){select.replaceChildren(...state.agents.map(a=>{const o=node('option',a.name);o.value=a.name;return o;}));if(state.agents.some(a=>a.name===old))select.value=old;}}
  $('online').textContent=`${state.agents.filter(a=>a.state.status==='ready').length} / ${state.agents.length}`;$('agents').replaceChildren();
  for(const a of state.agents){const c=node('article',undefined,'agent'+(selected===a.name?' active':'')),head=node('div',undefined,'agent-head'),title=node('div');title.append(node('h3',a.name),node('p',a.busy?'Выполняет команду…':labels[a.state.status]||a.state.status,'state'));head.append(node('div',a.name[0],'avatar'),title);c.append(head);
    const stats=node('div',undefined,'stats');for(const [label,value,cls] of [['Здоровье',a.state.health,'health'],['Сытость',a.state.food,'food']]){const s=node('div'),l=node('div',undefined,'stat-label');l.append(node('span',label),node('span',value==null?'—':`${Math.round(value)} / 20`));const p=node('progress',undefined,cls);p.max=20;p.value=value||0;s.append(l,p);stats.append(s);}c.append(stats);
    const p=a.state.position;c.append(node('p',p?`X ${p.x.toFixed(1)}  Y ${p.y.toFixed(1)}  Z ${p.z.toFixed(1)}`:'Координаты появятся после входа','position'));
    c.append(node('p',a.error||a.survival?.reason||a.brain?.reason||'Готов к подключению и выбору задачи.','reason'));
    const controls=node('div',undefined,'controls');if(a.state.status==='disconnected')controls.append(button('Подключить',a.name,'connect'));else if(a.state.status==='dead')controls.append(button('Возродить',a.name,'respawn'));else controls.append(button('Начать',a.name,'start'),button('Пауза',a.name,'pause'));
    const inspect=node('button','Инвентарь');inspect.onclick=()=>{$('selected').value=a.name;inventory();};controls.append(inspect);if(a.state.status!=='disconnected')controls.append(button('Выйти',a.name,'disconnect','danger'));c.append(controls);$('agents').append(c);
  }
  inventory();$('log').replaceChildren();for(const e of state.log.slice(-30).reverse()){const row=node('div',undefined,'event');row.append(node('time',new Date(e.at).toLocaleTimeString('ru-RU')),node('b',e.name),node('span',`${e.event} · ${e.detail}`));$('log').append(row);}
}
async function refresh(){if(updating)return;updating=true;try{const response=await fetch('/api/state');if(!response.ok)throw new Error();state=await response.json();token=state.token;render();$('lamp').className='online';$('connection').textContent='Панель на связи';}catch{$('lamp').className='';$('connection').textContent='Нет связи с панелью';}finally{updating=false;}}
$('selected').onchange=inventory;$('connectAll').onclick=async()=>{for(const a of state?.agents||[])await command(a.name,'connect');};
$('setGoal').onclick=()=>command($('selected').value,'goal',{target:$('goal').value});
$('craft').onclick=()=>command($('selected').value,'action',{skill:'craft',args:{item:$('craftItem').value.trim(),count:Number($('craftCount').value)}});
$('give').onclick=()=>command($('selected').value,'give',{to:$('recipient').value,item:$('giftItem').value.trim(),count:1});
$('sendAction').onclick=()=>{try{void command($('selected').value,'action',JSON.parse($('action').value));}catch(e){$('feedback').textContent='Неверный JSON: '+e.message;}};
void refresh();setInterval(refresh,1000);
