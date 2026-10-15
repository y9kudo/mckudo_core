# Computation boundaries: JavaScript, C and Java

OvermindMC uses different runtimes where there is a concrete integration or measurement benefit. Language count is not an intelligence metric. A planner still needs correct observations, mechanics, goals, learning data and result checks.

| Runtime | Implemented role | Execution boundary |
| --- | --- | --- |
| JavaScript / Node.js | Public agent API, OMConnect, recipes, scenarios, dashboard, training and risk models | Existing applications and headless protocol agents |
| C / Node-API | Optional static ground search, framing/VarInts and bounded dense inference | Copied typed arrays; asynchronous search; explicit opt-in and JS fallback |
| Java 21 | YourMind Fabric client, immutable voxel routes and crafting dependencies | Vanilla controls/physics/networking, client-thread world capture and one route worker |
| Python | Optional TinyCC build driver | Development tool only; not a dependency of a running agent |

YourMind is a separate **client execution target** under `mods/yourmind`. It does not replace OMConnect, run the JavaScript kernel inside Minecraft, or accelerate every existing Node.js agent automatically. Its command/recipe/route classes have no Minecraft imports and can be tested independently; Fabric-facing classes perform actual client interactions. See the [installation, commands and code map](../mods/yourmind/README.md).

The optional C ground kernel already has a measured benefit on its bounded fixture. One repeat on this Windows/Node 24.19.0 workstation measured a median **9.58 ms in JS and 1.76 ms in C**, with **9.83 ms** for the first native adapter call including terrain capture. These figures exclude full gameplay and cannot predict network, furnace, inventory or end-to-end expedition speed. See [native computation](NATIVE-COMPUTE.md) for the exact boundary and reproduction commands.

YourMind provides a Java fixture runner:

```powershell
cd mods/yourmind
.\gradlew.bat benchmarkNavigation
```

It checks the route cost, warms up the JVM, then reports median/p95/p99 for forty runs on the same 48×6×48 wall geometry used by the existing native benchmark. World capture and game ticks are excluded. Different planner implementations, runtimes, compilers and garbage collectors still need careful interpretation; the result is a fixture measurement, not a promise that Java outperforms C or JavaScript on every workload.

## Resource and responsiveness budgets

YourMind snapshots loaded terrain in slices capped by a two-millisecond wall-clock deadline, checked every 64 reads, and a maximum of 4096 reads per tick. This is cooperative yielding rather than a hard real-time guarantee. Search receives immutable collision bytes, not the live world. One daemon worker runs a bounded 18,000-expansion search. Interruption cancels obsolete jobs; observed collision and support are rechecked before movement. Vanilla remains responsible for tick cadence and physics.

The existing Node native adapter copies typed arrays, bounds queue depth and rejects stale/cancelled routes. Learned/custom edge scoring, excavation, bridges and fluids retain the JS planner. Its benchmark does not justify disabling these capabilities by default.

Do not start a Python interpreter on each physics tick or promise GPU acceleration without a model and a measured workload. Larger training jobs can become optional local workers later, with explicit CPU/memory limits and versioned model formats. The current change adds a real Java client target and retains the existing C backend; it does not introduce an unmeasured GPU dependency or a new trained neural model.
