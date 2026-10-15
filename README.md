# dsh-session-curator

**English** | [中文](README.zh-CN.md)

A DSH (DeepSeek Harness) plugin that adds **session deletion** and **archive management**.

DSH can archive and pin a session but offers no API to delete one. This plugin does the file-level work itself, and deletion is **permanent**: the session directory and its projection cache are removed from disk. If you want to be able to bring a session back later, **archive it instead** — archiving also hides it from the sidebar and is fully reversible.

## Features

| Where | What |
| --- | --- |
| Session row `⋯` menu | **Delete session** — permanently removes it from disk after a confirmation |
| Settings → **Session manager** | Two tabs — **archived / pinned** — grouped by the session's original workspace folder, with per-row and bulk actions |
| Settings → **Session manager** → **Settings** | Basics (default tab, grouping, **sidebar archived visibility**, row details, order), the installed version, and an upgrade hint with the exact command when npm has a newer release |
| Confirmation dialog | Permanent deletion; it warns that this cannot be undone and hints to use **Archive** instead, and needs an explicit "I cannot undo this" tick |
| Disk usage tab | Read-only totals plus largest / least-recently-opened sessions, each archivable in place |

Deletion is permanent and never touches a running session (or the session currently in use). Anything you want to keep should be archived instead.

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

The command runs pnpm inside that profile and records the package in both `dependencies` and `dsh.profile.bundles`. Restart DSH to pick up the host half; the client half only needs a page refresh.

The published package is dependency-free and needs no build: `lib/` is plain ESM JavaScript(`lib/index.js` for the host half, `lib/client.js` for the client bundle). Sources live in `src/` as TypeScript; contributors run `pnpm install` once and `pnpm run build` (tsc for the host half, esbuild for the client bundle) to regenerate `lib/`.

## License

[MIT](LICENSE)
