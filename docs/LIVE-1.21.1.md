# First game test: vanilla Java 1.21.1

Goal: From empty equipment to be obtained **One vertak and at least four sticks**. The kernel selects a chain of action from the operator catalogue, a Mineflayer performs mining and craft. This is a scenario-specific test, Not fully surviving.

First game test performed 22 September 2026 Year: One out of empty inventory received, four sticks and two remaining boards. [Saved result](results/vanilla-1.21.1.json). There were six actions and two challenges Planner: Delayed selection of the second log resulted in a proper re-engineering. After running, the waiting list for the inventory update added; It was tested by a test with a detainee's chin, but no separate live repetition after this correction was performed. This is one successful scenario, Not a complete survival test or all recipes.

## Peace preparation

1. Run vanilla Minecraft Java 1.21.1. A separate server or a world will fit, open LAN. For LAN use the port, The game, Not automatically 25565.
2. The point of arrival of the agent must have available oak logs within the range of the search for adapter (default 128 in blocks 0.4). For the first test, choose a flat area with access to the guns, day and without mobs.
3. The agent should have the right to break blocks. A protected point of appearance or plagiarized protection may prohibit mining.
4. Connect Microsoft uses a game account; If you're playing at the same time, Agent needs a separate account. `offline` Only the world is fit/server, Who really accepts such an entrance; It's not a bypass to the account.

## Start from the source

In the root `mckudo_core` Set up game relationships locally only, without adding them to the kernel:

```powershell
npm.cmd install --no-save --package-lock=false mineflayer mineflayer-pathfinder
```

Set up a connection and start an example:

```powershell
$env:MC_HOST = "127.0.0.1"
$env:MC_PORT = "25565"
$env:MC_VERSION = "1.21.1"
$env:MC_AUTH = "offline"
$env:MC_USERNAME = "OvermindMCAgent"
npm.cmd run demo:brain:mineflayer
```

Replace Port and Account Identifier. Entry Microsoft implemented as instructed Mineflayer in terminal; password not entered in code. For my own offline-Show the servers `MC_AUTH = "offline"` and nick `OvermindMCAgent`.

A separate application of the first test can also be used, Prepared near the library, if present in the work folder. It's not coming into the npm-Core package.

## What to Watch

Printed in terminal `decision:trace` and results of action. The chain usually consists of two mining operations, two crafts of boards, :: Versailles and sticks; order can change from-for initial equipment and reactions.

The result is counted only if the images of the real inventory confirm the text and the sticks. Check if they're in the game. One line «Plan built» Not enough. When achieving the target, the example stops the kernel and leaves the client engaged for inspection. Withdrawal — Ctrl+C.

If oak is not found, target locked with cause. If the block cannot be broken, space or no path, comes `failure`. Unconfirmed effect throws the plan away. Death Pauses the Core; Reconnect and re-re-re-re-enact this short example does not automate.

## Craft restrictions

`times` — number of prescription applications, not number of outputs. Versac and sticks can be manufactured in inventory. For the recipe 3×3 adapter looking for the already established Versac, approaches it and checks the ingredients again. The world's crafting table has not yet been implemented.

Cancellation checked between individual craft operations. B Mineflayer no `AbortSignal` for current transaction `craft`, So the core is waiting for it to be finished before the next operation. Network malfunction requires verification of actual inventory.

Used API: [Mineflayer recipesFor / craft](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md), [implementation craft](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/craft.js), [navigation mineflayer-pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder).
