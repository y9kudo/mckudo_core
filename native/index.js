import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {setImmediate as yieldTask} from 'node:timers/promises';
import {Transform} from 'node:stream';
import {isAir,isFullBlock,isHazard,planRouteAsync} from '../packages/omconnect/src/navigation.js';

const require=createRequire(import.meta.url);
export function loadNativeKernel({path=fileURLToPath(new URL('./build/om_kernel.node',import.meta.url))}={}){
  let kernel;try{kernel=require(path);}catch(error){throw new Error(`Cannot load the OvermindMC C kernel; run npm.cmd run native:build or supply a matching binary: ${error.message}`);}
  if(kernel.abi!==1||!['planRoute','planRouteAsync','denseForward','framePacket','readVarInt','writeVarInt'].every(n=>typeof kernel[n]==='function'))throw new Error('Unsupported native kernel ABI.');
  return kernel;
}

export class NativeFrameDecoder{
  constructor(kernel,{maxPacketBytes=2097151}={}){
    if(!Number.isInteger(maxPacketBytes)||maxPacketBytes<1||maxPacketBytes>2097151)throw new Error('Invalid native frame limit.');
    this.kernel=kernel;this.maxPacketBytes=maxPacketBytes;this.buffer=Buffer.alloc(0);
  }
  push(chunk){
    if(!(chunk instanceof Uint8Array)||chunk.length>this.maxPacketBytes+5)throw new Error('Invalid or oversized stream chunk.');
    this.buffer=Buffer.concat([this.buffer,chunk]);let offset=0;const frames=[];
    while(offset<this.buffer.length){
      const length=this.kernel.readVarInt(this.buffer.subarray(offset,offset+5));if(!length)break;
      if(length.value<1||length.value>this.maxPacketBytes)throw new Error('Invalid Minecraft packet length.');
      if(this.buffer.length-offset-length.bytes<length.value)break;
      frames.push(Buffer.from(this.buffer.subarray(offset+length.bytes,offset+length.bytes+length.value)));
      offset+=length.bytes+length.value;
    }
    this.buffer=Buffer.from(this.buffer.subarray(offset));
    if(this.buffer.length>this.maxPacketBytes+5)throw new Error('Native packet buffer limit exceeded.');return frames;
  }
}

/** Version schemas, compression and authentication remain protocol adapters. */
export function createNativeProtocolFactory({kernel=loadNativeKernel()}={}){
  const protocol=require('minecraft-protocol'),stats={framesSent:0,framesReceived:0};
  class NativeClient extends protocol.Client{
    constructor(...args){
      super(...args);
      const oldFramer=this.framer,oldSplitter=this.splitter;
      this.serializer.unpipe(oldFramer);oldSplitter.unpipe(this.deserializer);
      const decode=new NativeFrameDecoder(kernel);
      this.framer=new Transform({transform(chunk,encoding,callback){try{this.push(kernel.framePacket(chunk));stats.framesSent++;callback();}catch(error){callback(error);}}});
      this.splitter=new Transform({transform(chunk,encoding,callback){try{for(const frame of decode.push(chunk)){this.push(frame);stats.framesReceived++;}callback();}catch(error){callback(error);}}});
      this.serializer.pipe(this.framer);this.splitter.pipe(this.deserializer);
      oldFramer.destroy();oldSplitter.destroy();
    }
  }
  const create=options=>protocol.createClient({...options,Client:NativeClient});create.snapshot=()=>({...stats});return create;
}

/** Static ground geometry only. Dynamic edits and learned scoring use the JS implementation. */
export function createNativeNavigationBackend({kernel=loadNativeKernel(),maxVoxels=450000}={}){
  if(!Number.isInteger(maxVoxels)||maxVoxels<64||maxVoxels>450000)throw new Error('maxVoxels must be 64–450000.');
  const stats={native:0,fallback:0};
  return {
    kind:'C/Node-API',abi:1,
    snapshot:()=>({...stats}),
    async planGroundAsync(options,scheduling={}){
      options.signal?.throwIfAborted();
      const fallback=()=>{stats.fallback++;return planRouteAsync(options,scheduling);};
      if(options.goals||options.staticGeometry!==true||options.edgeCost||options.bridgeBudget||options.allowPartial||(options.maxDrop??3)>16)return fallback();
      const {start,goal,getBlock}=options;
      if(![start,goal].every(p=>p&&['x','y','z'].every(k=>Number.isInteger(p[k])&&Math.abs(p[k])<=30000000)))throw new Error('Native ground routes require integer start and goal positions.');
      const pad=6,maxDrop=options.maxDrop??3,origin={x:Math.min(start.x,goal.x)-pad,y:Math.min(start.y,goal.y)-maxDrop-2,z:Math.min(start.z,goal.z)-pad};
      const maxDistance=options.maxDistance??128;
      if(Math.max(...['x','y','z'].map(k=>Math.abs(start[k]-goal[k])))>maxDistance+(options.range??0))return fallback();
      const dims=[Math.abs(goal.x-start.x)+pad*2+1,Math.abs(goal.y-start.y)+maxDrop+6,Math.abs(goal.z-start.z)+pad*2+1],volume=dims.reduce((n,v)=>n*v,1);
      if(volume>maxVoxels||dims[0]>256||dims[1]>512||dims[2]>256)return fallback();
      const revision=scheduling.getRevision?.(),grid=new Uint8Array(volume);let i=0;
      if(revision===false)throw new Error('The native route read view is stale.');
      for(let y=0;y<dims[1];y++)for(let z=0;z<dims[2];z++)for(let x=0;x<dims[0];x++){
        if((i&255)===0){options.signal?.throwIfAborted();if(scheduling.getRevision&&scheduling.getRevision()!==revision)throw new Error('The world changed while capturing native route geometry.');await yieldTask();}
        const p={x:x+origin.x,y:y+origin.y,z:z+origin.z},b=getBlock(p);
        grid[i++]=Math.max(...['x','y','z'].map(k=>Math.abs(p[k]-start[k])))>maxDistance||!b?0:isHazard(b)||options.occupied?.(p)?3:isAir(b)?1:isFullBlock(b)?2:0;
      }
      const relative=p=>Int32Array.from(['x','y','z'],k=>p[k]-origin[k]);
      const f=options.fallPolicy??{};let result;
      try{result=await kernel.planRouteAsync(grid,Uint32Array.from(dims),relative(start),relative(goal),Float64Array.from([options.range??0,options.maxNodes??12000,maxDrop,f.health??20,f.minHealthAfter??6,f.maxDamage??6]));}
      catch(error){if(/Native route queue is full/.test(error.message))return fallback();throw error;}
      options.signal?.throwIfAborted();
      if(scheduling.getRevision&&scheduling.getRevision()!==revision)throw new Error('The world changed during native route search.');
      if(result.code!=='PLANNED')return fallback();
      const steps=[];let last=start,fallDamage=0;
      for(let i=0;i<result.path.length;i+=4){const p={x:result.path[i]+origin.x,y:result.path[i+1]+origin.y,z:result.path[i+2]+origin.z};fallDamage+=Math.max(0,last.y-p.y-3);steps.push({position:p,kind:['','walk','jump','drop'][result.path[i+3]]});last=p;}
      stats.native++;return {status:'planned',reason:'C route through observed static terrain.',steps,visited:result.visited,cost:result.cost,bridgeUsed:0,fallDamage,unknown:[]};
    }
  };
}
