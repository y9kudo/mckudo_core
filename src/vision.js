const category=name=>{
  if(!name)return 'unknown';
  if(/(?:water|lava)$/.test(name))return 'liquid';
  if(/(?:leaves|log|stem|wood)$/.test(name))return 'tree';
  if(/(?:ore|ancient_debris)$/.test(name))return 'ore';
  if(/(?:chest|barrel|shulker_box)$/.test(name))return 'storage';
  if(/(?:grass|dirt|sand|gravel|snow)$/.test(name))return 'ground';
  return 'solid';
};

/** This is a map of received chunk data, not a rendered client image. */
export function createVisionSnapshot(client,{radius=12,down=8,up=6}={}){
  if(!Number.isInteger(radius)||radius<2||radius>24||!Number.isInteger(down)||down<1||down>32||!Number.isInteger(up)||up<1||up>16)throw new Error('Обзор: radius 2–24, down 1–32, up 1–16.');
  const self=client.state.position;if(!self)return {status:'waiting',radius,cells:[],entities:[]};
  const cx=Math.floor(self.x),cy=Math.floor(self.y),cz=Math.floor(self.z),cells=[];
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
    const x=cx+dx,z=cz+dz;
    if(!client.world.columnAt({x,z})){cells.push({dx,dz,known:false,name:null,y:null,category:'unknown'});continue;}
    let found=null;
    for(let y=cy+up;y>=cy-down;y--){
      const b=client.world.blockAt({x,y,z});
      if(!b){found={known:false,name:null,y:null,category:'unknown'};break;}
      if(!['air','cave_air','void_air'].includes(b.name)){found={known:true,name:'minecraft:'+b.name,y,category:category(b.name)};break;}
    }
    cells.push({dx,dz,...(found||{known:true,name:'minecraft:air',y:null,category:'air'})});
  }
  const entities=[...client.entities.values()].filter(e=>e.position&&Math.abs(e.position.x-self.x)<=radius&&Math.abs(e.position.z-self.z)<=radius)
    .slice(0,128).map(e=>({name:e.name,kind:e.kind,dx:e.position.x-self.x,dz:e.position.z-self.z,dy:e.position.y-self.y}));
  return {status:'ready',dimension:client.state.dimension,center:{x:cx,y:cy,z:cz},yaw:client.state.yaw,pitch:client.state.pitch,radius,loadedChunks:client.world.columns.size,requestedViewDistance:client.options.viewDistance,cells,entities};
}
