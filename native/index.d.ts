import type {RoutePlan,RouteScheduling,GroundNavigationBackend} from '../packages/omconnect/index.js';
export interface NativeRouteResult {code:'PLANNED'|'NO_PATH'|'START_UNSUPPORTED'|'SEARCH_BUDGET'|'INVALID_INPUT'|'NO_MEMORY';visited:number;cost:number;path:Int32Array;}
export interface NativeKernel {
  readonly abi:1;readonly language:'C';readonly author:'y9kudo';
  planRoute(grid:Uint8Array,dimensions:Uint32Array,start:Int32Array,goal:Int32Array,options:Float64Array):NativeRouteResult;
  planRouteAsync(grid:Uint8Array,dimensions:Uint32Array,start:Int32Array,goal:Int32Array,options:Float64Array):Promise<NativeRouteResult>;
  writeVarInt(value:number):Buffer;readVarInt(bytes:Uint8Array):{value:number;bytes:number}|null;
  framePacket(payload:Uint8Array):Buffer;
  denseForward(input:Float32Array,weights:Float32Array,shape:Uint32Array):Float32Array;
}
export declare function loadNativeKernel(options?:{path?:string}):NativeKernel;
export declare class NativeFrameDecoder {
  constructor(kernel:NativeKernel,options?:{maxPacketBytes?:number});
  push(chunk:Uint8Array):Buffer[];
}
export declare function createNativeProtocolFactory(options?:{kernel?:NativeKernel}):((options:Record<string,unknown>)=>any)&{snapshot():{framesSent:number;framesReceived:number}};
export declare function createNativeNavigationBackend(options?:{kernel?:NativeKernel;maxVoxels?:number}):GroundNavigationBackend&{kind:'C/Node-API';abi:1;snapshot():{native:number;fallback:number}};
