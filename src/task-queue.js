import {jsonCopy} from './config.js';
import {validateScenario} from './scenario.js';

export function validateTasks(input,{skills=[]}={}){
  const tasks=jsonCopy(input,'tasks',60000),ids=new Set();
  if(!Array.isArray(tasks)||tasks.length>32)throw new Error('Очередь: от 0 до 32 задач.');
  for(const t of tasks){
    if(!t||typeof t!=='object')throw new Error('Задача должна быть объектом.');
    const allowed=['id','title','type',t.type==='action'?'action':'scenario'];
    if(!t||Object.keys(t).some(k=>!allowed.includes(k))||typeof t.id!=='string'||!/^[a-z0-9_-]{1,64}$/.test(t.id)||ids.has(t.id)||typeof t.title!=='string'||!t.title.trim()||t.title.length>100)throw new Error('Задаче нужны уникальный id и название до 100 символов.');
    ids.add(t.id);
    if(t.type==='scenario')t.scenario=validateScenario(t.scenario);
    else if(t.type==='action'){
      if(!t.action||Object.keys(t.action).some(k=>!['skill','args'].includes(k))||!skills.includes(t.action.skill)||!t.action.args||typeof t.action.args!=='object'||Array.isArray(t.action.args))throw new Error('Действие: известный skill и объект args.');
    }else throw new Error('Тип задачи: action или scenario.');
  }return tasks;
}

/** Sequential tasks are a reactor. Completion follows the executor, never a UI click. */
export function createTaskQueue({tasks=[],skills=[],scenarioFactory,resume}={}){
  const definition=validateTasks(tasks,{skills}),states=definition.map(t=>({id:t.id,status:'pending',reason:''}));
  if(resume)for(const s of states){const old=resume.find(r=>r.id===s.id);if(old?.status==='completed')s.status='completed';}
  const controllers=new Map(),failures=new Map();let active=null;
  const reactor={id:'mckudo:tasks',apiVersion:1,react(o){
    if(active)return {action:null,reason:'Ожидание результата текущего действия.'};
    for(let i=0;i<definition.length;i++){
      const task=definition[i],state=states[i];if(state.status==='completed')continue;
      if(state.status==='failed')return {action:null,reason:state.reason};
      let decision;
      if(task.type==='action')decision={action:task.action,priority:20,reason:task.title};
      else{
        if(!controllers.has(task.id))controllers.set(task.id,scenarioFactory(task.scenario));
        const controller=controllers.get(task.id);decision=controller.reactor.react(o);
        if(controller.snapshot().status==='completed'){state.status='completed';continue;}
      }
      state.status=decision.action?'running':'blocked';state.reason=decision.reason||'';
      return decision;
    }return {action:null,reason:'Очередь выполнена.'};
  }};
  return {reactor,definition:()=>jsonCopy(definition),snapshot:()=>jsonCopy(states),
    retry(id){const state=states.find(s=>s.id===id);if(!state)throw new Error('Неизвестная задача.');if(active)throw new Error('Сначала останови текущее действие.');state.status='pending';state.reason='';controllers.delete(id);failures.delete(id);},
    attach(brain){
      const start=e=>{if(e.id===reactor.id){const index=states.findIndex(s=>s.status!=='completed');active={index,action:e.action};}};
      const finish=e=>{if(e.rule!==reactor.id||!active)return;const {index,action}=active;active=null;const state=states[index],task=definition[index];controllers.get(task.id)?.recordResult?.(e,action);
        if(e.outcome==='success'){failures.delete(task.id);state.status=task.type==='action'?'completed':'pending';}
        else if(e.outcome==='failure'){const count=(failures.get(task.id)||0)+1;failures.set(task.id,count);state.status=task.type==='scenario'&&count<6?'blocked':'failed';state.reason=String(e.detail||'Действие завершилось ошибкой.');}
        else state.status='pending';};
      brain.on('action:start',start);brain.on('action:finish',finish);return()=>{brain.off('action:start',start);brain.off('action:finish',finish);};
    }
  };
}
