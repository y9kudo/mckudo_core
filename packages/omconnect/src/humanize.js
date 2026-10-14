/** Optional, low-priority environmental attention. It never interrupts a task. */
export class OMHumanize{
  constructor(client,{random=Math.random,clock=Date.now}={}){this.client=client;this.random=random;this.clock=clock;this.nextAt=0;this.last={status:'idle',target:null};}
  tick(){
    const c=this.client;
    if(!c.options.humanizeMode||!c.state.position){this.last={status:'disabled',target:null};return;}
    if(c.pending||c.look.target||c.attention.leases.size||this.clock()<this.nextAt)return;
    const p=c.state.position,entities=[...c.entities.values()].filter(e=>e.name!=='enderman'&&e.position&&Math.hypot(e.position.x-p.x,e.position.y-p.y,e.position.z-p.z)<12);
    const chosen=entities.length&&this.random()<.45?entities[Math.floor(this.random()*entities.length)]:null;
    const angle=(c.state.yaw+(this.random()-.5)*95)*Math.PI/180,distance=3+this.random()*6;
    const target=chosen?{x:chosen.position.x,y:chosen.position.y+Math.min(1.2,chosen.eyeHeight||1),z:chosen.position.z}:
      {x:p.x-Math.sin(angle)*distance,y:p.y+1.5+(this.random()-.5)*1.6,z:p.z+Math.cos(angle)*distance};
    c.lookAt(target,{turnSpeed:140+this.random()*140});
    this.last={status:chosen?'entity':'environment',target:chosen?.name||target,at:this.clock()};
    this.nextAt=this.clock()+1500+this.random()*3000;
  }
}
