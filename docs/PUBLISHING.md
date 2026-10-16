# GitHub and dissemination

Official repository of the author **y9kudo**: [OvermindMC](https://github.com/y9kudo/mckudo_core) and [OMConnect](https://github.com/y9kudo/kudoconnect). Licensing MIT. Version of this issue — **0.6.0**.

## Before publication at GitHub

The project is at its root MIT-licence, README, documents API, tests and workflow CI. B `.gitignore` Deleted currents, Local memory, Dependence and archives npm.

```powershell
npm.cmd run check
npm.cmd run release:check
npm.cmd run test:package
git status --short
```

`release:check` Checks package versions/lock-Files/Public constant, Imports in archives, Local links and lack of documentation runtime-Files. `test:package` Collects both archives, Sets them in a separate provisional annex and checks them API without Mineflayer. By default, the installation uses cache and if necessary npm registry. For unconnected testing: `npm.cmd run test:package -- --offline`; She needs the records of addictions, and their metadata in npm-Cash. One `npm ci` does not guarantee metadata of version ranges.

Playchecks are started separately: `npm.cmd run test:live:agent`. Requires offline-server Java 1.21.1 and a new name through `MC_USER`. Failures maintained; Early survival test is not a victory over a dragon. Methodology and results.

## Communications and releases

Add specific files of your change and write a message about his appointment:

```powershell
git add src/agent-manager.js test/shutdown.test.js
git commit -m "fix(core): close clients when memory saving fails"
git push origin main
```

GitHub Actions Checks **Linux/Windows × Node.js 22/24**. After successful matrix push in `main` Runs the release task: She reads the version `package.json`, Creates a tag `v<version>` on a proven commie and GitHub Release with `.tgz` and `SHA256SUMS.txt`. File required for release `docs/releases/<version>.md`. Existing release unchanged; The existing tag with another commite causes a mistake. The task of the reference uses built-in `GITHUB_TOKEN` with the right `contents: write` Only in my own job.

The source of the independent client is in `packages/omconnect`. The contents of this folder are transferred to a separate repository: code, Types, tests, Documentation, lock-file and CI. The layers OvermindMC, memory, Test worlds and personal settings are not copied. The change in the client in the two repositorys must coincide.

Come in GitHub by regular means through VS Code or Git Credential Manager. Token, don't put it in URL Repository and don't keep it in the originals. `.gitignore` does not delete the already monitored file or its history.

Publication GitHub and publication npm — Different actions. Even before npm Developer can install a library from a local folder, `.tgz` or its own published Git-Repository.

## npm

1. Check the accessibility of the name `mckudo` and the right to publish under that name. If it's occupied, choose a free one scoped-name under its account and new documentation imports.
2. Fill it out `repository.url` and as appropriate `homepage`/`bugs` real address GitHub.
3. Run the tests and check the contents `npm.cmd pack --dry-run`.
4. Come into your own npm-Account and publish only the agreed version. `prepublishOnly` Rejects publication, Goodbye URL Repository not filled.

This one CI Creates GitHub Release, but **does not publish in npm**, does not use games accounts and does not enter Minecraft. Before a separate publication npm Set `.tgz` official GitHub Release: `npm.cmd install C:/path/to/mckudo-0.6.0.tgz`. Self-contained OMConnect shall be installed in the same way; built-in already available via `overmindmc/connect`.
