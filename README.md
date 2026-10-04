# dsh-session-curator

**English** | [中文](README.zh-CN.md)

A **DSH (DeepSeek Harness)** plugin that adds **session deletion** and **archive management**.

The official host services only expose `archiveSession` / `unarchiveSession` / `pinSession` /
`unpinSession` — there is no delete API at all. So this plugin does the file-level work itself,
and designs deletion as a **fully recoverable soft delete**.

## Features

| Where | What |
| --- | --- |
| Session row `⋯` menu (`session-curator.delete`, order 500) | **Delete session** → moves it to the trash after confirmation |
| Settings → **Session manager** (section id borrows `archived-sessions`, order 45) | Three tabs — **archived / pinned / trash** — grouped by the session's **original workspace folder**, with per-row and bulk actions |
| Frame-wide overlay (`session-curator.dialog`, order 60) | Delete / permanent-delete confirmations (permanent delete requires ticking "I understand this cannot be undone") |

Each row's right side holds exactly one `⋯` menu: archived = unarchive / pin / move to trash,
trash = restore / delete permanently. The folder row has a small right-hand button that selects the
whole workspace at once. Rows show title, log size and file count, and creation (or deletion) time.

## Install

```powershell
# 1) From npm (most robust)
plugin_manager  install_bundle  target: dsh-session-curator
#    or: dsh plugin add dsh-session-curator

# 2) From GitHub
plugin_manager  install_bundle  target: github:Motues/dsh-session-curator
```

Manually (offline / from a tarball):

```powershell
$src = "the unpacked dsh-session-curator folder"
$dst = "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-session-curator"
Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $src $dst -Recurse -Force
# then append "dsh-session-curator" to dsh.profile.bundles in the profile package.json and restart DSH
```

> ⚠️ **A declared bundle whose package is missing on disk crashes the whole boot** (the boot loader
> fails on the first unresolvable bundle name and the desktop window never opens). To uninstall you
> must delete **both** the `node_modules` folder **and** the `dsh.profile.bundles` line.

The plugin is build-free: `lib/index.js` is a plain ESM host plugin and `lib/client.js` is a
hand-written `window.__ModuleLoader__.load(...)` bundle. **Zero npm dependencies** — drop it in and go.

## Safety model

- **Soft delete.** The session directory is moved wholesale to
  `<DSH_HOME>/storages/session-manager/trash/<sessionId>/`, together with a `__trash.json`
  (original slug, original cwd, title, deletion time) and the original projection cache
  `__projcache.json`. Restore moves it back to `<DSH_HOME>/sessions/<slug>/<sessionId>/` and does its
  best to re-attach the session to its original workspace via `registry.resolveByPath(cwd)` +
  `attachSession`.
- **The trash directory deliberately keeps the old name `session-manager`.** It already holds real
  data (sessions that were genuinely deleted); renaming the path would orphan them. There is a ⚠️
  comment in the code — please don't "tidy it up".
- **Consistent bookkeeping.** Deletion calls `Workspace.detachSession(sessionId)`; archived sessions
  are `unarchiveSession`-ed first and **pinned ones are `unpinSession`-ed first** (otherwise the id
  stays in `pinnedSessionIds` and the session shows up under both *pinned* and *trash*), so a restored
  session lands back where it was.
- **Not `<DSH_HOME>/sessions-trash`** — that name risks being swept up by the session scanner as a
  `sessions*` directory.
- **Running sessions are refused.** Same activity predicate as official archive:
  `ctx.waterfall("workspace/session-activity", …)`, plus `DSH_SESSION_ID` to block deleting the
  session you are currently using.
- **Permanent delete is only available for trash entries**, and requires an explicit checkbox.

## Design constraints (read before changing)

1. **Zero bare-specifier imports.** `$DSH_HOME` → else `~/.dsh` resolution is inlined in
   `lib/index.js`; it deliberately does **not** `import '@deepseek-ai/dsh-home-paths'`. That package
   only exists inside DSH's own `node_modules`, and the plugin usually appears under a profile as a
   junction/symlink — Node resolves bare specifiers through **realpath**, so the import would fail
   with `Cannot find package …` and the plugin would never load. Zero imports means it runs from
   anywhere.
2. **Use `ctx.connection.fetch.register()`, not `ctx.connection.rpc.handle()`.** The nastiest trap:
   inside `rpc.handle()` the effect owner is **Connection's own ctx** (its inject is only
   `["credentials"]`), so it always throws `cannot get property "webServer" without inject`; the
   plugin fiber ends up `failed`, not a single route is mounted, every client POST falls through to
   the SPA static fallback and answers **HTTP 405** — that was the original
   `transport failure for /session-manager/trash: HTTP 405` (a real error message, kept verbatim).
   Adding `webServer` to the plugin's own inject **does not fix it** — the failing ctx is not the
   plugin's. Instead each endpoint registers one **exact fetch route**
   `/api/session-curator/<endpoint>` under the shared `/api` channel: the Host/Origin/`sec-fetch-site`
   trust checks, browser session-cookie auth and body-size limits still run first in Connection's
   `/api` prefix route, so the plugin still carries zero auth code, while route registration hangs off
   **the plugin's own fiber** and is torn down with it.
3. **The client depends on no Cordis service (but prefers the official one).** It first tries
   `ctx.get('connection').rpc.call('/api', 'session-curator/<endpoint>', payload)`; failing that it
   falls back to a hand-written `fetch` that replicates Connection's wire protocol verbatim. Bad
   envelopes always answer **200 + an error envelope**, so the client reads prose instead of a
   transport exception. **The trust fence and session auth always run host-side.**
4. **`shell.overlay` is a frame-wide overlay with no owner props** — the correct home for a global
   confirmation dialog.
5. **Menu rows are `MenuItemButton` + `onSelect`** (not `onClick`), and closing the menu is the
   owner's call, so the action must call the `setOpen(false)` it got from `useMenuOpenState()` itself.

## Why the settings nav icon is "borrowed"

The settings shell's `navIcon(id)` looks the icon up **by section id**; the table only has `account` /
`models` / `agent-presets` / `plugins` / `archived-sessions`, and everything else falls back to the
default gear. The only unused entry, `archived-sessions`, happens to map to the archive box and fits
this plugin, so it is borrowed — but only after consulting the **slot ledger**: once DSH registers
`archived-sessions` itself, the plugin automatically falls back to its own id (and the gear icon).
To stop borrowing entirely, change `id: sectionIdFor(ctx)` to `id: SECTION_ID` in `apply()` in
`lib/client.js`.

## Hot-reload boundaries (measured)

- **The client half hot-reloads**: `dsh-client-hmr` computes a revision from mtime/size, so editing
  `lib/client.js` takes effect on page refresh.
- **The host half does not**: Node's ESM module cache is **keyed by URL**. Editing `lib/index.js`
  **requires a DSH restart**.
- `cordis.patch.yml` intentionally stays a pure `- insert:` shape, because dshmarket's hot-mount only
  accepts that shape.

## HTTP API

Shared `/api` channel, every route `POST` + `requestBody: 'buffered'`, at
`/api/session-curator/<endpoint>`:

| endpoint | payload | returns |
| --- | --- | --- |
| `snapshot` | `{}` | `{ dshHome, trashDir, sessionsDir, archived[], pinned[], trashed[], totals{} }` |
| `archive` | `{ ids, stopActivity }` | `{ results[], ...snapshot }` |
| `unarchive` / `pin` / `unpin` | `{ ids }` | `{ results[], ...snapshot }` |
| `trash` | `{ ids }` | `{ results[], ...snapshot }` |
| `restore` | `{ ids }` | `{ results[], ...snapshot }` |
| `purge` | `{ ids }` | `{ results[], ...snapshot }` |

The body is Connection's wire envelope
`{ type:'client-request', rpcId, method:'session-curator/<endpoint>', payload }`. A `method` that does
not match the route, or a broken envelope, answers **200 + an error envelope** (error codes
`session-curator/*`) instead of throwing a transport error. `results[]` holds per-item
`{ sessionId, ok }` or `{ sessionId, ok:false, reason }`; one failure does not affect the rest.
`ids` accepts only an array of strings — anything else is treated as empty.

## Troubleshooting

1. `plugin_manager` / `list_plugins`: check the `fiberPhase` of `include:dsh-session-curator` — it
   must be `active`. `failed` means `apply()` threw (the stack only reaches the host logger, not
   Electron's stdout) and **not a single route is mounted**.
2. Whether a route exists can only be asked from a **logged-in page** (the `/api` trust fence runs
   before route matching, so a bare `curl`/`Invoke-RestMethod` against `/api/*` always gets 401 and
   tells you nothing). In the browser console:

   ```js
   fetch("/api/session-curator/snapshot", {
     method: "POST",
     headers: { "content-type": "application/json" },
     body: JSON.stringify({ type: "client-request", rpcId: "probe", method: "session-curator/snapshot", payload: {} })
   }).then(async (r) => [r.status, await r.json()]);
   ```

   - **200 + `{type:'server-response', result:{ok:true, …}}`** = the route is there and working.
   - **404 `not found`** = the route is not registered (the host half is `failed`, or you did not
     restart DSH after editing it).
   - Control: the same fetch against `/api/nope` is always 404 (a route-table miss, not a 404 page).

## Self-check (no running DSH needed)

```powershell
npm test                       # runs the three below, in order
node scripts/smoke.mjs         # domain logic + wire protocol (fake ctx + real Request + real filesystem)
node scripts/activation.mjs    # host-half activation (real cordis, extracted from app.asar) + manifest metadata
node scripts/client.mjs        # client half: grouping logic + a mini-React render of the settings panel
```

Measured locally: `client.mjs` **59/59**, `smoke.mjs` **14/14**, `activation.mjs` **17/17**.
`activation.mjs` prints SKIP and exits when it cannot find `app.asar`; point `$env:DSH_APP_ASAR` at one
to force it.

## Layout

```
dsh-session-curator/
├── package.json          # dsh.bundle.patch / dsh.client / icon / locale exports
├── cordis.patch.yml      # pure - insert shape, hot-mountable by dshmarket
├── icon.svg              # plugin artwork (36 grid, self-coloured; the card renders it via <img>)
├── locale/{zh,en}.json   # card title / description
├── lib/index.js          # host half: file-level soft delete + archive management + exact /api routes
├── lib/client.js         # client half: menu item + confirm dialog + settings panel
└── scripts/*.mjs         # the three self-checks
```

## Name history

The plugin started as `dsh-session-manager`, which is **taken on npm** (lesterq's 0.6.2 — same niche,
more features; `dsh-session-hub`, `dsh-sessions`, `dsh-session-trash` and `dsh-session-organizer` are
taken too). Before the first release it was renamed to **`dsh-session-curator`**: package name,
`cordis.patch.yml` `id`/`name`, RPC route prefix, error codes, locale namespace, client module ids and
slot ids all use the new name.

Two places **intentionally keep the old name**: the trash directory
`<DSH_HOME>/storages/session-manager/trash` (it holds real data) and the historical error message
`transport failure for /session-manager/trash: HTTP 405` (rewriting it would make it untrue).

## Compatibility

```json
"engines": { "node": ">=20", "dsh": ">=0.2.0-rc.2 <0.2.1-0" }
```

Compatibility is declared only for host versions actually tested. Peers list just the interface
surfaces this plugin really binds to, and **all of them are `optional: true`**: those `@deepseek-ai/*`
packages are injected by the runtime and never published, so without `optional` pnpm would look for
them on the registry, 404, and need a retry. Only tested on Windows, hence no `os` field.

## License

[MIT](LICENSE)
