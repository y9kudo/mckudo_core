# Native C computation

The Arthas development branch includes an optional C kernel. JavaScript remains the application API, scenario language and adapter layer. This is the first phase of the native migration: neither the entire brain nor the complete network client has been rewritten in C.

## Implemented boundaries

| Component | C implementation | Current boundary |
| --- | --- | --- |
| OMVectorize ground search | Bounded A*, diagonal clearance, one-block jumps, health-aware falls | Known dry full-block terrain; excavation, bridges, swimming, partial routes and learned edge costs use the existing planner. |
| OMConnect wire framing | Signed VarInts, packet length prefixes, fragmented/coalesced input | Version schemas, authentication, compression, encryption, TCP, inventory, world state and physics remain protocol adapters in JavaScript. |
| Numerical inference | Float32 tanh network forward pass | Explicit API only; not automatically attached to the planning-risk networks. Backpropagation and optimizers remain JavaScript. |

`native/om_kernel.c` and `native/om_kernel.h` expose a portable C ABI. `native/node_binding.c` supplies the Node-API bridge. Async search copies input arrays, runs outside the event loop and has a two-job queue. Unknown voxels remain unknown. The JS adapter rechecks cancellation and world revision after native work; obsolete routes are rejected.

## Build explicitly

Install dependencies, then obtain Node headers matching the running Node version from the [official Node distribution](https://nodejs.org/dist/). Verify them using that release's `SHASUMS256.txt`. Use an existing C compiler and supply paths without changing system settings.

For GCC on Linux:

```sh
npm run native:build -- --cc=gcc --node-include=/path/to/node-v24.19.0/include/node
OM_REQUIRE_NATIVE=1 npm run test:native
```

For MSVC from its developer terminal on Windows, use the corresponding official `win-x64/node.lib`:

```powershell
npm.cmd run native:build -- --cc=cl --node-include=C:\toolchain\include\node --node-lib=C:\toolchain\node.lib
$env:OM_REQUIRE_NATIVE = '1'
npm.cmd run test:native
```

The script also accepts TinyCC and `zig cc`. Its default paths refer to an optional local `.cache/native-toolchain/` setup; a fresh checkout must provide its own compiler and headers. Windows may reject older compiler executables; use a compatible compiler rather than changing security settings.

If an existing trusted TinyCC executable cannot start on Windows but its shared library loads, the optional Python build driver uses the documented [libtcc API](https://bellard.org/tcc/tcc-doc.html#Libtcc). This tool compiles the same C sources; Python is not required by the agent at runtime:

```powershell
python scripts/build-native-tcc.py --library=C:\toolchain\tcc\libtcc.dll --node-include=C:\toolchain\include\node
```

The resulting file is `native/build/om_kernel.node`. Local binaries and toolchain downloads are excluded from Git and installation archives. An absent binary does not prevent normal JS operation; explicitly loading the C backend produces a clear build error. CI is configured to build and require native tests on Linux with Node 22 and 24. Local Windows checks are separate evidence.

## Use from JavaScript

```js
import {createOMConnect} from 'overmindmc/connect';
import {createNativeNavigationBackend,createNativeProtocolFactory} from 'overmindmc/native';

const navigation = createNativeNavigationBackend();
const protocol = createNativeProtocolFactory();
const client = createOMConnect({
  host:'127.0.0.1', port:25566, username:'AtlasNative',
  auth:'offline', version:'1.21.1'
}, {navigationBackend:navigation, createProtocolClient:protocol});
await client.connect();
```

`navigation.snapshot()` reports successful C routes and JS fallbacks. `protocol.snapshot()` counts C-framed packets. The live framing path has been exercised on Java 1.21.1; it is not evidence of native compatibility with every supported transport family.

For the full expedition launcher:

```powershell
$env:MC_NATIVE = '1'
npm.cmd run expedition:full
```

Learned navigation scoring remains enabled by default and therefore uses the JS route fallback. Setting `MC_NAVIGATION_LEARNING=0` tests static C routing while retaining saved navigation weights; planning-risk learning continues. This switch does not enable a C learning algorithm.

## Measure the actual workload first

For a running expedition report:

```powershell
npm.cmd run expedition:profile -- data/full-expedition/report.json
```

The output separates observation, reactors, execution, physics and the route scheduler. It includes process memory and CPU sampling when the current launcher recorded them. CPU percent is relative to one core; it is not a configured CPU limit. Phase durations are wall-clock measurements. An execution time that includes waiting for a furnace or a server packet must not be interpreted as expensive arithmetic.

Use a CPU profiler and representative workloads before replacing an implementation. Compare average and p95/p99 latency, memory, startup and bridge-copy costs. Keep navigation cancellation, unknown-voxel handling, protected regions, server corrections and deterministic test fixtures identical.

## Reproduce the search benchmark

```powershell
npm.cmd run benchmark:native
```

The benchmark saves its fixture, equal route costs, sample counts and timings under `data/native-benchmark/`. One Windows run with TinyCC and Node 24.19.0 measured median **9.01 ms in JS versus 1.92 ms in C** on a prepacked 13,824-voxel fixture. Its first adapter call, including geometry capture, took **7.84 ms**. This is a small search benchmark, not a claim that the whole agent or network runs 4.7 times faster. Compiler options, warmup, terrain and JS/C copying change results.

Node's [Node-API](https://nodejs.org/api/n-api.html) provides a C API for native addons and ABI compatibility across supported Node versions. Its asynchronous work API can execute native work away from the main event loop. External libraries can impose their own compatibility requirements. Native builds require a compiler or matching prebuilt binaries.

A Python backend should be a bounded local worker, not a Python process launched for each physics tick. Model changes should be versioned and validated before use. The default JavaScript implementation must remain available when Python, native binaries or a GPU are absent.

Optional Python training workers and a wider C migration remain future work. Online risk networks and DQN/PPO/SAC training currently run in JavaScript. Stable Arthas 1.0.0 still requires a reviewed autonomous Dragon victory.
