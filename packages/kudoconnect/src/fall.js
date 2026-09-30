/** Conservative Java fall estimate. Ordinary armor never reduces fall damage. */
export function assessFall({height,health=20,minHealthAfter=6,maxDamage=6,landing,slowFalling=false,sneaking=false}={}){
  if(![height,health,minHealthAfter,maxDamage].every(Number.isFinite)||height<0||health<0||minHealthAfter<0||maxDamage<0)throw new Error('Оценка падения: неотрицательные высота, здоровье и пределы.');
  const name=String(landing?.name||landing?.id||'').replace(/^minecraft:/,'');
  const result={height,landing:name||null,estimatedDamage:null,healthAfter:null,survivable:false,allowed:false,reason:''};
  if(!landing)return {...result,reason:'Место приземления ещё не наблюдается.'};
  if(/^(lava|fire|soul_fire|cactus|magma_block|powder_snow|sweet_berry_bush|water|bubble_column)$/.test(name))return {...result,reason:'Опасная поверхность или требуется отдельный контроллер приземления в жидкость.'};
  if(name==='slime_block'&&!sneaking)return {...result,estimatedDamage:0,healthAfter:health,survivable:true,reason:'Отскок слизи требует отдельной проверки следующего приземления.'};
  const full=landing.boundingBox==='block'&&(!landing.shapes||landing.shapes.some(s=>s.length===6&&s.every((n,i)=>n===(i<3?0:1))));
  if(!full)return {...result,reason:'Не подтверждена полная опора приземления.'};
  const multiplier=['hay_block','honey_block'].includes(name) ? 0.2 : 1;
  const damage=slowFalling?0:Math.max(0,Math.ceil((height-3)*multiplier));
  const healthAfter=health-damage,survivable=healthAfter>0,allowed=survivable&&healthAfter>=minHealthAfter&&damage<=maxDamage;
  return {...result,estimatedDamage:damage,healthAfter,survivable,allowed,reason:allowed?'Известное приземление оставляет запас здоровья.':!survivable?'Падение может быть смертельным.':'Недостаточный запас здоровья или превышен предел урона.'};
}
