import * as THREE from '/vendor/three.module.js';

const colors={tree:0x84a86c,ore:0xc7a36b,ground:0x8f8268,solid:0xa1aaa8,storage:0xb88c55,liquid:0x4385a6};
const routeColors={walk:0x7ce5c2,jump:0xf5d078,drop:0xa2b9fa,bridge:0xffa85f,dig:0xf28181};
const faces={east:([x,y,z],[X,Y,Z])=>[[X,y,Z],[X,y,z],[X,Y,z],[X,Y,Z]],west:([x,y,z],[X,Y,Z])=>[[x,y,z],[x,y,Z],[x,Y,Z],[x,Y,z]],up:([x,y,z],[X,Y,Z])=>[[x,Y,Z],[X,Y,Z],[X,Y,z],[x,Y,z]],down:([x,y,z],[X,Y,Z])=>[[x,y,z],[X,y,z],[X,y,Z],[x,y,Z]],south:([x,y,z],[X,Y,Z])=>[[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]],north:([x,y,z],[X,Y,Z])=>[[X,y,z],[x,y,z],[x,Y,z],[X,Y,z]]};
const point=p=>new THREE.Vector3(p.x,p.y,p.z);
function disposeGroup(group){for(const child of [...group.children]){if(child.isInstancedMesh)child.dispose();child.geometry?.dispose();if(child.userData.ownedMaterial)child.material?.dispose();group.remove(child);}}

export class Vision3D {
  constructor(canvas,{onInspect=()=>{},onStatus=()=>{},onMode=()=>{}}={}){
    this.canvas=canvas;this.onInspect=onInspect;this.onStatus=onStatus;this.onMode=onMode;this.active=false;this.mode='orbit';this.distance=26;this.azimuth=.7;this.polar=.95;this.pan=new THREE.Vector3();this.origin=new THREE.Vector3();this.materials=new Map();this.textureRevision=-1;this.meshKey='';
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'low-power'});this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x101920);this.scene.fog=new THREE.Fog(0x101920,65,130);
    this.camera=new THREE.PerspectiveCamera(60,1,.05,220);this.agentCamera=new THREE.PerspectiveCamera(80,1.4,.1,12);
    this.scene.add(new THREE.HemisphereLight(0xd7edff,0x58654b,2));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(12,25,8);this.scene.add(sun);
    this.world=new THREE.Group();this.overlays=new THREE.Group();this.entityGroup=new THREE.Group();this.gaze=new THREE.CameraHelper(this.agentCamera);this.gaze.material.transparent=true;this.gaze.material.opacity=.4;
    this.scene.add(this.world,this.overlays,this.entityGroup,this.gaze);
    this.selfGroup=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(.55,1.2,.3),new THREE.MeshLambertMaterial({color:0x71cbb1}));body.position.y=.6;this.head=new THREE.Mesh(new THREE.BoxGeometry(.48,.48,.48),new THREE.MeshLambertMaterial({color:0xe6d6b8}));this.head.position.y=1.48;this.selfGroup.add(body,this.head);this.scene.add(this.selfGroup);
    this.selection=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(),new THREE.Vector3(1,1,1)),0xffffff);this.selection.visible=false;this.scene.add(this.selection);
    this.raycaster=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.drag=null;
    canvas.addEventListener('pointerdown',event=>{this.drag={x:event.clientX,y:event.clientY,moved:0};canvas.setPointerCapture(event.pointerId);});
    canvas.addEventListener('pointermove',event=>{if(!this.drag)return;const dx=event.clientX-this.drag.x,dy=event.clientY-this.drag.y;this.drag.moved+=Math.abs(dx)+Math.abs(dy);this.drag.x=event.clientX;this.drag.y=event.clientY;if(event.shiftKey)this.pan.add(new THREE.Vector3(-dx,0,-dy).multiplyScalar(this.distance/450));else{this.azimuth-=dx*.007;this.polar=Math.max(.12,Math.min(1.55,this.polar+dy*.007));}this.mode='orbit';this.onMode('orbit');});
    canvas.addEventListener('pointerup',event=>{if(this.drag?.moved<5)this.inspect(event);this.drag=null;});
    canvas.addEventListener('pointercancel',()=>{this.drag=null;});
    canvas.addEventListener('wheel',event=>{event.preventDefault();this.distance=Math.max(3,Math.min(100,this.distance*Math.exp(event.deltaY*.001)));},{passive:false});
    this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(canvas);this.fit();
    this.tick=()=>{this.frame=requestAnimationFrame(this.tick);if(!this.active||!this.snapshot)return;
      const s=this.snapshot.self,target=point(s.position).sub(this.origin);if(this.selfGroup.position.distanceTo(target)>16)this.selfGroup.position.copy(target);else this.selfGroup.position.lerp(target,.3);
      this.selfGroup.rotation.y=-s.yaw*Math.PI/180;this.head.rotation.x=-s.pitch*Math.PI/180;
      const eye=this.selfGroup.position.clone().add(new THREE.Vector3(0,1.62,0)),yaw=s.yaw*Math.PI/180,pitch=s.pitch*Math.PI/180,view=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),-Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch));
      this.agentCamera.position.copy(eye);this.agentCamera.lookAt(eye.clone().add(view));this.agentCamera.updateMatrixWorld();this.gaze.update();
      if(this.mode==='eyes'){this.camera.position.copy(eye);this.camera.lookAt(eye.clone().add(view));this.selfGroup.visible=false;}else{
        this.selfGroup.visible=true;const look=eye.clone().add(this.pan);
        if(this.mode==='follow'){this.camera.position.copy(eye).addScaledVector(view,-6).add(new THREE.Vector3(0,3,0));this.camera.lookAt(eye.clone().addScaledVector(view,3));}
        else{this.camera.position.copy(look).add(new THREE.Vector3(Math.sin(this.azimuth)*Math.sin(this.polar),Math.cos(this.polar),Math.cos(this.azimuth)*Math.sin(this.polar)).multiplyScalar(this.distance));this.camera.lookAt(look);}
      }
      this.gaze.visible=this.showGaze!==false&&this.mode!=='eyes';this.overlays.visible=this.showRoute!==false;this.entityGroup.visible=this.showEntities!==false;this.renderer.render(this.scene,this.camera);
    };this.tick();
  }
  fit(){const box=this.canvas.getBoundingClientRect();if(box.width<1||box.height<1)return;this.renderer.setSize(box.width,box.height,false);this.camera.aspect=box.width/box.height;this.camera.updateProjectionMatrix();}
  reset(){this.distance=26;this.azimuth=.7;this.polar=.95;this.pan.set(0,0,0);this.mode='orbit';}
  setActive(value){this.active=value;if(value)this.fit();}
  material(texture,tint,category){
    const key=[this.textureRevision,texture,tint,category==='liquid'].join('/');if(this.materials.has(key))return this.materials.get(key);
    const material=new THREE.MeshLambertMaterial({color:texture?(tint?0x92b96b:0xffffff):(colors[category]||0x9ba8b0),alphaTest:.15,transparent:category==='liquid',opacity:category==='liquid' ? .65 : 1,side:THREE.DoubleSide}),revision=this.textureRevision;
    if(texture){new THREE.TextureLoader().load('/api/textures/'+encodeURIComponent(texture)+'.png?r='+revision,map=>{if(this.disposed||revision!==this.textureRevision){map.dispose();return;}map.magFilter=THREE.NearestFilter;map.minFilter=THREE.NearestMipmapNearestFilter;map.colorSpace=THREE.SRGBColorSpace;if(map.image.height>map.image.width){map.repeat.y=map.image.width/map.image.height;map.offset.y=1-map.repeat.y;}material.map=map;material.needsUpdate=true;},undefined,()=>{if(!this.disposed&&revision===this.textureRevision)material.color.setHex(colors[category]||0x9ba8b0);});}
    this.materials.set(key,material);return material;
  }
  geometry(block){
    let models=block.model?.models||[];
    if(!models.length){const shapes=block.shapes?.length?block.shapes:[[0,0,0,1,block.category==='liquid' ? .88 : 1,1]];models=[{elements:shapes.map(shape=>({from:shape.slice(0,3).map(v=>v*16),to:shape.slice(3).map(v=>v*16),faces:Object.fromEntries(Object.keys(faces).map(side=>[side,{texture:block.model?.fallback}]))}))}];}
    const positions=[],uvs=[],materials=[],groups=[];let vertex=0;
    for(const model of models)for(const element of model.elements){
      const from=element.from.map(v=>v/16),to=element.to.map(v=>v/16),modelRotation=new THREE.Euler(-(model.x||0)*Math.PI/180,-(model.y||0)*Math.PI/180,0,'YXZ');
      for(const [side,face]of Object.entries(element.faces||{})){
        if(!faces[side])continue;const material=this.material(face.texture,face.tint,block.category);let materialIndex=materials.indexOf(material);if(materialIndex<0){materialIndex=materials.length;materials.push(material);}
        const corners=faces[side](from,to).map(p=>{
          const v=new THREE.Vector3(...p),rotation=element.rotation;
          if(rotation&&['x','y','z'].includes(rotation.axis)&&Array.isArray(rotation.origin)){const origin=new THREE.Vector3(...rotation.origin.map(n=>n/16)),axis=new THREE.Vector3(rotation.axis==='x'?1:0,rotation.axis==='y'?1:0,rotation.axis==='z'?1:0);v.sub(origin).applyAxisAngle(axis,(Number(rotation.angle)||0)*Math.PI/180).add(origin);}
          return v.subScalar(.5).applyEuler(modelRotation).addScalar(.5);
        });
        const [u,v,U,V]=(face.uv||[0,0,16,16]).map(value=>value/16),uv=[[u,1-V],[U,1-V],[U,1-v],[u,1-v]],shift=((face.rotation||0)/90)%4;
        for(const index of [0,1,2,0,2,3]){positions.push(...corners[index].toArray());uvs.push(...uv[(index+shift)%4]);}
        groups.push({start:vertex,count:6,materialIndex});vertex+=6;
      }
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();for(const group of groups)geometry.addGroup(group.start,group.count,group.materialIndex);return {geometry,materials};
  }
  update(snapshot){
    this.snapshot=snapshot;const origin=point(snapshot.center);if(this.textureRevision!==snapshot.textures.revision){for(const material of this.materials.values()){material.map?.dispose();material.dispose();}this.materials.clear();this.textureRevision=snapshot.textures.revision;this.meshKey='';}
    const key=snapshot.signature+'/'+this.textureRevision;
    this.origin.copy(origin);
    if(key!==this.meshKey){
      disposeGroup(this.world);this.meshKey=key;this.selection.visible=false;
      const byPalette=new Map();for(const block of snapshot.blocks){if(!byPalette.has(block[3]))byPalette.set(block[3],[]);byPalette.get(block[3]).push(block);}
      const matrix=new THREE.Matrix4();for(const [index,blocks]of byPalette){const descriptor=snapshot.palette[index],{geometry,materials}=this.geometry(descriptor);if(!materials.length){geometry.dispose();continue;}const mesh=new THREE.InstancedMesh(geometry,materials,blocks.length);blocks.forEach((block,i)=>mesh.setMatrixAt(i,matrix.makeTranslation(block[0],block[1],block[2])));mesh.computeBoundingSphere();mesh.userData={blocks,descriptor};this.world.add(mesh);}
    }
    disposeGroup(this.overlays);disposeGroup(this.entityGroup);
    const line=(points,color)=>{const geometry=new THREE.BufferGeometry().setFromPoints(points),material=new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.9}),mesh=new THREE.Line(geometry,material);mesh.renderOrder=10;mesh.userData.ownedMaterial=true;this.overlays.add(mesh);};
    const steps=snapshot.route?.steps||[];
    for(let i=1;i<steps.length;i++){const a=point(steps[i-1].position).sub(origin).add(new THREE.Vector3(.5,.15,.5)),b=point(steps[i].position).sub(origin).add(new THREE.Vector3(.5,.15,.5));line([a,b],i<(snapshot.route.index||0)?0x53766d:routeColors[steps[i].kind]||0x7ce5c2);}
    for(const waypoint of [...(snapshot.waypoints||[]),...(snapshot.target?[{title:'Current target',position:snapshot.target,target:true}]:[])]){
      if(!waypoint.position||!['x','y','z'].every(k=>Number.isFinite(waypoint.position[k])))continue;
      const marker=new THREE.Mesh(new THREE.OctahedronGeometry(waypoint.target ? .35 : .2),new THREE.MeshBasicMaterial({color:waypoint.target?0xffca78:0xafbaff,depthTest:false}));marker.position.copy(point(waypoint.position).sub(origin)).add(new THREE.Vector3(.5,.5,.5));marker.userData.ownedMaterial=true;marker.renderOrder=11;this.overlays.add(marker);line([marker.position,marker.position.clone().add(new THREE.Vector3(0,2,0))],waypoint.target?0xffca78:0xafbaff);
    }
    for(const region of snapshot.protectedRegions||[]){const box=new THREE.Box3(point(region.min).sub(origin),point(region.max).sub(origin).addScalar(1)),helper=new THREE.Box3Helper(box,0xd99da7);helper.userData.ownedMaterial=true;this.overlays.add(helper);}
    for(const entity of snapshot.entities){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,entity.kind==='player'?1.8:.7,.5),new THREE.MeshLambertMaterial({color:entity.kind==='player'?0xe4be85:0xd3939b,transparent:true,opacity:.8}));mesh.position.copy(point(entity.position).sub(origin)).add(new THREE.Vector3(0,entity.kind==='player' ? .9 : .35,0));mesh.userData.ownedMaterial=true;this.entityGroup.add(mesh);}
    this.onStatus({blocks:snapshot.blocks.length,entities:snapshot.entities.length,waypoints:steps.length,textures:snapshot.textures.textures,truncated:snapshot.truncated});
  }
  inspect(event){
    const rect=this.canvas.getBoundingClientRect();this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);this.raycaster.setFromCamera(this.pointer,this.camera);const hit=this.raycaster.intersectObjects(this.world.children,false)[0];if(!hit||hit.instanceId===undefined)return;
    const mesh=hit.object,block=mesh.userData.blocks[hit.instanceId],position={x:this.origin.x+block[0],y:this.origin.y+block[1],z:this.origin.z+block[2]};this.selection.box.set(point(position).sub(this.origin),point(position).sub(this.origin).addScalar(1));this.selection.visible=true;this.onInspect({position,...mesh.userData.descriptor});
  }
  dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();disposeGroup(this.world);disposeGroup(this.overlays);disposeGroup(this.entityGroup);for(const child of this.selfGroup.children){child.geometry.dispose();child.material.dispose();}this.selection.dispose();this.gaze.dispose();for(const material of this.materials.values()){material.map?.dispose();material.dispose();}this.renderer.dispose();}
}
