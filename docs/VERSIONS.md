# Versions Minecraft and OMConnect

The compatibility is checked separately for game data, Transport and administration. One supported protocol number, depending on the function of physics, does not guarantee the operation of physics, windows, equipment and actions OMConnect.

| Profile | Catalogue | Ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, ah, a, | Checking on this server |
|---|---|---|---|
| Java 1.21.1 | Available | Available, offline | Run 0.5.0, rise/and short-term training 0.6.0 |
| Java 1.21 | Available | General protocol profile included 767 | No separate game run |
| Other versions 1.7–26.1 | Depends on the set `minecraft-data` | Need game adapters | Not declared |
| Java 26.3 | There's a metadata number; No complete directory in defined relationship | No | No |

```js
import { listVersionSupport, versionSupport } from './omconnect/index.js';
console.table(listVersionSupport());
console.log(versionSupport('26.3'));
```

`listVersionSupport()` — Light list without all versions of catalogs. `versionSupport(version)` Checks a particular version of the case on a clear request: `known`, `protocol`, `catalog`, `transport`, `native`, `liveTested`. `liveTested` means the previous game profile run, Not certification of all functions of the current change.

Current OMConnect accepts `version: '1.21'` or `'1.21.1'`. The rest of the values deviate from the understandable error before connection. Support for range from 26.3 The platform's development remains a challenge; Fake switch «All versions» no.

For a new profile, the package coding needs to be checked, loading of cups and range of heights, Materials components, window slots and confirmations, Prescriptions, Nomenclature and physics metadata. Then there's a regression test and a game test. Update `minecraft-protocol` does not in itself replace this work.

Sources of dependence: [Transport support](https://github.com/PrismarineJS/node-minecraft-protocol/blob/master/docs/README.md), [data Minecraft](https://github.com/PrismarineJS/minecraft-data). [Java 26.3](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-3) issued; The game is available and adapter ready — different conditions.
