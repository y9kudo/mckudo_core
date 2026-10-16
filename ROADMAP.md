# Roadmap

OvermindMC is a Minecraft Java agent library maintained by y9kudo. The current published build and installation instructions are in [README](README.md); completed changes are recorded in [CHANGELOG](CHANGELOG.md).

## Stable Arthas acceptance

- Complete a Survival campaign from an empty inventory to the agent's own confirmed Ender Dragon defeat on a fixed build.
- Resolve observed navigation, resource acquisition, recovery and combat failures through reusable kernel policies and regression tests.
- Verify the public APIs, type declarations and installation archives on the supported CI platforms.
- Keep operational worlds and player journals private while publishing reproducible API tests and a clear summary of verified capabilities.

See [release readiness](docs/V1-READINESS.md) and [quality policy](docs/QUALITY.md) for acceptance requirements. An unfinished engineering campaign is not a stable-release result.

## Compatibility

- Expand gameplay-tested Minecraft versions separately from protocol/registry discovery.
- Validate authentication, inventory transactions, movement and recipes for each supported transport profile.
- Extend mod recipe adapters with explicit machine capabilities and observed execution outcomes.

See the [version API](docs/VERSION-API.md) for the existing compatibility model.

## Planning and learning

- Reuse more spatial search work after relevant world changes while preserving safety and cancellation budgets.
- Improve prerequisite planning, recovery after equipment loss and coordination over shared resources.
- Evaluate learned policies against fixed baselines with bounded compute and disclosed training evidence.

The [planning guide](docs/PLANNING.md) describes the current implementation and its public interfaces.

## Developer tools

- Improve visual program editing, live route inspection and actionable failure explanations.
- Keep JavaScript applications concise while exposing advanced configuration through documented APIs.
- Add integrations only when their measured benefit justifies their runtime and maintenance cost.
