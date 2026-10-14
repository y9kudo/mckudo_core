import {loadNativeKernel,createNativeNavigationBackend,createNativeProtocolFactory,NativeFrameDecoder} from 'overmindmc/native';
import {createOMConnect} from 'overmindmc/connect';
const kernel=loadNativeKernel({path:'./native/build/om_kernel.node'});
const backend=createNativeNavigationBackend({kernel,maxVoxels:450000});
const protocol=createNativeProtocolFactory({kernel});
createOMConnect({username:'AtlasNative'},{navigationBackend:backend,createProtocolClient:protocol});
const output:Float32Array=kernel.denseForward(new Float32Array(2),new Float32Array(17),new Uint32Array([2,4,1]));
const frames:Buffer[]=new NativeFrameDecoder(kernel).push(new Uint8Array([1,0]));
void output;void frames;void backend.snapshot();void protocol.snapshot();
