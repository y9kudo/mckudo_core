# YourMind alpha1.0 command reference

Commands are local: use the `#` prefix or `/yourmind`. Aliases do not count as separate commands.

| Command | Arguments and behavior |
| --- | --- |
| `#help` | [page] - show help |
| `#version` | - show version and author |
| `#status` | - inspect current task |
| `#pos` | - show position and dimension |
| `#inventory` | [filter] - list inventory |
| `#recipes` | [item] - inspect server crafting recipes |
| `#blocks` | [filter] - search block identifiers |
| `#settings` | - list settings |
| `#goto` | <x y z or waypoint> - walk to destination |
| `#offset` | <dx dy dz> - move relative to position |
| `#forward` | [distance] - route ahead |
| `#back` | [distance] - route behind |
| `#left` | [distance] - route left |
| `#right` | [distance] - route right |
| `#up` | [distance] - route to higher ground |
| `#down` | [distance] - route to lower ground |
| `#come` | <player> - approach a visible player |
| `#follow` | <player> [distance] - follow a visible player |
| `#explore` | [distance] - explore along current heading |
| `#patrol` | <waypoint...> - cycle named waypoints |
| `#sethome` | - save current location as home |
| `#home` | - walk to this world's home |
| `#goal` | [here or clear or x y z or waypoint] - inspect/set a goal marker |
| `#path` | - walk to the configured goal |
| `#mine` | <block or #tag or comma-list> [count] - mine matching blocks |
| `#get` | <item> [total] - collect/craft an inventory target |
| `#craft` | <item> [amount] - craft from existing materials |
| `#farm` | [radius] - harvest and replant mature crops |
| `#collect` | [item or all] [amount] - collect dropped items |
| `#find` | <block or #tag> - highlight matching observed blocks |
| `#look` | <x y z or player> - look smoothly at a target |
| `#equip` | <item> - equip an inventory item |
| `#eat` | - eat available food |
| `#drop` | <item> [amount] - drop requested items |
| `#stop` | - stop and clear queue |
| `#pause` | - release controls and pause |
| `#resume` | - continue current task |
| `#retry` | - clear failures and retry |
| `#repath` | - refresh terrain and route |
| `#tasks` | - inspect current and waiting tasks |
| `#queue` | <command> - append a task |
| `#repeat` | <1..16> <command> - queue repeated tasks |
| `#skip` | - skip to next queued task |
| `#clearqueue` | - clear waiting tasks |
| `#waypoint` | <add or remove or goto or list or clear> [name] [x y z] |
| `#pos1` | [x y z] - first selection corner |
| `#pos2` | [x y z] - second selection corner |
| `#selection` | [clear] - inspect/reset selection |
| `#protect` | <name> - protect selected blocks from changes |
| `#unprotect` | <name or all> - remove block protection |
| `#set` | <setting> <value> - change a validated setting |
| `#resetsettings` | - restore default settings |
| `#render` | [on or off] - toggle world overlays |
| `#hud` | [on or off] - toggle status HUD |
| `#save` | - save settings and world markers/protection |
| `#load` | - reload saved configuration |

## Settings

`render`, `hud`, `path`, `targets`, `goal`, `waypoints`, `selection`, `protection`, `labels`, `sprint`, `jump`, and `xray` accept `on/off` or `true/false`.

| Setting | Default | Range |
| --- | --- | --- |
| radius | 24 | 8..48 blocks |
| nodes | 18000 | 1000..50000 expansions |
| timeout | 600 | 30..3600 seconds in client ticks |
| renderdistance | 128 | 16..256 blocks |
| turnspeed | 14 | 2..90 degrees per tick |

Xray defaults to off; all other boolean settings default to on. Use `#set radius 32`, `#set labels off`, `#save`, and `#load`.

Resource counts are total inventory targets for `#get`, additional output for `#craft`, block counts for `#mine`, and additional picked-up items for `#collect`. `#collect all` without an amount clears the nearby pickup area. Queries list bounded results. `#find` pauses with highlighted candidates for inspection; `#skip` advances a waiting queue. Follow and patrol run until stopped or timed out. Heading exploration follows known safe ground segments and pauses when none are available.

Movement does not implicitly dig, fly or place bridges. `#up` and `#down` need an existing safe route. `#look` and player-follow commands require the player to be visible in loaded terrain. Persisted workspaces use the server address or single-player folder plus dimension. Temporary goals, selections and queues are not saved.
