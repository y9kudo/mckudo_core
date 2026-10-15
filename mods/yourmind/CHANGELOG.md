# YourMind alpha1.0

- Renamed the client mod version to `alpha1.0`; OvermindMC's separate package version is unchanged.
- Added bounded in-world route/node rendering, selected mining-block and candidate outlines, goal coordinates, labeled waypoints, selections and protected regions.
- Added a status HUD, per-layer toggles, label/distance budgets and optional through-terrain debug rendering.
- Expanded to 56 canonical commands with paged help, aliases and client-command suggestions.
- Added relative destinations, visible-player following/approach, heading exploration, waypoint patrols, explicit pickup, crafting-only, equipment, food and bounded item-drop jobs.
- Added a 16-entry FIFO task queue, repeat, skip, retry, route refresh and queue inspection.
- Added per-server/single-player-folder and per-dimension waypoints, home and edit protection, with bounded validated configuration save/load.
- Anchored crop search at its starting position and kept protected blocks out of mining, harvesting and workstation placement.
- Made sprint, jump, route budgets, turn speed, observation radius and task timeout configurable. Disabling jump now removes jump edges from route planning.
- Added tests for every advertised command, invalid/nested queue input, atomic limits/imports, world isolation, protection boundaries, debug geometry budgets and configuration round trips.

Compilation and automated checks are recorded separately from live-client gameplay and visual verification. The full JavaScript OvermindMC brain is not embedded in this Java client mod.
