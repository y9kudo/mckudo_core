# Errors

Author: y9kudo. API versions 0.7.0; old archive `dev.0` it's not.

The error message is for the person, `code` — for the programme. Don't choose a strategy for words «route» in the communication.

```js
import { OMActionError } from 'omconnect';

try {
  await client.execute({ skill: 'navigate', args: { x: 10, y: 64, z: 5 } });
} catch (error) {
  if (error instanceof OMActionError) {
    console.log(error.code, error.evidence);
  } else {
    throw error; // Cancel, breakup and other errors retain their meaning.
  }
}
```

| Code | Value |
|---|---|
| `START_UNSUPPORTED` | Ground planner didn't confirm a free place at the feet/head and full support |
| `NO_PATH` | No path found in the observed area with the current rules |
| `SEARCH_BUDGET` | Search has exhausted knot budget |
| `STALE_WORLD` | Initial position changed during planning |
| `STEP_STALLED` | Step budget expired |
| `OCCUPIED` | Could not clear the passage or bypass the players for limited re-engineering |
| `SERVER_CORRECTION` | The server has corrected the agent's position several times |
| `SUPPORT_CHANGED` | Passage or support changed during route |
| `ACTION_FAILED` | Undefined error |

`planRoute()` and `planRouteAsync()` Returned `failure` At the side of the rejected route. The perpetrator `navigate` converts this result into `OMActionError`. Old and other skills can continue to return ordinary mistakes; cancellation does not become proof of impossibility.

For `START_UNSUPPORTED` Field `evidence` contains `complete` and map of scalar facts: Leg position, mode `ground` and the blocks read. `blockEvidenceValue(block)` Returns a comparable status line/Form, for an unknown block — `null`. The facts are linked to the world version; Comparison ID You can't have different versions.

`complete=false` means, I'm sure the unsub block has prevented the inspection. This recording does not prove an obstacle. Even `complete=true` Confirms the failure of the current ground model, Not universal physical impossibility.

Information on budget overruns, Neighbouring players and server correction are not a permanent ban. Waiting period, Rechecking and sharing experience is a tool or brain of the agent.
