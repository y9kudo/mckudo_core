# Sky diamond: goal-driven crafting and elevated access

Date: **2026-10-15**. Build: **1.0.0-Arthas-beta1**. Author: **y9kudo**.

## Setup and acceptance

The user prepared a Java **1.21.1** offline Survival superflat world with a village, three iron ore blocks and a floating diamond ore block. `RowanSky` started the recorded trial with an **empty inventory**. Village building materials were explicitly available to this trial; automatic structure protection was disabled for this client only.

The example supplied one goal: `{'minecraft:diamond': 1}`. It contained no ordered crafting instructions or fixed ore coordinates. The survival reactor chose dependencies from the connected catalog and observed resources, then executed ordinary crafting, smelting, movement, block placement, mining and pickup. No items, administrative commands or world-edit operations were issued by the test runner.

## Observed result

| Acceptance evidence | Result |
| --- | --- |
| Initial inventory | Empty |
| Prerequisites | Planks, sticks, crafting table, wooden pickaxe, stone pickaxe and furnace crafted |
| Iron preparation | Iron smelted; iron pickaxe crafted |
| Elevated target | Diamond ore at X 22, Y -49, Z 160 |
| Side column | 11 confirmed jump-placements, in batches of 8, 1 and 2 |
| Drop-catching platform | Oak log attached below the ore at X 22, Y -50, Z 160 |
| Mining | Diamond ore mined with an iron pickaxe |
| Authoritative inventory | **1 diamond** after collection |
| Final health / food | **20 / 20** |

The agent remained connected on the platform after the goal completed. A vanished ore block alone would not pass: the runner required the iron-pickaxe craft, successful ore mining, confirmed pillar placements and a diamond in the server-derived inventory.

## Development incidents and interpretation

This was a development trial across **two client sessions**, retaining the same agent, inventory and action journal. In the first session an `entity_equipment` decode failure aborted the action stream. The initial runner continued attempting actions on that aborted stream; it was stopped and corrected to terminate on that condition. The client was reconnected and resumed its existing inventory. The underlying packet-decoding incident was **not reproduced or established as fixed**; diagnostic packet capture was added for a future recurrence.

One later stale-world navigation action recovered through replanning. The recorded start-to-finish interval was approximately 323 seconds, including the diagnostic restart and development intervention. It is **not an uninterrupted autonomy or speed benchmark**.

The result confirms the complete resource-goal chain in this prepared world. It does not show naturally generated iron in an empty superflat world, unrestricted construction heights, a general mining success rate or autonomous Dragon completion.

## Reproduction and regression checks

Use [the trial instructions](../SKY-DIAMOND-TRIAL.md) and [goal-only launcher](../../examples/sky-diamond-live.js). The new behavior lives in the core's survival reactor and elevated-access planner, not in the launcher.

`npm.cmd run check` passed **623 tests**, with zero failures, skips or cancellations. Five new regressions exercise known clearance and material budgets, verified partial-column reuse, staging-level soil collection, actual reactor sequencing through construction/mining and material procurement before ascent. Strict public TypeScript checks also passed.

The frozen detailed report and raw session logs remain ignored local data. This document is the curated public record.
