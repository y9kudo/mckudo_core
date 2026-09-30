/** Equip owned armor before ordinary gathering. Higher material tier wins; no invented items. */
export function createEquipmentReactor(){
  const parts={head:'helmet',chest:'chestplate',legs:'leggings',feet:'boots'},tiers=['leather','golden','chainmail','iron','diamond','netherite'];
  const score=item=>tiers.indexOf(String(item||'').replace(/^minecraft:/,'').split('_')[0]);
  return {id:'mckudo:equipment',apiVersion:1,react(o){
    for(const [slot,suffix]of Object.entries(parts)){
      const equipped=o.equipment?.[slot]?.item,best=Object.entries(o.inventory||{}).filter(([item,n])=>n>0&&item.endsWith('_'+suffix)).sort(([a],[b])=>score(b)-score(a))[0]?.[0];
      if(best&&score(best)>score(equipped))return {priority:850,action:{skill:'equipArmor',args:{item:best}},reason:'Надеть лучшую доступную броню.'};
    }
    return {action:null,reason:'Лучшая доступная броня уже надета.'};
  }};
}

export function unequippedTargets(client,targets={}){
  const result={...targets};
  for(const item of Object.values(client.inventory.equipment?.()||{}))if(item){const key=Object.hasOwn(result,item.item)?item.item:item.name;if(result[key])result[key]=Math.max(0,result[key]-item.count);}
  return result;
}

/** Preserve ingredients for unfinished equipment; make only actual surplus shareable. */
export function equipmentTradeTargets(client,targets={}){
  const result={...targets},costs={helmet:5,chestplate:8,leggings:7,boots:4,pickaxe:3,axe:3,sword:2};
  let diamonds=0;
  for(const [item,amount]of Object.entries(targets)){
    const name=item.replace(/^minecraft:/,''),cost=costs[name.replace(/^diamond_/,'')];
    if(!name.startsWith('diamond_')||!cost)continue;
    const owned=client.inventory.ownedCount?.(name)??client.inventory.count(name);
    diamonds+=Math.max(0,amount-owned)*cost;
  }
  if(diamonds)result['minecraft:diamond']=Math.max(result['minecraft:diamond']||0,diamonds);
  return result;
}
