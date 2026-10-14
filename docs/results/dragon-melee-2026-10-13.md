# The Dracon of the Krajya test · Java 1.21.1

**Peace:** Local vanilla-server 127.0.0.1:25565, offline-Incoming. **Agent:** Avery07, OMConnect and OvermindMC 0.7.0-dev.0 with current changes. The equipment was issued through the chest «Equipment»; It's a battle test, Not the passage from empty equipment. Implementation report maintained locally in `data/end-v07-trial.json` And doesn't fit into the package.

First, correct the false drop signal on the stairs: The previous processor spent eight pearls and interrupted the rise. The rerun after the correction did not cause any emergency rescue at the stairs. Crystal behind bars was opened from its pole and its destruction was confirmed by the server. The next runs revealed, I'm sure the onion is enchanted «Infinity»: No arrows were spent, Though the wear of the bow has grown. The wear check now confirms the arrow fired; The total dragon strikes are accounted for separately.

In the final run with 20:13:42 to 20:14:53 UTC 12 October agent did 30 actions, including 12 confirmed shots and four blows to the head of the sitting dragon. For all four strikes, the server confirmed the damage; The agent tried to perform a critical blow during the fall. No separate critical multiplier server sign in the log, So, `criticalAttempted` does not mean proven critter. The event of the dragon's death came from `confirmed: true`, `ownDamageConfirmed: true`, `ownHitCount: 14`. At the end of the agent's 20 Health, The dragon died. Test ended after receipt of this event.

There was no fall in the final run, So the automatic water installation and the emergency drop of pearls in the real fall are not confirmed here. They have separate automatic tests and geometric checks on loaded cups.
