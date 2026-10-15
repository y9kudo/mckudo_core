# Contributing to OvermindMC

OvermindMC is maintained by **y9kudo** under the MIT license. Small, reproducible improvements are welcome.

## Set up a checkout

Use Node.js 24; the minimum version is 22.13.0. Clone the repository and run:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:types
npm.cmd run release:check
```

On Linux and macOS, use `npm` instead of `npm.cmd`. CI runs on Windows and Linux with Node.js 22 and 24. The optional C backend has additional compiled checks on Linux. [Native development](docs/NATIVE-COMPUTE.md).

## Choose the right layer

| Change | Location |
| --- | --- |
| Goals, resource planning, policies and program execution | `src/` |
| Independent connection, world decoding, physics and actions | `packages/omconnect/src/` |
| OMVectorize spatial calculations | Vectorize and navigation modules in OMConnect |
| Local dashboard | `src/dashboard-public/` and `src/dashboard.js` |
| Application examples | `examples/` |
| Public types and guides | `overmindmc.d.ts`, `packages/omconnect/index.d.ts`, `docs/` |

Examples connect and configure the library. Reusable decisions belong in the kernel or client, so applications do not need to copy a second brain into each script.

## Report a useful bug

Use the bug-report form. Include the Minecraft version, server/loader, package version, Node.js version, a minimal program, expected behavior and the observed failure. For gameplay reports, state whether the inventory was empty and whether items, teleports or operator commands were used.

Remove authentication data and unrelated personal information from logs. Keep worlds, texture archives, auth caches and full runtime reports in ignored directories. A short, sanitized evidence summary can accompany a fix.

## Prepare a change

1. Describe the problem and keep the patch focused.
2. Update public types and documentation when an API changes.
3. Validate JSON before changing saved programs or world state. Update the relevant schema when its contract changes.
4. Respect cancellation, bounded computation and the single physical executor. Unknown terrain must remain unknown.
5. Confirm inventory changes, crafting, placement, collection and combat outcomes from server observations.
6. Add a regression test for a meaningful behavioral change. Documentation-only fixes do not need artificial tests.

Before opening a pull request, run the checks relevant to your patch:

```powershell
npm.cmd run validate
npm.cmd test
npm.cmd run test:types
npm.cmd run check:english
npm.cmd run release:check
npm.cmd run test:package
```

The package test installs both archives into a clean consumer. Use `-- --offline` only when dependencies are already cached.

## Explain the evidence

Separate unit tests, simulators and real Minecraft trials. Record the exact version and important environment settings. A connected socket, a sent packet or a passing simulator does not establish completed gameplay. Keep failures visible; they help the next change.

Use English for public code and documentation where possible. Keep discussions respectful, describe concrete behavior and avoid unsupported performance or compatibility claims.
