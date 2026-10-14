# Forge, NeoForge and Fabric

Project priority: **new Forge and NeoForge**. Fabric retained as a subsequent direction. Verification of sources: 22 September 2026 Year.

| Integration | What is in 0.2.0 | What isn't yet |
|---|---|---|
| Vanilla / Mineflayer | JavaScript-adapter for eat, gather, goto; Example and simulation test API | The test entry of this assembly into the real game world |
| Forge | Verification bridge-contracts, loader and capabilities; Fashion skills names | Play Java-Fashion, transport and `.jar` |
| NeoForge | Same contract with mandatory match loader | Play Java-Fashion, transport and `.jar` |
| Fabric | Extended contract and transport simulation test | Game adapter; direction postponed |

**Test bridge with `loader: "forge"` is not a test at Forge-server.** The compatibility with arbitrary fashion pack has not yet been declared.

## Which new versions to look for

- [Official page Forge](https://files.minecraftforge.net/net/minecraftforge/forge/) as at the date of verification Minecraft **26.3**, assembly **66.0.2**. This is the main new candidate for the Forge-adapter.
- B [official Maven NeoForge](https://maven.neoforged.net/releases/net/neoforged/neoforge/) Accompanied branch **26.2**, including [26.2.0.62](https://maven.neoforged.net/releases/net/neoforged/neoforge/26.2.0.62/). On this test, assembly NeoForge for 26.3 Not found in index. We don't think it's a publication [migration management 26.3](https://docs.neoforged.net/primer/docs/26.3/) proof of the pre-assembly of the loader.
- For the modern Java-parts required **JDK 25**: This is indicated in [of the relevant instructions NeoForge](https://github.com/neoforged/Documentation/blob/main/docs/gettingstarted/index.md). JS-Core-still working for Node.js.

The exact versions of downloaders need to be fixed in future Gradle-After selection and assembly of game adapters. Not yet in this repository Java-code, which would be awarded for verified integration.

## Why You Need a Special Play Fashion

Fashion Adds its Items, menu, Opportunities and networking. Their channels and processors differ: [Forge SimpleImpl](https://docs.minecraftforge.net/en/1.20.x/networking/simpleimpl/), [NeoForge payloads](https://docs.neoforged.net/docs/networking/payload/), [Fabric networking](https://docs.fabricmc.net/develop/networking). References describe the mechanisms of their versions, not guarantee compatibility of one Java-Files with all versions.

Our architecture: JSON → JS-Core → bridge-Transport → Fashion inside a real client Minecraft. Maud receives observations from the playbooks and performs authorized actions on the game stream. For compatibility with client fashions, it's preferable to pretending Forge-by the customer through the usual Mineflayer. This architecture still requires the implementation of the game component.

## Contract bridge v1

```js
import { createBridgeAdapter } from 'overmindmc/adapters/bridge';
const adapter = await createBridgeAdapter({
  expectedLoader: 'neoforge',
  transport: yourImplementedTransport
});
```

Transport is required to carry out four operations:

| Operation | Entry | Response |
|---|---|---|
| `describe()` | No | `{ protocolVersion: 1, loader, minecraftVersion, skills: [...] }` |
| `observe({ signal })` | Cancellation of observation | Normal JSON of the world |
| `execute({ requestId, action })` | Unique ID, skills and args | `{ ok: true }` either `{ ok: false, message }` After actual completion |
| `cancel({ requestId })` | ID Current status | `{ stopped: true }` Only after actual stop |

Client bridge It doesn't work out just because, I'm sure the request is sent. If the stop is not confirmed or the connection is lost without effect, adapter locked to new connection. `execute()` must end after stop; Core doesn't start a new job, Until it happened.

Network transport needs to be separately licensed, Limitation of the size of communications, Checking the request identifiers and processing the deactivation of the client. Real game fashion must perform actions through game fashions API on the right stream and only to communicate the real possibilities. From JavaScript cannot be considered as having been created without confirmation, unit destroyed or activated.

Items and skills use full names: `minecraft:oak_log`, `create:brass_ingot`, `my_mod:activate_machine`. Support namespace already in the regulations and bridge-contract; Working with a particular machine still requires a separate skill.
