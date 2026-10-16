const element=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const copy=value=>JSON.parse(JSON.stringify(value));
const titles={resources:'Gather resources',navigate:'Move to a waypoint',action:'Use a skill',sequence:'Sequence',parallel:'Parallel goals',if:'If / else',repeat:'Repeat',until:'Repeat until',scenario:'Game scenario'};
const nested=node=>node.type==='if'?['then','else']:['sequence','parallel','repeat','until'].includes(node.type)?['children']:[];
const uid=()=> 'block-'+crypto.randomUUID().slice(0,8);
export const emptyProgram=()=>({schemaVersion:1,name:'My agent program',nodes:[]});
export function tasksToProgram(tasks=[]){
  if(tasks.some(t=>['dependsOn','requires','expected','priorityWhen','retry','timeoutMs','resumePolicy'].some(key=>t[key]!==undefined)))throw new Error('Dependency queues retain their policies in JSON mode.');
  if(tasks.length===1&&tasks[0].type==='program')return copy(tasks[0].program);
  let serial=0;
  const rename=nodes=>nodes.map(value=>{const node={...copy(value),id:'imported-'+(++serial)};for(const key of nested(node))node[key]=rename(node[key]||[]);return node;});
  const convert=task=>({id:'imported-'+(++serial),title:task.title,priority:task.priority||0,...(task.type==='program'?{type:'sequence',children:rename(task.program.nodes)}:task.type==='scenario'?{type:'scenario',scenario:copy(task.scenario)}:{type:'action',action:copy(task.action)})});
  const sequential=tasks.filter(task=>task.mode!=='parallel').map(convert),parallel=tasks.filter(task=>task.mode==='parallel').map(convert);
  return {schemaVersion:1,name:'My agent program',nodes:parallel.length?[{id:'imported-parallel',type:'parallel',title:'Existing task queue',children:[...(sequential.length?[{id:'imported-sequence',type:'sequence',title:'Sequential tasks',children:sequential}]:[]),...parallel]}]:sequential};
}
function validateShape(value){
  if(!value||value.schemaVersion!==1||!Array.isArray(value.nodes)||typeof value.name!=='string')throw new Error('Expected a program with schemaVersion: 1, a name and nodes: [].');
  if(JSON.stringify(value).length>60000)throw new Error('Program exceeds 60 KB.');
  const ids=new Set();let count=0;
  const visit=(nodes,depth)=>{if(!Array.isArray(nodes)||nodes.length>64||depth>8)throw new Error('Program nesting is limited to 8 levels and 64 blocks per group.');for(const node of nodes){if(++count>128||!node||!Object.hasOwn(titles,node.type)||typeof node.id!=='string'||ids.has(node.id))throw new Error('Use at most 128 blocks, known types and unique IDs.');ids.add(node.id);for(const key of nested(node))visit(node[key]||[],depth+1);}};
  visit(value.nodes,0);
}
export function programSource(program){if(Array.isArray(program))throw new Error('Export dependency queues as JSON and run them with createAgentManager.');return `import { createMinecraftAgent } from 'overmindmc';\n\nconst agent = createMinecraftAgent({\n  name: 'Atlas', worldId: 'my-survival-world',\n  connection: { host: '127.0.0.1', port: 25565, version: '1.21.1', auth: 'offline' }\n});\n\nconst program = ${JSON.stringify(program,null,2)};\n\ntry {\n  await agent.runProgram(program, { timeoutMs: 1800000 });\n} finally {\n  await agent.close();\n}\n`;}

export class ProgramBuilder {
  constructor(root,{onChange=()=>{},onMessage=()=>{}}={}){
    this.root=root;this.onChange=onChange;this.onMessage=onMessage;this.value=emptyProgram();this.selected=null;this.statuses=new Map();this.dragged=null;
    this.palette=element('div',undefined,'builder-palette');this.tree=element('div',undefined,'builder-tree');this.inspector=element('div',undefined,'builder-inspector');root.classList.add('program-builder');root.replaceChildren(this.palette,this.tree,this.inspector);
    this.palette.append(element('h3','Add a block'),element('p','Click to add. Drag blocks to change their order.','muted'));
    for(const [type,title]of Object.entries(titles)){const button=element('button',title);button.type='button';button.dataset.addBlock=type;button.onclick=()=>this.add(type);this.palette.append(button);}
    this.palette.append(element('p','Parallel goals share one physical executor. Defense can interrupt the program.','muted'));this.choices=element('datalist');this.choices.id='program-resource-choices';this.palette.append(this.choices);this.setCatalog([]);this.render();
  }
  setCatalog(items){const values=[{id:'#logs',name:'Any available tree trunk'},{id:'#planks',name:'Any wooden planks'},...items];this.choices.replaceChildren(...values.map(item=>{const option=element('option');option.value=item.id;option.label=item.name;return option;}));}
  document(){return copy(this.value);}
  load(value){validateShape(value);this.value=copy(value);this.selected=null;this.render();}
  updateStates(snapshot){this.statuses=new Map((snapshot?.nodes||[]).map(node=>[node.id,node]));for(const row of this.tree.querySelectorAll('[data-node]')){const status=this.statuses.get(row.dataset.node);row.dataset.status=status?.status||'pending';const badge=row.querySelector('.block-status');if(badge)badge.textContent=status?.status||'';}}
  find(id,nodes=this.value.nodes,parent=null,key='nodes'){for(let index=0;index<nodes.length;index++){const node=nodes[index];if(node.id===id)return {node,nodes,index,parent,key};for(const childKey of nested(node)){const result=this.find(id,node[childKey]||[],node,childKey);if(result)return result;}}return null;}
  changed(){this.onChange(this.document());this.render();}
  add(type,preset={}){
    const node={id:uid(),type,title:titles[type]};
    if(type==='resources')node.targets={'#logs':4};
    if(type==='navigate')Object.assign(node,{position:{x:0,y:64,z:0},range:1,bridge:true,excavate:false});
    if(type==='action')node.action={skill:'wait',args:{durationMs:1000}};
    if(type==='scenario')node.scenario={schemaVersion:1,name:'Build a Nether portal',steps:[{id:'portal',type:'netherPortal'}]};
    if(['sequence','parallel','repeat','until'].includes(type))node.children=[];
    if(type==='repeat')node.count=3;
    if(type==='until'){node.condition={fact:'/inventory/minecraft:oak_log',gte:4};node.maxIterations=8;}
    if(type==='if'){node.condition={fact:'/self/health',lt:10};node.then=[];node.else=[];}
    Object.assign(node,preset);
    const selected=this.find(this.selected),container=selected&&nested(selected.node)[0];
    (container?selected.node[container]:this.value.nodes).push(node);this.selected=node.id;this.changed();
  }
  move(id,targetId,position='before',branch){
    const source=this.find(id),target=targetId?this.find(targetId):null;if(!source||id===targetId)return;
    const contains=node=>node.id===targetId||nested(node).some(key=>(node[key]||[]).some(contains));if(target&&contains(source.node))throw new Error('A block cannot contain itself.');
    const value=source.node;source.nodes.splice(source.index,1);
    if(position==='inside'&&target){target.node[branch||nested(target.node)[0]].push(value);}else if(target){const next=this.find(targetId);next.nodes.splice(next.index+(position==='after'?1:0),0,value);}else this.value.nodes.push(value);
    this.selected=id;this.changed();
  }
  render(){
    this.tree.replaceChildren();const title=element('input');title.value=this.value.name;title.setAttribute('aria-label','Program name');title.onchange=()=>{this.value.name=title.value;this.changed();};this.tree.append(title);
    const renderList=(nodes,parent=null,key='nodes')=>{
      const list=element('div',undefined,'block-list');
      const drop=(before=null)=>{const zone=element('div',undefined,'drop-zone');zone.ondragover=event=>{event.preventDefault();zone.classList.add('drag-over');};zone.ondragleave=()=>zone.classList.remove('drag-over');zone.ondrop=event=>{event.preventDefault();event.stopPropagation();try{const id=event.dataTransfer.getData('text/plain');if(before)this.move(id,before);else if(parent)this.move(id,parent.id,'inside',key);else this.move(id,null);}catch(error){this.onMessage(error.message);}};return zone;};
      nodes.forEach((node,index)=>{
        list.append(drop(node.id));const row=element('article',undefined,'program-block');row.dataset.node=node.id;row.dataset.status=this.statuses.get(node.id)?.status||'pending';row.classList.toggle('selected',node.id===this.selected);
        const head=element('div',undefined,'program-block-head'),handle=element('button','⠿','drag-handle');handle.type='button';handle.draggable=true;handle.setAttribute('aria-label','Drag '+(node.title||node.type));handle.ondragstart=event=>event.dataTransfer.setData('text/plain',node.id);
        const label=element('button',node.title||titles[node.type]||node.type,'block-label');label.onclick=()=>{this.selected=node.id;this.render();};
        head.append(handle,element('span',titles[node.type]||node.type,'block-type'),label,element('small',this.statuses.get(node.id)?.status||'','block-status'));
        for(const [text,delta]of [['↑',-1],['↓',1]]){const button=element('button',text);button.disabled=index+delta<0||index+delta>=nodes.length;button.setAttribute('aria-label',delta<0?'Move block up':'Move block down');button.onclick=()=>{[nodes[index],nodes[index+delta]]=[nodes[index+delta],nodes[index]];this.changed();};head.append(button);}
        const remove=element('button','×');remove.setAttribute('aria-label','Remove '+(node.title||node.type));remove.onclick=()=>{nodes.splice(index,1);if(this.selected===node.id)this.selected=null;this.changed();};head.append(remove);row.append(head);
        if(node.type==='resources')row.append(element('p',Object.entries(node.targets||{}).map(([item,count])=>count+' × '+item).join(' · '),'block-summary'));
        if(node.type==='navigate')row.append(element('p',[node.position?.x,node.position?.y,node.position?.z].join(' / '),'block-summary'));
        if(node.type==='action')row.append(element('p',node.action?.skill||'Select a skill','block-summary'));
        for(const childKey of nested(node)){const group=element('div',undefined,'block-branch');group.append(element('small',childKey==='then'?'WHEN TRUE':childKey==='else'?'OTHERWISE':node.type==='repeat'?`REPEAT ${node.count} TIMES`:node.type==='until'?`UNTIL CONDITION · LIMIT ${node.maxIterations}`:node.type==='parallel'?'INTERLEAVED GOALS':'IN ORDER'));if(!(node[childKey]||[]).length)group.append(element('p','Drop blocks here, or select this group and add one.','muted'));group.append(renderList(node[childKey]||[],node,childKey));row.append(group);}
        list.append(row);
      });list.append(drop());return list;
    };
    if(!this.value.nodes.length)this.tree.append(element('p','Start with “Gather resources”, then add tools, waypoints or a condition.','empty'));
    this.tree.append(renderList(this.value.nodes));this.renderInspector();
  }
  renderInspector(){
    this.inspector.replaceChildren();const selected=this.find(this.selected);if(!selected){this.inspector.append(element('h3','Block settings'),element('p','Select a block to change its goal, inputs or control flow.','muted'));return;}
    const node=selected.node;this.inspector.append(element('h3',titles[node.type]||node.type));
    const field=(title,value,onChange,type='text')=>{const label=element('label',title),input=element('input');input.type=type;input.value=value??'';input.onchange=()=>{onChange(type==='number'?Number(input.value):input.value);this.changed();};label.append(input);this.inspector.append(label);return input;};
    const select=(title,values,value,onChange)=>{const label=element('label',title),input=element('select');for(const [id,text]of values){const option=element('option',text);option.value=id;input.append(option);}input.value=value;input.onchange=()=>{onChange(input.value);this.changed();};label.append(input);this.inspector.append(label);return input;};
    field('Label',node.title||'',value=>node.title=value);
    if(node.type==='resources'){
      for(const [item,count]of Object.entries(node.targets||{})){const line=element('div',undefined,'resource-row'),name=element('input'),amount=element('input'),remove=element('button','×');name.value=item;name.setAttribute('aria-label','Item or class');name.setAttribute('list',this.choices.id);name.placeholder='Search items or choose a class';amount.type='number';amount.min='1';amount.max='4096';amount.value=count;amount.setAttribute('aria-label','Required count');name.onchange=()=>{const targets={...node.targets};delete targets[item];targets[name.value]=count;node.targets=targets;this.changed();};amount.onchange=()=>{node.targets[item]=Number(amount.value);this.changed();};remove.onclick=()=>{delete node.targets[item];this.changed();};line.append(name,amount,remove);this.inspector.append(line);}
      const add=element('button','+ Resource');add.onclick=()=>{node.targets['minecraft:stone_pickaxe']=1;this.changed();};this.inspector.append(add,element('p','Use #logs for any tree species, or minecraft:iron_pickaxe for an exact item. The core plans prerequisites.','muted'));
    }
    if(node.type==='navigate'){
      for(const axis of ['x','y','z'])field(axis.toUpperCase(),node.position?.[axis],value=>{node.position||={};node.position[axis]=value;},'number');
      field('Arrival range',node.range??1,value=>node.range=value,'number');
      for(const [key,title]of [['bridge','Allow bridges'],['excavate','Allow excavation under protection rules']]){const label=element('label',title,'check'),input=element('input');input.type='checkbox';input.checked=Boolean(node[key]);input.onchange=()=>{node[key]=input.checked;this.changed();};label.prepend(input);this.inspector.append(label);}
      this.inspector.append(element('p','You can also pick a block in the 3D preview and add a waypoint.','muted'));
    }
    if(node.type==='action'){
      const options={wait:['Wait',{durationMs:1000}],gather:['Gather blocks',{block:'#logs',count:1}],craft:['Craft an item',{item:'crafting_table',count:1}],ensureStation:['Prepare a workstation',{station:'crafting_table'}],smelt:['Smelt / cook',{input:'raw_iron',item:'iron_ingot',count:1,fuel:'coal',fuelCount:1}],eat:['Eat',{item:'bread'}],prepareBed:['Find or craft a bed',{}],sleep:['Sleep',{}],lootChest:['Take from a storage',{x:0,y:64,z:0,maxStacks:27}],creativeFly:['Fly in Creative',{x:0,y:80,z:0}],pillar:['Build upward',{count:5}]};
      if(!options[node.action.skill])options[node.action.skill]=[node.action.skill,node.action.args];
      select('Skill',Object.entries(options).map(([id,value])=>[id,value[0]]),node.action.skill,value=>node.action={skill:value,args:copy(options[value][1])});
      for(const [key,value]of Object.entries(node.action.args||{}))if(typeof value==='boolean')select(key,[['true','Yes'],['false','No']],String(value),next=>node.action.args[key]=next==='true');else if(['string','number'].includes(typeof value))field(key,value,next=>node.action.args[key]=next,typeof value==='number'?'number':'text');
    }
    if(node.type==='repeat')field('Number of repetitions',node.count,value=>node.count=value,'number');
    if(node.type==='until')field('Maximum iterations',node.maxIterations,value=>node.maxIterations=value,'number');
    if(['if','until'].includes(node.type)){
      const condition=node.condition||{},fact=condition.fact||'',operator=Object.keys(condition).find(key=>key!=='fact')||'lt';
      const kind=fact.startsWith('/inventory/')?'item':fact==='/self/health'?'health':fact==='/self/food'?'food':fact==='/time/isDay'?'day':fact==='/dimension'?'dimension':'custom';
      select('Observed condition',[['item','Inventory count'],['health','Health (0–20)'],['food','Food (0–20)'],['day','Day / night'],['dimension','Dimension'],['custom','Custom JSON condition']],kind,value=>{node.condition=value==='custom'?{all:[{fact:'/self/health',gt:0}]}:value==='item'?{fact:'/inventory/minecraft:oak_log',gte:4}:value==='day'?{fact:'/time/isDay',eq:false}:value==='dimension'?{fact:'/dimension',eq:'minecraft:the_nether'}:{fact:value==='food'?'/self/food':'/self/health',lt:10};});
      if(kind==='item')field('Exact item ID',fact.slice('/inventory/'.length).replace(/~1/g,'/').replace(/~0/g,'~'),value=>node.condition.fact='/inventory/'+value.replace(/~/g,'~0').replace(/\//g,'~1'));
      if(['item','health','food'].includes(kind)){select('Comparison',[['gte','At least'],['lt','Less than'],['eq','Equal to'],['gt','More than']],operator,value=>{node.condition={fact,[value]:condition[operator]??1};});field('Value',condition[operator],value=>node.condition[operator]=value,'number');}
      if(kind==='day')select('Time',[['true','Day'],['false','Night']],String(condition.eq),value=>node.condition.eq=value==='true');
      if(kind==='dimension')select('Dimension',[['minecraft:overworld','Overworld'],['minecraft:the_nether','Nether'],['minecraft:the_end','End']],condition.eq,value=>node.condition.eq=value);
      this.inspector.append(element('p','A condition reads the latest observation. Loops are bounded; an unmet condition reports its limit.','muted'));
    }
    if(node.type==='scenario'){
      const presets={portal:{schemaVersion:1,name:'Build a Nether portal',steps:[{id:'portal',type:'netherPortal'}]},nether:{schemaVersion:1,name:'Enter the Nether',steps:[{id:'travel',type:'travel',dimension:'minecraft:the_nether'}]},stronghold:{schemaVersion:1,name:'Find a stronghold',steps:[{id:'stronghold',type:'stronghold'}]},end:{schemaVersion:1,name:'Activate the End portal',steps:[{id:'end',type:'endPortal'}]},dragon:{schemaVersion:1,name:'Fight the Ender Dragon',steps:[{id:'dragon',type:'dragon'}]}};
      select('Scenario preset',[['portal','Build Nether portal'],['nether','Travel to Nether'],['stronghold','Find stronghold'],['end','Activate End portal'],['dragon','Fight Ender Dragon']],Object.keys(presets).find(key=>presets[key].steps[0].type===node.scenario?.steps?.[0]?.type)||'portal',value=>node.scenario=copy(presets[value]));
      this.inspector.append(element('p','Scenario blocks require the corresponding resources, reachable terrain and dimension. Inspect progress and failure reasons during execution.','muted'));
    }
    field('Priority adjustment',node.priority||0,value=>node.priority=value,'number');
    const advanced=element('details'),summary=element('summary','Advanced block JSON'),code=element('textarea');code.rows=9;code.value=JSON.stringify(node,null,2);code.spellcheck=false;code.setAttribute('aria-label','Advanced block JSON');code.onchange=()=>{try{const parsed=JSON.parse(code.value);if(parsed.id!==node.id)throw new Error('Keep the block ID unchanged.');selected.nodes[selected.index]=parsed;this.changed();}catch(error){this.onMessage(error.message);}};advanced.append(summary,code);this.inspector.append(advanced);
  }
}
