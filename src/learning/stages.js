/** Reusable curriculum definitions. Training environments and live Minecraft remain distinct. */
export function headlessCurriculumStages() {
  return [
    {id:'wood-near',title:"Nearest Tree",task:'wood',size:6,maxSteps:48,hazards:0,resources:{tree:24}},
    {id:'wood-search',title:"Search for wood",task:'wood',size:12,maxSteps:120,hazards:0,resources:{tree:16}},
    {id:'wood-sparse',title:"Rare trees",task:'wood',size:18,maxSteps:180,hazards:0,resources:{tree:8}},
    {id:'wood-distance',title:"Further study",task:'wood',size:24,maxSteps:240,hazards:0,resources:{tree:6}},
    {id:'table',title:"Wood and crafting table",task:'table',size:12,maxSteps:160,hazards:0},
    {id:'wood-pickaxe',title:"Wooden pickaxe",task:'wood_pickaxe',size:12,maxSteps:200,hazards:0},
    {id:'cobblestone',title:"First Stone",task:'cobblestone',size:12,maxSteps:240,hazards:0},
    {id:'stone-pickaxe',title:"Stone pickaxe",task:'stone',size:12,maxSteps:280,hazards:0},
    {id:'furnace',title:"Crafting table, tools and furnace",task:'furnace',size:12,maxSteps:360,hazards:0},
    {id:'raw-iron',title:"Iron mining",task:'raw_iron',size:14,maxSteps:400,hazards:0},
    {id:'iron-smelting',title:"Iron preparation and smelting",task:'iron_ingot',size:14,maxSteps:440,hazards:0},
    {id:'iron-pickaxe',title:"Iron pickaxe",task:'iron_pickaxe',size:14,maxSteps:480,hazards:0},
    {id:'diamond-first',title:"First diamond",task:'diamond',size:12,maxSteps:520,hazards:0},
    {id:'diamond-search',title:"Diamond on the big map",task:'diamond',size:20,maxSteps:640,hazards:0},
    {id:'diamond-sparse',title:"Rare resources",task:'diamond',size:20,maxSteps:720,hazards:0,resources:{tree:8,stone:16,iron:5,diamond:2}},
    {id:'wood-hazards',title:"Tree Among Risks",task:'wood',size:16,maxSteps:200,hazards:4},
    {id:'stone-hazards',title:"Stone tools among hazards",task:'stone',size:16,maxSteps:440,hazards:6},
    {id:'iron-hazards',title:"Iron pickaxe with hazards",task:'iron_pickaxe',size:18,maxSteps:640,hazards:8},
    {id:'diamond-hazards',title:"Risk Diamond",task:'diamond',size:20,maxSteps:800,hazards:10},
    {id:'diamond-transfer',title:"A Large World With Rare Resources",task:'diamond',size:28,maxSteps:1000,hazards:12,resources:{tree:8,stone:18,iron:6,diamond:3}}
  ].map(s=>({...s,resources:{...(s.resources||{})}}));
}

/** All live targets are satisfied by observed inventory; no item grants, teleports or commands. */
export function minecraftCurriculumStages({tier='stone'}={}) {
  if(!['wood','stone','iron','diamond'].includes(tier))throw new Error('Live curriculum tier: wood/stone/iron/diamond');
  const groups={
    wood:[
      ['logs',"Gather wood by class",{'#logs':4}],
      ['table',"Create a Wrestle",{crafting_table:1}],
      ['wood-pickaxe',"Create a wooden pick",{wooden_pickaxe:1}]
    ],
    stone:[
      ['cobblestone',"Get a rock with the right tool",{cobblestone:4}],
      ['stone-pickaxe',"Create a Stone pickaxe",{stone_pickaxe:1}],
      ['furnace',"Prepare the furnace",{furnace:1}]
    ],
    iron:[
      ['shield',"Create Shield",{shield:1}],
      ['iron-pickaxe',"Get iron, to melt and build a brick",{iron_pickaxe:1}],
      ['iron-sword',"Create an iron sword",{iron_sword:1}],
      ['iron-chestplate',"Create iron breast",{iron_chestplate:1}],
      ['iron-helmet',"Create an iron helmet",{iron_helmet:1}],
      ['iron-leggings',"Create iron-powders",{iron_leggings:1}],
      ['iron-boots',"Create iron shoes",{iron_boots:1}],
      ['bucket',"Create Pail",{bucket:1}]
    ],
    diamond:[
      ['diamond-pickaxe',"Create Diamond pickaxe",{diamond_pickaxe:1}],
      ['diamond-sword',"Create Diamond Sword",{diamond_sword:1}],
      ['diamond-chestplate',"Create diamond breast-bread",{diamond_chestplate:1}],
      ['diamond-helmet',"Create Diamond helmet",{diamond_helmet:1}],
      ['diamond-leggings',"Create Diamond Feeds",{diamond_leggings:1}],
      ['diamond-boots',"Create diamond shoes",{diamond_boots:1}]
    ]
  };
  const tiers=['wood','stone','iron','diamond'];return tiers.slice(0,tiers.indexOf(tier)+1).flatMap(level=>groups[level].map(([id,title,targets])=>({id,title,tier:level,targets:Object.fromEntries(Object.entries(targets).map(([id,n])=>[id.startsWith('#')?id:`minecraft:${id}`,n])),timeoutMs:level==='diamond'?900000:level==='iron'?600000:240000})));
}
