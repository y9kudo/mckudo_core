# Exchange with piglins and safety of Neser

Author: **y9kudo**. Changes in assembly after 0.7.0; game profile Java 1.21.1. OMConnect Act, a Resource selection, partners and routes remain in the annex or OvermindMC.

```js
const result = await client.execute({
  skill: 'barter', args: { entityId: '42' }
});
```

Preconditions: live client in Neser, Health better 8, Observed **Adult** A normal piglin, Gold detail of armor, clique in inventory and free slot. Brutus, children, unknown age and recently attacked partner rejected. Transfers are performed by normal interaction `use_entity`, after an accessible approach and testing.

The perpetrator awaits a confirmed flow of one ingot, then to 8 For seconds, watching new objects that fell out next to you. The result contains `serverConfirmed`, `consumed`, `entityId`, `dropsObserved` and `rewardConfirmed: false`. The last one is intentionally left `false`: The fallen object has no author, So the client can't prove, That a foreign object is a reward. Select a specific item to be observed `collect` and check the equipment.

`metrics.barterGoldSpent` considers the server supported costs, including exchange, The waiting for which the threat was then interrupted. If the clique was not accepted, Action doesn't indicate success. Event `barter` the end of the observation; It doesn't mean that pearls are received.

Materials `bridgeTo`, `navigate` and `pillar` in Nezer excludes combustible wood. `bridgeMaterials(..., { dimension: 'minecraft:the_nether' })` allows an application to receive the same list. Crimson and distorted boards are suitable. `waterGuard`/`waterClutch` Reversed before dispatching the installation package; The drop reaction doesn't choose water in Neser.

The middle battle is turning to the target at a reduced speed, rechecks distance and visibility before the package. If the target has gone at the time of turning, `combat` continues next shot. Event `attackSent` means only the attack sent; confirmed damage occurs separately through `damage`.

Automatic tests check protocol on models. Real Nezer march and full resource result requires server testing.
