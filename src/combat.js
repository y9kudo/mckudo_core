import { createDefenseReactor } from './survival.js';
import {shieldThreat} from '../packages/omconnect/src/shield-threats.js';
export { weaponProfile, chooseWeapon, combatDecision } from '../packages/omconnect/src/combat.js';

export function createCombatReactor(options = {}) {
  const ignoredEntities = options.ignoredEntities ?? ['ender_dragon'];
  if (!Array.isArray(ignoredEntities) || ignoredEntities.some(n => typeof n !== 'string')) throw new Error("ignoredEntities: List of names of entities.");
  const ranged=options.ranged??true,rangedDistance=options.rangedDistance??8;
  if(typeof ranged!=='boolean'||!Number.isFinite(rangedDistance)||rangedDistance<4||rangedDistance>24)throw new Error('Combat: ranged must be boolean and rangedDistance must be 4–24.');
  const defense = createDefenseReactor(options);
  const clock=options.clock??Date.now,failed=new Map(),rangedBlocked=new Map(),retreatBlocked=new Map(),waterAttempted=new Map();let latest=null,selected=null;
  const distance=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z):Infinity;
  const reactor={ id: 'overmind:combat', apiVersion: 1, preempt: true, failureScope:'action',
    react(observation) {
      latest=observation;
      const shieldAvailable=observation.self?.shield===true||observation.self?.shieldAvailable===true||(observation.inventory?.['minecraft:shield']||0)>0;
      if(shieldAvailable&&observation.self?.health>0&&!observation.self.shieldDisabled){
        const incoming=shieldThreat(observation.self,observation.entities??[]);
        if(incoming){selected={skill:'guard',args:{reactive:true,durationMs:2000}};return {priority:1000,action:selected,reason:incoming.anticipating?'Raise the shield before the observed aimed bow releases.':'Intercept an incoming projectile, independently of retaliation.'};}
      }
      for(const [id,block] of rangedBlocked)if(clock()>=block.until||block.dimension!==observation.dimension)rangedBlocked.delete(id);
      for(const [id,block] of retreatBlocked)if(clock()>=block.until||block.dimension!==observation.dimension||distance(block.self,observation.self?.position)>=3)retreatBlocked.delete(id);
      const entities=observation.entities?.filter(e=>{
        if(ignoredEntities.includes(e.name))return false;
        // A transient aim failure must not hide an immediately reachable hostile mob.
        const f=failed.get(String(e.id));if(!f)return true;
        if(e.kind!=='player'&&e.hostile===true&&e.visible===true&&distance(e.position,observation.self?.position)<=3.5&&f.transientAim)return true;
        const newHit=(observation.combat?.attackers||[]).some(a=>String(a.entityId)===String(e.id)&&a.lastHitAt>f.at);
        if(clock()>=f.until||f.dimension!==observation.dimension||newHit||distance(f.target,e.position)>=2||distance(f.self,observation.self?.position)>=2){failed.delete(String(e.id));return true;}
        return observation.self?.health==null||observation.self.health<=(options.retreatHealth??8)||e.name==='creeper';
      });
      const response = defense.react({ ...observation, entities });
      selected=response.action?{ skill: 'combat', args: { ...response.action.args, allowPlayer: options.attackPlayers === true, retreatHealth: options.retreatHealth ?? 8, durationMs: 400 } }:null;
      const threat=selected&&entities?.find(e=>String(e.id)===String(selected.args.entityId));
      const blockedRetreat=threat&&retreatBlocked.has(String(threat.id));
      const canShoot=ranged&&threat&&threat.blocking!==true&&!rangedBlocked.has(String(threat.id));
      if(canShoot&&threat?.visible===true&&observation.self?.health>(options.retreatHealth??8)&&distance(threat.position,observation.self.position)>=rangedDistance){
        const inventory=observation.inventory??{},weapon=inventory['minecraft:bow']?'bow':inventory['minecraft:crossbow']?'crossbow':null;
        if(weapon&&(inventory['minecraft:arrow']||inventory['minecraft:spectral_arrow']||inventory['minecraft:tipped_arrow']))selected={skill:'shoot',args:{entityId:String(threat.id),weapon,chargeTicks:20,allowPlayer:options.attackPlayers===true,minDistance:Math.max(3,rangedDistance-2),retreatHealth:options.retreatHealth??8}};
      }
      if(threat?.position&&observation.self?.health>(options.retreatHealth??8)&&threat.visible!==false){
        const flying=['ghast','phantom','blaze','vex'].includes(threat.name)||threat.position.y-observation.self.position.y>3;
        const weapon=canShoot?((observation.inventory?.['minecraft:bow']||0)>0?'bow':(observation.inventory?.['minecraft:crossbow']||0)>0?'crossbow':null):null;
        if(flying&&distance(threat.position,observation.self.position)>3.5){if(weapon&&(observation.inventory?.['minecraft:arrow']||observation.inventory?.['minecraft:spectral_arrow']||observation.inventory?.['minecraft:tipped_arrow']))selected={skill:'shoot',args:{entityId:String(threat.id),weapon,chargeTicks:20,allowPlayer:options.attackPlayers===true}};
          else if(options.pathRetreat===true)selected={skill:'evade',args:{from:{...threat.position},entityId:String(threat.id),seekCover:true,digEscape:true}};
          else selected=null;}
      }
      if(options.pathRetreat===true&&threat?.position&&(observation.self?.health==null||observation.self.health<=(options.retreatHealth??8)||threat.name==='creeper')){
        if(blockedRetreat)selected={...selected,args:{...selected.args,retreatHealth:0,critical:false}};
        else selected={skill:'evade',args:{from:{...threat.position},entityId:String(threat.id),seekCover:true,digEscape:true}};
      }
      if(threat?.name==='enderman'&&observation.dimension!=='minecraft:the_nether'&&(observation.inventory?.['minecraft:water_bucket']||0)>0&&clock()>=(waterAttempted.get(String(threat.id))||0))selected={skill:'waterGuard',args:{entityId:String(threat.id)}};
      return selected?{ ...response, priority: 990, action:selected }:{...response,action:null};
    },
    recordResult(result,action=selected){
      if(action?.skill==='waterGuard'){waterAttempted.set(String(action.args.entityId),clock()+10000);return;}
      if(!action||!['combat','evade','shoot'].includes(action.skill)||result.outcome!=='failure')return;
      if(action.skill==='shoot'){
        rangedBlocked.set(String(action.args.entityId),{until:clock()+1500,dimension:latest?.dimension});
        while(rangedBlocked.size>64)rangedBlocked.delete(rangedBlocked.keys().next().value);
        return;
      }
      if(action.skill==='evade'&&/No route|No known safe route found|Start position changed|route|path/i.test(result.detail||''))retreatBlocked.set(String(action.args.entityId),{until:clock()+1500,dimension:latest?.dimension,self:latest?.self?.position?{...latest.self.position}:null});
      const entity=latest?.entities?.find(e=>String(e.id)===String(action.args.entityId));
      failed.set(String(action.args.entityId),{at:clock(),until:clock()+5000,transientAim:/aim|turn|target moved/i.test(result.detail||''),dimension:latest?.dimension,self:latest?.self?.position?{...latest.self.position}:null,target:entity?.position?{...entity.position}:null});
      while(failed.size>64)failed.delete(failed.keys().next().value);
    },
    attach(core){
      reactor.managesRetries=true;
      let current=null;
      const start=d=>{current=d.id===reactor.id?d.action:null;};
      const finish=e=>{if(e.rule===reactor.id&&current)reactor.recordResult(e,current);current=null;};
      core.on('action:start',start);core.on('action:finish',finish);
      return ()=>{core.off('action:start',start);core.off('action:finish',finish);};
    }
  };return reactor;
}
