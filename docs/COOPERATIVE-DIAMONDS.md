# Cooperative test of five agents 0.7

Start test ArKaDiU656, `_FISTFIGHT_`, MrGiraffe6614, DERTKE and LazyP1nk. Everyone needs to get a diamond helmet, breast plate, ♪ Beautiful ♪, Shoes, Kirk, Sword and Axe; four parts of the armor must be worn. Mining decisions, krafte, The libraries are responsible for the creation of a new network of new and more efficient and efficient services OvermindMC and OMConnect.

## Launch on Java 1.21.1

In the local world with the entrance `offline` I need five free slots. Put at least five elites in the first available chest, a minimum 80 Fireworks without explosive stars — Second. Coordinates and inscriptions are optional: Agents are looking for storage in the cupboards they received. Everyone takes only the missing pair of elites and 16 Missiles. Unable chests are in the report; One agent doesn't take the entire reserve of the team.

```powershell
npm.cmd run test:cooperative-diamonds:check
npm.cmd run test:live:cooperative-diamonds
```

Panel: `http://127.0.0.1:4181/`. Time frame for one launch — 30 minutes; Can I ask you something `$env:MC_TEST_MINUTES='120'`. Use it for another port `$env:MC_PORT='25566'`; The number of missiles changes each through `$env:MC_ROCKETS_EACH='32'`. Stop — `Ctrl+C`.

B `data/cooperative-diamonds-live.json` Base and current inventory retained, supplies from the chest, Production phases, Errors, Death, Command messages and gear results. Memory is in `data/cooperative-diamonds-memory`. When reconnected, characters retain server items. Restarting with accumulated items is not considered as a new passage from empty equipment. Up to three normal rebirths are allowed after death; Lost equipment not recovered by team.

`passed` shall only be displayed after checking the full five. The existence of reports or reserves of resources does not in itself prove the successful exchange or extraction of diamonds. Getting an elite also separate from confirmed flight: This scenario checks resources and cooperation.

## Experiment 26.3

Intactly tested profiles OMConnect Now — 1.21 and 1.21.1. server 26.3 was discovered under the protocol 777. The experimental client went in and got cups, But the connection closed after the first game tick. Then the test was moved back to 1.21.1. Support 26.3 **Not confirmed**.

Research adapter `createJava263Profile` connected via `new OMConnect(options,{versionProfile})`. It's separated from the standard addictions. For playback by the developer:

```powershell
node scripts/setup-java263.js
node examples/version263-smoke.js
```

Isolated Idea Catalogue — `data/compat263/runtime`, The versions are fixed in `examples/compat263-runtime.package.json`; Package sets disabled. Used BSD/MIT Forky [of the Protocol](https://github.com/wupengabc/node-minecraft-protocol), [Catalogues](https://github.com/wupengabc/node-minecraft-data) and [chunks](https://github.com/wupengabc/prismarine-chunk). In the main branch PrismarineJS [integration 26.3](https://github.com/PrismarineJS/node-minecraft-protocol/pull/1532) and [New entity movement format](https://github.com/PrismarineJS/node-minecraft-protocol/pull/1538) still under discussion.

The experiment uses a clearly defined version recipe catalogue, Not the full server recipe graph. The metadata of old entities are temporarily inherited from 26.1.2 and require verification. The hardware clicks are waiting for server sync, without local creation of items. Until sustainable smoke-Test and test production, craft, The profile should not be considered support 26.3.
