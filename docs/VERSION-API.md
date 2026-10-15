# Minecraft version API

OMConnect separates four claims: **known data**, **installed transport**, **native actions** and **live verification**. A version appearing in a recipe catalog does not establish that inventory clicks, swimming or combat work on its server.

The [version lab](VERSION-LAB.md) records real server trials, including whether an empty-inventory agent actually collected cobblestone. Version metadata comes from the [official Minecraft launcher manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json); wire schemas come from the installed [PrismarineJS protocol package](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/README.md). Neither source alone verifies gameplay.

## Discover exact historical releases

```js
import {
  discoverOfficialJavaVersions,
  inspectOfficialJavaVersion
} from 'overmindmc/connect';

const releases = await discoverOfficialJavaVersions();
console.log(releases.length, releases.find(v => v.version === '1.20.4'));

const exact = await inspectOfficialJavaVersion('1.20.4');
console.log(exact.officialServer, exact.support);
```

`discoverOfficialJavaVersions()` includes release, old beta and old alpha IDs by default. Use `includeLegacy: false` for full releases only; `includeSnapshots: true` adds snapshots. Discovery is lazy and requires network access. `inspectOfficialJavaVersion()` fetches exact official metadata and reports whether Mojang offers a standalone server JAR. It does **not** install a transport or enable unsupported gameplay actions. A version is considered ready for an agent only after its connection, world decoding, recipes, inventory, movement and actions pass a real server trial.

## Inspect support before connecting

```js
import {
  versionSupport, listVersionSupport, createVersionAPI,
  detectServerVersion
} from 'overmindmc/connect';

console.log(versionSupport('1.16.5'));
console.table(listVersionSupport());

const api = createVersionAPI('1.16.5');
console.log(api.capabilities());
console.log(api.hasPacket('teleport_confirm'));
console.log(api.capabilities().blockDigging);
const registry = api.loadRegistry();
```

`versionSupport(version)` returns `known`, `protocol`, `catalog`, `transport`, `native` and `liveTested`. `createVersionAPI` rejects versions for which this installation has no wire schema. Capabilities are inspected from the installed protocol definitions, including movement, teleport confirmation, configuration and inventory format.

The installed transport declares 30 protocol families from Java 1.7 through 26.1, including 1.16.5, 1.18.2, 1.19.4, 1.20.4 and 1.21.1. Patch releases with the same known protocol can share a transport. Future releases are not silently assigned an older codec.

Automated tests serialize and deserialize normalized movement through every one of those 30 codecs. Native high-level actions currently use the 1.21/1.21.1 profiles; the live trial is on 1.21.1. Other families have a low-level transport/catalog API and require a complete action profile before being advertised as full agent support. The separately supplied 26.3 profile remains experimental.

## Detect the server version

```js
const server = await detectServerVersion({
  host: '127.0.0.1',
  port: 25565,
  timeoutMs: 5000
});
console.log(server.version, server.protocol, server.support);
```

This is a status probe, not an account login. It selects an installed schema by protocol number and reports the server's advertised name separately. A proxy's marketing version may differ from its wire protocol. Unknown protocols result in an explicit error.

For a supported native profile:

```js
import { createOMConnect } from 'overmindmc/connect';

const client = createOMConnect({
  host: '127.0.0.1', port: 25565,
  username: 'Atlas', auth: 'offline',
  version: server.version
});
await client.connect();
console.log(client.observe());
client.close();
```

## Use the low-level transport

```js
const transport = api.createTransport({
  host: '127.0.0.1', port: 25565,
  username: 'Atlas', auth: 'offline'
});
transport.on('error', error => console.error(error.message));
transport.on('packet', (packet, metadata) => {
  const normalized = api.normalize(metadata.name, packet);
  // Consume actual server observations here.
});
```

This provides a Java transport independently of Mineflayer and the planning kernel. It does not create an inventory executor or run a survival controller. Handle errors and connection shutdown in the host application.

`normalize()` copies a received packet before adapting known legacy login dimensions and item slots. `movement()` produces an outgoing packet appropriate to the installed schema:

```js
const outgoing = api.movement({
  position: { x: 1.5, y: 64, z: -2.5 },
  yaw: 90, pitch: 0, onGround: true
});
// Only send a state produced by your movement/physics controller:
// transport.write(outgoing.name, outgoing.params);
```

Minecraft positions and inventory changes remain server-authoritative. Codec round trips alone do not validate movement physics or prove an accepted inventory transaction.

The `digging()` helper shapes a block-dig packet for the selected schema. The caller must still select a valid target and tool, send start/finish at legal times, and wait for a server-confirmed block change and pickup:

```js
const start = api.digging({
  position: {x: 1, y: 64, z: 2}, phase: 'start', face: 1
});
// transport.write(start.name, start.params);
```

The experimental `createVanillaCompatibilityProfile(version)` bridges older vanilla packet layouts into the current client for lab testing. Register it explicitly; it is not a blanket compatibility promise:

```js
import {createVanillaCompatibilityProfile, registerVersionProfile}
  from 'overmindmc/connect';
const unregister = registerVersionProfile(createVanillaCompatibilityProfile('1.20.4'));
// Create and run the client; call unregister() after closing it.
```

## Add a complete version profile

```js
import { registerVersionProfile } from 'overmindmc/connect';

const unregister = registerVersionProfile({
  version: 'your-version',
  experimental: true,
  loadRegistry,
  createProtocolClient,
  worldOptions: { chunkFactory, blockFactory },
  normalizeIncoming,
  encodePacket,
  install,
  readRecipes,
  afterTick
});
```

The two required functions load the version's registry and create its protocol transport. Optional hooks adapt incoming packets before native handlers, outgoing packets, chunk/block factories, recipes and additional tick inputs. A registered profile is resolved by `OMConnect` when creating a client for that exact version. Registrations cannot replace a native profile or another registration. Call `unregister()` to remove the profile.

An adapter must cover more than login: chunk geometry and height, item slots and click acknowledgements, entities and relative movement, abilities, chat/auth requirements, block interaction, respawn and dimension changes. Label its status as experimental until these paths have been checked on the corresponding Minecraft version.

Run the codec and package tests with `npm.cmd test` and `npm.cmd run release:check`. Live version evidence belongs in a separate test report with the version, server type, accepted actions and any corrections.
