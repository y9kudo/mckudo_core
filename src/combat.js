import { createDefenseReactor } from './survival.js';
export { weaponProfile, chooseWeapon, combatDecision } from '../packages/kudoconnect/src/combat.js';

export function createCombatReactor(options = {}) {
  const ignoredEntities = options.ignoredEntities ?? ['ender_dragon'];
  if (!Array.isArray(ignoredEntities) || ignoredEntities.some(n => typeof n !== 'string')) throw new Error('ignoredEntities: список имён сущностей.');
  const defense = createDefenseReactor(options);
  const clock=options.clock??Date.now,failed=new Map();let latest=null,selected=null;
  const distance=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):Infinity;
  const reactor={ id: 'mckudo:combat', apiVersion: 1, preempt: true, failureScope:'action',
    react(observation) {
      latest=observation;
      const entities=observation.entities?.filter(e=>{
        if(ignoredEntities.includes(e.name))return false;
        const f=failed.get(String(e.id));if(!f)return true;
        const newHit=(observation.combat?.attackers||[]).some(a=>String(a.entityId)===String(e.id)&&a.lastHitAt>f.at);
        if(clock()>=f.until||f.dimension!==observation.dimension||newHit||distance(f.target,e.position)>=2||distance(f.self,observation.self?.position)>=2){failed.delete(String(e.id));return true;}
        return observation.self?.health==null||observation.self.health<=(options.retreatHealth??8)||e.name==='creeper';
      });
      const response = defense.react({ ...observation, entities });
      selected=response.action?{ skill: 'combat', args: { ...response.action.args, allowPlayer: options.attackPlayers === true, retreatHealth: options.retreatHealth ?? 8, durationMs: 400 } }:null;
      const threat=selected&&entities?.find(e=>String(e.id)===String(selected.args.entityId));
      if(options.pathRetreat===true&&threat?.position&&(observation.self?.health==null||observation.self.health<=(options.retreatHealth??8)||threat.name==='creeper'))selected={skill:'evade',args:{from:{...threat.position},entityId:String(threat.id)}};
      return selected?{ ...response, priority: 990, action:selected }:response;
    },
    recordResult(result,action=selected){
      if(!action||!['combat','evade'].includes(action.skill)||result.outcome!=='failure')return;
      const entity=latest?.entities?.find(e=>String(e.id)===String(action.args.entityId));
      failed.set(String(action.args.entityId),{at:clock(),until:clock()+5000,dimension:latest?.dimension,self:latest?.self?.position?{...latest.self.position}:null,target:entity?.position?{...entity.position}:null});
      while(failed.size>64)failed.delete(failed.keys().next().value);
    },
    attach(core){
      let current=null;
      const start=d=>{current=d.id===reactor.id?d.action:null;};
      const finish=e=>{if(e.rule===reactor.id&&current)reactor.recordResult(e,current);current=null;};
      core.on('action:start',start);core.on('action:finish',finish);
      return ()=>{core.off('action:start',start);core.off('action:finish',finish);};
    }
  };return reactor;
}
