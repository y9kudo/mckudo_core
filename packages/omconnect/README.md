# OMConnect

**Independent Minecraft Java client · Version Arthas · `1.0.0-Arthas-beta1` · Created by y9kudo · MIT.**

This checkout is the Arthas dev.3 development build. Build its independent installation archive with `npm.cmd pack --ignore-scripts` from this directory.

OMConnect connects agents to Java servers, records authoritative world/inventory observations and executes actions through ordinary protocol packets. It includes collision/medium physics, containers, equipment, protection and player tracking. It does not import Mineflayer or the OvermindMC planning kernel.

OMVectorize supplies ground routes, swimming, body clearance and elytra trajectory calculations. OvermindMC can use the client as its execution layer, or your application can use OMConnect independently.

## Install a local build

Use Node.js 24. Build `omconnect-1.0.0-Arthas-beta1.tgz`, copy it to your application's folder and run:

```powershell
npm.cmd install .\omconnect-1.0.0-Arthas-beta1.tgz
```

Installation resolves dependencies through npm. Publication of this development build is separate from building the archive; the package is not published to the npm registry.

Add `"type": "module"` to your application's `package.json`.

```js
import { createOMConnect } from 'omconnect';

const client = createOMConnect({
  host: '127.0.0.1', port: 25565,
  username: 'Atlas', version: '1.21.1', auth: 'offline'
});

try {
  await client.connect();
  console.log(client.observe());
  await client.execute({ skill: 'gather', args: { block: '#logs', count: 1 } });
} finally {
  client.close();
}
```

This gathers a reachable member of the observed logs class. It is not an autonomous survival planner. Actions can fail because terrain is unknown, a region is protected, an item is unavailable or the server does not confirm a transaction.

## Versions and authentication

Native high-level profiles cover Java **1.21/1.21.1**, with live tests on **1.21.1**. The version API exposes transport/catalog availability separately from native actions. All 30 installed transport families pass movement codec round trips; that does not certify every action on every server version. A separately supplied 26.3 profile is experimental.

```js
import { createVersionAPI, versionSupport, detectServerVersion } from 'omconnect';
console.log(versionSupport('1.16.5'));
const api = createVersionAPI('1.16.5');
console.log(api.capabilities());
```

Registered version profiles can provide alternate registries, transports, chunk decoders and packet adapters. An unknown profile is rejected before gameplay rather than silently using another version.

Offline authentication requires a server that permits it. Microsoft authentication uses a device-code flow and a Minecraft-owning account. The authentication cache is local and must not be published. [Authentication](docs/AUTHENTICATION.md).

## Actions and observations

The public client includes navigation, gathering and mining, crafting, smelting, equipment, storage inspection/transfers, signs, combat, portals and flight helpers. Server updates confirm inventory and block changes; sending a click is not proof of success. [API](docs/API.md) · [Crafting and movement](docs/CRAFTING-MOVEMENT.md) · [Action failures](docs/ACTION-FAILURES.md).

Regions and observed building evidence restrict excavation. A bounded section index shares voxel reads between resource selectors and invalidates edited chunks. Smooth route heading remains stable on descents. [Protection](docs/PROTECTION.md) · [Physics](docs/PHYSICS.md) · [Vectorize](docs/VECTORIZE.md).

Ground routes include supported jumps/descents and verified bridges. Unknown chunks are never treated as air. Flight and portal actions require the relevant observed equipment, geometry and confirmations. [Flight and storage](docs/FLIGHT-AND-STORAGE.md) · [Fall rescue](docs/FALL-RESCUE.md) · [Dragon combat](docs/DRAGON-COMBAT.md).

## Development

```powershell
npm.cmd ci
npm.cmd test
```

The full repository additionally checks public TypeScript declarations, packed-package imports and documentation links. Release archives exclude world data, account caches and raw local logs.

[License](LICENSE) · [Changelog](CHANGELOG.md).
