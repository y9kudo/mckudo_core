/** Conservative Java fall estimate. Ordinary armor never reduces fall damage. */
export function assessFall({height,health=20,minHealthAfter=6,maxDamage=6,landing,slowFalling=false,sneaking=false}={}){
  if(![height,health,minHealthAfter,maxDamage].every(Number.isFinite)||height<0||health<0||minHealthAfter<0||maxDamage<0)throw new Error("Impact assessment: Non-negative height, Health and limits.");
  const name=String(landing?.name||landing?.id||'').replace(/^minecraft:/,'');
  const result={height,landing:name||null,estimatedDamage:null,healthAfter:null,survivable:false,allowed:false,reason:''};
  if(!landing)return {...result,reason:"No landing site yet."};
  if(/^(lava|fire|soul_fire|cactus|magma_block|powder_snow|sweet_berry_bush|water|bubble_column)$/.test(name))return {...result,reason:"Dangerous surface or separate liquid landing controller required."};
  if(name==='slime_block'&&!sneaking)return {...result,estimatedDamage:0,healthAfter:health,survivable:true,reason:"The rebound of the mucus requires a separate verification of the next landing."};
  const full=landing.boundingBox==='block'&&(!landing.shapes||landing.shapes.some(s=>s.length===6&&s.every((n,i)=>n===(i<3?0:1))));
  if(!full)return {...result,reason:"Total landing support not confirmed."};
  const multiplier=['hay_block','honey_block'].includes(name) ? 0.2 : 1;
  const damage=slowFalling?0:Math.max(0,Math.ceil((height-3)*multiplier));
  const healthAfter=health-damage,survivable=healthAfter>0,allowed=survivable&&healthAfter>=minHealthAfter&&damage<=maxDamage;
  return {...result,estimatedDamage:damage,healthAfter,survivable,allowed,reason:allowed?"The known landing leaves a health reserve.":!survivable?"Falling can be fatal.":"Inadequate health or excess of damage."};
}
