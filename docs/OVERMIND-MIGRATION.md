# Migrating to OvermindMC

The project has three public components, authored by **y9kudo** under **MIT**:

| Previous name | Current name | Responsibility |
| --- | --- | --- |
| MCKudo Core | OvermindMC | Goals, resources, planning, learning, memory and cooperation |
| KudoConnect | OMConnect | Java transport, world observations, inventory, physics and action execution |
| KudoVectorize | OMVectorize | Ground routes, swimming, body clearance and elytra trajectories |

The GitHub repository URL remains `y9kudo/mckudo_core`; the source package and public APIs have been renamed. The new package names describe this checkout. Publication to the npm registry is a separate step, so use a local package installation until an actual npm release is available.

## Update imports

```js
import { OVERMIND, OvermindCore, createMinecraftAgent } from 'overmindmc';
import { OMConnect, createOMConnect, OMCONNECT } from 'overmindmc/connect';
import { OMVectorize, OMVECTORIZE } from 'overmindmc/vectorize';
import { createOMAdapter } from 'overmindmc/adapters/omconnect';
import { createPPO, createSAC } from 'overmindmc/intelligence';
```

The canonical root files are `overmindmc.js` and `overmindmc.d.ts`. The standalone client lives in `packages/omconnect/`; the bundled forwarding entry is `omconnect/index.js`. The client remains independent of the planning kernel and does not import Mineflayer.

The old local `mckudo_core.js` entry is retained as a compatibility export for `MckudoCore` and `MCKUDO`. The client also retains deprecated JavaScript aliases for its previous client/vectorize names. New code and TypeScript declarations use the canonical OM names.

## Install from this checkout

```powershell
# In the library checkout:
npm.cmd ci

# In your own application's folder; replace this path:
npm.cmd install C:\path\to\mckudo_core
```

Now import `overmindmc`, `overmindmc/connect` or `overmindmc/intelligence` in your application. To use only the independent client, install `C:\path\to\mckudo_core\packages\omconnect` and import `omconnect` instead.

The CLI executable is `overmindmc`. Its generated JSON schema path points at `node_modules/overmindmc/schemas/agent.schema.json`. Local dashboard control headers now use `X-Overmind-Token`, `X-Overmind-Name` and `X-Overmind-Filename`. The agent observation contract is `omconnect.agent`; kernel reactor identifiers use the `overmind:` namespace.

## Keep world identity stable

Back up existing memory before migration. Keep the same `worldId` only when connecting to the same world and server. A new test world needs a new identity. Older reactor statistics may use the previous namespace; start a separate memory directory when comparing versions instead of mixing benchmark histories.

Policy checkpoints have their own feature/action schemas. Renaming the project does not convert a 22×12 skill model into an 18×9 physical model. Keep both dimensions and schema identifiers when loading a checkpoint.

## Historical 0.1.0

[The original 0.1.0 archive](https://github.com/y9kudo/mckudo_core/tree/archive/mckudo-0.1.0) preserves its bytes, MIT license, author and original language. It is an historical package rather than a supported modern release. Its SHA-256 is `1faf331e496af4ddca02e3ed7c64ba7080f3c82d54bd13d06c7c192cb4bc33ca`.
