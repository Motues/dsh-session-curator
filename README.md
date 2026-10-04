# dsh-session-curator

**English** | [中文](README.zh-CN.md)

A DSH (DeepSeek Harness) plugin that adds **session deletion** and **archive management**.

DSH can archive and pin a session but offers no API to delete one. This plugin does the file-level
work itself, and designs deletion as a **recoverable soft delete**: the session directory is moved to
a trash folder together with its metadata, and restoring it puts the session back into its original
workspace.

## Features

| Where | What |
| --- | --- |
| Session row `⋯` menu | **Delete session** — moves it to the trash after a confirmation |
| Settings → **Session manager** | Three tabs — **archived / pinned / trash** — grouped by the session's original workspace folder, with per-row and bulk actions |
| Settings → **Session manager** → **Settings** | Basics (default tab, grouping, **sidebar archived visibility**, row details, order), the installed version, and an upgrade hint with the exact command when npm has a newer release |
| Confirmation dialog | Delete and permanent delete (permanent delete needs an explicit "I cannot undo this" tick) |

Deleting is always reversible: every trashed entry keeps its original workspace folder, title and
deletion time, and running sessions are never touched.

## Install

```powershell
# desktop profile
dsh plugin --profile desktop add dsh-session-curator

# web profile
dsh plugin --profile web add dsh-session-curator
```

From GitHub instead of npm:

```powershell
dsh plugin --profile desktop add github:Motues/dsh-session-curator
```

The command runs pnpm inside that profile and records the package in both `dependencies` and
`dsh.profile.bundles`. Restart DSH to pick up the host half; the client half only needs a page
refresh.

The plugin is build-free and has no npm dependencies: `lib/index.js` is a plain ESM host plugin and
`lib/client.js` is a hand-written client bundle.

## License

[MIT](LICENSE)
